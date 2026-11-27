import type { Rect } from './canvas';

/*
 * Vodítka a přichytávání – čisté funkce bez DOM.
 * Vodítko `h` je vodorovná čára ve výšce `pos`, `v` svislá čára na x = `pos` (px dokumentu).
 */

export type GuideDir = 'h' | 'v';

export interface Guide {
  dir: GuideDir;
  pos: number;
}

/** Vodítka po změně velikosti obrazu (měřítko sx, sy). */
export const scaleGuides = (guides: readonly Guide[], sx: number, sy: number): Guide[] =>
  guides.map((g) => ({ dir: g.dir, pos: round2(g.pos * (g.dir === 'v' ? sx : sy)) }));

/** Vodítka po posunu obsahu (velikost plátna s kotvou, oříznutí). */
export const offsetGuides = (guides: readonly Guide[], dx: number, dy: number): Guide[] =>
  guides.map((g) => ({ dir: g.dir, pos: g.pos + (g.dir === 'v' ? dx : dy) }));

/** Vodítka po otočení dokumentu W × H o `quarterTurns` × 90° po směru hodinových ručiček. */
export function rotateGuides(guides: readonly Guide[], quarterTurns: 1 | 2 | 3, W: number, H: number): Guide[] {
  return guides.map((g) => {
    // Bod (x, y) → 1: (H − y, x), 2: (W − x, H − y), 3: (y, W − x).
    if (quarterTurns === 2) return { dir: g.dir, pos: g.dir === 'v' ? W - g.pos : H - g.pos };
    if (quarterTurns === 1) return g.dir === 'h' ? { dir: 'v', pos: H - g.pos } : { dir: 'h', pos: g.pos };
    return g.dir === 'h' ? { dir: 'v', pos: g.pos } : { dir: 'h', pos: W - g.pos };
  });
}

/** Vodítka po převrácení dokumentu vodorovně (`h`) nebo svisle (`v`). */
export const flipGuides = (guides: readonly Guide[], axis: 'h' | 'v', W: number, H: number): Guide[] =>
  guides.map((g) => (axis === 'h' && g.dir === 'v' ? { dir: 'v', pos: W - g.pos } : axis === 'v' && g.dir === 'h' ? { dir: 'h', pos: H - g.pos } : g));

const round2 = (v: number) => Math.round(v * 100) / 100;

// ---- přichytávání ----

/** Hodnoty, ke kterým se přichytává: svislé čáry (x) a vodorovné čáry (y) v px dokumentu. */
export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/** Nejbližší cíl do vzdálenosti `threshold`, jinak null. */
export function snapValue(v: number, targets: readonly number[], threshold: number): number | null {
  let best: number | null = null;
  let dist = threshold;
  for (const t of targets) {
    const d = Math.abs(t - v);
    if (d <= dist) {
      dist = d;
      best = t;
    }
  }
  return best;
}

/** Přichytí bod – každou osu zvlášť. */
export function snapPoint(p: { x: number; y: number }, t: SnapTargets, threshold: number): { x: number; y: number } {
  return { x: snapValue(p.x, t.xs, threshold) ?? p.x, y: snapValue(p.y, t.ys, threshold) ?? p.y };
}

/**
 * Posun obdélníku, aby se jeho levý / pravý okraj nebo střed (a obdobně svisle) přichytil k nejbližšímu cíli.
 * Vrací korekci (0 = nic blízko).
 */
export function snapRectOffset(r: Rect, t: SnapTargets, threshold: number): { dx: number; dy: number } {
  const axis = (edges: number[], targets: readonly number[]) => {
    let best = 0;
    let dist = threshold;
    let found = false;
    for (const e of edges) {
      const s = snapValue(e, targets, dist);
      if (s === null) continue;
      const d = Math.abs(s - e);
      if (!found || d < dist) {
        dist = d;
        best = s - e;
        found = true;
      }
    }
    return best;
  };
  return {
    dx: axis([r.x, r.x + r.width / 2, r.x + r.width], t.xs),
    dy: axis([r.y, r.y + r.height / 2, r.y + r.height], t.ys),
  };
}

/** Vodítko nejblíž bodu (px obrazovky přepočtené na dokument: `threshold`), nebo -1. */
export function hitGuide(guides: readonly Guide[], x: number, y: number, threshold: number): number {
  let best = -1;
  let dist = threshold;
  guides.forEach((g, i) => {
    const d = Math.abs((g.dir === 'v' ? x : y) - g.pos);
    if (d <= dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}
