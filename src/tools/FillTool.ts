import { PaintBucket } from 'lucide';
import { createCanvas, get2d } from '../core/canvas';
import type { Editor, PaintTarget } from '../core/Editor';
import type { SelectionMask } from '../core/selection/SelectionMask';
import type { BlendMode } from '../core/Layer';
import { luminance, paintMaskValue } from '../core/mask';
import { multiplyMasks, softenEdge } from '../core/paint/fill';
import { floodSelect } from '../core/selection/floodFill';
import { maskToCanvas, samplePixels } from '../core/selection/raster';
import { checkbox, selectField, SliderField } from '../ui/controls';
import { h } from '../ui/dom';
import { blendModeSelect, opacitySlider } from './optionParts';
import { eyedropperOf } from './EyedropperTool';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

export interface FillOptions {
  source: 'fg' | 'bg';
  blendMode: BlendMode;
  /** 0..1 */
  opacity: number;
  tolerance: number;
  antiAlias: boolean;
  contiguous: boolean;
  sampleAll: boolean;
}

/**
 * Oblast podobné barvy kolem bodu (x, y) dokumentu pro plechovku a kouzelnou gumu: flood fill
 * nad pixely vrstvy / složeného obrazu (v masce nad hodnotami masky), volitelně s vyhlazeným lemem, omezená výběrem.
 */
export function floodRegion(
  editor: Editor,
  target: PaintTarget,
  x: number,
  y: number,
  o: { tolerance: number; antiAlias: boolean; contiguous: boolean; sampleAll: boolean },
): SelectionMask {
  const { doc } = editor;
  const { layer } = target;
  let pixels: Uint8ClampedArray;
  if (target.kind === 'mask') {
    const c = createCanvas(doc.width, doc.height);
    const cctx = get2d(c);
    cctx.drawImage(target.canvas, layer.x, layer.y);
    pixels = cctx.getImageData(0, 0, doc.width, doc.height).data;
  } else pixels = samplePixels(doc, o.sampleAll ? 'all' : 'layer').data;
  let region = floodSelect(pixels, doc.width, doc.height, x, y, o.tolerance, o.contiguous);
  if (o.antiAlias) region = softenEdge(region);
  return multiplyMasks(region, doc.selection);
}

/**
 * Plechovka (G): vyplní oblast podobné barvy (jako kouzelná hůlka) barvou popředí / pozadí.
 * Výplň je omezená výběrem; v režimu úprav masky vyplňuje masku jasem barvy. Alt+klik = kapátko.
 */
export class FillTool implements Tool {
  readonly id = 'fill';
  readonly name = 'Plechovka';
  readonly icon = PaintBucket;
  readonly shortcut = 'G';
  readonly cursor = 'crosshair';
  readonly options: FillOptions = {
    source: 'fg',
    blendMode: 'source-over',
    opacity: 1,
    tolerance: 32,
    antiAlias: true,
    contiguous: true,
    sampleAll: false,
  };

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    if (p.altKey) return eyedropperOf(this.editor)?.begin(p, 'color');
    this.fillAt(p.x, p.y);
  }

  pointerMove(p: ToolPointer): void {
    eyedropperOf(this.editor)?.move(p);
  }

  pointerUp(): void {
    eyedropperOf(this.editor)?.end();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    eyedropperOf(editor)?.drawOverlay(ctx, editor);
  }

  /** Vyplní oblast kolem bodu (x, y) dokumentu. Vrací false, pokud nebylo co vyplnit. */
  fillAt(docX: number, docY: number): boolean {
    const { editor, options: o } = this;
    const { doc } = editor;
    const target = editor.paintTarget();
    const x = Math.floor(docX);
    const y = Math.floor(docY);
    if (!target || !target.layer.visible || x < 0 || y < 0 || x >= doc.width || y >= doc.height) return false;
    const { layer } = target;
    const isMask = target.kind === 'mask';
    const region = floodRegion(editor, target, x, y, o);
    const b = region.bounds();
    if (!b) return false;

    const color = o.source === 'fg' ? editor.settings.color : editor.settings.secondaryColor;
    const rect = { x: b.x - layer.x, y: b.y - layer.y, width: b.width, height: b.height };
    const shape = maskToCanvas(region);
    const cmd = editor.paintLayer(
      layer,
      rect,
      isMask ? 'Plechovka (maska)' : 'Plechovka',
      (ctx) => {
        if (isMask) {
          paintMaskValue(ctx, shape, -layer.x, -layer.y, luminance(color), o.opacity);
          return;
        }
        const piece = createCanvas(b.width, b.height);
        const pctx = get2d(piece);
        pctx.drawImage(shape, -b.x, -b.y);
        pctx.globalCompositeOperation = 'source-in';
        pctx.fillStyle = color;
        pctx.fillRect(0, 0, b.width, b.height);
        ctx.globalAlpha = o.opacity;
        ctx.globalCompositeOperation = o.blendMode;
        ctx.drawImage(piece, rect.x, rect.y);
      },
      target.kind,
    );
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
        selectField(
          'Výplň:',
          [
            { value: 'fg', label: 'Popředí' },
            { value: 'bg', label: 'Pozadí' },
          ],
          o.source,
          (v) => (o.source = v as FillOptions['source']),
        ),
        blendModeSelect(o.blendMode, (v) => (o.blendMode = v)),
        opacitySlider(o.opacity, (v) => (o.opacity = v)),
        new SliderField({ label: 'Tolerance:', value: o.tolerance, min: 0, max: 255, onInput: (v) => (o.tolerance = v) }).element,
        checkbox('Vyhlazování', o.antiAlias, (v) => (o.antiAlias = v)),
        checkbox('Souvislé', o.contiguous, (v) => (o.contiguous = v)),
        checkbox('Ze všech vrstev', o.sampleAll, (v) => (o.sampleAll = v)),
      ),
    };
  }
}
