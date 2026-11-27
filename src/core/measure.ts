/*
 * Měření pravítkem – čisté funkce (tools/RulerTool.ts).
 */

export interface RulerLine {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/** Měření úsečky: úhel ve stupních (proti směru hodinových ručiček, −180..180) a délka. */
export function measure(l: RulerLine): { dx: number; dy: number; angle: number; length: number } {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  const angle = dx || dy ? (Math.atan2(-dy, dx) * 180) / Math.PI : 0;
  return { dx, dy, angle: angle === -180 ? 180 : angle, length: Math.hypot(dx, dy) };
}

/** Otočení (radiány, po směru hodinových ručiček jako u transformace), které úsečku srovná k nejbližší ose. */
export function straightenAngle(l: RulerLine): number {
  const t = Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
  const q = Math.PI / 2;
  return -(t - Math.round(t / q) * q);
}
