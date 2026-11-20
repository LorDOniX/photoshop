import type { Rect } from './canvas';

/*
 * Zarovnání a rozmístění vrstev (čisté funkce). Pracuje s obdélníky OBSAHU vrstev
 * (neprůhledné pixely), stejně jako Photoshop – ne s celým plátnem vrstvy.
 */

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'h' | 'v';

export interface Offset {
  dx: number;
  dy: number;
}

/** Posuny, které zarovnají obdélníky k referenčnímu obdélníku. */
export function alignOffsets(rects: readonly Rect[], ref: Rect, kind: AlignKind): Offset[] {
  return rects.map((r) => {
    switch (kind) {
      case 'left':
        return { dx: ref.x - r.x, dy: 0 };
      case 'right':
        return { dx: ref.x + ref.width - (r.x + r.width), dy: 0 };
      case 'hcenter':
        return { dx: Math.round(ref.x + ref.width / 2 - (r.x + r.width / 2)), dy: 0 };
      case 'top':
        return { dx: 0, dy: ref.y - r.y };
      case 'bottom':
        return { dx: 0, dy: ref.y + ref.height - (r.y + r.height) };
      case 'vcenter':
        return { dx: 0, dy: Math.round(ref.y + ref.height / 2 - (r.y + r.height / 2)) };
    }
  });
}

/**
 * Stejné mezery: krajní obdélníky zůstanou, ostatní se rozmístí tak, aby mezery mezi sousedy byly stejné.
 * Vrací posuny v původním pořadí obdélníků. Méně než 3 obdélníky = beze změny.
 */
export function distributeOffsets(rects: readonly Rect[], axis: DistributeAxis): Offset[] {
  const out: Offset[] = rects.map(() => ({ dx: 0, dy: 0 }));
  if (rects.length < 3) return out;
  const pos = (r: Rect) => (axis === 'h' ? r.x : r.y);
  const size = (r: Rect) => (axis === 'h' ? r.width : r.height);
  const order = rects.map((_, i) => i).sort((a, b) => pos(rects[a]) - pos(rects[b]));
  const first = rects[order[0]];
  const last = rects[order[order.length - 1]];
  const span = pos(last) + size(last) - pos(first);
  const used = order.reduce((sum, i) => sum + size(rects[i]), 0);
  const gap = (span - used) / (order.length - 1);
  let cursor = pos(first);
  for (const i of order) {
    const target = Math.round(cursor);
    const d = target - pos(rects[i]);
    out[i] = axis === 'h' ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    cursor += size(rects[i]) + gap;
  }
  return out;
}

/** Obdélník neprůhledných pixelů v RGBA bufferu (null = vše průhledné). */
export function alphaBounds(rgba: Uint8ClampedArray, width: number, height: number): Rect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
