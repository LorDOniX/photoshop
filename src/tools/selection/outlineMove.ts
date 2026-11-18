import { SetSelectionCommand } from '../../core/commands/selectionCommands';
import type { Editor } from '../../core/Editor';
import type { SelectionMask } from '../../core/selection/SelectionMask';
import type { ToolPointer } from '../Tool';
import { arrowOffset } from '../MoveTool';

/** Tah nástrojem výběru uvnitř výběru (bez modifikátorů) posouvá jen obrys výběru. */
export function startsOutlineMove(editor: Editor, p: ToolPointer): boolean {
  const sel = editor.doc.selection;
  return !!sel && !p.shiftKey && !p.altKey && editor.selectionOptions.mode === 'replace' && sel.get(Math.floor(p.x), Math.floor(p.y)) >= 128;
}

export class OutlineDrag {
  private readonly base: SelectionMask;
  private dx = 0;
  private dy = 0;

  constructor(
    private readonly editor: Editor,
    private readonly sx: number,
    private readonly sy: number,
  ) {
    this.base = editor.doc.selection!;
  }

  move(p: ToolPointer): void {
    const dx = Math.round(p.x - this.sx);
    const dy = Math.round(p.y - this.sy);
    if (dx === this.dx && dy === this.dy) return;
    this.dx = dx;
    this.dy = dy;
    this.editor.doc.setSelection(this.base.translate(dx, dy));
  }

  /** Vrací false, pokud se obrys nepohnul (= obyčejný klik). */
  end(): boolean {
    const { doc, history } = this.editor;
    if (!this.dx && !this.dy) return false;
    history.push(new SetSelectionCommand(doc, this.base, doc.selection, 'Přesunout výběr'));
    return true;
  }
}

/** Šipky s aktivním nástrojem výběru posouvají obrys výběru. */
export function nudgeSelection(editor: Editor, e: KeyboardEvent): boolean {
  const off = arrowOffset(e);
  const sel = editor.doc.selection;
  if (!off || !sel) return false;
  editor.setSelection(sel.translate(off.dx, off.dy), 'Přesunout výběr');
  return true;
}
