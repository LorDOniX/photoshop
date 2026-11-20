import { canvasBytes, type Command } from '../History';
import type { DocState, ImageDocument, LayerState } from '../ImageDocument';

/**
 * Výměna plátna/masky/pozice jedné vrstvy (přesun vybraných pixelů, transformace).
 * Operace vytvářejí nová plátna, takže stačí držet reference na stav před a po.
 */
export class LayerStateCommand implements Command {
  constructor(
    private readonly doc: ImageDocument,
    private readonly layerId: string,
    private readonly before: LayerState,
    private readonly after: LayerState,
    readonly label: string,
  ) {}

  get bytes(): number {
    return stateBytes(this.before, this.after);
  }

  do(): void {
    this.doc.setLayerState(this.layerId, this.after);
  }

  undo(): void {
    this.doc.setLayerState(this.layerId, this.before);
  }
}

/** Změna celého dokumentu (velikost obrazu / plátna, otočení, oříznutí…). */
export class DocStateCommand implements Command {
  constructor(
    private readonly doc: ImageDocument,
    private readonly before: DocState,
    private readonly after: DocState,
    readonly label: string,
  ) {}

  get bytes(): number {
    let sum = 0;
    for (const [id, b] of this.before.layers) {
      const a = this.after.layers.get(id);
      sum += a ? stateBytes(b, a) : canvasBytes(b.canvas) + canvasBytes(b.mask);
    }
    if (this.before.selection !== this.after.selection) sum += this.before.selection?.data.length ?? 0;
    return sum;
  }

  do(): void {
    this.doc.applyState(this.after);
  }

  undo(): void {
    this.doc.applyState(this.before);
  }
}

/** Paměť plátna a masky, které drží jen jeden ze stavů (nová plátna po transformaci apod.). */
function stateBytes(before: LayerState, after: LayerState): number {
  return (before.canvas !== after.canvas ? canvasBytes(before.canvas) : 0) + (before.mask !== after.mask ? canvasBytes(before.mask) : 0);
}
