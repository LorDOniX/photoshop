import { Sparkles } from 'lucide';
import { createCanvas, get2d } from '../core/canvas';
import type { Editor } from '../core/Editor';
import { maskToCanvas } from '../core/selection/raster';
import { checkbox, SliderField } from '../ui/controls';
import { h } from '../ui/dom';
import { floodRegion } from './FillTool';
import { opacitySlider } from './optionParts';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

export interface MagicEraserOptions {
  tolerance: number;
  antiAlias: boolean;
  contiguous: boolean;
  sampleAll: boolean;
  /** 0..1 */
  opacity: number;
}

/**
 * Kouzelná guma (E): jedním klikem vymaže oblast podobné barvy (jako kouzelná hůlka + Delete).
 * Omezená výběrem; se zamčenou průhledností vyplní oblast barvou pozadí (jako Photoshop).
 */
export class MagicEraserTool implements Tool {
  readonly id = 'magic-eraser';
  readonly name = 'Kouzelná guma';
  readonly icon = Sparkles;
  readonly shortcut = 'E';
  readonly cursor = 'crosshair';
  readonly options: MagicEraserOptions = { tolerance: 32, antiAlias: true, contiguous: true, sampleAll: false, opacity: 1 };

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    if (p.button === 0) this.eraseAt(p.x, p.y);
  }

  /** Vymaže oblast kolem bodu dokumentu; false = nebylo co mazat. */
  eraseAt(docX: number, docY: number): boolean {
    const { editor, options: o } = this;
    const { doc } = editor;
    const target = editor.paintTarget();
    const x = Math.floor(docX);
    const y = Math.floor(docY);
    // Do masky kouzelná guma nekreslí (stejně jako ve Photoshopu).
    if (!target || target.kind !== 'pixels' || !target.layer.visible || x < 0 || y < 0 || x >= doc.width || y >= doc.height) return false;
    const { layer } = target;
    const region = floodRegion(editor, target, x, y, o);
    const b = region.bounds();
    if (!b) return false;
    const shape = maskToCanvas(region);
    const keepAlpha = editor.isLocked(layer, 'lockTransparency');
    const rect = { x: b.x - layer.x, y: b.y - layer.y, width: b.width, height: b.height };
    const cmd = editor.paintLayer(layer, rect, this.name, (ctx) => {
      ctx.globalAlpha = o.opacity;
      if (!keepAlpha) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(shape, -layer.x, -layer.y);
        return;
      }
      const piece = createCanvas(b.width, b.height);
      const pctx = get2d(piece);
      pctx.drawImage(shape, -b.x, -b.y);
      pctx.globalCompositeOperation = 'source-in';
      pctx.fillStyle = editor.settings.secondaryColor;
      pctx.fillRect(0, 0, b.width, b.height);
      ctx.drawImage(piece, rect.x, rect.y);
    });
    if (!cmd) return false;
    editor.history.push(cmd);
    return true;
  }

  createOptions(): ToolOptionsUI {
    const o = this.options;
    return {
      element: h(
        'div',
        { class: 'tool-options' },
        new SliderField({ label: 'Tolerance:', value: o.tolerance, min: 0, max: 255, onInput: (v) => (o.tolerance = v) }).element,
        checkbox('Vyhlazování', o.antiAlias, (v) => (o.antiAlias = v)),
        checkbox('Souvislé', o.contiguous, (v) => (o.contiguous = v)),
        checkbox('Ze všech vrstev', o.sampleAll, (v) => (o.sampleAll = v)),
        opacitySlider(o.opacity, (v) => (o.opacity = v)),
      ),
    };
  }
}
