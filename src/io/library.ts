import { createCanvas, get2d } from '../core/canvas';
import type { GradientDef } from '../core/paint/gradient';
import { patternCanvas, registerPattern, unregisterPattern, type PatternDef } from '../core/patterns';

/*
 * Uživatelská knihovna přechodů a vzorků, uložená v prohlížeči (localStorage). Vzorky jsou jako PNG
 * (data URL). Nedostupné nebo plné úložiště se ohlásí výjimkou při ukládání; čtení selže tiše.
 */

const KEY = 'photoshop-ts:library';

interface StoredLibrary {
  gradients: Array<{ name: string; def: GradientDef }>;
  patterns: Array<{ id: string; name: string; png: string }>;
}

function read(): StoredLibrary {
  try {
    const raw = localStorage.getItem(KEY);
    const lib = raw ? (JSON.parse(raw) as Partial<StoredLibrary>) : {};
    return { gradients: lib.gradients ?? [], patterns: lib.patterns ?? [] };
  } catch {
    return { gradients: [], patterns: [] };
  }
}

function write(lib: StoredLibrary): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
  } catch {
    throw new Error('Knihovnu nejde uložit – úložiště prohlížeče je plné nebo vypnuté.');
  }
}

// ---- přechody ----

export function userGradients(): Array<{ name: string; def: GradientDef }> {
  return read().gradients;
}

export function addUserGradient(name: string, def: GradientDef): void {
  const lib = read();
  lib.gradients.push({ name, def });
  write(lib);
}

export function removeUserGradient(index: number): void {
  const lib = read();
  lib.gradients.splice(index, 1);
  write(lib);
}

// ---- vzorky ----

/** Načte uložené vzorky do registru (při startu aplikace). */
export async function loadUserPatterns(): Promise<void> {
  for (const p of read().patterns) {
    try {
      registerPattern(await decodePattern(p.id, p.name, p.png));
    } catch {
      // Poškozený záznam přeskočíme.
    }
  }
}

export function addUserPattern(p: PatternDef): void {
  const lib = read();
  lib.patterns.push({ id: p.id, name: p.name, png: patternCanvas(p).toDataURL('image/png') });
  write(lib);
  registerPattern(p);
}

export function removeUserPattern(id: string): void {
  const lib = read();
  lib.patterns = lib.patterns.filter((p) => p.id !== id);
  write(lib);
  unregisterPattern(id);
}

export async function decodePattern(id: string, name: string, src: string): Promise<PatternDef> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = createCanvas(img.naturalWidth, img.naturalHeight);
  const ctx = get2d(c);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  return { id, name, width: c.width, height: c.height, data };
}
