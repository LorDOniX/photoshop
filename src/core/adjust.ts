import { parseHex } from './color';
import { buildLut, gradientStops, type GradientDef } from './paint/gradient';

/*
 * Úpravy obrazu (Obraz → Úpravy) – čisté funkce nad RGBA daty bez DOM. Mění jen barvy, průhlednost
 * zůstává. Popis úpravy je obyčejný objekt (`Adjustment`), aby šel uložit (budoucí vrstvy úprav).
 */

export type Channel = 'rgb' | 'r' | 'g' | 'b';
export const CHANNELS: readonly Channel[] = ['rgb', 'r', 'g', 'b'];
export const CHANNEL_NAMES: Record<Channel, string> = { rgb: 'RGB', r: 'Červený', g: 'Zelený', b: 'Modrý' };

export interface LevelsChannel {
  inBlack: number;
  inWhite: number;
  /** 0,1–9,99 (1 = beze změny). */
  gamma: number;
  outBlack: number;
  outWhite: number;
}

/** Bod křivky: vstup → výstup (0–255). */
export interface CurvePoint {
  x: number;
  y: number;
}

/** Posun barev ve třech tónech: azurová–červená, purpurová–zelená, žlutá–modrá (−100…100). */
export type BalanceTriple = [number, number, number];

export type Adjustment =
  | { kind: 'brightnessContrast'; brightness: number; contrast: number }
  | { kind: 'levels'; channels: Record<Channel, LevelsChannel> }
  | { kind: 'curves'; channels: Record<Channel, CurvePoint[]> }
  | { kind: 'exposure'; exposure: number; offset: number; gamma: number }
  | { kind: 'vibrance'; vibrance: number; saturation: number }
  | { kind: 'hueSaturation'; hue: number; saturation: number; lightness: number; colorize: boolean }
  | { kind: 'colorBalance'; shadows: BalanceTriple; midtones: BalanceTriple; highlights: BalanceTriple; preserveLuminosity: boolean }
  | { kind: 'blackWhite'; reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number; tint: boolean; tintColor: string }
  | { kind: 'photoFilter'; color: string; density: number; preserveLuminosity: boolean }
  | { kind: 'invert' }
  | { kind: 'posterize'; levels: number }
  | { kind: 'threshold'; level: number }
  | { kind: 'gradientMap'; gradient: GradientDef; reverse: boolean }
  | { kind: 'desaturate' };

export type AdjustmentKind = Adjustment['kind'];
export type AdjustmentOf<K extends AdjustmentKind> = Extract<Adjustment, { kind: K }>;

export const LEVELS_IDENTITY: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
export const CURVE_IDENTITY: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

const perChannel = <T>(make: () => T): Record<Channel, T> => ({ rgb: make(), r: make(), g: make(), b: make() });

/** Výchozí (neutrální) hodnoty úprav – Photoshop. */
export function defaultAdjustment<K extends AdjustmentKind>(kind: K): AdjustmentOf<K> {
  const all: { [P in AdjustmentKind]: AdjustmentOf<P> } = {
    brightnessContrast: { kind: 'brightnessContrast', brightness: 0, contrast: 0 },
    levels: { kind: 'levels', channels: perChannel(() => ({ ...LEVELS_IDENTITY })) },
    curves: { kind: 'curves', channels: perChannel(() => CURVE_IDENTITY.map((p) => ({ ...p }))) },
    exposure: { kind: 'exposure', exposure: 0, offset: 0, gamma: 1 },
    vibrance: { kind: 'vibrance', vibrance: 0, saturation: 0 },
    hueSaturation: { kind: 'hueSaturation', hue: 0, saturation: 0, lightness: 0, colorize: false },
    colorBalance: { kind: 'colorBalance', shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true },
    blackWhite: { kind: 'blackWhite', reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#e1d3b3' },
    photoFilter: { kind: 'photoFilter', color: '#ec8a00', density: 25, preserveLuminosity: true },
    invert: { kind: 'invert' },
    posterize: { kind: 'posterize', levels: 4 },
    threshold: { kind: 'threshold', level: 128 },
    gradientMap: {
      kind: 'gradientMap',
      gradient: {
        colors: [
          { pos: 0, color: '#000000' },
          { pos: 1, color: '#ffffff' },
        ],
        alphas: [
          { pos: 0, opacity: 1 },
          { pos: 1, opacity: 1 },
        ],
      },
      reverse: false,
    },
    desaturate: { kind: 'desaturate' },
  };
  return structuredClone(all[kind]) as AdjustmentOf<K>;
}

export const ADJUSTMENT_NAMES: Record<AdjustmentKind, string> = {
  brightnessContrast: 'Jas/kontrast',
  levels: 'Úrovně',
  curves: 'Křivky',
  exposure: 'Expozice',
  vibrance: 'Živost',
  hueSaturation: 'Odstín/sytost',
  colorBalance: 'Vyvážení barev',
  blackWhite: 'Černobílý',
  photoFilter: 'Fotofiltr',
  invert: 'Invertovat',
  posterize: 'Posterizace',
  threshold: 'Práh',
  gradientMap: 'Mapa přechodu',
  desaturate: 'Odbarvit',
};

/** Druhy vrstev úprav v pořadí menu (jako Photoshop; Odbarvit vrstvou úprav není). */
export const LAYER_ADJUSTMENT_KINDS: AdjustmentKind[] = [
  'brightnessContrast',
  'levels',
  'curves',
  'exposure',
  'vibrance',
  'hueSaturation',
  'colorBalance',
  'blackWhite',
  'photoFilter',
  'invert',
  'posterize',
  'threshold',
  'gradientMap',
];

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
/** Jas pixelu (Rec. 601, jako Photoshop pro histogram a práh). */
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---- tabulky (LUT) ----

type Lut = Uint8Array;
const identityLut = (): Lut => Uint8Array.from({ length: 256 }, (_, i) => i);
const lutOf = (f: (v: number) => number): Lut => Uint8Array.from({ length: 256 }, (_, i) => Math.round(clamp255(f(i))));

/** Úrovně jednoho kanálu → tabulka. */
export function levelsLut(l: LevelsChannel): Lut {
  const span = Math.max(1, l.inWhite - l.inBlack);
  const g = Math.max(0.01, l.gamma);
  return lutOf((x) => {
    const v = Math.max(0, Math.min(1, (x - l.inBlack) / span)) ** (1 / g);
    return l.outBlack + v * (l.outWhite - l.outBlack);
  });
}

/**
 * Křivka → tabulka: monotónní kubická interpolace (Fritsch–Carlson) mezi body, mimo krajní body vodorovně
 * (jako Photoshop).
 */
export function curveLut(points: readonly CurvePoint[]): Lut {
  const p = [...points].sort((a, b) => a.x - b.x).filter((q, i, a) => i === 0 || q.x > a[i - 1].x);
  if (p.length === 0) return identityLut();
  if (p.length === 1) return lutOf(() => p[0].y);
  const n = p.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return lutOf((x) => {
    if (x <= p[0].x) return p[0].y;
    if (x >= p[n - 1].x) return p[n - 1].y;
    let i = 0;
    while (x > p[i + 1].x) i++;
    const h = p[i + 1].x - p[i].x;
    const t = (x - p[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p[i].y + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1].y + (t3 - t2) * h * m[i + 1];
  });
}

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** Tabulky [R, G, B] pro úpravy, které jdou vyjádřit po kanálech; null = úprava potřebuje celý pixel. */
export function adjustmentLuts(a: Adjustment): [Lut, Lut, Lut] | null {
  switch (a.kind) {
    case 'brightnessContrast': {
      // Jas jako gama (černá a bílá zůstanou), kontrast lineárně kolem středu.
      const g = 2 ** (-a.brightness / 75);
      const k = 1 + a.contrast / 100;
      const lut = lutOf((x) => (255 * (x / 255) ** g - 127.5) * k + 127.5);
      return [lut, lut, lut];
    }
    case 'levels': {
      const all = levelsLut(a.channels.rgb);
      return (['r', 'g', 'b'] as const).map((c) => {
        const ch = levelsLut(a.channels[c]);
        return lutOf((x) => all[ch[x]]);
      }) as [Lut, Lut, Lut];
    }
    case 'curves': {
      const all = curveLut(a.channels.rgb);
      return (['r', 'g', 'b'] as const).map((c) => {
        const ch = curveLut(a.channels[c]);
        return lutOf((x) => all[ch[x]]);
      }) as [Lut, Lut, Lut];
    }
    case 'exposure': {
      const gain = 2 ** a.exposure;
      const g = Math.max(0.01, a.gamma);
      const lut = lutOf((x) => {
        const lin = Math.max(0, srgbToLinear(x / 255) * gain + a.offset);
        return 255 * linearToSrgb(Math.min(1, lin) ** (1 / g));
      });
      return [lut, lut, lut];
    }
    case 'invert': {
      const lut = lutOf((x) => 255 - x);
      return [lut, lut, lut];
    }
    case 'posterize': {
      const n = Math.max(2, Math.min(255, Math.round(a.levels)));
      const lut = lutOf((x) => (Math.round((x / 255) * (n - 1)) / (n - 1)) * 255);
      return [lut, lut, lut];
    }
    default:
      return null;
  }
}

// ---- HSL ----

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  if (max === min) return [0, 0, l];
  const d = (max - min) / 255;
  const s = l > 0.5 ? d / (2 - (max + min) / 255) : d / ((max + min) / 255);
  let h: number;
  if (max === r) h = (g - b) / (max - min) + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number, out: number[]): void {
  if (s <= 0) {
    out[0] = out[1] = out[2] = l * 255;
    return;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  for (let i = 0; i < 3; i++) {
    let t = hk + (1 - i) / 3;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    out[i] = v * 255;
  }
}

/** Váhy tónů pro vyvážení barev (stíny, střední tóny, světla) podle hodnoty 0–255 (jako GIMP). */
export function toneWeights(v: number): [number, number, number] {
  const a = 64;
  const b = 85;
  const scale = 1.785;
  const c = (x: number) => Math.max(0, Math.min(1, x));
  const low = c((v - b) / -a + 0.5) * scale;
  const mid = c((v - b) / a + 0.5) * c((v + b - 255) / -a + 0.5) * scale;
  const high = c((v + b - 255) / a + 0.5) * scale;
  return [Math.min(1, low), Math.min(1, mid), Math.min(1, high)];
}

/**
 * Upraví RGB pixelů na místě (alfa zůstává). `weights` (0–255 na pixel) = síla úpravy – výběr s měkkým
 * okrajem; bez nich plně.
 */
export function applyAdjustment(data: Uint8ClampedArray, a: Adjustment, weights?: ArrayLike<number>): void {
  const n = data.length / 4;
  const mix = (i: number, r: number, g: number, b: number) => {
    const p = i * 4;
    const w = weights ? weights[i] / 255 : 1;
    if (w <= 0) return;
    if (w >= 1) {
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
    } else {
      data[p] += (r - data[p]) * w;
      data[p + 1] += (g - data[p + 1]) * w;
      data[p + 2] += (b - data[p + 2]) * w;
    }
  };

  const luts = adjustmentLuts(a);
  if (luts) {
    const [lr, lg, lb] = luts;
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      mix(i, lr[data[p]], lg[data[p + 1]], lb[data[p + 2]]);
    }
    return;
  }

  const rgb = [0, 0, 0];
  switch (a.kind) {
    case 'desaturate':
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        const v = luma(data[p], data[p + 1], data[p + 2]);
        mix(i, v, v, v);
      }
      return;

    case 'threshold':
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        const v = luma(data[p], data[p + 1], data[p + 2]) >= a.level ? 255 : 0;
        mix(i, v, v, v);
      }
      return;

    case 'gradientMap': {
      const lut = buildLut(gradientStops(a.gradient));
      const last = lut.length / 4 - 1;
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        let t = luma(data[p], data[p + 1], data[p + 2]) / 255;
        if (a.reverse) t = 1 - t;
        const k = Math.round(t * last) * 4;
        mix(i, lut[k], lut[k + 1], lut[k + 2]);
      }
      return;
    }

    case 'hueSaturation': {
      const ds = a.saturation / 100;
      const dl = a.lightness / 100;
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        let [h, s, l] = rgbToHsl(data[p], data[p + 1], data[p + 2]);
        if (a.colorize) {
          h = a.hue;
          s = Math.max(0, Math.min(1, (a.saturation + 100) / 200));
          l = luma(data[p], data[p + 1], data[p + 2]) / 255;
        } else {
          h += a.hue;
          // Šedá zůstane šedá: sytost se násobí (při +100 je každá barva plně sytá).
          s = ds >= 0 ? Math.min(1, s / (1 - ds * 0.99)) : s * (1 + ds);
        }
        l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl);
        hslToRgb(h, s, l, rgb);
        mix(i, rgb[0], rgb[1], rgb[2]);
      }
      return;
    }

    case 'vibrance': {
      const vib = a.vibrance / 100;
      const sat = a.saturation / 100;
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        let r = data[p];
        let g = data[p + 1];
        let b = data[p + 2];
        // Živost: méně syté barvy se sytí víc, syté skoro ne (sytost = rozpětí kanálů).
        if (vib !== 0) {
          const s = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
          const y = luma(r, g, b);
          const k = 1 + vib * (1 - s);
          r = y + (r - y) * k;
          g = y + (g - y) * k;
          b = y + (b - y) * k;
        }
        if (sat !== 0) {
          const y = luma(r, g, b);
          const k = 1 + sat;
          r = y + (r - y) * k;
          g = y + (g - y) * k;
          b = y + (b - y) * k;
        }
        mix(i, clamp255(r), clamp255(g), clamp255(b));
      }
      return;
    }

    case 'colorBalance': {
      const tables = [0, 1, 2].map((c) =>
        lutOf((v) => {
          const [lo, mid, hi] = toneWeights(v);
          return v + (a.shadows[c] * lo + a.midtones[c] * mid + a.highlights[c] * hi) * 0.6;
        }),
      );
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        let r = tables[0][data[p]];
        let g = tables[1][data[p + 1]];
        let b = tables[2][data[p + 2]];
        if (a.preserveLuminosity) {
          const d = luma(data[p], data[p + 1], data[p + 2]) - luma(r, g, b);
          r = clamp255(r + d);
          g = clamp255(g + d);
          b = clamp255(b + d);
        }
        mix(i, r, g, b);
      }
      return;
    }

    case 'blackWhite': {
      // Photoshop: šedá = min + (střed − min) · váha dvojbarvy + (max − střed) · váha hlavní barvy.
      const w = { r: a.reds / 100, y: a.yellows / 100, g: a.greens / 100, c: a.cyans / 100, b: a.blues / 100, m: a.magentas / 100 };
      const tint = parseHex(a.tintColor);
      const [th, ts] = rgbToHsl(tint.r, tint.g, tint.b);
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const min = Math.min(r, g, b);
        const max = Math.max(r, g, b);
        const mid = r + g + b - min - max;
        let primary: number;
        let secondary: number;
        if (max === r) {
          primary = w.r;
          secondary = g >= b ? w.y : w.m;
        } else if (max === g) {
          primary = w.g;
          secondary = r >= b ? w.y : w.c;
        } else {
          primary = w.b;
          secondary = r >= g ? w.m : w.c;
        }
        const gray = clamp255(min + (mid - min) * secondary + (max - mid) * primary);
        if (a.tint) {
          hslToRgb(th, ts, gray / 255, rgb);
          mix(i, rgb[0], rgb[1], rgb[2]);
        } else mix(i, gray, gray, gray);
      }
      return;
    }

    case 'photoFilter': {
      const c = parseHex(a.color);
      const d = Math.max(0, Math.min(100, a.density)) / 100;
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        const r0 = data[p];
        const g0 = data[p + 1];
        const b0 = data[p + 2];
        let r = r0 + ((r0 * c.r) / 255 - r0) * d;
        let g = g0 + ((g0 * c.g) / 255 - g0) * d;
        let b = b0 + ((b0 * c.b) / 255 - b0) * d;
        if (a.preserveLuminosity) {
          const diff = luma(r0, g0, b0) - luma(r, g, b);
          r += diff;
          g += diff;
          b += diff;
        }
        mix(i, clamp255(r), clamp255(g), clamp255(b));
      }
      return;
    }
  }
}

// ---- histogram a automatické úrovně ----

/** Histogram kanálu (rgb = jas). Průhledné pixely a pixely mimo výběr (váha 0) se nepočítají. */
export function histogram(data: Uint8ClampedArray, channel: Channel, weights?: ArrayLike<number>): Uint32Array {
  const h = new Uint32Array(256);
  for (let i = 0, p = 0; p < data.length; i++, p += 4) {
    if (data[p + 3] === 0 || (weights && weights[i] === 0)) continue;
    const v = channel === 'rgb' ? Math.round(luma(data[p], data[p + 1], data[p + 2])) : data[p + (channel === 'r' ? 0 : channel === 'g' ? 1 : 2)];
    h[v]++;
  }
  return h;
}

/** Nejtmavší a nejsvětlejší hodnota histogramu po oříznutí podílu `clip` z každé strany. */
export function histogramRange(h: Uint32Array, clip: number): [number, number] {
  const total = h.reduce((a, b) => a + b, 0);
  if (!total) return [0, 255];
  const limit = total * clip;
  let lo = 0;
  for (let acc = 0; lo < 255; lo++) {
    acc += h[lo];
    if (acc > limit) break;
  }
  let hi = 255;
  for (let acc = 0; hi > 0; hi--) {
    acc += h[hi];
    if (acc > limit) break;
  }
  return hi > lo ? [lo, hi] : [0, 255];
}

/**
 * Automatické úrovně: `tone` = každý kanál zvlášť (posune barvy), `contrast` = všechny kanály stejně
 * (barvy zůstanou), `color` = jako tón, ale s menším ořezem (jemnější). Ořez 0,1 % jako Photoshop.
 */
export function autoLevels(data: Uint8ClampedArray, mode: 'tone' | 'contrast' | 'color', weights?: ArrayLike<number>): AdjustmentOf<'levels'> {
  const a = defaultAdjustment('levels');
  const clip = mode === 'color' ? 0.0005 : 0.001;
  const ranges = (['r', 'g', 'b'] as const).map((c) => histogramRange(histogram(data, c, weights), clip));
  if (mode === 'contrast') {
    a.channels.rgb.inBlack = Math.min(...ranges.map((r) => r[0]));
    a.channels.rgb.inWhite = Math.max(...ranges.map((r) => r[1]));
  } else {
    (['r', 'g', 'b'] as const).forEach((c, i) => {
      a.channels[c].inBlack = ranges[i][0];
      a.channels[c].inWhite = ranges[i][1];
    });
  }
  return a;
}
