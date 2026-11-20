import { MacroCommand } from '../commands/layerCommands';
import { SetSelectionCommand } from '../commands/selectionCommands';
import { LayerStateCommand } from '../commands/stateCommands';
import { createCanvas, get2d } from '../canvas';
import type { Editor } from '../Editor';
import { captureLayer, type LayerState } from '../ImageDocument';
import type { Layer } from '../Layer';
import { extractPixels, maskToCanvas, rasterizeMask } from '../selection/raster';
import type { SelectionMask } from '../selection/SelectionMask';
import { identityTransform, type Transform } from './geometry';
import { clearSelected, composeOnto, renderTransformed, transformLayerState, type Piece } from './render';

/** Co se transformuje: celá vrstva, vybrané pixely vrstvy, nebo jen obrys výběru. */
export type TransformMode = 'layer' | 'pixels' | 'selection';

/**
 * Relace transformace: drží výchozí stav, umí průběžně aplikovat transformaci (náhled bez historie),
 * potvrdit (jeden krok historie) nebo zrušit (návrat do výchozího stavu).
 */
export class TransformSession {
  readonly initial: Transform;
  private current: Transform;

  private constructor(
    private readonly editor: Editor,
    readonly mode: TransformMode,
    private readonly layer: Layer | null,
    private readonly base: LayerState | null,
    private readonly cleared: LayerState | null,
    private readonly source: Piece,
    private readonly selection: SelectionMask | null,
  ) {
    this.initial = identityTransform(source.x, source.y, source.canvas.width, source.canvas.height);
    this.current = this.initial;
  }

  /**
   * Začne transformaci. `selectionOnly` = Výběr → Transformovat výběr; jinak se s výběrem transformují
   * vybrané pixely, bez výběru celá aktivní vrstva.
   */
  static start(editor: Editor, selectionOnly = false): TransformSession | null {
    const { doc } = editor;
    const sel = doc.selection;
    if (selectionOnly) {
      const b = sel?.bounds();
      if (!sel || !b) return null;
      const canvas = createCanvas(b.width, b.height);
      get2d(canvas).drawImage(maskToCanvas(sel), -b.x, -b.y);
      return new TransformSession(editor, 'selection', null, null, null, { canvas, x: b.x, y: b.y }, sel);
    }
    const layer = doc.activeLayer;
    if (!layer || layer.isGroup || editor.isLocked(layer, 'lockPixels') || editor.isLocked(layer, 'lockPosition')) return null;
    const base = captureLayer(layer);
    if (sel) {
      const piece = extractPixels(layer, sel);
      if (!piece) return null;
      return new TransformSession(editor, 'pixels', layer, base, clearSelected(base, sel), piece, sel);
    }
    return new TransformSession(editor, 'layer', layer, base, null, { canvas: layer.canvas, x: layer.x, y: layer.y }, null);
  }

  get transform(): Transform {
    return this.current;
  }

  /** Původní velikost zdroje (pro výpočet procent). */
  get sourceSize(): { width: number; height: number } {
    return { width: this.source.canvas.width, height: this.source.canvas.height };
  }

  /** Náhled transformace (bez zápisu do historie). */
  apply(t: Transform): void {
    this.current = t;
    const { doc } = this.editor;
    if (this.mode === 'selection') {
      doc.setSelection(this.transformedSelection(t));
      return;
    }
    if (this.mode === 'layer') {
      doc.setLayerState(this.layer!.id, transformLayerState(this.base!, t));
      return;
    }
    doc.setLayerState(this.layer!.id, composeOnto(this.cleared!, renderTransformed(this.source.canvas, t)));
    doc.setSelection(this.transformedSelection(t));
  }

  private transformedSelection(t: Transform): SelectionMask | null {
    if (!this.selection) return null;
    const sel = this.selection;
    const b = sel.bounds();
    if (!b) return null;
    const crop = createCanvas(b.width, b.height);
    get2d(crop).drawImage(maskToCanvas(sel), -b.x, -b.y);
    const piece = renderTransformed(crop, t);
    const mask = rasterizeMask(sel.width, sel.height, (ctx) => ctx.drawImage(piece.canvas, piece.x, piece.y));
    return mask.isEmpty() ? null : mask;
  }

  commit(label: string): void {
    const { doc, history } = this.editor;
    const t = this.current;
    const i = this.initial;
    const unchanged = t.cx === i.cx && t.cy === i.cy && t.w === i.w && t.h === i.h && t.angle === i.angle && t.flipX === i.flipX && t.flipY === i.flipY;
    if (unchanged) return this.cancel();
    if (this.mode === 'selection') {
      history.push(new SetSelectionCommand(doc, this.selection, doc.selection, label));
      return;
    }
    const layerCmd = new LayerStateCommand(doc, this.layer!.id, this.base!, captureLayer(this.layer!), label);
    if (this.mode === 'layer') history.push(layerCmd);
    else history.push(new MacroCommand(label, [layerCmd, new SetSelectionCommand(doc, this.selection, doc.selection, label)]));
  }

  cancel(): void {
    const { doc } = this.editor;
    if (this.layer && this.base) doc.setLayerState(this.layer.id, this.base);
    if (this.mode !== 'layer') doc.setSelection(this.selection);
  }
}
