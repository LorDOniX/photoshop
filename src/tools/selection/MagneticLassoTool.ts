import { Magnet } from 'lucide';
import type { Editor } from '../../core/Editor';
import { findLiveWire, polylineLength, snapToEdge } from '../../core/selection/livewire';
import { edgeMap, polygonMask } from '../../core/selection/raster';
import type { SelectionMode } from '../../core/selection/SelectionMask';
import type { Tool, ToolOptionsUI, ToolPointer } from '../Tool';
import { strokePolyline } from './LassoTool';
import { selectionOptionsUI } from './selectionOptions';
import { nudgeSelection } from './outlineMove';

const CLOSE_DISTANCE = 8;
const DOUBLE_CLICK_MS = 350;

/**
 * Magnetické laso: klik = první kotva, pak stačí vést myš podél hrany – cesta se k hraně
 * „přilepí“ (livewire) a kotvy se přidávají automaticky podle frekvence.
 * Klik přidá kotvu ručně, dvojklik / Enter / klik na počátek uzavře, Backspace smaže kotvu, Esc zruší.
 */
export class MagneticLassoTool implements Tool {
  readonly id = 'lasso-magnetic';
  readonly name = 'Magnetické laso';
  readonly icon = Magnet;
  readonly shortcut = 'L';
  readonly cursor = 'crosshair';
  /** Pevná část cesty [x0, y0, ...]. */
  private path: number[] = [];
  /** Indexy (do `path` po dvojicích) kotevních bodů. */
  private anchors: number[] = [];
  /** Živý úsek od poslední kotvy ke kurzoru. */
  private live: number[] = [];
  private mode: SelectionMode = 'replace';
  private lastClick = { time: 0, x: 0, y: 0 };

  constructor(private readonly editor: Editor) {}

  private get active(): boolean {
    return this.path.length > 0;
  }

  private params() {
    const { doc, selectionOptions: o, viewport } = this.editor;
    return {
      edges: edgeMap(doc),
      w: doc.width,
      h: doc.height,
      width: o.lassoWidth,
      minEdge: (o.lassoContrast / 100) * 255 * 0.5,
      // Vyšší frekvence = kratší úseky mezi automatickými kotvami (v px obrazovky).
      spacing: Math.max(12, 130 - o.lassoFrequency) / viewport.zoom,
    };
  }

  private snap(x: number, y: number): { x: number; y: number } {
    const p = this.params();
    return snapToEdge(p.edges, p.w, p.h, x, y, p.width, p.minEdge);
  }

  private wire(fx: number, fy: number, tx: number, ty: number): number[] {
    const p = this.params();
    return findLiveWire(p.edges, p.w, p.h, fx, fy, tx, ty, { margin: p.width + 8, minEdge: p.minEdge });
  }

  private lastPoint(): { x: number; y: number } {
    const n = this.path.length;
    return { x: this.path[n - 2], y: this.path[n - 1] };
  }

  /** Připojí živý úsek k pevné cestě a jeho konec udělá kotvou. */
  private commitLive(): void {
    if (this.live.length >= 4) {
      this.path.push(...this.live.slice(2));
      this.anchors.push(this.path.length / 2 - 1);
    }
    this.live = [];
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const now = performance.now();
    const isDouble =
      now - this.lastClick.time < DOUBLE_CLICK_MS && Math.hypot(p.screenX - this.lastClick.x, p.screenY - this.lastClick.y) < 5;
    this.lastClick = { time: now, x: p.screenX, y: p.screenY };

    if (!this.active) {
      this.mode = this.editor.selectionModeFor(p);
      const s = this.snap(p.x, p.y);
      this.path = [s.x, s.y];
      this.anchors = [0];
      this.live = [];
      return;
    }
    if (isDouble || this.nearStart(p)) {
      this.finish();
      return;
    }
    this.commitLive();
  }

  pointerMove(p: ToolPointer): void {
    if (!this.active) return;
    const target = this.snap(p.x, p.y);
    const last = this.lastPoint();
    this.live = this.wire(last.x, last.y, target.x, target.y);
    if (polylineLength(this.live) > this.params().spacing) this.commitLive();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (!this.active) return nudgeSelection(this.editor, e);
    if (e.key === 'Escape') this.cancel();
    else if (e.key === 'Enter') this.finish();
    else if (e.key === 'Backspace') this.removeAnchor();
    else return false;
    this.editor.notifyView();
    return true;
  }

  deactivate(): void {
    this.cancel();
  }

  private removeAnchor(): void {
    this.live = [];
    if (this.anchors.length <= 1) return this.cancel();
    this.anchors.pop();
    const keep = this.anchors[this.anchors.length - 1];
    this.path.length = (keep + 1) * 2;
  }

  private cancel(): void {
    this.path = [];
    this.anchors = [];
    this.live = [];
  }

  private nearStart(p: ToolPointer): boolean {
    if (this.path.length + this.live.length < 8) return false;
    const s = this.editor.viewport.toScreen(this.path[0], this.path[1]);
    return Math.hypot(p.screenX - s.x, p.screenY - s.y) <= CLOSE_DISTANCE;
  }

  private finish(): void {
    this.commitLive();
    // Uzavření: livewire z posledního bodu zpět na začátek.
    const last = this.lastPoint();
    const closing = this.wire(last.x, last.y, this.path[0], this.path[1]);
    const pts = [...this.path, ...closing.slice(2)];
    const mode = this.mode;
    this.cancel();
    if (pts.length < 6) {
      if (mode === 'replace') this.editor.deselect();
      this.editor.notifyView();
      return;
    }
    const { doc, selectionOptions: o } = this.editor;
    // Body jsou středy pixelů → posun o půl pixelu, aby obrys seděl na hranách.
    const shifted = pts.map((v) => v + 0.5);
    this.editor.applySelectionShape(polygonMask(doc.width, doc.height, shifted, o.antiAlias), mode, this.name);
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    if (!this.active) return;
    const shift = (pts: number[]) => pts.map((v) => v + 0.5);
    strokePolyline(ctx, editor, shift([...this.path, ...this.live.slice(2)]));
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    for (const a of this.anchors) {
      const s = editor.viewport.toScreen(this.path[a * 2] + 0.5, this.path[a * 2 + 1] + 0.5);
      ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 2, 5, 5);
      ctx.strokeRect(Math.round(s.x) - 2.5, Math.round(s.y) - 2.5, 6, 6);
    }
    ctx.restore();
  }

  createOptions(): ToolOptionsUI {
    return selectionOptionsUI(this.editor, { antiAlias: true, magnetic: true });
  }
}
