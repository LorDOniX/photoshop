import { Wand } from 'lucide';
import type { Editor } from '../../core/Editor';
import { floodSelect } from '../../core/selection/floodFill';
import { samplePixels } from '../../core/selection/raster';
import type { Tool, ToolOptionsUI, ToolPointer } from '../Tool';
import { selectionOptionsUI } from './selectionOptions';

/** Kouzelná hůlka – vybere oblast podobné barvy (tolerance, souvislé, ze všech vrstev). */
export class MagicWandTool implements Tool {
  readonly id = 'magic-wand';
  readonly name = 'Kouzelná hůlka';
  readonly icon = Wand;
  readonly shortcut = 'W';
  readonly cursor = 'crosshair';

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const { doc, selectionOptions: o } = this.editor;
    const mode = this.editor.selectionModeFor(p);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) {
      if (mode === 'replace') this.editor.deselect();
      return;
    }
    const img = samplePixels(doc, o.sampleAll);
    const shape = floodSelect(img.data, doc.width, doc.height, x, y, o.tolerance, o.contiguous);
    this.editor.applySelectionShape(shape, mode, this.name);
  }

  createOptions(): ToolOptionsUI {
    return selectionOptionsUI(this.editor, { wand: true });
  }
}
