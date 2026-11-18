import { Hand, ZoomIn, ZoomOut } from 'lucide';
import type { Editor } from '../core/Editor';
import { checkbox, segmented, textButton } from '../ui/controls';
import { h } from '../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

function viewOptions(editor: Editor, extra: Node[] = []): ToolOptionsUI {
  return {
    element: h(
      'div',
      { class: 'tool-options' },
      ...extra,
      textButton('Pixel na pixel', () => editor.actions.run('view.actual')),
      textButton('Přizpůsobit oknu', () => editor.actions.run('view.fit')),
      checkbox('Všechny dokumenty'),
    ),
  };
}

export class HandTool implements Tool {
  readonly id = 'hand';
  readonly name = 'Ruka';
  readonly icon = Hand;
  readonly shortcut = 'H';
  readonly cursor = 'grab';
  private last: { x: number; y: number } | null = null;

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    this.last = { x: p.screenX, y: p.screenY };
  }

  pointerMove(p: ToolPointer): void {
    if (!this.last) return;
    this.editor.viewport.panBy(p.screenX - this.last.x, p.screenY - this.last.y);
    this.last = { x: p.screenX, y: p.screenY };
    this.editor.notifyView();
  }

  pointerUp(): void {
    this.last = null;
  }

  createOptions(): ToolOptionsUI {
    return viewOptions(this.editor);
  }
}

export class ZoomTool implements Tool {
  readonly id = 'zoom';
  readonly name = 'Lupa';
  readonly icon = ZoomIn;
  readonly shortcut = 'Z';
  readonly cursor = 'zoom-in';

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    this.editor.viewport.stepZoom(p.altKey || p.button === 2 ? -1 : 1, p.screenX, p.screenY);
    this.editor.notifyView();
  }

  createOptions(): ToolOptionsUI {
    return viewOptions(this.editor, [
      segmented([
        { icon: ZoomIn, title: 'Přiblížit' },
        { icon: ZoomOut, title: 'Oddálit (Alt)' },
      ]),
    ]);
  }
}
