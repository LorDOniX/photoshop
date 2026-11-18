export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Hodnota, od které se pixel považuje za „vybraný“ (obrys, binární operace). */
const THRESHOLD = 128;

/**
 * Výběr jako maska 0..255 o velikosti dokumentu. Instance je **neměnná** – každá operace
 * vrací novou masku, takže je lze bez kopírování ukládat do historie.
 */
export class SelectionMask {
  readonly data: Uint8ClampedArray;
  private cachedBounds: Bounds | null | undefined;
  private cachedOutline: Float32Array | undefined;

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8ClampedArray,
  ) {
    this.data = data ?? new Uint8ClampedArray(width * height);
  }

  static all(width: number, height: number): SelectionMask {
    const m = new SelectionMask(width, height);
    m.data.fill(255);
    return m;
  }

  static rect(width: number, height: number, r: Bounds): SelectionMask {
    const m = new SelectionMask(width, height);
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width, Math.ceil(r.x + r.width));
    const y1 = Math.min(height, Math.ceil(r.y + r.height));
    for (let y = y0; y < y1; y++) m.data.fill(255, y * width + x0, y * width + x1);
    return m;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x];
  }

  isEmpty(): boolean {
    return this.bounds() === null;
  }

  /** Nejmenší obdélník obsahující všechny nenulové pixely. */
  bounds(): Bounds | null {
    if (this.cachedBounds !== undefined) return this.cachedBounds;
    const { width: w, height: h, data } = this;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let first = -1;
      for (let x = 0; x < w; x++) {
        if (data[row + x]) {
          first = x;
          break;
        }
      }
      if (first < 0) continue;
      let last = first;
      for (let x = w - 1; x > first; x--) {
        if (data[row + x]) {
          last = x;
          break;
        }
      }
      if (first < minX) minX = first;
      if (last > maxX) maxX = last;
      if (y < minY) minY = y;
      maxY = y;
    }
    this.cachedBounds = maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    return this.cachedBounds;
  }

  private map(fn: (a: number, i: number) => number): SelectionMask {
    const out = new Uint8ClampedArray(this.data.length);
    for (let i = 0; i < out.length; i++) out[i] = fn(this.data[i], i);
    return new SelectionMask(this.width, this.height, out);
  }

  /** Kombinace s dalším tvarem podle režimu výběru. */
  combine(shape: SelectionMask, mode: SelectionMode): SelectionMask {
    const b = shape.data;
    switch (mode) {
      case 'replace':
        return shape;
      case 'add':
        return this.map((a, i) => Math.max(a, b[i]));
      case 'subtract':
        return this.map((a, i) => (a * (255 - b[i])) / 255);
      case 'intersect':
        return this.map((a, i) => Math.min(a, b[i]));
    }
  }

  invert(): SelectionMask {
    return this.map((a) => 255 - a);
  }

  /** Prolnutí okraje (3× box blur ≈ Gaussovo rozostření). */
  feather(radius: number): SelectionMask {
    const r = Math.round(radius);
    if (r < 1) return this;
    const out = new Uint8ClampedArray(this.data);
    const tmp = new Uint8ClampedArray(out.length);
    const pass = Math.max(1, Math.round(r / 2));
    for (let i = 0; i < 3; i++) {
      boxBlur(out, tmp, this.width, this.height, pass, true);
      boxBlur(tmp, out, this.width, this.height, pass, false);
    }
    return new SelectionMask(this.width, this.height, out);
  }

  /** Rozšíření o `radius` px (binárně, čtvercové jádro). */
  expand(radius: number): SelectionMask {
    const r = Math.round(radius);
    if (r < 1) return this;
    return new SelectionMask(this.width, this.height, dilate(this.binary(), this.width, this.height, r));
  }

  /** Zúžení o `radius` px. Okraje plátna se nezužují (stejně jako ve Photoshopu). */
  contract(radius: number): SelectionMask {
    const r = Math.round(radius);
    if (r < 1) return this;
    const inverted = this.binary().map((v) => 255 - v);
    const grown = dilate(inverted, this.width, this.height, r);
    return new SelectionMask(this.width, this.height, grown.map((v) => 255 - v));
  }

  /** Pás o šířce `width` px kolem okraje výběru. */
  border(width: number): SelectionMask {
    const half = Math.max(1, Math.round(width / 2));
    return this.expand(half).combine(this.contract(half), 'subtract');
  }

  /** Vyhlazení zubatých okrajů (rozostření + práh). */
  smooth(radius: number): SelectionMask {
    if (radius < 1) return this;
    return this.feather(radius).map((v) => (v >= THRESHOLD ? 255 : 0));
  }

  private binary(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.data.length);
    for (let i = 0; i < out.length; i++) out[i] = this.data[i] >= THRESHOLD ? 255 : 0;
    return out;
  }

  /**
   * Obrys výběru jako úsečky po hranách pixelů: [x0, y0, x1, y1, ...].
   * Sousední hrany na řádku/sloupci se slučují, aby jich bylo co nejméně.
   */
  outline(): Float32Array {
    if (this.cachedOutline) return this.cachedOutline;
    const b = this.bounds();
    const segs: number[] = [];
    if (b) {
      const { width: w, height: h, data } = this;
      const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= THRESHOLD;
      const x0 = b.x;
      const x1 = b.x + b.width;
      const y0 = b.y;
      const y1 = b.y + b.height;
      for (let y = y0; y <= y1; y++) {
        let start = -1;
        for (let x = x0; x <= x1; x++) {
          const edge = x < x1 && inside(x, y - 1) !== inside(x, y);
          if (edge && start < 0) start = x;
          else if (!edge && start >= 0) {
            segs.push(start, y, x, y);
            start = -1;
          }
        }
      }
      for (let x = x0; x <= x1; x++) {
        let start = -1;
        for (let y = y0; y <= y1; y++) {
          const edge = y < y1 && inside(x - 1, y) !== inside(x, y);
          if (edge && start < 0) start = y;
          else if (!edge && start >= 0) {
            segs.push(x, start, x, y);
            start = -1;
          }
        }
      }
    }
    this.cachedOutline = Float32Array.from(segs);
    return this.cachedOutline;
  }
}

/** Jeden průchod box blur (vodorovně nebo svisle) s klouzavým součtem; okraje se prodlužují. */
function boxBlur(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, horizontal: boolean): void {
  const lines = horizontal ? h : w;
  const len = horizontal ? w : h;
  const stride = horizontal ? 1 : w;
  const size = r * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w : line;
    const at = (i: number) => src[base + Math.max(0, Math.min(len - 1, i)) * stride];
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += at(i);
    for (let i = 0; i < len; i++) {
      dst[base + i * stride] = sum / size;
      sum += at(i + r + 1) - at(i - r);
    }
  }
}

/** Binární dilatace čtvercem (2r+1) v O(n): vzdálenost k nejbližšímu vybranému pixelu po řádcích, pak po sloupcích. */
function dilate(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const rows = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) dilateLine(src, rows, y * w, 1, w, r);
  const out = new Uint8ClampedArray(src.length);
  for (let x = 0; x < w; x++) dilateLine(rows, out, x, w, h, r);
  return out;
}

function dilateLine(src: Uint8ClampedArray, dst: Uint8ClampedArray, base: number, stride: number, len: number, r: number): void {
  let dist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < len; i++) {
    dist = src[base + i * stride] ? 0 : dist + 1;
    dst[base + i * stride] = dist <= r ? 255 : 0;
  }
  dist = Number.POSITIVE_INFINITY;
  for (let i = len - 1; i >= 0; i--) {
    dist = src[base + i * stride] ? 0 : dist + 1;
    if (dist <= r) dst[base + i * stride] = 255;
  }
}
