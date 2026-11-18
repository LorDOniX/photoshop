import { MacroCommand } from '../commands/layerCommands';
import { SetSelectionCommand } from '../commands/selectionCommands';
import { LayerStateCommand } from '../commands/stateCommands';
import type { Editor } from '../Editor';
import { captureLayer, type LayerState } from '../ImageDocument';
import type { Layer } from '../Layer';
import { extractPixels } from '../selection/raster';
import type { SelectionMask } from '../selection/SelectionMask';
import { clearSelected, composeOnto, type Piece } from './render';

/**
 * Plovoucí výběr: vybrané pixely aktivní vrstvy se „zvednou“ a posouvají (náhled naživo bez historie).
 * Po dokončení se zapíše jeden krok historie (pixely vrstvy + posunutý výběr).
 */
export class FloatingSelection {
  private dx = 0;
  private dy = 0;

  private constructor(
    private readonly editor: Editor,
    private readonly layer: Layer,
    private readonly base: LayerState,
    private readonly cleared: LayerState,
    private readonly piece: Piece,
    private readonly selection: SelectionMask,
    private readonly duplicate: boolean,
  ) {}

  /** Začne přesun vybraných pixelů; null = není co přesouvat (bez výběru, maska jako cíl…). */
  static start(editor: Editor, duplicate: boolean): FloatingSelection | null {
    const sel = editor.doc.selection;
    const target = editor.paintTarget();
    if (!sel || !target || target.kind !== 'pixels' || !target.layer.visible) return null;
    const layer = target.layer;
    const piece = extractPixels(layer, sel);
    if (!piece) return null;
    const base = captureLayer(layer);
    return new FloatingSelection(editor, layer, base, duplicate ? base : clearSelected(base, sel), piece, sel, duplicate);
  }

  get offset(): { dx: number; dy: number } {
    return { dx: this.dx, dy: this.dy };
  }

  moveTo(dx: number, dy: number): void {
    if (dx === this.dx && dy === this.dy) return;
    this.dx = dx;
    this.dy = dy;
    const { doc } = this.editor;
    doc.setLayerState(this.layer.id, composeOnto(this.cleared, { ...this.piece, x: this.piece.x + dx, y: this.piece.y + dy }));
    doc.setSelection(this.selection.translate(dx, dy));
  }

  commit(): void {
    const { doc, history } = this.editor;
    if (!this.dx && !this.dy) return this.cancel();
    const label = this.duplicate ? 'Duplikovat výběr' : 'Přesunout výběr';
    history.push(
      new MacroCommand(label, [
        new LayerStateCommand(doc, this.layer.id, this.base, captureLayer(this.layer), label),
        new SetSelectionCommand(doc, this.selection, doc.selection, label),
      ]),
    );
  }

  cancel(): void {
    const { doc } = this.editor;
    doc.setLayerState(this.layer.id, this.base);
    doc.setSelection(this.selection);
  }
}
