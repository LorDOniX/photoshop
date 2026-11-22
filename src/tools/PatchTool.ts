import { Puzzle } from 'lucide';
import { clipRect, cloneCanvas, createCanvas, get2d, unionRect, type Rect } from '../core/canvas';
import type { Editor } from '../core/Editor';
import type { Layer } from '../core/Layer';
import { healRegion } from '../core/paint/heal';
import { maskToCanvas } from '../core/selection/raster';
import type { SelectionMask } from '../core/selection/SelectionMask';
import { selectField } from '../ui/controls';
import { h } from '../ui/dom';
import { LassoTool } from './selection/LassoTool';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/*
 * Záplata (J): mimo výběr kreslí výběr jako laso (Shift / Alt přidá / odebere). Tah uvnitř výběru posouvá
 * záplatu:
 * - Zdroj: vybrané (poškozené) místo se nahradí texturou z místa, kam se výběr přetáhne,
 * - Cíl: vybrané místo se přenese tam, kam se výběr přetáhne.
 * Během tažení je vidět posunutý obrys i náhled pixelů, po puštění se oblast retušuje (textura ze zdroje,
 * barvy napojené na okolí – core/paint/heal.ts). Měkký výběr zapůsobí jen zčásti. Výběr zůstane na místě.
 */

interface Drag {
  layer: Layer;
  /** Originál vrstvy. */
  base: HTMLCanvasElement;
  selection: SelectionMask;
  selectionCanvas: HTMLCanvasElement;
  /** Obdélník výběru v souřadnicích vrstvy (oříznutý vrstvou). */
  rect: Rect;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  /** Naposledy překreslený výřez náhledu. */
  dirty: Rect | null;
}

export class PatchTool implements Tool {
  readonly id = 'patch';
  readonly name = 'Záplata';
  readonly icon = Puzzle;
  readonly shortcut = 'J';
  readonly cursor = 'crosshair';
  mode: 'source' | 'destination' = 'source';
  private readonly lasso: LassoTool;
  private drag: Drag | null = null;

  constructor(private readonly editor: Editor) {
    this.lasso = new LassoTool(editor, 'free');
  }

  private inside(p: ToolPointer): boolean {
    const sel = this.editor.doc.selection;
    return !!sel && !p.shiftKey && !p.altKey && sel.get(Math.floor(p.x), Math.floor(p.y)) >= 128;
  }

  cursorAt(p: ToolPointer): string | null {
    return this.drag || this.inside(p) ? 'move' : null;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const sel = this.editor.doc.selection;
    if (!sel || !this.inside(p)) return this.lasso.pointerDown(p);
    const target = this.editor.paintTarget();
    if (!target || target.kind !== 'pixels' || !target.layer.visible || this.editor.isLocked(target.layer, 'lockPixels')) {
      this.editor.notice('Záplata pracuje s pixely viditelné, nezamčené vrstvy.');
      return;
    }
    const { layer } = target;
    const b = sel.bounds()!;
    const rect = clipRect({ x: b.x - layer.x, y: b.y - layer.y, width: b.width, height: b.height }, layer.canvas.width, layer.canvas.height);
    if (!rect) return;
    this.drag = {
      layer,
      base: cloneCanvas(layer.canvas),
      selection: sel,
      selectionCanvas: maskToCanvas(sel),
      rect,
      startX: p.x,
      startY: p.y,
      dx: 0,
      dy: 0,
      dirty: null,
    };
  }

  pointerMove(p: ToolPointer): void {
    const d = this.drag;
    if (!d) return this.lasso.pointerMove(p);
    const dx = Math.round(p.x - d.startX);
    const dy = Math.round(p.y - d.startY);
    if (dx === d.dx && dy === d.dy) return;
    d.dx = dx;
    d.dy = dy;
    this.editor.doc.setSelection(d.selection.translate(dx, dy));
    this.preview(d);
  }

  /** Obdélník, který záplata mění (souřadnice vrstvy). */
  private changed(d: Drag): Rect | null {
    const r = this.mode === 'source' ? d.rect : { ...d.rect, x: d.rect.x + d.dx, y: d.rect.y + d.dy };
    return clipRect(r, d.base.width, d.base.height);
  }

  /** Náhled: zdrojové pixely (posunuté) maskované výběrem přes originál. */
  private preview(d: Drag): void {
    const ctx = get2d(d.layer.canvas);
    const r = this.changed(d);
    const restore = r ? unionRect(d.dirty, r) : d.dirty;
    if (restore) {
      ctx.clearRect(restore.x, restore.y, restore.width, restore.height);
      ctx.drawImage(d.base, restore.x, restore.y, restore.width, restore.height, restore.x, restore.y, restore.width, restore.height);
    }
    if (r) {
      const tile = this.sourceTile(d, r);
      ctx.drawImage(tile, r.x, r.y);
    }
    d.dirty = r;
    if (restore) this.editor.doc.notifyPixels(d.layer.id, { x: restore.x + d.layer.x, y: restore.y + d.layer.y, width: restore.width, height: restore.height });
  }

  /** Posun mezi cílem (měněný pixel) a zdrojem: zdroj = cíl + posun. */
  private shift(d: Drag): { x: number; y: number } {
    return this.mode === 'source' ? { x: d.dx, y: d.dy } : { x: -d.dx, y: -d.dy };
  }

  /** Pixely zdroje pro výřez `r`, maskované výběrem (u Cíle posunutým). */
  private sourceTile(d: Drag, r: Rect, masked = true): HTMLCanvasElement {
    const tile = createCanvas(r.width, r.height);
    const t = get2d(tile);
    const s = this.shift(d);
    t.drawImage(d.base, -(r.x + s.x), -(r.y + s.y));
    if (masked) {
      t.globalCompositeOperation = 'destination-in';
      const mx = this.mode === 'source' ? 0 : d.dx;
      const my = this.mode === 'source' ? 0 : d.dy;
      t.drawImage(d.selectionCanvas, -(r.x + d.layer.x - mx), -(r.y + d.layer.y - my));
    }
    return tile;
  }

  pointerUp(): void {
    const d = this.drag;
    if (!d) return this.lasso.pointerUp();
    this.drag = null;
    const { doc } = this.editor;
    doc.setSelection(d.selection);
    // Vrátit originál a záplatu zapsat jako krok historie.
    const ctx = get2d(d.layer.canvas);
    if (d.dirty) {
      const r = d.dirty;
      ctx.clearRect(r.x, r.y, r.width, r.height);
      ctx.drawImage(d.base, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
      doc.notifyPixels(d.layer.id, { x: r.x + d.layer.x, y: r.y + d.layer.y, width: r.width, height: r.height });
    }
    if (!d.dx && !d.dy) return;
    const r = this.changed(d);
    if (!r) return;
    const area = clipRect({ x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4 }, d.base.width, d.base.height)!;
    const { width, height } = area;
    const dst = get2d(d.base).getImageData(area.x, area.y, width, height).data;
    const src = get2d(this.sourceTile(d, area, false)).getImageData(0, 0, width, height).data;
    // Váhy výběru ve výřezu (u Cíle posunutý výběr).
    const mx = this.mode === 'source' ? 0 : d.dx;
    const my = this.mode === 'source' ? 0 : d.dy;
    const sel = d.selection;
    const weights = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const sy = y + area.y + d.layer.y - my;
      if (sy < 0 || sy >= sel.height) continue;
      for (let x = 0; x < width; x++) {
        const sx = x + area.x + d.layer.x - mx;
        if (sx >= 0 && sx < sel.width) weights[y * width + x] = sel.data[sy * sel.width + sx];
      }
    }
    const inside = new Uint8Array(width * height);
    for (let i = 0; i < inside.length; i++) inside[i] = weights[i] > 0 ? 1 : 0;
    const healed = healRegion(dst, src, inside, width, height);
    const out = new ImageData(new Uint8ClampedArray(dst), width, height);
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] / 255;
      if (w <= 0) continue;
      for (let c = 0; c < 4; c++) out.data[i * 4 + c] = dst[i * 4 + c] + (healed[i * 4 + c] - dst[i * 4 + c]) * w;
    }
    const cmd = this.editor.paintLayer(d.layer, area, this.name, (c) => c.putImageData(out, area.x, area.y));
    if (cmd) this.editor.history.push(cmd);
  }

  keyDown(e: KeyboardEvent): boolean {
    return this.lasso.keyDown(e);
  }

  deactivate(): void {
    if (this.drag) {
      const d = this.drag;
      d.dx = d.dy = 0;
      this.preview(d);
      this.editor.doc.setSelection(d.selection);
      this.drag = null;
    }
    this.lasso.deactivate();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    this.lasso.drawOverlay(ctx, editor);
  }

  createOptions(): ToolOptionsUI {
    const element = h(
      'div',
      { class: 'tool-options' },
      selectField(
        'Záplata:',
        [
          { value: 'source', label: 'Zdroj' },
          { value: 'destination', label: 'Cíl' },
        ],
        this.mode,
        (v) => (this.mode = v as 'source' | 'destination'),
      ),
      h('span', { class: 'muted opt-hint' }, 'Nakreslete výběr kolem místa a přetáhněte ho.'),
    );
    return { element };
  }
}
