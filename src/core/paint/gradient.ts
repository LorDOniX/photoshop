import { parseHex, type RGBA } from '../color';

/*
 * Výpočet přechodu po pixelech – čisté funkce bez DOM. Canvas 2D umí jen lineární, kruhový
 * a kuželový přechod a nepodporuje rozptýlení (dither), proto se počítá ručně.
 */

export type GradientType = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';

export const GRADIENT_TYPES: ReadonlyArray<{ value: GradientType; label: string }> = [
  { value: 'linear', label: 'Lineární' },
  { value: 'radial', label: 'Kruhový' },
  { value: 'angle', label: 'Úhlový' },
  { value: 'reflected', label: 'Zrcadlený' },
  { value: 'diamond', label: 'Kosočtverečný' },
];

export interface GradientStop {
  /** 0..1 */
  pos: number;
  color: RGBA;
}

export interface Point {
  x: number;
  y: number;
}

/** Počet vzorků tabulky barev – víc než 256, aby rozptýlení mělo z čeho brát. */
const LUT_SIZE = 1024;

/** Tabulka barev přechodu: LUT_SIZE × RGBA (float, nepřednásobené). */
export function buildLut(stops: readonly GradientStop[]): Float32Array {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const lut = new Float32Array(LUT_SIZE * 4);
  if (!sorted.length) return lut;
  let k = 0;
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    while (k < sorted.length - 2 && t > sorted[k + 1].pos) k++;
    const a = sorted[k];
    const b = sorted[Math.min(k + 1, sorted.length - 1)];
    const span = b.pos - a.pos;
    const f = span <= 0 ? (t < a.pos ? 0 : 1) : Math.max(0, Math.min(1, (t - a.pos) / span));
    lut[i * 4] = a.color.r + (b.color.r - a.color.r) * f;
    lut[i * 4 + 1] = a.color.g + (b.color.g - a.color.g) * f;
    lut[i * 4 + 2] = a.color.b + (b.color.b - a.color.b) * f;
    lut[i * 4 + 3] = a.color.a + (b.color.a - a.color.a) * f;
  }
  return lut;
}

/** Funkce bod → poloha v přechodu 0..1 pro daný typ a úsečku start → konec. */
export function gradientParam(type: GradientType, start: Point, end: Point): (x: number, y: number) => number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len2 = dx * dx + dy * dy;
  const len = Math.sqrt(len2);
  if (len2 === 0) return () => 0;
  const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
  switch (type) {
    case 'linear':
      return (x, y) => clamp(((x - start.x) * dx + (y - start.y) * dy) / len2);
    case 'reflected':
      return (x, y) => clamp(Math.abs(((x - start.x) * dx + (y - start.y) * dy) / len2));
    case 'radial':
      return (x, y) => clamp(Math.hypot(x - start.x, y - start.y) / len);
    case 'diamond':
      return (x, y) => {
        const u = ((x - start.x) * dx + (y - start.y) * dy) / len;
        const v = ((y - start.y) * dx - (x - start.x) * dy) / len;
        return clamp((Math.abs(u) + Math.abs(v)) / len);
      };
    case 'angle': {
      // Proti směru hodinových ručiček (na obrazovce) od směru start → konec.
      const base = Math.atan2(dy, dx);
      const TAU = Math.PI * 2;
      return (x, y) => {
        const a = base - Math.atan2(y - start.y, x - start.x);
        return (((a % TAU) + TAU) % TAU) / TAU;
      };
    }
  }
}

export interface GradientRender {
  type: GradientType;
  start: Point;
  end: Point;
  lut: Float32Array;
  reverse?: boolean;
  /** Rozptýlení – šum ±0,5 úrovně proti pruhům v plynulých přechodech. */
  dither?: boolean;
  /** Generátor náhodných čísel (kvůli testům). */
  random?: () => number;
}

/**
 * Vyplní RGBA buffer `width` × `height` přechodem. Pixel (i, j) leží v souřadnicích
 * (ox + i + 0,5; oy + j + 0,5) – tedy ve středu pixelu dokumentu.
 */
export function renderGradient(out: Uint8ClampedArray, width: number, height: number, ox: number, oy: number, o: GradientRender): void {
  const param = gradientParam(o.type, o.start, o.end);
  const random = o.random ?? Math.random;
  const last = LUT_SIZE - 1;
  for (let j = 0; j < height; j++) {
    const y = oy + j + 0.5;
    for (let i = 0; i < width; i++) {
      let t = param(ox + i + 0.5, y);
      if (o.reverse) t = 1 - t;
      const k = Math.round(t * last) * 4;
      const p = (j * width + i) * 4;
      if (o.dither) {
        const n = random() - 0.5;
        out[p] = o.lut[k] + n;
        out[p + 1] = o.lut[k + 1] + n;
        out[p + 2] = o.lut[k + 2] + n;
        out[p + 3] = o.lut[k + 3];
      } else {
        out[p] = o.lut[k];
        out[p + 1] = o.lut[k + 1];
        out[p + 2] = o.lut[k + 2];
        out[p + 3] = o.lut[k + 3];
      }
    }
  }
}

/** Úhel úsečky přichycený k násobkům 45° (Shift při tažení). */
export function snapAngle(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len };
}

export type GradientPreset = 'fg-bg' | 'fg-transparent' | 'black-white';

export const GRADIENT_PRESETS: ReadonlyArray<{ value: GradientPreset; label: string }> = [
  { value: 'fg-bg', label: 'Popředí → pozadí' },
  { value: 'fg-transparent', label: 'Popředí → průhledná' },
  { value: 'black-white', label: 'Černá → bílá' },
];

/** Barevné body přechodu podle předvolby a aktuálních barev popředí / pozadí. */
export function presetStops(preset: GradientPreset, fg: string, bg: string): GradientStop[] {
  const f = parseHex(fg);
  const colors: Record<GradientPreset, [RGBA, RGBA]> = {
    'fg-bg': [f, parseHex(bg)],
    'fg-transparent': [f, { ...f, a: 0 }],
    'black-white': [parseHex('#000000'), parseHex('#ffffff')],
  };
  const [a, b] = colors[preset];
  return [
    { pos: 0, color: a },
    { pos: 1, color: b },
  ];
}
