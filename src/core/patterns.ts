import { createCanvas, get2d } from './canvas';

/*
 * Vzorky (pro překrytí vzorkem a Úpravy → Vyplnit vzorkem). Vzorek = malý obrázek RGBA, který se dlaždicuje.
 * Registr drží vestavěné vzorky, uživatelskou knihovnu (io/library.ts) i vzorky z otevřených souborů
 * (projekt / PSD je nese s sebou). Vzorky jsou neměnné – nový obsah = nové id.
 */

export interface PatternDef {
  id: string;
  name: string;
  width: number;
  height: number;
  /** RGBA, nepřednásobené, width × height × 4. */
  data: Uint8ClampedArray;
}

/** Největší rozměr vzorku (Definovat vzorek), aby knihovna v prohlížeči nebyla příliš velká. */
export const MAX_PATTERN_SIZE = 1000;

const registry = new Map<string, PatternDef>();
const canvases = new WeakMap<PatternDef, HTMLCanvasElement>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version++;
  listeners.forEach((l) => l());
}

/** Počítadlo změn registru (klíč cache efektů – vzorek může přibýt až po prvním vykreslení). */
export function patternsVersion(): number {
  return version;
}

export function registerPattern(p: PatternDef): void {
  registry.set(p.id, p);
  changed();
}

export function unregisterPattern(id: string): void {
  if (registry.delete(id)) changed();
}

export function getPattern(id: string): PatternDef | undefined {
  ensureBuiltins();
  return registry.get(id);
}

/** Všechny známé vzorky: vestavěné, pak ostatní v pořadí registrace. */
export function allPatterns(): PatternDef[] {
  ensureBuiltins();
  return [...registry.values()];
}

/** Změna registru (knihovna, otevřený soubor) – pro překreslení výběru vzorků. */
export function onPatternsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const isBuiltinPattern = (id: string) => id.startsWith('builtin:');
export const isUserPattern = (id: string) => id.startsWith('user:');

/** Plátno se vzorkem (cache). */
export function patternCanvas(p: PatternDef): HTMLCanvasElement {
  let c = canvases.get(p);
  if (!c) {
    c = createCanvas(p.width, p.height);
    get2d(c).putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
    canvases.set(p, c);
  }
  return c;
}

/**
 * Výplň vzorkem pro kontext: dlaždice začínají v bodě (ox, oy) kontextu a mají měřítko `scale`.
 * Null, pokud vzorek neexistuje.
 */
export function canvasPattern(ctx: CanvasRenderingContext2D, id: string, ox = 0, oy = 0, scale = 1): CanvasPattern | null {
  const p = getPattern(id);
  if (!p) return null;
  const pattern = ctx.createPattern(patternCanvas(p), 'repeat');
  pattern?.setTransform(new DOMMatrix().translate(ox, oy).scale(scale));
  return pattern;
}

// ---- vestavěné vzorky (generované, deterministické) ----

type Pixel = [number, number, number, number];

function generate(id: string, name: string, w: number, h: number, pixel: (x: number, y: number) => Pixel): PatternDef {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(x, y), (y * w + x) * 4);
  return { id: `builtin:${id}`, name, width: w, height: h, data };
}

/** Pseudonáhodná čísla 0..1 se semínkem (stejný šum při každém spuštění). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function builtinPatterns(): PatternDef[] {
  const noise = seeded(7);
  const noiseValues = Array.from({ length: 64 * 64 }, () => noise());
  const weave = seeded(11);
  const weaveValues = Array.from({ length: 32 * 32 }, () => weave());
  return [
    generate('checker', 'Šachovnice', 16, 16, (x, y) => ((x < 8) !== (y < 8) ? [96, 96, 96, 255] : [255, 255, 255, 255])),
    generate('stripes', 'Šikmé pruhy', 16, 16, (x, y) => ((x + y) % 16 < 6 ? [40, 40, 40, 255] : [0, 0, 0, 0])),
    generate('dots', 'Puntíky', 16, 16, (x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const a = Math.max(0, Math.min(1, 4.5 - d));
      return [0, 0, 0, Math.round(a * 255)];
    }),
    generate('grid', 'Mřížka', 20, 20, (x, y) => (x === 0 || y === 0 ? [120, 120, 120, 255] : [0, 0, 0, 0])),
    generate('bricks', 'Cihly', 32, 16, (x, y) => {
      const mortar = y === 7 || y === 15 || (y < 7 ? x === 0 : x === 16);
      return mortar ? [214, 208, 196, 255] : [168, 74, 50, 255];
    }),
    generate('noise', 'Šum', 64, 64, (x, y) => {
      const v = Math.round(noiseValues[y * 64 + x] * 255);
      return [v, v, v, 255];
    }),
    generate('canvas', 'Plátno', 32, 32, (x, y) => {
      const thread = (x % 4 < 2) !== (y % 4 < 2) ? 18 : 0;
      const v = Math.round(214 + thread + (weaveValues[y * 32 + x] - 0.5) * 30);
      return [v, v - 6, v - 18, 255];
    }),
  ];
}

let builtinsDone = false;
function ensureBuiltins(): void {
  if (builtinsDone) return;
  builtinsDone = true;
  const user = [...registry.values()];
  registry.clear();
  for (const p of builtinPatterns()) registry.set(p.id, p);
  for (const p of user) registry.set(p.id, p);
}

/** Vzorek z výřezu obrázku (Definovat vzorek). */
export function patternFromImage(name: string, image: ImageData, id = `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`): PatternDef {
  return { id, name, width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}
