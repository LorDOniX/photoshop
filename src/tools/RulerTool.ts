import { Ruler } from 'lucide';
import type { Editor } from '../core/Editor';
import type { ImageDocument } from '../core/ImageDocument';
import { measure, straightenAngle, type RulerLine } from '../core/measure';
import { TransformSession } from '../core/transform/session';
import { textButton } from '../ui/controls';
import { h } from '../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/*
 * Pravítko (I): tažením se změří úsečka – v liště je počátek (X, Y), rozměry (Š, V), úhel (Ú, proti směru hodinových
 * ručiček od vodorovné, jako ve Photoshopu) a délka (D). Tažení konce úsečky ji upraví, Shift = úhel po 45°.
 * *Narovnat vrstvu* otočí aktivní vrstvu (s výběrem vybrané pixely) tak, aby úsečka byla vodorovná, nebo svislá,
 * pokud má blíž ke svislé – jeden krok historie. Úsečka patří dokumentu a do historie se nezapisuje.
 */

const HIT = 8;

export class RulerTool implements Tool {
  readonly id = 'ruler';
  readonly name = 'Pravítko';
  readonly icon = Ruler;
  readonly shortcut = 'I';
  readonly cursor = 'crosshair';
  private readonly lines = new WeakMap<ImageDocument, RulerLine>();
  /** Tažený konec úsečky. */
  private dragging: 'a' | 'b' | null = null;
  private fields: Record<'x' | 'y' | 'w' | 'h' | 'angle' | 'length', HTMLInputElement> | null = null;

  constructor(private readonly editor: Editor) {}

  get line(): RulerLine | null {
    return this.lines.get(this.editor.doc) ?? null;
  }

  private hit(p: ToolPointer): 'a' | 'b' | null {
    const l = this.line;
    if (!l) return null;
    for (const end of ['b', 'a'] as const) {
      const at = this.editor.viewport.toScreen(l[end].x, l[end].y);
      if (Math.hypot(at.x - p.screenX, at.y - p.screenY) <= HIT) return end;
    }
    return null;
  }

  cursorAt(p: ToolPointer): string | null {
    return this.hit(p) ? 'move' : null;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const end = this.hit(p);
    if (end) {
      this.dragging = end;
      return;
    }
    const at = this.editor.snap(p);
    const pt = { x: Math.round(at.x), y: Math.round(at.y) };
    this.lines.set(this.editor.doc, { a: pt, b: { ...pt } });
    this.dragging = 'b';
    this.changed();
  }

  pointerMove(p: ToolPointer): void {
    const l = this.line;
    if (!l || !this.dragging) return;
    const other = l[this.dragging === 'a' ? 'b' : 'a'];
    let x = p.x;
    let y = p.y;
    if (p.shiftKey) {
      // Úhel po 45°: průmět na nejbližší směr.
      const step = Math.PI / 4;
      const t = Math.round(Math.atan2(y - other.y, x - other.x) / step) * step;
      const len = Math.hypot(x - other.x, y - other.y);
      x = other.x + Math.cos(t) * len;
      y = other.y + Math.sin(t) * len;
    } else ({ x, y } = this.editor.snap(p));
    l[this.dragging] = { x: Math.round(x), y: Math.round(y) };
    this.changed();
  }

  pointerUp(): void {
    this.dragging = null;
  }

  deactivate(): void {
    this.dragging = null;
  }

  clear(): void {
    this.lines.delete(this.editor.doc);
    this.changed();
  }

  /** Narovnat vrstvu podle úsečky. */
  straighten(): void {
    const l = this.line;
    if (!l || (l.a.x === l.b.x && l.a.y === l.b.y)) {
      this.editor.notice('Nejdřív pravítkem natáhněte úsečku podél čáry, která má být vodorovná.');
      return;
    }
    const rot = straightenAngle(l);
    if (Math.abs(rot) < 1e-9) return this.clear();
    const session = TransformSession.start(this.editor);
    if (!session) {
      this.editor.notice('Aktivní vrstvu nejde otočit (skupina nebo zamčená vrstva).');
      return;
    }
    const t = session.initial;
    session.apply({ ...t, angle: t.angle + rot });
    session.commit('Narovnat vrstvu');
    this.clear();
  }

  private changed(): void {
    this.updateFields();
    this.editor.notifyView();
  }

  private updateFields(): void {
    const f = this.fields;
    if (!f) return;
    const l = this.line;
    const m = l ? measure(l) : null;
    const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('cs-CZ');
    f.x.value = l ? String(l.a.x) : '';
    f.y.value = l ? String(l.a.y) : '';
    f.w.value = m ? String(m.dx) : '';
    f.h.value = m ? String(m.dy) : '';
    f.angle.value = m ? `${fmt(m.angle)}°` : '';
    f.length.value = m ? fmt(m.length) : '';
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    const l = this.line;
    if (!l) return;
    const a = editor.viewport.toScreen(l.a.x, l.a.y);
    const b = editor.viewport.toScreen(l.b.x, l.b.y);
    ctx.save();
    for (const [color, width] of [
      ['rgba(0,0,0,0.85)', 3],
      ['rgba(255,255,255,0.95)', 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      for (const p of [a, b]) {
        ctx.moveTo(p.x - 5, p.y);
        ctx.lineTo(p.x + 5, p.y);
        ctx.moveTo(p.x, p.y - 5);
        ctx.lineTo(p.x, p.y + 5);
      }
      ctx.stroke();
    }
    const m = measure(l);
    if (m.length) {
      const label = `${(Math.round(m.length * 10) / 10).toLocaleString('cs-CZ')} px  ${(Math.round(m.angle * 10) / 10).toLocaleString('cs-CZ')}°`;
      ctx.font = '11px sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = '#fff';
      ctx.strokeText(label, b.x + 8, b.y - 6);
      ctx.fillText(label, b.x + 8, b.y - 6);
    }
    ctx.restore();
  }

  createOptions(): ToolOptionsUI {
    const field = (label: string, width: number) => {
      const input = h('input', { type: 'text', class: 'opt-input', readOnly: true, style: { width: `${width}px` } });
      return [input, h('label', { class: 'opt-field' }, label, input)] as const;
    };
    const [x, xl] = field('X:', 44);
    const [y, yl] = field('Y:', 44);
    const [w, wl] = field('Š:', 44);
    const [hh, hl] = field('V:', 44);
    const [angle, al] = field('Ú:', 52);
    const [length, ll] = field('D:', 56);
    this.fields = { x, y, w, h: hh, angle, length };
    this.updateFields();
    const unsubscribe = this.editor.on('document', () => this.updateFields());
    return {
      element: h('div', { class: 'tool-options' }, xl, yl, wl, hl, al, ll, textButton('Narovnat vrstvu', () => this.straighten()), textButton('Vymazat', () => this.clear())),
      dispose: () => {
        unsubscribe();
        this.fields = null;
      },
    };
  }
}
