import type { Editor } from '../core/Editor';
import { corners, handlePosition, HANDLES, containsPoint, type Handle, type Transform } from '../core/transform/geometry';
import type { ToolPointer } from './Tool';

/** Co je pod kurzorem u transformačního rámečku. */
export type BoxHit = { kind: 'handle'; handle: Handle } | { kind: 'move' } | { kind: 'rotate' } | { kind: 'outside' };

const HANDLE_RADIUS = 6; // px obrazovky

export function hitTestBox(editor: Editor, t: Transform, p: ToolPointer, opts: { rotate: boolean; edges: boolean }): BoxHit {
  const vp = editor.viewport;
  for (const handle of HANDLES) {
    if (!opts.edges && (!handle.hx || !handle.hy)) continue;
    const s = vp.toScreen(handlePosition(t, handle).x, handlePosition(t, handle).y);
    if (Math.abs(s.x - p.screenX) <= HANDLE_RADIUS && Math.abs(s.y - p.screenY) <= HANDLE_RADIUS) return { kind: 'handle', handle };
  }
  if (containsPoint(t, p)) return { kind: 'move' };
  return opts.rotate ? { kind: 'rotate' } : { kind: 'outside' };
}

/** Kurzor pro úchyt s ohledem na otočení rámečku. */
export function cursorForHit(hit: BoxHit, t: Transform): string {
  if (hit.kind === 'move') return 'move';
  if (hit.kind === 'rotate') return 'alias';
  if (hit.kind === 'outside') return 'crosshair';
  const angle = Math.atan2(hit.handle.hy, hit.handle.hx) + t.angle;
  const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  const i = ((Math.round(angle / (Math.PI / 4)) % 4) + 4) % 4;
  return cursors[i];
}

/** Rámeček s úchyty (souřadnice obrazovky). */
export function drawBox(ctx: CanvasRenderingContext2D, editor: Editor, t: Transform, opts: { edges: boolean; thirds?: boolean }): void {
  const vp = editor.viewport;
  const pts = corners(t).map((c) => vp.toScreen(c.x, c.y));
  ctx.save();
  ctx.lineWidth = 1;
  ctx.beginPath();
  pts.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
  ctx.closePath();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (opts.thirds) {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      ctx.moveTo(pts[0].x + (pts[1].x - pts[0].x) * k, pts[0].y + (pts[1].y - pts[0].y) * k);
      ctx.lineTo(pts[3].x + (pts[2].x - pts[3].x) * k, pts[3].y + (pts[2].y - pts[3].y) * k);
      ctx.moveTo(pts[0].x + (pts[3].x - pts[0].x) * k, pts[0].y + (pts[3].y - pts[0].y) * k);
      ctx.lineTo(pts[1].x + (pts[2].x - pts[1].x) * k, pts[1].y + (pts[2].y - pts[1].y) * k);
    }
    ctx.stroke();
  }
  for (const handle of HANDLES) {
    if (!opts.edges && (!handle.hx || !handle.hy)) continue;
    const hp = handlePosition(t, handle);
    const s = vp.toScreen(hp.x, hp.y);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.fillRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7);
    ctx.strokeRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7);
  }
  ctx.restore();
}
