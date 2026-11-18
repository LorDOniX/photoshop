import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Download,
  Ellipsis,
  LayoutGrid,
  Move,
} from 'lucide';
import type { Editor } from '../core/Editor';
import { checkbox, iconButton, selectField, separator } from '../ui/controls';
import { h } from '../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

export class MoveTool implements Tool {
  readonly id = 'move';
  readonly name = 'Přesun';
  readonly icon = Move;
  readonly shortcut = 'V';
  readonly cursor = 'move';
  private drag: { layerId: string; startX: number; startY: number; origX: number; origY: number } | null = null;

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    const layer = this.editor.doc.activeLayer;
    if (p.button !== 0 || !layer) return;
    this.drag = { layerId: layer.id, startX: p.x, startY: p.y, origX: layer.x, origY: layer.y };
  }

  pointerMove(p: ToolPointer): void {
    const d = this.drag;
    if (!d) return;
    let dx = Math.round(p.x - d.startX);
    let dy = Math.round(p.y - d.startY);
    if (p.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    this.editor.doc.updateLayer(d.layerId, { x: d.origX + dx, y: d.origY + dy });
  }

  pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    const layer = d && this.editor.doc.getLayer(d.layerId);
    if (!d || !layer || (layer.x === d.origX && layer.y === d.origY)) return;
    this.editor.commitLayerProps(d.layerId, { x: d.origX, y: d.origY }, { x: layer.x, y: layer.y }, 'Přesun vrstvy');
  }

  /** Volby jsou zatím jen připravené (bez funkce). */
  createOptions(): ToolOptionsUI {
    const element = h(
      'div',
      { class: 'tool-options' },
      checkbox('Automatický výběr', true),
      selectField(null, ['Složka', 'Vrstva'], 'Vrstva'),
      checkbox('Transformační úchyty'),
      checkbox('Vzdálenosti'),
      iconButton(Download, 'Uložit vybrané vrstvy'),
      separator(),
      iconButton(AlignStartVertical, 'Zarovnat levé okraje'),
      iconButton(AlignCenterVertical, 'Zarovnat na střed vodorovně'),
      iconButton(AlignEndVertical, 'Zarovnat pravé okraje'),
      iconButton(AlignHorizontalSpaceAround, 'Stejné mezery'),
      separator(),
      iconButton(AlignStartHorizontal, 'Zarovnat horní okraje'),
      iconButton(AlignCenterHorizontal, 'Zarovnat na střed svisle'),
      iconButton(AlignEndHorizontal, 'Zarovnat dolní okraje'),
      iconButton(AlignVerticalSpaceAround, 'Stejné mezery'),
      iconButton(Ellipsis, 'Další možnosti zarovnání'),
      iconButton(LayoutGrid, 'Zarovnat do mřížky'),
    );
    return { element };
  }
}
