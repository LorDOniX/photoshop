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
import { FloatingSelection } from '../core/transform/floating';
import { checkbox, iconButton, selectField, separator } from '../ui/controls';
import { h } from '../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/** Šipky: posun o 1 px, se Shift o 10 px. */
export function arrowOffset(e: KeyboardEvent): { dx: number; dy: number } | null {
  const step = e.shiftKey ? 10 : 1;
  const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const v = map[e.key];
  return v && !e.ctrlKey && !e.metaKey ? { dx: v[0], dy: v[1] } : null;
}

/**
 * Přesun: bez výběru posouvá celou vrstvu, s výběrem jen vybrané pixely (Alt = duplikovat).
 * Šipky posouvají o 1 px (Shift = 10 px).
 */
export class MoveTool implements Tool {
  readonly id = 'move';
  readonly name = 'Přesun';
  readonly icon = Move;
  readonly shortcut = 'V';
  readonly cursor = 'move';
  private drag: { layerId: string; startX: number; startY: number; origX: number; origY: number } | null = null;
  private floating: { session: FloatingSelection; startX: number; startY: number } | null = null;
  private frame = 0;
  private pending: { dx: number; dy: number } | null = null;

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    const layer = this.editor.doc.activeLayer;
    if (p.button !== 0 || !layer) return;
    const session = FloatingSelection.start(this.editor, p.altKey);
    if (session) {
      this.floating = { session, startX: p.x, startY: p.y };
      return;
    }
    this.drag = { layerId: layer.id, startX: p.x, startY: p.y, origX: layer.x, origY: layer.y };
  }

  private offset(p: ToolPointer, sx: number, sy: number): { dx: number; dy: number } {
    let dx = Math.round(p.x - sx);
    let dy = Math.round(p.y - sy);
    if (p.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    return { dx, dy };
  }

  pointerMove(p: ToolPointer): void {
    const f = this.floating;
    if (f) {
      // Přeskládání vrstvy je dražší – slučujeme do jednoho snímku.
      this.pending = this.offset(p, f.startX, f.startY);
      if (!this.frame) {
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          if (this.pending && this.floating) this.floating.session.moveTo(this.pending.dx, this.pending.dy);
        });
      }
      return;
    }
    const d = this.drag;
    if (!d) return;
    const { dx, dy } = this.offset(p, d.startX, d.startY);
    this.editor.doc.updateLayer(d.layerId, { x: d.origX + dx, y: d.origY + dy });
  }

  pointerUp(p: ToolPointer): void {
    const f = this.floating;
    if (f) {
      this.floating = null;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      const { dx, dy } = this.offset(p, f.startX, f.startY);
      f.session.moveTo(dx, dy);
      f.session.commit();
      return;
    }
    const d = this.drag;
    this.drag = null;
    const layer = d && this.editor.doc.getLayer(d.layerId);
    if (!d || !layer || (layer.x === d.origX && layer.y === d.origY)) return;
    this.editor.commitLayerProps(d.layerId, { x: d.origX, y: d.origY }, { x: layer.x, y: layer.y }, 'Přesun vrstvy');
  }

  keyDown(e: KeyboardEvent): boolean {
    const off = arrowOffset(e);
    if (!off || this.drag || this.floating) return false;
    const session = FloatingSelection.start(this.editor, e.altKey);
    if (session) {
      session.moveTo(off.dx, off.dy);
      session.commit();
      return true;
    }
    const layer = this.editor.doc.activeLayer;
    if (layer) this.editor.setLayerProps(layer.id, { x: layer.x + off.dx, y: layer.y + off.dy }, 'Přesun vrstvy');
    return true;
  }

  deactivate(): void {
    if (this.floating) {
      this.floating.session.commit();
      this.floating = null;
    }
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
