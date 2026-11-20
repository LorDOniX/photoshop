import { Blend } from 'lucide';
import { clipRect, createCanvas, get2d } from '../core/canvas';
import type { RGBA } from '../core/color';
import type { Editor } from '../core/Editor';
import type { BlendMode } from '../core/Layer';
import {
  buildLut,
  GRADIENT_PRESETS,
  GRADIENT_TYPES,
  presetStops,
  renderGradient,
  snapAngle,
  type GradientPreset,
  type GradientType,
  type Point,
} from '../core/paint/gradient';
import { maskToCanvas } from '../core/selection/raster';
import { checkbox, selectField } from '../ui/controls';
import { h } from '../ui/dom';
import { eyedropperOf } from './EyedropperTool';
import { blendModeSelect, opacitySlider } from './optionParts';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

export interface GradientOptions {
  preset: GradientPreset;
  type: GradientType;
  blendMode: BlendMode;
  /** 0..1 */
  opacity: number;
  reverse: boolean;
  dither: boolean;
}

/**
 * Přechod (G): tažením se určí začátek a konec, po puštění se vyplní vrstva (nebo výběr).
 * Shift = úhel po 45°, Alt+klik = kapátko. V režimu úprav masky kreslí přechod jasu do masky.
 */
export class GradientTool implements Tool {
  readonly id = 'gradient';
  readonly name = 'Přechod';
  readonly icon = Blend;
  readonly shortcut = 'G';
  readonly cursor = 'crosshair';
  readonly options: GradientOptions = {
    preset: 'fg-bg',
    type: 'linear',
    blendMode: 'source-over',
    opacity: 1,
    reverse: false,
    dither: true,
  };
  private drag: { start: Point; end: Point } | null = null;
  private picking = false;

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    if (p.altKey) {
      this.picking = true;
      eyedropperOf(this.editor)?.begin(p, 'color');
      return;
    }
    this.drag = { start: { x: p.x, y: p.y }, end: { x: p.x, y: p.y } };
  }

  pointerMove(p: ToolPointer): void {
    if (this.picking) return eyedropperOf(this.editor)?.move(p);
    if (!this.drag) return;
    const end = { x: p.x, y: p.y };
    this.drag.end = p.shiftKey ? snapAngle(this.drag.start, end) : end;
  }

  pointerUp(): void {
    if (this.picking) {
      this.picking = false;
      eyedropperOf(this.editor)?.end();
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (d) this.apply(d.start, d.end);
    this.editor.notifyView();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key !== 'Escape' || !this.drag) return false;
    this.drag = null;
    this.editor.notifyView();
    return true;
  }

  deactivate(): void {
    this.drag = null;
    this.picking = false;
  }

  /** Vykreslí přechod mezi body (souřadnice dokumentu). Vrací false, pokud se nic nezměnilo. */
  apply(start: Point, end: Point): boolean {
    const { editor, options: o } = this;
    const target = editor.paintTarget();
    if (!target || !target.layer.visible || Math.hypot(end.x - start.x, end.y - start.y) < 1) return false;
    const { layer } = target;
    const sel = editor.doc.selection;
    const sb = sel?.bounds();
    const area = sb ? { x: sb.x - layer.x, y: sb.y - layer.y, width: sb.width, height: sb.height } : { x: 0, y: 0, width: layer.width, height: layer.height };
    const r = clipRect(area, layer.width, layer.height);
    if (!r) return false;

    // Přechod vypočtený pro oblast r (v souřadnicích vrstvy).
    const lut = buildLut(presetStops(o.preset, editor.settings.color, editor.settings.secondaryColor));
    const image = new ImageData(r.width, r.height);
    renderGradient(image.data, r.width, r.height, layer.x + r.x, layer.y + r.y, {
      type: o.type,
      start,
      end,
      lut,
      reverse: o.reverse,
      dither: o.dither,
    });
    const piece = createCanvas(r.width, r.height);
    const pctx = get2d(piece);
    pctx.putImageData(image, 0, 0);
    if (sel) {
      pctx.globalCompositeOperation = 'destination-in';
      pctx.drawImage(maskToCanvas(sel), -(layer.x + r.x), -(layer.y + r.y));
    }

    const isMask = target.kind === 'mask';
    const cmd = editor.paintLayer(
      layer,
      r,
      isMask ? 'Přechod (maska)' : 'Přechod',
      (ctx) => {
        if (isMask) return blendIntoMask(ctx, piece, r.x, r.y, o.opacity);
        ctx.globalAlpha = o.opacity;
        ctx.globalCompositeOperation = o.blendMode;
        ctx.drawImage(piece, r.x, r.y);
      },
      target.kind,
    );
    if (!cmd) return false;
    editor.history.push(cmd);
    return true;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    eyedropperOf(editor)?.drawOverlay(ctx, editor);
    const d = this.drag;
    if (!d) return;
    const a = editor.viewport.toScreen(d.start.x, d.start.y);
    const b = editor.viewport.toScreen(d.end.x, d.end.y);
    ctx.save();
    for (const [color, width] of [
      ['rgba(0,0,0,0.8)', 3],
      ['#fff', 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      for (const pt of [a, b]) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  createOptions(): ToolOptionsUI {
    const { editor, options: o } = this;
    const preview = h('span', { class: 'gradient-preview', title: 'Náhled přechodu' });
    const updatePreview = () => {
      const stops = presetStops(o.preset, editor.settings.color, editor.settings.secondaryColor);
      const css = (c: RGBA) => `rgba(${c.r},${c.g},${c.b},${c.a / 255})`;
      const [a, b] = o.reverse ? [stops[1], stops[0]] : [stops[0], stops[1]];
      preview.style.background = `linear-gradient(to right, ${css(a.color)}, ${css(b.color)}), repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0 / 8px 8px`;
    };
    updatePreview();
    const unsubscribe = editor.on('settings', updatePreview);
    return {
      element: h(
        'div',
        { class: 'tool-options' },
        preview,
        selectField(null, GRADIENT_PRESETS, o.preset, (v) => {
          o.preset = v as GradientPreset;
          updatePreview();
        }),
        selectField(null, GRADIENT_TYPES, o.type, (v) => (o.type = v as GradientType)),
        blendModeSelect(o.blendMode, (v) => (o.blendMode = v)),
        opacitySlider(o.opacity, (v) => (o.opacity = v)),
        checkbox('Obrátit', o.reverse, (v) => {
          o.reverse = v;
          updatePreview();
        }),
        checkbox('Rozptýlení', o.dither, (v) => (o.dither = v)),
      ),
      dispose: unsubscribe,
    };
  }
}

/**
 * Přechod do masky: nová hodnota = stará · (1 − a) + jas · a, kde a = alfa přechodu × krytí
 * (hodnota masky je v alfa kanálu – viz core/mask.ts).
 */
function blendIntoMask(ctx: CanvasRenderingContext2D, piece: HTMLCanvasElement, x: number, y: number, opacity: number): void {
  const src = get2d(piece).getImageData(0, 0, piece.width, piece.height).data;
  const img = ctx.getImageData(x, y, piece.width, piece.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = (src[i + 3] / 255) * opacity;
    if (a <= 0) continue;
    const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = d[i + 3] * (1 - a) + lum * a;
  }
  ctx.putImageData(img, x, y);
}
