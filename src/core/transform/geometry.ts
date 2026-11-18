/*
 * Volná transformace: obdélník zdroje (sw × sh) se vykreslí se středem (cx, cy), velikostí w × h,
 * otočením `angle` (radiány) a případným převrácením. Geometrie je čistá (bez DOM) a testovatelná.
 */

export interface Transform {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  flipX: boolean;
  flipY: boolean;
}

export interface Point {
  x: number;
  y: number;
}

/** Transformace, která nic nemění – obdélník (x, y, w, h). */
export function identityTransform(x: number, y: number, w: number, h: number): Transform {
  return { cx: x + w / 2, cy: y + h / 2, w, h, angle: 0, flipX: false, flipY: false };
}

export function rotate(p: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Bod v lokálních souřadnicích transformace (střed = 0,0; bez otočení) → dokument. */
export function localToDoc(t: Transform, p: Point): Point {
  const r = rotate(p, t.angle);
  return { x: t.cx + r.x, y: t.cy + r.y };
}

export function docToLocal(t: Transform, p: Point): Point {
  return rotate({ x: p.x - t.cx, y: p.y - t.cy }, -t.angle);
}

/** Rohy v pořadí: vlevo nahoře, vpravo nahoře, vpravo dole, vlevo dole. */
export function corners(t: Transform): Point[] {
  const hw = t.w / 2;
  const hh = t.h / 2;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => localToDoc(t, p));
}

/** Ohraničující obdélník (osově zarovnaný) v celých pixelech. */
export function boundingBox(t: Transform): { x: number; y: number; width: number; height: number } {
  const c = corners(t);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs) + 1e-6);
  const y0 = Math.floor(Math.min(...ys) + 1e-6);
  return {
    x: x0,
    y: y0,
    width: Math.max(1, Math.ceil(Math.max(...xs) - 1e-6) - x0),
    height: Math.max(1, Math.ceil(Math.max(...ys) - 1e-6) - y0),
  };
}

/** Úchyt: směr (−1/0/1) v lokálních osách. */
export interface Handle {
  hx: -1 | 0 | 1;
  hy: -1 | 0 | 1;
}

export const HANDLES: Handle[] = [
  { hx: -1, hy: -1 },
  { hx: 0, hy: -1 },
  { hx: 1, hy: -1 },
  { hx: 1, hy: 0 },
  { hx: 1, hy: 1 },
  { hx: 0, hy: 1 },
  { hx: -1, hy: 1 },
  { hx: -1, hy: 0 },
];

export function handlePosition(t: Transform, h: Handle): Point {
  return localToDoc(t, { x: (h.hx * t.w) / 2, y: (h.hy * t.h) / 2 });
}

/**
 * Tažení úchytu: protější úchyt zůstává na místě. `keepRatio` (Shift u rohů) zachová poměr stran,
 * `fromCenter` (Alt) mění velikost symetricky kolem středu.
 */
export function dragHandle(start: Transform, h: Handle, p: Point, keepRatio: boolean, fromCenter: boolean): Transform {
  const anchorLocal = fromCenter ? { x: 0, y: 0 } : { x: (-h.hx * start.w) / 2, y: (-h.hy * start.h) / 2 };
  const anchor = localToDoc(start, anchorLocal);
  const v = rotate({ x: p.x - anchor.x, y: p.y - anchor.y }, -start.angle);
  const k = fromCenter ? 2 : 1;
  let w = h.hx ? Math.max(1, h.hx * v.x * k) : start.w;
  let hh = h.hy ? Math.max(1, h.hy * v.y * k) : start.h;
  if (keepRatio && h.hx && h.hy) {
    const s = Math.max(w / start.w, hh / start.h);
    w = start.w * s;
    hh = start.h * s;
  }
  if (fromCenter) return { ...start, w, h: hh };
  const c = localToDoc({ ...start, cx: anchor.x, cy: anchor.y }, { x: (h.hx * w) / 2, y: (h.hy * hh) / 2 });
  return { ...start, cx: c.x, cy: c.y, w, h: hh };
}

/** Otočení tažením kolem středu (Shift = po 15°). */
export function dragRotate(start: Transform, from: Point, to: Point, snap: boolean): Transform {
  const a0 = Math.atan2(from.y - start.cy, from.x - start.cx);
  const a1 = Math.atan2(to.y - start.cy, to.x - start.cx);
  let angle = start.angle + (a1 - a0);
  if (snap) {
    const step = Math.PI / 12;
    angle = Math.round(angle / step) * step;
  }
  return { ...start, angle };
}

/** Je bod uvnitř transformovaného obdélníku? */
export function containsPoint(t: Transform, p: Point): boolean {
  const l = docToLocal(t, p);
  return Math.abs(l.x) <= t.w / 2 && Math.abs(l.y) <= t.h / 2;
}
