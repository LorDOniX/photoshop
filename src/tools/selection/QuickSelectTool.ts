import { WandSparkles, Square, SquaresSubtract, SquaresUnite } from 'lucide';
import { SetSelectionCommand } from '../../core/commands/selectionCommands';
import type { Editor } from '../../core/Editor';
import { floodSelect } from '../../core/selection/floodFill';
import { samplePixels } from '../../core/selection/raster';
import { SelectionMask, type SelectionMode } from '../../core/selection/SelectionMask';
import { checkbox, segmented, separator, SliderField } from '../../ui/controls';
import { h } from '../../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from '../Tool';
import { nudgeSelection } from './outlineMove';

/**
 * Rychlý výběr: tahem „malujete“ výběr – každý bod tahu přidá souvislou oblast podobné barvy
 * v okolí štětce (kruh o poloměru 3× velikosti štětce). Po prvním tahu přidává, Alt odebírá.
 */
export class QuickSelectTool implements Tool {
  readonly id = 'quick-select';
  readonly name = 'Rychlý výběr';
  readonly icon = WandSparkles;
  readonly shortcut = 'W';
  readonly cursor = 'crosshair';
  private stroke: {
    before: SelectionMask | null;
    mode: SelectionMode;
    last: { x: number; y: number } | null;
    /** Sjednocení oblastí z tohoto tahu. */
    acc: SelectionMask;
  } | null = null;

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const { doc } = this.editor;
    const sel = doc.selection;
    let mode = this.editor.selectionModeFor(p);
    // Jako ve Photoshopu: pokud už výběr existuje, další tahy přidávají.
    if (mode === 'replace' && sel) mode = 'add';
    this.stroke = { before: sel, mode, last: null, acc: new SelectionMask(doc.width, doc.height) };
    this.sample(p.x, p.y);
    this.preview();
  }

  pointerMove(p: ToolPointer): void {
    const s = this.stroke;
    if (!s?.last) return;
    const step = Math.max(2, this.editor.settings.brushSize / 3);
    const dist = Math.hypot(p.x - s.last.x, p.y - s.last.y);
    if (dist < step) return;
    const from = s.last;
    for (let d = step; d <= dist; d += step) {
      const k = d / dist;
      this.sample(from.x + (p.x - from.x) * k, from.y + (p.y - from.y) * k);
    }
    this.preview();
  }

  pointerUp(): void {
    const s = this.stroke;
    this.stroke = null;
    const { doc, history } = this.editor;
    if (s && s.before !== doc.selection) history.push(new SetSelectionCommand(doc, s.before, doc.selection, this.name));
  }

  deactivate(): void {
    this.pointerUp();
  }

  keyDown(e: KeyboardEvent): boolean {
    return !this.stroke && nudgeSelection(this.editor, e);
  }

  private sample(x: number, y: number): void {
    const s = this.stroke;
    if (!s) return;
    s.last = { x, y };
    const { doc, selectionOptions: o, settings } = this.editor;
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return;
    const img = samplePixels(doc, o.sampleAll);
    const shape = floodSelect(img.data, doc.width, doc.height, px, py, o.tolerance, true, settings.brushSize * 1.5);
    const b = shape.bounds();
    if (!b) return;
    const { data } = s.acc;
    for (let yy = b.y; yy < b.y + b.height; yy++) {
      for (let i = yy * doc.width + b.x, end = i + b.width; i < end; i++) if (shape.data[i]) data[i] = 255;
    }
  }

  /** Živý náhled bez historie – krok se zapíše až po dokončení tahu. */
  private preview(): void {
    const s = this.stroke;
    if (!s) return;
    const acc = new SelectionMask(s.acc.width, s.acc.height, new Uint8ClampedArray(s.acc.data));
    const base = s.before;
    if (!base) return this.editor.doc.setSelection(s.mode === 'subtract' ? null : acc);
    this.editor.doc.setSelection(s.mode === 'replace' ? acc : base.combine(acc, s.mode === 'subtract' ? 'subtract' : 'add'));
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    if (!editor.pointer) return;
    const { x, y } = editor.viewport.toScreen(editor.pointer.x, editor.pointer.y);
    const r = Math.max(2, (editor.settings.brushSize / 2) * editor.viewport.zoom);
    ctx.save();
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
    const { editor } = this;
    const modes: SelectionMode[] = ['replace', 'add', 'subtract'];
    const size = new SliderField({
      label: 'Velikost:',
      value: editor.settings.brushSize,
      min: 1,
      max: 500,
      unit: ' px',
      onInput: (v) => editor.updateSettings({ brushSize: v }),
    });
    const unsubscribe = editor.on('settings', () => size.setValue(editor.settings.brushSize));
    const element = h(
      'div',
      { class: 'tool-options' },
      segmented(
        [
          { icon: Square, title: 'Nový výběr' },
          { icon: SquaresUnite, title: 'Přidat k výběru (Shift)' },
          { icon: SquaresSubtract, title: 'Odečíst od výběru (Alt)' },
        ],
        Math.max(0, modes.indexOf(editor.selectionOptions.mode)),
        (i) => editor.updateSelectionOptions({ mode: modes[i] }),
      ),
      separator(),
      size.element,
      new SliderField({
        label: 'Tolerance:',
        value: editor.selectionOptions.tolerance,
        min: 0,
        max: 255,
        onCommit: (v) => editor.updateSelectionOptions({ tolerance: v }),
      }).element,
      checkbox('Ze všech vrstev', editor.selectionOptions.sampleAll, (v) => editor.updateSelectionOptions({ sampleAll: v })),
    );
    return { element, dispose: unsubscribe };
  }
}
