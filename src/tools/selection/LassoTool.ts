import { Lasso, LassoSelect } from 'lucide';
import type { Editor } from '../../core/Editor';
import { polygonMask } from '../../core/selection/raster';
import type { SelectionMode } from '../../core/selection/SelectionMask';
import type { IconNode } from '../../ui/icons';
import type { Tool, ToolOptionsUI, ToolPointer } from '../Tool';
import { selectionOptionsUI } from './selectionOptions';
import { nudgeSelection, OutlineDrag, startsOutlineMove } from './outlineMove';

const CLOSE_DISTANCE = 8; // px obrazovky – klik u počátečního bodu uzavře mnohoúhelník
const DOUBLE_CLICK_MS = 350;

/** Lomená čára v obrazovkových souřadnicích (černobílá, dobře viditelná na jakémkoli podkladu). */
export function strokePolyline(ctx: CanvasRenderingContext2D, editor: Editor, points: readonly number[], closeTo?: { x: number; y: number }): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    const s = editor.viewport.toScreen(points[i], points[i + 1]);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  if (closeTo) {
    const s = editor.viewport.toScreen(closeTo.x, closeTo.y);
    ctx.lineTo(s.x, s.y);
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.restore();
}

/**
 * Laso: `free` = kreslení tažením, `polygon` = body kliknutím (uzavření: klik na počátek,
 * dvojklik nebo Enter; Backspace smaže poslední bod; Esc zruší; Shift = násobky 45°).
 */
export class LassoTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon: IconNode;
  readonly shortcut = 'L';
  readonly cursor = 'crosshair';
  private points: number[] = [];
  private mode: SelectionMode = 'replace';
  private hover: { x: number; y: number } | null = null;
  private drawing = false;
  private lastClick = { time: 0, x: 0, y: 0 };
  private outline: OutlineDrag | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly kind: 'free' | 'polygon',
  ) {
    this.id = kind === 'free' ? 'lasso' : 'lasso-polygon';
    this.name = kind === 'free' ? 'Laso' : 'Mnohoúhelníkové laso';
    this.icon = kind === 'free' ? Lasso : LassoSelect;
  }

  private get active(): boolean {
    return this.points.length > 0;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    if (this.kind === 'free') {
      if (startsOutlineMove(this.editor, p)) {
        this.outline = new OutlineDrag(this.editor, p.x, p.y);
        return;
      }
      this.mode = this.editor.selectionModeFor(p);
      this.points = [p.x, p.y];
      this.drawing = true;
      return;
    }

    const now = performance.now();
    const isDouble =
      now - this.lastClick.time < DOUBLE_CLICK_MS && Math.hypot(p.screenX - this.lastClick.x, p.screenY - this.lastClick.y) < 5;
    this.lastClick = { time: now, x: p.screenX, y: p.screenY };

    if (!this.active) {
      this.mode = this.editor.selectionModeFor(p);
      this.points = [p.x, p.y];
      return;
    }
    if (isDouble || this.nearStart(p)) {
      this.finish();
      return;
    }
    const pt = this.constrained(p);
    this.points.push(pt.x, pt.y);
  }

  pointerMove(p: ToolPointer): void {
    if (this.outline) return this.outline.move(p);
    this.hover = this.active ? this.constrained(p) : null;
    if (this.kind === 'free' && this.drawing) {
      const n = this.points.length;
      if (Math.hypot(p.x - this.points[n - 2], p.y - this.points[n - 1]) * this.editor.viewport.zoom >= 1.5) {
        this.points.push(p.x, p.y);
      }
    }
  }

  pointerUp(): void {
    if (this.outline) {
      if (!this.outline.end()) this.editor.deselect();
      this.outline = null;
      return;
    }
    if (this.kind !== 'free' || !this.drawing) return;
    this.drawing = false;
    this.finish();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (!this.active) return nudgeSelection(this.editor, e);
    if (e.key === 'Escape') this.cancel();
    else if (e.key === 'Enter') this.finish();
    else if (e.key === 'Backspace' && this.kind === 'polygon') {
      this.points.length -= 2;
      if (!this.points.length) this.cancel();
    } else return false;
    this.editor.notifyView();
    return true;
  }

  deactivate(): void {
    this.cancel();
  }

  private cancel(): void {
    this.points = [];
    this.hover = null;
    this.drawing = false;
  }

  private nearStart(p: ToolPointer): boolean {
    if (this.points.length < 6) return false;
    const s = this.editor.viewport.toScreen(this.points[0], this.points[1]);
    return Math.hypot(p.screenX - s.x, p.screenY - s.y) <= CLOSE_DISTANCE;
  }

  /** Shift: úhel po násobcích 45° od posledního bodu. */
  private constrained(p: ToolPointer): { x: number; y: number } {
    const n = this.points.length;
    if (!p.shiftKey || this.kind !== 'polygon' || n < 2) return { x: p.x, y: p.y };
    const lx = this.points[n - 2];
    const ly = this.points[n - 1];
    const angle = Math.round(Math.atan2(p.y - ly, p.x - lx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(p.x - lx, p.y - ly);
    return { x: lx + Math.cos(angle) * len, y: ly + Math.sin(angle) * len };
  }

  private finish(): void {
    const pts = this.points;
    const mode = this.mode;
    this.cancel();
    if (pts.length < 6) {
      if (mode === 'replace') this.editor.deselect();
      this.editor.notifyView();
      return;
    }
    const { doc, selectionOptions: o } = this.editor;
    this.editor.applySelectionShape(polygonMask(doc.width, doc.height, pts, o.antiAlias), mode, this.name);
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    if (!this.active) return;
    const closeTo = this.kind === 'polygon' ? (this.hover ?? undefined) : { x: this.points[0], y: this.points[1] };
    strokePolyline(ctx, editor, this.points, closeTo);
  }

  createOptions(): ToolOptionsUI {
    return selectionOptionsUI(this.editor, { antiAlias: true });
  }
}
