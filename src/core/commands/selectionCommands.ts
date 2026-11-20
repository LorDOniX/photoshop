import type { Command } from '../History';
import type { ImageDocument } from '../ImageDocument';
import type { SelectionMask } from '../selection/SelectionMask';

/** Změna výběru. Masky jsou neměnné, stačí si pamatovat reference. */
export class SetSelectionCommand implements Command {
  constructor(
    private readonly doc: ImageDocument,
    private readonly before: SelectionMask | null,
    private readonly after: SelectionMask | null,
    readonly label: string,
  ) {}

  get bytes(): number {
    return (this.before?.data.length ?? 0) + (this.after?.data.length ?? 0);
  }

  do(): void {
    this.doc.setSelection(this.after);
  }

  undo(): void {
    this.doc.setSelection(this.before);
  }
}
