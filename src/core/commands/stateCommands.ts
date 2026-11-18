import type { Command } from '../History';
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

  do(): void {
    this.doc.applyState(this.after);
  }

  undo(): void {
    this.doc.applyState(this.before);
  }
}
