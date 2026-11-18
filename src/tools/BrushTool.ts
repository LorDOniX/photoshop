import { Brush, Eraser } from 'lucide';
import { PaintCommand, type PaintTargetKind } from '../core/commands/layerCommands';
import { clipRect, cloneCanvas, createCanvas, get2d, unionRect, type Rect } from '../core/canvas';
import type { Editor } from '../core/Editor';
import type { Layer } from '../core/Layer';
import { luminance, paintMaskValue } from '../core/mask';
import { maskToCanvas } from '../core/selection/raster';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';
import { h } from '../ui/dom';
import { selectField, SliderField } from '../ui/controls';
import type { IconNode } from '../ui/icons';
import { PAINT_BLEND_MODES, pressureToggles } from './optionParts';

interface Stroke {
  layer: Layer;
  /** Cíl kreslení – pixely vrstvy, nebo její maska. */
  target: PaintTargetKind;
  ctx: CanvasRenderingContext2D;
  /** Stav cíle před tahem – pro undo a pro opakované skládání při krytí < 100 %. */
  snapshot: HTMLCanvasElement;
  /** Samotný tah při 100 % krytí; na vrstvu se skládá s krytím štětce (tah se tak nepřekrývá sám se sebou). */
  stroke: HTMLCanvasElement;
  strokeCtx: CanvasRenderingContext2D;
  last: { x: number; y: number };
  bounds: Rect | null;
  opacity: number;
  size: number;
  /** Maska výběru (canvas v souřadnicích dokumentu) – tah se kreslí jen uvnitř. */
  selection: HTMLCanvasElement | null;
  /** Při kreslení do masky: cílová hodnota 0..1 (jas barvy). */
  maskValue: number;
}

export class BrushTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon: IconNode;
  readonly shortcut: string;
  readonly cursor = 'none';
  private current: Stroke | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly mode: 'brush' | 'eraser',
  ) {
    const eraser = mode === 'eraser';
    this.id = eraser ? 'eraser' : 'brush';
    this.name = eraser ? 'Guma' : 'Štětec';
    this.icon = eraser ? Eraser : Brush;
    this.shortcut = eraser ? 'E' : 'B';
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const target = this.editor.paintTarget();
    if (!target || !target.layer.visible) return;
    const { layer, canvas } = target;
    const { color, secondaryColor, brushSize, brushOpacity } = this.editor.settings;
    const isMask = target.kind === 'mask';
    const stroke = createCanvas(canvas.width, canvas.height);
    const strokeCtx = get2d(stroke);
    // V masce na barvě tahu nezáleží (hodnotu určuje jas), jen na jeho alfě.
    strokeCtx.strokeStyle = strokeCtx.fillStyle = isMask ? '#fff' : color;
    strokeCtx.lineWidth = brushSize;
    strokeCtx.lineCap = 'round';
    strokeCtx.lineJoin = 'round';
    const local = { x: p.x - layer.x, y: p.y - layer.y };
    this.current = {
      layer,
      target: target.kind,
      ctx: target.ctx,
      snapshot: cloneCanvas(canvas),
      stroke,
      strokeCtx,
      last: local,
      bounds: null,
      opacity: brushOpacity,
      size: brushSize,
      selection: this.editor.doc.selection ? maskToCanvas(this.editor.doc.selection) : null,
      // Guma v masce kreslí barvou pozadí (jako ve Photoshopu).
      maskValue: luminance(this.mode === 'eraser' ? secondaryColor : color),
    };
    this.segment(local, local);
  }

  pointerMove(p: ToolPointer): void {
    const s = this.current;
    if (!s) return;
    const local = { x: p.x - s.layer.x, y: p.y - s.layer.y };
    this.segment(s.last, local);
    s.last = local;
  }

  pointerUp(): void {
    const s = this.current;
    this.current = null;
    if (!s?.bounds) return;
    const { x, y, width, height } = s.bounds;
    const before = get2d(s.snapshot).getImageData(x, y, width, height);
    const after = s.ctx.getImageData(x, y, width, height);
    const label = `${this.mode === 'eraser' ? 'Guma' : 'Štětec'}${s.target === 'mask' ? ' (maska)' : ''}`;
    this.editor.history.push(new PaintCommand(this.editor.doc, s.layer.id, x, y, before, after, label, s.target));
  }

  deactivate(): void {
    this.pointerUp();
  }

  private segment(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const s = this.current;
    if (!s) return;
    const ctx = s.strokeCtx;
    if (a.x === b.x && a.y === b.y) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, s.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    const r = s.size / 2 + 2;
    const dirty = clipRect(
      {
        x: Math.min(a.x, b.x) - r,
        y: Math.min(a.y, b.y) - r,
        width: Math.abs(a.x - b.x) + r * 2,
        height: Math.abs(a.y - b.y) + r * 2,
      },
      s.snapshot.width,
      s.snapshot.height,
    );
    if (!dirty) return;
    s.bounds = unionRect(s.bounds, dirty);

    // Přeskládání jen dotčené oblasti: původní stav + tah s krytím štětce.
    const { x, y, width, height } = dirty;
    if (s.selection) {
      // Ořez tahu výběrem – jen v dotčené oblasti (clip), zbytek tahu je už oříznutý.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(s.selection, -s.layer.x, -s.layer.y);
      ctx.restore();
    }
    const lc = s.ctx;
    lc.save();
    lc.clearRect(x, y, width, height);
    lc.drawImage(s.snapshot, x, y, width, height, x, y, width, height);
    if (s.target === 'mask') {
      lc.beginPath();
      lc.rect(x, y, width, height);
      lc.clip();
      paintMaskValue(lc, s.stroke, 0, 0, s.maskValue, s.opacity);
    } else {
      lc.globalAlpha = s.opacity;
      lc.globalCompositeOperation = this.mode === 'eraser' ? 'destination-out' : 'source-over';
      lc.drawImage(s.stroke, x, y, width, height, x, y, width, height);
    }
    lc.restore();
    this.editor.doc.notifyPixels(s.layer.id);
  }
  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    if (!editor.pointer) return;
    const { x, y } = editor.viewport.toScreen(editor.pointer.x, editor.pointer.y);
    const r = Math.max(1, (editor.settings.brushSize / 2) * editor.viewport.zoom);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  createOptions(): ToolOptionsUI {
    const editor = this.editor;
    const size = new SliderField({
      label: 'Velikost:',
      value: editor.settings.brushSize,
      min: 1,
      max: 500,
      unit: ' px',
      onInput: (v) => editor.updateSettings({ brushSize: v }),
    });
    const opacity = new SliderField({
      label: 'Krytí:',
      value: Math.round(editor.settings.brushOpacity * 100),
      min: 1,
      max: 100,
      unit: '%',
      onInput: (v) => editor.updateSettings({ brushOpacity: v / 100 }),
    });
    const sync = () => {
      size.setValue(editor.settings.brushSize);
      opacity.setValue(Math.round(editor.settings.brushOpacity * 100));
    };
    const unsubscribe = editor.on('settings', sync);

    const element = h(
      'div',
      { class: 'tool-options' },
      size.element,
      this.mode === 'brush' ? selectField('Režim prolnutí:', PAINT_BLEND_MODES) : selectField('Režim:', ['Štětec', 'Tužka']),
      opacity.element,
      // Připravené volby (zatím bez funkce):
      new SliderField({ label: 'Tok:', value: 100, min: 1, max: 100, unit: '%' }).element,
      new SliderField({ label: 'Vyhlazení:', value: 0, min: 0, max: 100, unit: '%' }).element,
      ...pressureToggles(),
    );
    return { element, dispose: unsubscribe };
  }
}
