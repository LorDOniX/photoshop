import { CircleDashed, SquareDashed } from 'lucide';
import type { Editor } from '../../core/Editor';
import { rasterizeMask } from '../../core/selection/raster';
import type { Bounds, SelectionMode } from '../../core/selection/SelectionMask';
import type { IconNode } from '../../ui/icons';
import type { Tool, ToolOptionsUI, ToolPointer } from '../Tool';
import { selectionOptionsUI, strokeDashed } from './selectionOptions';
import { nudgeSelection, OutlineDrag, startsOutlineMove } from './outlineMove';

/** Tah kratší než tento počet px obrazovky je klik (= odznačit). */
const CLICK_TOLERANCE = 3;

interface Drag {
  sx: number;
  sy: number;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  moved: boolean;
  mode: SelectionMode;
  /** Shift = čtverec/kruh, Alt = od středu (během tažení). */
  shift: boolean;
  alt: boolean;
  /** Modifikátory stisknuté při kliknutí určují režim – omezení zapnou až po puštění a novém stisku. */
  shiftForMode: boolean;
  altForMode: boolean;
}

export class MarqueeTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon: IconNode;
  readonly shortcut = 'M';
  readonly cursor = 'crosshair';
  private drag: Drag | null = null;
  private outline: OutlineDrag | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly shape: 'rect' | 'ellipse',
  ) {
    this.id = shape === 'rect' ? 'marquee-rect' : 'marquee-ellipse';
    this.name = shape === 'rect' ? 'Obdélníkový výběr' : 'Eliptický výběr';
    this.icon = shape === 'rect' ? SquareDashed : CircleDashed;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    if (startsOutlineMove(this.editor, p)) {
      this.outline = new OutlineDrag(this.editor, p.x, p.y);
      return;
    }
    const mode = this.editor.selectionModeFor(p);
    const o = this.editor.selectionOptions;
    if (o.style === 'size') {
      // Pevná velikost: klik umístí výběr levým horním rohem do kurzoru.
      const at = this.editor.snap(p);
      this.commit({ x: Math.round(at.x), y: Math.round(at.y), width: o.fixedWidth, height: o.fixedHeight }, mode);
      return;
    }
    const at = this.editor.snap(p);
    const x = Math.round(at.x);
    const y = Math.round(at.y);
    this.drag = {
      sx: x,
      sy: y,
      x,
      y,
      screenX: p.screenX,
      screenY: p.screenY,
      moved: false,
      mode,
      shift: false,
      alt: false,
      shiftForMode: p.shiftKey,
      altForMode: p.altKey,
    };
  }

  pointerMove(p: ToolPointer): void {
    if (this.outline) return this.outline.move(p);
    const d = this.drag;
    if (!d) return;
    const at = this.editor.snap(p);
    d.x = Math.round(at.x);
    d.y = Math.round(at.y);
    if (!p.shiftKey) d.shiftForMode = false;
    if (!p.altKey) d.altForMode = false;
    d.shift = p.shiftKey && !d.shiftForMode;
    d.alt = p.altKey && !d.altForMode;
    if (Math.hypot(p.screenX - d.screenX, p.screenY - d.screenY) > CLICK_TOLERANCE) d.moved = true;
  }

  pointerUp(): void {
    if (this.outline) {
      const moved = this.outline.end();
      this.outline = null;
      if (!moved) this.editor.deselect();
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const rect = d.moved ? this.rect(d) : null;
    if (!rect || rect.width < 1 || rect.height < 1) {
      if (d.mode === 'replace') this.editor.deselect();
      this.editor.notifyView();
      return;
    }
    this.commit(rect, d.mode);
  }

  deactivate(): void {
    this.drag = null;
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.drag) {
      this.drag = null;
      this.editor.notifyView();
      return true;
    }
    return !this.drag && nudgeSelection(this.editor, e);
  }

  private commit(rect: Bounds, mode: SelectionMode): void {
    const { doc, selectionOptions: o } = this.editor;
    const shape = rasterizeMask(
      doc.width,
      doc.height,
      (ctx) => {
        ctx.beginPath();
        if (this.shape === 'rect') ctx.rect(rect.x, rect.y, rect.width, rect.height);
        else ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      },
      this.shape === 'rect' || o.antiAlias,
    );
    this.editor.applySelectionShape(shape, mode, this.name);
  }

  /** Obdélník tažení v souřadnicích dokumentu (s omezením poměru a tažením od středu). */
  private rect(d: Drag): Bounds {
    const o = this.editor.selectionOptions;
    let w = d.x - d.sx;
    let h = d.y - d.sy;
    const ratio = o.style === 'ratio' ? o.fixedWidth / o.fixedHeight : d.shift ? 1 : 0;
    if (ratio) {
      const size = Math.max(Math.abs(w), Math.abs(h) * ratio);
      w = Math.sign(w || 1) * size;
      h = Math.sign(h || 1) * (size / ratio);
    }
    if (d.alt) {
      return { x: Math.round(d.sx - Math.abs(w)), y: Math.round(d.sy - Math.abs(h)), width: Math.round(Math.abs(w) * 2), height: Math.round(Math.abs(h) * 2) };
    }
    return {
      x: Math.round(Math.min(d.sx, d.sx + w)),
      y: Math.round(Math.min(d.sy, d.sy + h)),
      width: Math.round(Math.abs(w)),
      height: Math.round(Math.abs(h)),
    };
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    const d = this.drag;
    if (!d?.moved) return;
    const r = this.rect(d);
    const a = editor.viewport.toScreen(r.x, r.y);
    const w = r.width * editor.viewport.zoom;
    const h = r.height * editor.viewport.zoom;
    strokeDashed(ctx, (c) => {
      if (this.shape === 'rect') c.rect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(w), Math.round(h));
      else c.ellipse(a.x + w / 2, a.y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    });
  }

  createOptions(): ToolOptionsUI {
    return selectionOptionsUI(this.editor, { antiAlias: this.shape === 'ellipse', style: true });
  }
}
