import type { Command } from '../History';
import type { ImageDocument } from '../ImageDocument';
import type { Bounds, SelectionMask } from '../selection/SelectionMask';

/** Změna výběru. Masky jsou neměnné, stačí si pamatovat reference. */
export class SetSelectionCommand implements Command {
  constructor(
    private readonly doc: ImageDocument,
    private readonly before: SelectionMask | null,
    private readonly after: SelectionMask | null,
    readonly label: string,
  ) {}

  do(): void {
    this.doc.setSelection(this.after);
  }

  undo(): void {
    this.doc.setSelection(this.before);
  }
}

/** Oříznutí plátna na obdélník – vrstvy se jen posunou, jejich pixely zůstávají (jde to vrátit). */
export class CropCommand implements Command {
  private before: { width: number; height: number; selection: SelectionMask | null } | null = null;

  constructor(
    private readonly doc: ImageDocument,
    private readonly rect: Bounds,
    readonly label = 'Oříznout',
  ) {}

  do(): void {
    const { doc, rect } = this;
    this.before = { width: doc.width, height: doc.height, selection: doc.selection };
    doc.setSelection(null);
    for (const layer of doc.layers) doc.updateLayer(layer.id, { x: layer.x - rect.x, y: layer.y - rect.y });
    doc.resize(rect.width, rect.height);
  }

  undo(): void {
    const { doc, rect, before } = this;
    if (!before) return;
    doc.resize(before.width, before.height);
    for (const layer of doc.layers) doc.updateLayer(layer.id, { x: layer.x + rect.x, y: layer.y + rect.y });
    doc.setSelection(before.selection);
  }
}
