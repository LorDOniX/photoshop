import { ScanEye } from 'lucide';
import { clipRect, type Rect } from '../core/canvas';
import type { Editor } from '../core/Editor';
import { redEyeMask, removeRedEye } from '../core/paint/recolor';
import { SliderField } from '../ui/controls';
import { h } from '../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/*
 * Červené oči (J): klik do zornice opraví červenou oblast spojenou s místem kliku (hledá se v okolí ±CLICK_REACH px),
 * tažení obdélníku opraví všechny červené pixely v něm. Velikost zornice = citlivost (větší zachytí i méně červené
 * okraje), Ztmavení = jak tmavá bude zornice. Jen pixely aktivní vrstvy, jen ve výběru, jeden krok historie.
 */

/** Dosah hledání zornice kolem kliku (px dokumentu). */
const CLICK_REACH = 150;

export class RedEyeTool implements Tool {
  readonly id = 'red-eye';
  readonly name = 'Červené oči';
  readonly icon = ScanEye;
  readonly shortcut = 'J';
  readonly cursor = 'crosshair';
  pupilSize = 50;
  darken = 50;
  private drag: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }

  pointerMove(p: ToolPointer): void {
    if (!this.drag) return;
    this.drag.x1 = p.x;
    this.drag.y1 = p.y;
    this.editor.notifyView();
  }

  pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    this.editor.notifyView();
    const w = Math.abs(d.x1 - d.x0);
    const hgt = Math.abs(d.y1 - d.y0);
    // Malý tah = klik.
    if (w < 4 && hgt < 4) this.fix({ x: Math.floor(d.x0) - CLICK_REACH, y: Math.floor(d.y0) - CLICK_REACH, width: 2 * CLICK_REACH + 1, height: 2 * CLICK_REACH + 1 }, { x: Math.floor(d.x0), y: Math.floor(d.y0) });
    else this.fix({ x: Math.floor(Math.min(d.x0, d.x1)), y: Math.floor(Math.min(d.y0, d.y1)), width: Math.ceil(w) + 1, height: Math.ceil(hgt) + 1 });
  }

  deactivate(): void {
    this.drag = null;
  }

  /** Oprava v obdélníku dokumentu; `seed` = bod kliku (dokument). */
  fix(area: Rect, seed?: { x: number; y: number }): boolean {
    const target = this.editor.paintTarget();
    if (!target || !target.layer.visible) return false;
    if (target.kind !== 'pixels') {
      this.editor.notice('Červené oči se opravují v pixelech vrstvy, ne v masce.');
      return false;
    }
    const { layer, ctx } = target;
    const r = clipRect({ x: area.x - layer.x, y: area.y - layer.y, width: area.width, height: area.height }, layer.width, layer.height);
    if (!r) return false;
    const img = ctx.getImageData(r.x, r.y, r.width, r.height);
    const s = seed ? { x: seed.x - layer.x - r.x, y: seed.y - layer.y - r.y } : undefined;
    const weights = redEyeMask(img.data, r.width, r.height, this.pupilSize, s);
    const sel = this.editor.doc.selection;
    if (sel) {
      for (let j = 0; j < r.height; j++) {
        for (let i = 0; i < r.width; i++) {
          const k = j * r.width + i;
          if (!weights[k]) continue;
          const sx = r.x + i + layer.x;
          const sy = r.y + j + layer.y;
          weights[k] *= sx >= 0 && sy >= 0 && sx < sel.width && sy < sel.height ? sel.data[sy * sel.width + sx] / 255 : 0;
        }
      }
    }
    if (!removeRedEye(img.data, weights, this.darken)) {
      this.editor.notice('Nenašla se červená zornice – klikněte přímo do ní, nebo zvětšete Velikost zornice.');
      return false;
    }
    const cmd = this.editor.paintLayer(layer, r, this.name, (c) => c.putImageData(img, r.x, r.y));
    if (cmd) this.editor.history.push(cmd);
    return !!cmd;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    const d = this.drag;
    if (!d || (Math.abs(d.x1 - d.x0) < 4 && Math.abs(d.y1 - d.y0) < 4)) return;
    const a = editor.viewport.toScreen(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1));
    const b = editor.viewport.toScreen(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
    ctx.restore();
  }

  createOptions(): ToolOptionsUI {
    return {
      element: h(
        'div',
        { class: 'tool-options' },
        new SliderField({ label: 'Velikost zornice:', value: this.pupilSize, min: 1, max: 100, unit: '%', onInput: (v) => (this.pupilSize = v) }).element,
        new SliderField({ label: 'Ztmavení:', value: this.darken, min: 1, max: 100, unit: '%', onInput: (v) => (this.darken = v) }).element,
      ),
    };
  }
}
