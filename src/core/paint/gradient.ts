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

/**
 * Přechod jako ve Photoshopu: barevné zastávky a zvlášť zastávky krytí (obojí poloha 0..1). Mezi zastávkami
 * se lineárně interpoluje, před první / za poslední platí krajní hodnota.
 */
export interface GradientDef {
  colors: Array<{ pos: number; color: string }>;
  alphas: Array<{ pos: number; opacity: number }>;
}

const byPos = <T extends { pos: number }>(a: readonly T[]) => [...a].sort((x, y) => x.pos - y.pos);

function interpolate<T extends { pos: number }>(stops: readonly T[], t: number, value: (s: T) => number[]): number[] {
  const s = byPos(stops);
  if (!s.length) return [];
  if (t <= s[0].pos) return value(s[0]);
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].pos) {
      const a = s[i - 1];
      const b = s[i];
      const f = b.pos > a.pos ? (t - a.pos) / (b.pos - a.pos) : 1;
      const va = value(a);
      const vb = value(b);
      return va.map((v, k) => v + (vb[k] - v) * f);
    }
  }
  return value(s[s.length - 1]);
}

/** Barva a krytí přechodu v poloze t (0..1). */
export function sampleGradient(def: GradientDef, t: number): RGBA {
  const rgb = def.colors.length ? interpolate(def.colors, t, (c) => { const x = parseHex(c.color); return [x.r, x.g, x.b]; }) : [0, 0, 0];
  const [o] = def.alphas.length ? interpolate(def.alphas, t, (a) => [a.opacity]) : [1];
  return { r: rgb[0], g: rgb[1], b: rgb[2], a: o * 255 };
}

/** Zastávky RGBA pro `buildLut` / canvas: sjednocení poloh barevných zastávek a zastávek krytí (přesné). */
export function gradientStops(def: GradientDef): GradientStop[] {
  const positions = [...new Set([0, 1, ...def.colors.map((c) => c.pos), ...def.alphas.map((a) => a.pos)])].sort((a, b) => a - b);
  return positions.map((pos) => ({ pos, color: sampleGradient(def, pos) }));
}

/** Dvoubarevný neprůhledný přechod. */
export function twoColorGradient(from: string, to: string): GradientDef {
  return {
    colors: [
      { pos: 0, color: from },
      { pos: 1, color: to },
    ],
    alphas: [
      { pos: 0, opacity: 1 },
      { pos: 1, opacity: 1 },
    ],
  };
}

/** Obrácený přechod (zrcadlení poloh). */
export function reverseGradient(def: GradientDef): GradientDef {
  return {
    colors: byPos(def.colors.map((c) => ({ ...c, pos: 1 - c.pos }))),
    alphas: byPos(def.alphas.map((a) => ({ ...a, pos: 1 - a.pos }))),
  };
}

/** CSS `linear-gradient` zleva doprava (náhledy v UI; pod něj patří šachovnice). */
export function gradientCss(def: GradientDef): string {
  const parts = gradientStops(def).map((s) => `rgba(${Math.round(s.color.r)},${Math.round(s.color.g)},${Math.round(s.color.b)},${(s.color.a / 255).toFixed(3)}) ${(s.pos * 100).toFixed(2)}%`);
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** Knihovna přechodů editoru (barvy popředí / pozadí se doplní při použití). */
export const GRADIENT_LIBRARY: ReadonlyArray<{ name: string; def: GradientDef | 'fg-bg' | 'fg-transparent' }> = [
  { name: 'Popředí → pozadí', def: 'fg-bg' },
  { name: 'Popředí → průhledná', def: 'fg-transparent' },
  { name: 'Černá → bílá', def: twoColorGradient('#000000', '#ffffff') },
  {
    name: 'Spektrum',
    def: {
      colors: ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].map((color, i) => ({ pos: i / 6, color })),
      alphas: [
        { pos: 0, opacity: 1 },
        { pos: 1, opacity: 1 },
      ],
    },
  },
  {
    name: 'Měď',
    def: {
      colors: [
        { pos: 0, color: '#97461a' },
        { pos: 0.3, color: '#fbd8c5' },
        { pos: 0.65, color: '#6c2e16' },
        { pos: 1, color: '#efdbcd' },
      ],
      alphas: [
        { pos: 0, opacity: 1 },
        { pos: 1, opacity: 1 },
      ],
    },
  },
  {
    name: 'Chrom',
    def: {
      colors: [
        { pos: 0, color: '#29868c' },
        { pos: 0.45, color: '#ffffff' },
        { pos: 0.5, color: '#4a3017' },
        { pos: 0.6, color: '#d1913d' },
        { pos: 1, color: '#ffffff' },
      ],
      alphas: [
        { pos: 0, opacity: 1 },
        { pos: 1, opacity: 1 },
      ],
    },
  },
  {
    name: 'Západ slunce',
    def: {
      colors: [
        { pos: 0, color: '#2a0a4a' },
        { pos: 0.55, color: '#e8445a' },
        { pos: 1, color: '#ffcc66' },
      ],
      alphas: [
        { pos: 0, opacity: 1 },
        { pos: 1, opacity: 1 },
      ],
    },
  },
  {
    name: 'Průhledné pruhy',
    def: {
      colors: [
        { pos: 0, color: '#000000' },
        { pos: 1, color: '#000000' },
      ],
      alphas: [0, 0.2, 0.2001, 0.4, 0.4001, 0.6, 0.6001, 0.8, 0.8001, 1].map((pos, i) => ({ pos, opacity: Math.floor((i + 1) / 2) % 2 ? 0 : 1 })),
    },
  },
];

/** Položka knihovny → přechod s doplněnými barvami popředí / pozadí. */
export function libraryGradient(def: GradientDef | 'fg-bg' | 'fg-transparent', fg: string, bg: string): GradientDef {
  if (def === 'fg-bg') return twoColorGradient(fg, bg);
  if (def === 'fg-transparent') {
    const g = twoColorGradient(fg, fg);
    g.alphas[1].opacity = 0;
    return g;
  }
  return structuredClone(def);
}

export type GradientPreset = 'fg-bg' | 'fg-transparent' | 'black-white' | 'custom';

export const GRADIENT_PRESETS: ReadonlyArray<{ value: GradientPreset; label: string }> = [
  { value: 'fg-bg', label: 'Popředí → pozadí' },
  { value: 'fg-transparent', label: 'Popředí → průhledná' },
  { value: 'black-white', label: 'Černá → bílá' },
  { value: 'custom', label: 'Vlastní' },
];

/** Přechod podle předvolby nástroje a aktuálních barev popředí / pozadí. */
export function presetGradient(preset: GradientPreset, fg: string, bg: string, custom: GradientDef): GradientDef {
  if (preset === 'custom') return structuredClone(custom);
  if (preset === 'black-white') return twoColorGradient('#000000', '#ffffff');
  return libraryGradient(preset, fg, bg);
}

/** Barevné body přechodu podle předvolby a aktuálních barev popředí / pozadí. */
export function presetStops(preset: Exclude<GradientPreset, 'custom'>, fg: string, bg: string): GradientStop[] {
  return gradientStops(presetGradient(preset, fg, bg, twoColorGradient(fg, bg)));
}
