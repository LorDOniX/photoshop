import { luma } from './adjust';
import type { Rect } from './canvas';
import { parseHex } from './color';

/*
 * Filtry (menu Filtr) – čisté funkce nad RGBA obrázkem bez DOM. Rozostření pracují s předem vynásobenou
 * alfou, aby průhledné okolí neztmavilo okraje. Popis filtru je obyčejný objekt (`Filter`), aby šel zopakovat
 * (Poslední filtr) a uložit.
 */

export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type Filter =
  | { kind: 'average' }
  | { kind: 'gaussianBlur'; radius: number }
  | { kind: 'boxBlur'; radius: number }
  | { kind: 'motionBlur'; angle: number; distance: number }
  | { kind: 'addNoise'; amount: number; gaussian: boolean; monochromatic: boolean; seed: number }
  | { kind: 'despeckle' }
  | { kind: 'median'; radius: number }
  | { kind: 'sharpen' }
  | { kind: 'sharpenMore' }
  | { kind: 'unsharpMask'; amount: number; radius: number; threshold: number }
  | { kind: 'highPass'; radius: number }
  | { kind: 'offset'; dx: number; dy: number; mode: 'wrap' | 'repeat' | 'transparent' }
  | { kind: 'mosaic'; size: number }
  | { kind: 'colorToAlpha'; color: string }
  | { kind: 'radialBlur'; mode: 'spin' | 'zoom'; amount: number }
  | { kind: 'twirl'; angle: number }
  | { kind: 'pinch'; amount: number }
  | { kind: 'spherize'; amount: number }
  | { kind: 'ripple'; amount: number; size: number }
  | { kind: 'polar'; toPolar: boolean }
  | { kind: 'findEdges' }
  | { kind: 'emboss'; angle: number; height: number; amount: number }
  | { kind: 'solarize' }
  | { kind: 'clouds'; fg: string; bg: string; scale: number; seed: number };

export type FilterKind = Filter['kind'];
export type FilterOf<K extends FilterKind> = Extract<Filter, { kind: K }>;

export const FILTER_NAMES: Record<FilterKind, string> = {
  average: 'Průměr',
  gaussianBlur: 'Gaussovské rozostření',
  boxBlur: 'Rámečkové rozostření',
  motionBlur: 'Rozostření pohybem',
  addNoise: 'Přidat šum',
  despeckle: 'Odstranit skvrny',
  median: 'Medián',
  sharpen: 'Zostřit',
  sharpenMore: 'Zostřit více',
  unsharpMask: 'Maska rozostření',
  highPass: 'Horní propust',
  offset: 'Posun',
  mosaic: 'Mozaika',
  colorToAlpha: 'Barva na alfu',
  radialBlur: 'Radiální rozostření',
  twirl: 'Zkroucení',
  pinch: 'Sevření',
  spherize: 'Kulovitost',
  ripple: 'Zvlnění',
  polar: 'Polární souřadnice',
  findEdges: 'Najít hrany',
  emboss: 'Reliéf',
  solarize: 'Solarizace',
  clouds: 'Mraky',
};

/** Výchozí hodnoty (Photoshop, kde dávají smysl). */
export function defaultFilter<K extends FilterKind>(kind: K): FilterOf<K> {
  const all: { [P in FilterKind]: FilterOf<P> } = {
    average: { kind: 'average' },
    gaussianBlur: { kind: 'gaussianBlur', radius: 4 },
    boxBlur: { kind: 'boxBlur', radius: 5 },
    motionBlur: { kind: 'motionBlur', angle: 0, distance: 20 },
    addNoise: { kind: 'addNoise', amount: 12.5, gaussian: true, monochromatic: false, seed: 1 },
    despeckle: { kind: 'despeckle' },
    median: { kind: 'median', radius: 2 },
    sharpen: { kind: 'sharpen' },
    sharpenMore: { kind: 'sharpenMore' },
    unsharpMask: { kind: 'unsharpMask', amount: 100, radius: 1, threshold: 0 },
    highPass: { kind: 'highPass', radius: 10 },
    offset: { kind: 'offset', dx: 0, dy: 0, mode: 'wrap' },
    mosaic: { kind: 'mosaic', size: 10 },
    colorToAlpha: { kind: 'colorToAlpha', color: '#ffffff' },
    radialBlur: { kind: 'radialBlur', mode: 'spin', amount: 10 },
    twirl: { kind: 'twirl', angle: 50 },
    pinch: { kind: 'pinch', amount: 50 },
    spherize: { kind: 'spherize', amount: 100 },
    ripple: { kind: 'ripple', amount: 100, size: 16 },
    polar: { kind: 'polar', toPolar: true },
    findEdges: { kind: 'findEdges' },
    emboss: { kind: 'emboss', angle: 135, height: 3, amount: 100 },
    solarize: { kind: 'solarize' },
    clouds: { kind: 'clouds', fg: '#000000', bg: '#ffffff', scale: 128, seed: 1 },
  };
  return structuredClone(all[kind]) as FilterOf<K>;
}

/** O kolik px filtr čte za okraj upravované oblasti (kontext kolem výběru). */
export function filterReach(f: Filter): number {
  switch (f.kind) {
    case 'gaussianBlur':
    case 'highPass':
      return Math.ceil(f.radius * 3) + 1;
    case 'unsharpMask':
      return Math.ceil(f.radius * 3) + 1;
    case 'boxBlur':
    case 'median':
      return Math.ceil(f.radius) + 1;
    case 'motionBlur':
      return Math.ceil(f.distance / 2) + 1;
    case 'despeckle':
    case 'sharpen':
    case 'sharpenMore':
    case 'findEdges':
      return 3;
    case 'emboss':
      return Math.ceil(f.height) + 2;
    default:
      return 0;
  }
}

// ---- předem vynásobená alfa ----

function premultiply(src: Img): Float32Array {
  const d = src.data;
  const out = new Float32Array(d.length);
  for (let p = 0; p < d.length; p += 4) {
    const a = d[p + 3] / 255;
    out[p] = d[p] * a;
    out[p + 1] = d[p + 1] * a;
    out[p + 2] = d[p + 2] * a;
    out[p + 3] = d[p + 3];
  }
  return out;
}

function unpremultiply(buf: Float32Array, width: number, height: number): Img {
  const data = new Uint8ClampedArray(buf.length);
  for (let p = 0; p < buf.length; p += 4) {
    const a = buf[p + 3];
    if (a <= 0.001) continue;
    const k = 255 / a;
    data[p] = buf[p] * k;
    data[p + 1] = buf[p + 1] * k;
    data[p + 2] = buf[p + 2] * k;
    data[p + 3] = a;
  }
  return { data, width, height };
}

// ---- rozostření ----

/** Rámeček podél jedné osy (běžící součet, okraj se prodlouží). `step` = vzdálenost sousedů v pixelech. */
function boxPass(src: Float32Array, dst: Float32Array, len: number, lines: number, step: number, lineStep: number, r: number): void {
  if (r <= 0) {
    dst.set(src);
    return;
  }
  const inv = 1 / (2 * r + 1);
  const s4 = step * 4;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep * 4;
    const last = base + (len - 1) * s4;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let k = -r; k <= r; k++) {
      const q = k <= 0 ? base : k >= len - 1 ? last : base + k * s4;
      s0 += src[q];
      s1 += src[q + 1];
      s2 += src[q + 2];
      s3 += src[q + 3];
    }
    for (let i = 0, o = base; i < len; i++, o += s4) {
      dst[o] = s0 * inv;
      dst[o + 1] = s1 * inv;
      dst[o + 2] = s2 * inv;
      dst[o + 3] = s3 * inv;
      const add = i + r + 1 >= len ? last : base + (i + r + 1) * s4;
      const rem = i - r <= 0 ? base : base + (i - r) * s4;
      s0 += src[add] - src[rem];
      s1 += src[add + 1] - src[rem + 1];
      s2 += src[add + 2] - src[rem + 2];
      s3 += src[add + 3] - src[rem + 3];
    }
  }
}

/** Svislý rámeček po řádcích (běžící součet celých řádků – paměť se čte souvisle). */
function boxPassV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  if (r <= 0) {
    dst.set(src);
    return;
  }
  const row = w * 4;
  const inv = 1 / (2 * r + 1);
  const sum = new Float32Array(row);
  for (let k = -r; k <= r; k++) {
    const o = Math.min(h - 1, Math.max(0, k)) * row;
    for (let i = 0; i < row; i++) sum[i] += src[o + i];
  }
  for (let y = 0; y < h; y++) {
    const o = y * row;
    const add = Math.min(h - 1, y + r + 1) * row;
    const rem = Math.max(0, y - r) * row;
    for (let i = 0; i < row; i++) {
      dst[o + i] = sum[i] * inv;
      sum[i] += src[add + i] - src[rem + i];
    }
  }
}

/** Svislé Gaussovo jádro po řádcích. */
function gaussPassV(src: Float32Array, dst: Float32Array, w: number, h: number, sigma: number): void {
  const r = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0);
  const row = w * 4;
  dst.fill(0);
  for (let y = 0; y < h; y++) {
    const o = y * row;
    for (let k = -r; k <= r; k++) {
      const kv = kernel[k + r] / total;
      const q = Math.min(h - 1, Math.max(0, y + k)) * row;
      for (let i = 0; i < row; i++) dst[o + i] += src[q + i] * kv;
    }
  }
}

/** Velikosti rámečků, jejichž trojí opakování odpovídá Gaussovi se směrodatnou odchylkou sigma. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

/** Přesné oddělitelné Gaussovo jádro (pro malé poloměry, kde rámečky nestačí). */
function gaussPass(src: Float32Array, dst: Float32Array, len: number, lines: number, step: number, lineStep: number, sigma: number): void {
  const r = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0);
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
  const s4 = step * 4;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep * 4;
    for (let i = 0, o = base; i < len; i++, o += s4) {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let k = -r; k <= r; k++) {
        const j = i + k;
        const q = base + (j < 0 ? 0 : j >= len ? len - 1 : j) * s4;
        const kv = kernel[k + r];
        s0 += src[q] * kv;
        s1 += src[q + 1] * kv;
        s2 += src[q + 2] * kv;
        s3 += src[q + 3] * kv;
      }
      dst[o] = s0;
      dst[o + 1] = s1;
      dst[o + 2] = s2;
      dst[o + 3] = s3;
    }
  }
}

/** Gaussovo rozostření nad předem vynásobenými daty (sigma = poloměr). */
function gaussPremultiplied(buf: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return buf;
  const tmp = new Float32Array(buf.length);
  let a = Float32Array.from(buf);
  if (sigma < 1.5) {
    gaussPass(a, tmp, w, h, 1, w, sigma);
    gaussPassV(tmp, a, w, h, sigma);
    return a;
  }
  for (const r of boxesForGauss(sigma)) {
    boxPass(a, tmp, w, h, 1, w, r);
    boxPassV(tmp, a, w, h, r);
  }
  return a;
}

export function gaussianBlur(src: Img, radius: number): Img {
  return unpremultiply(gaussPremultiplied(premultiply(src), src.width, src.height, radius), src.width, src.height);
}

export function boxBlur(src: Img, radius: number): Img {
  const r = Math.round(radius);
  const a = premultiply(src);
  const tmp = new Float32Array(a.length);
  boxPass(a, tmp, src.width, src.height, 1, src.width, r);
  boxPassV(tmp, a, src.width, src.height, r);
  return unpremultiply(a, src.width, src.height);
}

/** Rozostření pohybem: průměr vzorků podél úsečky (úhel 0° = vodorovně) délky `distance`. */
export function motionBlur(src: Img, angle: number, distance: number): Img {
  const { width: w, height: h } = src;
  const a = premultiply(src);
  const out = new Float32Array(a.length);
  const rad = (angle * Math.PI) / 180;
  const n = Math.max(1, Math.round(distance));
  const offsets: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    offsets.push([Math.round(Math.cos(rad) * t * distance), Math.round(-Math.sin(rad) * t * distance)]);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let al = 0;
      for (const [dx, dy] of offsets) {
        const p = (Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))) * 4;
        r += a[p];
        g += a[p + 1];
        b += a[p + 2];
        al += a[p + 3];
      }
      const q = (y * w + x) * 4;
      out[q] = r / n;
      out[q + 1] = g / n;
      out[q + 2] = b / n;
      out[q + 3] = al / n;
    }
  }
  return unpremultiply(out, w, h);
}

/** Průměr: celá oblast jednou průměrnou barvou (váženě alfou a výběrem). */
export function average(src: Img, area: Rect, weights?: ArrayLike<number>): Img {
  const d = src.data;
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width; x++) {
      const p = ((y + area.y) * src.width + x + area.x) * 4;
      const wgt = (d[p + 3] / 255) * (weights ? weights[y * area.width + x] / 255 : 1);
      r += d[p] * wgt;
      g += d[p + 1] * wgt;
      b += d[p + 2] * wgt;
      total += wgt;
    }
  }
  const out = new Uint8ClampedArray(d);
  if (total <= 0) return { data: out, width: src.width, height: src.height };
  for (let p = 0; p < out.length; p += 4) {
    if (!out[p + 3]) continue;
    out[p] = r / total;
    out[p + 1] = g / total;
    out[p + 2] = b / total;
  }
  return { data: out, width: src.width, height: src.height };
}

// ---- šum ----

/** Generátor náhodných čísel se semínkem (stejný šum v náhledu i po potvrzení). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function addNoise(src: Img, amount: number, gaussian: boolean, monochromatic: boolean, seed: number): Img {
  const rnd = seededRandom(seed);
  const gauss = () => {
    // Box–Muller
    const u = Math.max(1e-9, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const sample = () => (gaussian ? gauss() * 0.5 : rnd() * 2 - 1) * (amount / 100) * 255;
  const out = new Uint8ClampedArray(src.data);
  for (let p = 0; p < out.length; p += 4) {
    if (!out[p + 3]) continue;
    if (monochromatic) {
      const n = sample();
      out[p] += n;
      out[p + 1] += n;
      out[p + 2] += n;
    } else {
      out[p] += sample();
      out[p + 1] += sample();
      out[p + 2] += sample();
    }
  }
  return { data: out, width: src.width, height: src.height };
}

/** Medián po kanálech ve čtverci (2r+1)² – Huangův posuvný histogram. */
export function median(src: Img, radius: number): Img {
  const r = Math.max(1, Math.round(radius));
  const { width: w, height: h, data: d } = src;
  const out = new Uint8ClampedArray(d.length);
  const half = ((2 * r + 1) * (2 * r + 1)) >> 1;
  const hist = new Uint32Array(256);
  const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y);
  for (let c = 0; c < 4; c++) {
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      for (let dy = -r; dy <= r; dy++) {
        const row = clampY(y + dy) * w;
        for (let dx = -r; dx <= r; dx++) hist[d[(row + clampX(dx)) * 4 + c]]++;
      }
      let med = 0;
      let below = 0;
      while (below + hist[med] <= half) below += hist[med++];
      out[(y * w) * 4 + c] = med;
      for (let x = 1; x < w; x++) {
        const xOut = clampX(x - r - 1);
        const xIn = clampX(x + r);
        for (let dy = -r; dy <= r; dy++) {
          const row = clampY(y + dy) * w;
          const vo = d[(row + xOut) * 4 + c];
          const vi = d[(row + xIn) * 4 + c];
          hist[vo]--;
          if (vo < med) below--;
          hist[vi]++;
          if (vi < med) below++;
        }
        while (below > half) below -= hist[--med];
        while (below + hist[med] <= half) below += hist[med++];
        out[(y * w + x) * 4 + c] = med;
      }
    }
  }
  return { data: out, width: w, height: h };
}

/** Odstranit skvrny: medián 3 × 3 jen tam, kde není výrazná hrana (hrany zůstanou ostré). */
export function despeckle(src: Img): Img {
  const med = median(src, 1);
  const { width: w, height: h, data: d } = src;
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let lo = 255;
      let hi = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = (Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))) * 4;
          const v = luma(d[q], d[q + 1], d[q + 2]);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (hi - lo > 48) continue;
      const p = (y * w + x) * 4;
      out[p] = med.data[p];
      out[p + 1] = med.data[p + 1];
      out[p + 2] = med.data[p + 2];
    }
  }
  return { data: out, width: w, height: h };
}

// ---- zostření ----

/** Maska rozostření: původní + (původní − rozostřený) · síla; rozdíl jasu pod prahem se nezostřuje. */
export function unsharpMask(src: Img, amount: number, radius: number, threshold: number): Img {
  const blurred = gaussianBlur(src, radius);
  const d = src.data;
  const b = blurred.data;
  const k = amount / 100;
  const out = new Uint8ClampedArray(d);
  for (let p = 0; p < d.length; p += 4) {
    if (!d[p + 3]) continue;
    if (threshold > 0 && Math.abs(luma(d[p], d[p + 1], d[p + 2]) - luma(b[p], b[p + 1], b[p + 2])) < threshold) continue;
    out[p] = d[p] + (d[p] - b[p]) * k;
    out[p + 1] = d[p + 1] + (d[p + 1] - b[p + 1]) * k;
    out[p + 2] = d[p + 2] + (d[p + 2] - b[p + 2]) * k;
  }
  return { data: out, width: src.width, height: src.height };
}

/** Horní propust: 128 + (původní − rozostřený); zůstanou jen hrany. */
export function highPass(src: Img, radius: number): Img {
  const b = gaussianBlur(src, radius).data;
  const d = src.data;
  const out = new Uint8ClampedArray(d);
  for (let p = 0; p < d.length; p += 4) {
    if (!d[p + 3]) continue;
    out[p] = 128 + d[p] - b[p];
    out[p + 1] = 128 + d[p + 1] - b[p + 1];
    out[p + 2] = 128 + d[p + 2] - b[p + 2];
  }
  return { data: out, width: src.width, height: src.height };
}

// ---- ostatní ----

/** Posun obsahu oblasti o (dx, dy): uvolněné místo se zalomí z druhé strany, zopakuje okraj, nebo zprůhlední. */
export function offset(src: Img, area: Rect, dx: number, dy: number, mode: 'wrap' | 'repeat' | 'transparent'): Img {
  const out = new Uint8ClampedArray(src.data);
  const { width: aw, height: ah } = area;
  const mod = (v: number, m: number) => ((v % m) + m) % m;
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      let sx = x - Math.round(dx);
      let sy = y - Math.round(dy);
      const q = ((y + area.y) * src.width + x + area.x) * 4;
      if (sx < 0 || sx >= aw || sy < 0 || sy >= ah) {
        if (mode === 'transparent') {
          out[q] = out[q + 1] = out[q + 2] = out[q + 3] = 0;
          continue;
        }
        if (mode === 'wrap') {
          sx = mod(sx, aw);
          sy = mod(sy, ah);
        } else {
          sx = Math.min(aw - 1, Math.max(0, sx));
          sy = Math.min(ah - 1, Math.max(0, sy));
        }
      }
      const p = ((sy + area.y) * src.width + sx + area.x) * 4;
      out[q] = src.data[p];
      out[q + 1] = src.data[p + 1];
      out[q + 2] = src.data[p + 2];
      out[q + 3] = src.data[p + 3];
    }
  }
  return { data: out, width: src.width, height: src.height };
}

/** Mozaika: čtverce o hraně `size` (od levého horního rohu oblasti) vyplněné průměrnou barvou. */
export function mosaic(src: Img, area: Rect, size: number): Img {
  const s = Math.max(1, Math.round(size));
  const out = new Uint8ClampedArray(src.data);
  const d = src.data;
  for (let by = 0; by < area.height; by += s) {
    for (let bx = 0; bx < area.width; bx += s) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      const ex = Math.min(area.width, bx + s);
      const ey = Math.min(area.height, by + s);
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const p = ((y + area.y) * src.width + x + area.x) * 4;
          const al = d[p + 3];
          r += d[p] * al;
          g += d[p + 1] * al;
          b += d[p + 2] * al;
          a += al;
          n++;
        }
      }
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const p = ((y + area.y) * src.width + x + area.x) * 4;
          if (a > 0) {
            out[p] = r / a;
            out[p + 1] = g / a;
            out[p + 2] = b / a;
          }
          out[p + 3] = a / n;
        }
      }
    }
  }
  return { data: out, width: src.width, height: src.height };
}

/** Barva na alfu (jako GIMP): odebere barvu tak, aby složení přes ni dalo původní obraz. */
export function colorToAlpha(src: Img, color: string): Img {
  const c = parseHex(color);
  const cc = [c.r / 255, c.g / 255, c.b / 255];
  const out = new Uint8ClampedArray(src.data);
  for (let p = 0; p < out.length; p += 4) {
    if (!out[p + 3]) continue;
    const px = [out[p] / 255, out[p + 1] / 255, out[p + 2] / 255];
    let alpha = 0;
    for (let i = 0; i < 3; i++) {
      const a = cc[i] < 0.0001 ? px[i] : px[i] > cc[i] ? (px[i] - cc[i]) / (1 - cc[i]) : px[i] < cc[i] ? (cc[i] - px[i]) / cc[i] : 0;
      if (a > alpha) alpha = a;
    }
    if (alpha > 0.0001) for (let i = 0; i < 3; i++) out[p + i] = ((px[i] - cc[i]) / alpha + cc[i]) * 255;
    out[p + 3] = alpha * out[p + 3];
  }
  return { data: out, width: src.width, height: src.height };
}

// ---- radiální rozostření a deformace ----

/** Bilineární vzorek z předem vynásobených dat (souřadnice mimo se přitáhnou k okraji). */
function sample(buf: Float32Array, w: number, h: number, x: number, y: number, out: Float32Array): void {
  const fx = Math.min(w - 1, Math.max(0, x - 0.5));
  const fy = Math.min(h - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = (y0 * w + x0) * 4;
  const b = (y0 * w + x1) * 4;
  const c = (y1 * w + x0) * 4;
  const d = (y1 * w + x1) * 4;
  for (let i = 0; i < 4; i++) {
    const top = buf[a + i] + (buf[b + i] - buf[a + i]) * tx;
    const bottom = buf[c + i] + (buf[d + i] - buf[c + i]) * tx;
    out[i] = top + (bottom - top) * ty;
  }
}

/**
 * Deformace oblasti: pro každý pixel cíle `map` vrátí zdrojový bod (souřadnice v oblasti, středy pixelů
 * na +0,5), nebo false = ponechat původní pixel. Vzorkuje se bilineárně jen z oblasti.
 */
function warp(src: Img, area: Rect, map: (x: number, y: number, out: number[]) => boolean): Img {
  const { width: aw, height: ah } = area;
  const crop: Img = { data: new Uint8ClampedArray(aw * ah * 4), width: aw, height: ah };
  for (let y = 0; y < ah; y++) {
    const from = ((y + area.y) * src.width + area.x) * 4;
    crop.data.set(src.data.subarray(from, from + aw * 4), y * aw * 4);
  }
  const buf = premultiply(crop);
  const res = new Float32Array(buf);
  const px = new Float32Array(4);
  const pt = [0, 0];
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      if (!map(x + 0.5, y + 0.5, pt)) continue;
      sample(buf, aw, ah, pt[0], pt[1], px);
      res.set(px, (y * aw + x) * 4);
    }
  }
  const back = unpremultiply(res, aw, ah);
  const out = new Uint8ClampedArray(src.data);
  for (let y = 0; y < ah; y++) out.set(back.data.subarray(y * aw * 4, (y + 1) * aw * 4), ((y + area.y) * src.width + area.x) * 4);
  return { data: out, width: src.width, height: src.height };
}

/** Radiální rozostření ze středu oblasti: otočením (míra ≈ stupně oblouku) nebo přiblížením (míra v % poloměru). */
export function radialBlur(src: Img, area: Rect, mode: 'spin' | 'zoom', amount: number): Img {
  const buf = premultiply(src);
  const out = new Float32Array(buf);
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const px = new Float32Array(4);
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      const length = mode === 'spin' ? (r * amount * Math.PI) / 180 : (r * amount) / 100;
      const n = Math.max(1, Math.min(64, Math.ceil(length)));
      if (n === 1) continue;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        let sx: number;
        let sy: number;
        if (mode === 'spin') {
          const a = (t * amount * Math.PI) / 180;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          sx = cx + dx * cos - dy * sin;
          sy = cy + dx * sin + dy * cos;
        } else {
          const k = 1 + (t * amount) / 100;
          sx = cx + dx * k;
          sy = cy + dy * k;
        }
        sample(buf, src.width, src.height, sx, sy, px);
        s0 += px[0];
        s1 += px[1];
        s2 += px[2];
        s3 += px[3];
      }
      const q = (y * src.width + x) * 4;
      out[q] = s0 / n;
      out[q + 1] = s1 / n;
      out[q + 2] = s2 / n;
      out[q + 3] = s3 / n;
    }
  }
  return unpremultiply(out, src.width, src.height);
}

/** Polární deformace (zkroucení, sevření, kulovitost) v elipse vepsané do oblasti. */
function radialWarp(src: Img, area: Rect, f: (rn: number) => { r: number; angle: number }): Img {
  const cx = area.width / 2;
  const cy = area.height / 2;
  return warp(src, area, (x, y, out) => {
    const nx = (x - cx) / cx;
    const ny = (y - cy) / cy;
    const rn = Math.hypot(nx, ny);
    if (rn >= 1 || rn === 0) return false;
    const { r, angle } = f(rn);
    const k = r / rn;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    out[0] = cx + (nx * cos - ny * sin) * k * cx;
    out[1] = cy + (nx * sin + ny * cos) * k * cy;
    return true;
  });
}

/** Zkroucení: otočení klesající od středu (úhel ve stupních). */
export const twirl = (src: Img, area: Rect, angle: number) => radialWarp(src, area, (rn) => ({ r: rn, angle: (-angle * Math.PI * (1 - rn)) / 180 }));

/** Sevření: kladná míra střed vtáhne (zmenší), záporná ho vyboulí; okraj elipsy zůstane. */
export const pinch = (src: Img, area: Rect, amount: number) =>
  radialWarp(src, area, (rn) => ({ r: Math.min(1, rn * Math.sin((Math.PI / 2) * rn) ** (-amount / 200)), angle: 0 }));

/**
 * Kulovitost: kladná míra vyboulí střed jako koule (zdroj blíž ke středu: 1 − √(1 − r²)), záporná ho
 * promáčkne (zdroj dál: √(1 − (1 − r)²)); na okraji elipsy se nic neposune.
 */
export const spherize = (src: Img, area: Rect, amount: number) => {
  const k = Math.max(-1, Math.min(1, amount / 100));
  return radialWarp(src, area, (rn) => {
    const shape = k >= 0 ? 1 - Math.sqrt(1 - rn * rn) : Math.sqrt(1 - (1 - rn) ** 2);
    return { r: rn + (shape - rn) * Math.abs(k), angle: 0 };
  });
};

/** Zvlnění: posun o sinus kolmo na směr (amplituda = míra % čtvrtiny vlnové délky, `size` = vlnová délka v px). */
export function ripple(src: Img, area: Rect, amount: number, size: number): Img {
  const amp = ((amount / 100) * size) / 4;
  const k = (2 * Math.PI) / Math.max(2, size);
  return warp(src, area, (x, y, out) => {
    out[0] = x + amp * Math.sin(y * k);
    out[1] = y + amp * Math.sin(x * k);
    return true;
  });
}

/** Polární souřadnice: obdélník → kruh (horní okraj do středu), nebo zpět. */
export function polar(src: Img, area: Rect, toPolar: boolean): Img {
  const w = area.width;
  const h = area.height;
  const cx = w / 2;
  const cy = h / 2;
  return warp(src, area, (x, y, out) => {
    if (toPolar) {
      const nx = (x - cx) / cx;
      const ny = (y - cy) / cy;
      let theta = Math.atan2(nx, -ny);
      if (theta < 0) theta += 2 * Math.PI;
      out[0] = (theta / (2 * Math.PI)) * w;
      out[1] = Math.hypot(nx, ny) * h;
    } else {
      const theta = (x / w) * 2 * Math.PI;
      const r = y / h;
      out[0] = cx + r * Math.sin(theta) * cx;
      out[1] = cy - r * Math.cos(theta) * cy;
    }
    return true;
  });
}

// ---- stylizace a vykreslení ----

/** Najít hrany: Sobelův gradient po kanálech, převrácený (hrany tmavé na bílé, barevné jako ve Photoshopu). */
export function findEdges(src: Img): Img {
  const { width: w, height: h, data: d } = src;
  const out = new Uint8ClampedArray(d);
  const at = (x: number, y: number, c: number) => d[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (!d[p + 3]) continue;
      for (let c = 0; c < 3; c++) {
        const gx = at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c);
        const gy = at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c);
        out[p + c] = 255 - Math.min(255, Math.hypot(gx, gy) / 2);
      }
    }
  }
  return { data: out, width: w, height: h };
}

/** Reliéf: šedá 128 + rozdíl jasu po směru světla (úhel), výška = vzdálenost vzorků, míra = zesílení. */
export function emboss(src: Img, angle: number, height: number, amount: number): Img {
  const { width: w, height: h, data: d } = src;
  const out = new Uint8ClampedArray(d);
  const a = (angle * Math.PI) / 180;
  const ox = Math.round(Math.cos(a) * height);
  const oy = Math.round(-Math.sin(a) * height);
  const lum = (x: number, y: number) => {
    const q = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
    return luma(d[q], d[q + 1], d[q + 2]);
  };
  const k = amount / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (!d[p + 3]) continue;
      const v = 128 + (lum(x + ox, y + oy) - lum(x - ox, y - oy)) * k;
      out[p] = out[p + 1] = out[p + 2] = v;
    }
  }
  return { data: out, width: w, height: h };
}

/** Solarizace: světlé tóny se převrátí (jako přeexponovaný film). */
export function solarize(src: Img): Img {
  const out = new Uint8ClampedArray(src.data);
  for (let p = 0; p < out.length; p += 4) for (let c = 0; c < 3; c++) if (out[p + c] > 127) out[p + c] = 255 - out[p + c];
  return { data: out, width: src.width, height: src.height };
}

/** Hladký hodnotový šum se semínkem v bodě (x, y) – mřížka náhodných hodnot, kosinová interpolace. */
function valueNoise(seed: number): (x: number, y: number) => number {
  const hash = (ix: number, iy: number) => {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const tx = smooth(x - ix);
    const ty = smooth(y - iy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const e = hash(ix + 1, iy + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  };
}

/** Mraky: fraktální šum (5 oktáv) mezi barvou popředí a pozadí; oblast se vyplní neprůhledně. */
export function clouds(src: Img, area: Rect, fg: string, bg: string, scale: number, seed: number): Img {
  const a = parseHex(fg);
  const b = parseHex(bg);
  const noise = valueNoise(seed);
  const out = new Uint8ClampedArray(src.data);
  const base = 1 / Math.max(2, scale);
  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width; x++) {
      let v = 0;
      let amp = 0.5;
      let f = base;
      for (let o = 0; o < 5; o++) {
        v += noise(x * f + o * 17.3, y * f + o * 31.7) * amp;
        amp /= 2;
        f *= 2;
      }
      const t = Math.min(1, Math.max(0, (v - 0.0625) / 0.875));
      const p = ((y + area.y) * src.width + x + area.x) * 4;
      out[p] = a.r + (b.r - a.r) * t;
      out[p + 1] = a.g + (b.g - a.g) * t;
      out[p + 2] = a.b + (b.b - a.b) * t;
      out[p + 3] = 255;
    }
  }
  return { data: out, width: src.width, height: src.height };
}

/** Filtr pro zmenšený náhled (měřítko k < 1): délky v pixelech se zmenší. */
export function scaleFilter(f: Filter, k: number): Filter {
  switch (f.kind) {
    case 'gaussianBlur':
    case 'highPass':
      return { ...f, radius: Math.max(0.1, f.radius * k) };
    case 'boxBlur':
      return { ...f, radius: f.radius * k };
    case 'median':
      return { ...f, radius: Math.max(1, Math.round(f.radius * k)) };
    case 'unsharpMask':
      return { ...f, radius: Math.max(0.1, f.radius * k) };
    case 'motionBlur':
      return { ...f, distance: Math.max(1, f.distance * k) };
    case 'offset':
      return { ...f, dx: f.dx * k, dy: f.dy * k };
    case 'mosaic':
      return { ...f, size: Math.max(1, f.size * k) };
    case 'ripple':
      return { ...f, size: Math.max(2, f.size * k) };
    case 'emboss':
      return { ...f, height: Math.max(1, f.height * k) };
    case 'clouds':
      return { ...f, scale: f.scale * k };
    default:
      return f;
  }
}

/**
 * Použije filtr na obrázek. `area` = upravovaná oblast uvnitř obrázku (kolem je kontext pro rozostření),
 * `weights` = výběr v oblasti (pro Průměr).
 */
export function applyFilter(src: Img, f: Filter, area: Rect = { x: 0, y: 0, width: src.width, height: src.height }, weights?: ArrayLike<number>): Img {
  switch (f.kind) {
    case 'average':
      return average(src, area, weights);
    case 'gaussianBlur':
      return gaussianBlur(src, f.radius);
    case 'boxBlur':
      return boxBlur(src, f.radius);
    case 'motionBlur':
      return motionBlur(src, f.angle, f.distance);
    case 'addNoise':
      return addNoise(src, f.amount, f.gaussian, f.monochromatic, f.seed);
    case 'despeckle':
      return despeckle(src);
    case 'median':
      return median(src, f.radius);
    case 'sharpen':
      return unsharpMask(src, 60, 0.7, 0);
    case 'sharpenMore':
      return unsharpMask(src, 140, 0.7, 0);
    case 'unsharpMask':
      return unsharpMask(src, f.amount, f.radius, f.threshold);
    case 'highPass':
      return highPass(src, f.radius);
    case 'offset':
      return offset(src, area, f.dx, f.dy, f.mode);
    case 'mosaic':
      return mosaic(src, area, f.size);
    case 'colorToAlpha':
      return colorToAlpha(src, f.color);
    case 'radialBlur':
      return radialBlur(src, area, f.mode, f.amount);
    case 'twirl':
      return twirl(src, area, f.angle);
    case 'pinch':
      return pinch(src, area, f.amount);
    case 'spherize':
      return spherize(src, area, f.amount);
    case 'ripple':
      return ripple(src, area, f.amount, f.size);
    case 'polar':
      return polar(src, area, f.toPolar);
    case 'findEdges':
      return findEdges(src);
    case 'emboss':
      return emboss(src, f.angle, f.height, f.amount);
    case 'solarize':
      return solarize(src);
    case 'clouds':
      return clouds(src, area, f.fg, f.bg, f.scale, f.seed);
  }
}
