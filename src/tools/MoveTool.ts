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
import { unionRect, type Rect } from '../core/canvas';
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
  /** Tažené vrstvy (u skupiny všechny její vrstvy) s původní polohou. */
  private drag: { items: Array<{ id: string; x: number; y: number }>; startX: number; startY: number; bounds: Rect | null } | null = null;
  private floating: { session: FloatingSelection; startX: number; startY: number; bounds: Rect | null; exclude: string[] } | null = null;
  private frame = 0;
  private pending: { dx: number; dy: number } | null = null;

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    const layer = this.editor.doc.activeLayer;
    if (p.button !== 0 || !layer) return;
    const session = FloatingSelection.start(this.editor, p.altKey);
    if (session) {
      this.floating = { session, startX: p.x, startY: p.y, bounds: this.editor.doc.selection?.bounds() ?? null, exclude: [layer.id] };
      return;
    }
    const layers = this.editor.movableSelection();
    const items = layers.map((l) => ({ id: l.id, x: l.x, y: l.y }));
    // Obdélník obsahu posouvaných vrstev – jeho okraje a střed se přichytávají.
    let bounds: Rect | null = null;
    for (const l of layers) {
      const b = l.isGroup ? null : this.editor.contentBounds(l);
      if (b) bounds = unionRect(bounds, b);
    }
    if (items.length) this.drag = { items, startX: p.x, startY: p.y, bounds };
  }

  /** Posun od začátku tažení (Shift = jen vodorovně / svisle); obdélník `bounds` se přichytí k vodítkům apod. */
  private offset(p: ToolPointer, sx: number, sy: number, bounds: Rect | null = null, exclude: readonly string[] = []): { dx: number; dy: number } {
    let dx = Math.round(p.x - sx);
    let dy = Math.round(p.y - sy);
    if (p.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (bounds) {
      const c = this.editor.snapRect({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, exclude);
      if (!p.shiftKey || dx) dx = Math.round(dx + c.dx);
      if (!p.shiftKey || dy) dy = Math.round(dy + c.dy);
    }
    return { dx, dy };
  }

  pointerMove(p: ToolPointer): void {
    const f = this.floating;
    if (f) {
      // Přeskládání vrstvy je dražší – slučujeme do jednoho snímku.
      this.pending = this.offset(p, f.startX, f.startY, f.bounds, f.exclude);
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
    const { dx, dy } = this.offset(p, d.startX, d.startY, d.bounds, d.items.map((i) => i.id));
    for (const it of d.items) this.editor.doc.updateLayer(it.id, { x: it.x + dx, y: it.y + dy });
  }

  pointerUp(p: ToolPointer): void {
    const f = this.floating;
    if (f) {
      this.floating = null;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      const { dx, dy } = this.offset(p, f.startX, f.startY, f.bounds, f.exclude);
      f.session.moveTo(dx, dy);
      f.session.commit();
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (d) this.editor.commitLayerMoves(d.items, 'Přesun vrstvy');
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
    if (layer) this.editor.offsetLayers(this.editor.movableSelection(), off.dx, off.dy, 'Přesun vrstvy');
    return true;
  }

  deactivate(): void {
    if (this.floating) {
      this.floating.session.commit();
      this.floating = null;
    }
  }

  /** Zarovnání a rozmístění vrstev; ostatní volby jsou zatím jen připravené. */
  createOptions(): ToolOptionsUI {
    const run = (id: string) => () => this.editor.actions.run(id);
    const element = h(
      'div',
      { class: 'tool-options' },
      checkbox('Automatický výběr', true),
      selectField(null, ['Složka', 'Vrstva'], 'Vrstva'),
      checkbox('Transformační úchyty'),
      checkbox('Vzdálenosti'),
      iconButton(Download, 'Uložit vybrané vrstvy'),
      separator(),
      iconButton(AlignStartVertical, 'Zarovnat levé okraje', run('layer.alignLeft')),
      iconButton(AlignCenterVertical, 'Zarovnat na střed vodorovně', run('layer.alignHCenter')),
      iconButton(AlignEndVertical, 'Zarovnat pravé okraje', run('layer.alignRight')),
      iconButton(AlignHorizontalSpaceAround, 'Stejné vodorovné mezery (3 a více vrstev)', run('layer.distributeH')),
      separator(),
      iconButton(AlignStartHorizontal, 'Zarovnat horní okraje', run('layer.alignTop')),
      iconButton(AlignCenterHorizontal, 'Zarovnat na střed svisle', run('layer.alignVCenter')),
      iconButton(AlignEndHorizontal, 'Zarovnat dolní okraje', run('layer.alignBottom')),
      iconButton(AlignVerticalSpaceAround, 'Stejné svislé mezery (3 a více vrstev)', run('layer.distributeV')),
      iconButton(Ellipsis, 'Další možnosti zarovnání'),
      iconButton(LayoutGrid, 'Zarovnat do mřížky'),
    );
    return { element };
  }
}
