import { Check, Scaling, X } from 'lucide';
import type { Editor } from '../core/Editor';
import { dragHandle, dragRotate, type Point, type Transform } from '../core/transform/geometry';
import { TransformSession } from '../core/transform/session';
import { iconButton, separator } from '../ui/controls';
import { h } from '../ui/dom';
import { cursorForHit, drawBox, hitTestBox, type BoxHit } from './boxHandles';
import { arrowOffset } from './MoveTool';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/**
 * Volná transformace (Ctrl+Alt+T) a Transformovat výběr. Nástroj není v liště – spouští se akcí,
 * po potvrzení (Enter / ✓) nebo zrušení (Esc / ✗) se vrátí předchozí nástroj.
 * Táhnutí: uvnitř = posun, úchyty = změna velikosti (Shift = poměr, Alt = od středu), mimo = otočení (Shift = po 15°).
 */
export class TransformTool implements Tool {
  readonly id = 'transform';
  readonly name = 'Volná transformace';
  readonly icon = Scaling;
  readonly cursor = 'default';
  private session: TransformSession | null = null;
  private label = '';
  private previousTool = 'move';
  private drag: { hit: BoxHit; start: Transform; from: Point } | null = null;
  private frame = 0;
  private pending: Transform | null = null;
  private fields: Record<'x' | 'y' | 'w' | 'h' | 'angle', HTMLInputElement> | null = null;

  constructor(private readonly editor: Editor) {}

  /** Spustí transformaci; false = není co transformovat. */
  begin(selectionOnly: boolean): boolean {
    if (this.session) return true;
    const session = TransformSession.start(this.editor, selectionOnly);
    if (!session) return false;
    this.session = session;
    this.label = selectionOnly ? 'Transformovat výběr' : 'Volná transformace';
    const current = this.editor.activeTool?.id;
    if (current && current !== this.id) this.previousTool = current;
    this.editor.setTool(this.id);
    return true;
  }

  finish(commit: boolean): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.drag = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.pending) s.apply(this.pending);
    this.pending = null;
    if (commit) s.commit(this.label);
    else s.cancel();
    this.editor.setTool(this.previousTool);
    this.editor.notifyView();
  }

  deactivate(): void {
    // Přepnutí na jiný nástroj transformaci potvrdí (jako Photopea).
    if (this.session) this.finish(true);
  }

  private update(t: Transform): void {
    this.pending = t;
    this.syncFields(t);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.pending && this.session) this.session.apply(this.pending);
      this.pending = null;
    });
  }

  private get transform(): Transform | null {
    return this.pending ?? this.session?.transform ?? null;
  }

  pointerDown(p: ToolPointer): void {
    const t = this.transform;
    if (p.button !== 0 || !t) return;
    this.drag = { hit: hitTestBox(this.editor, t, p, { rotate: true, edges: true }), start: t, from: { x: p.x, y: p.y } };
  }

  pointerMove(p: ToolPointer): void {
    const d = this.drag;
    if (!d) return;
    let t: Transform;
    if (d.hit.kind === 'handle') t = dragHandle(d.start, d.hit.handle, p, p.shiftKey, p.altKey);
    else if (d.hit.kind === 'rotate') t = dragRotate(d.start, d.from, p, p.shiftKey);
    else t = { ...d.start, cx: d.start.cx + (p.x - d.from.x), cy: d.start.cy + (p.y - d.from.y) };
    this.update(t);
  }

  pointerUp(): void {
    this.drag = null;
  }

  cursorAt(p: ToolPointer): string | null {
    const t = this.transform;
    return t ? cursorForHit(hitTestBox(this.editor, t, p, { rotate: true, edges: true }), t) : null;
  }

  keyDown(e: KeyboardEvent): boolean {
    if (!this.session) return false;
    if (e.key === 'Enter') this.finish(true);
    else if (e.key === 'Escape') this.finish(false);
    else {
      const off = arrowOffset(e);
      const t = this.transform;
      if (!off || !t) return false;
      this.update({ ...t, cx: t.cx + off.dx, cy: t.cy + off.dy });
    }
    return true;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    const t = this.transform;
    if (!t) return;
    drawBox(ctx, editor, t, { edges: true });
    const c = editor.viewport.toScreen(t.cx, t.cy);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private syncFields(t: Transform): void {
    const f = this.fields;
    const s = this.session?.sourceSize;
    if (!f || !s) return;
    const set = (input: HTMLInputElement, v: number) => {
      if (document.activeElement !== input) input.value = String(Math.round(v * 10) / 10);
    };
    set(f.x, t.cx);
    set(f.y, t.cy);
    set(f.w, (t.w / s.width) * 100);
    set(f.h, (t.h / s.height) * 100);
    set(f.angle, (t.angle * 180) / Math.PI);
  }

  createOptions(): ToolOptionsUI {
    const field = (label: string, unit: string, apply: (v: number, t: Transform) => Transform) => {
      const input = h('input', { type: 'text', class: 'opt-input', style: { width: '56px' } });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') input.blur();
      });
      input.addEventListener('change', () => {
        const v = Number.parseFloat(input.value.replace(',', '.'));
        const t = this.transform;
        if (Number.isFinite(v) && t) this.update(apply(v, t));
      });
      return { input, element: h('label', { class: 'opt-field' }, label, input, h('span', { class: 'muted' }, unit)) };
    };
    const size = () => this.session?.sourceSize ?? { width: 1, height: 1 };
    const x = field('X:', 'px', (v, t) => ({ ...t, cx: v }));
    const y = field('Y:', 'px', (v, t) => ({ ...t, cy: v }));
    const w = field('Š:', '%', (v, t) => ({ ...t, w: Math.max(1, (size().width * v) / 100) }));
    const hh = field('V:', '%', (v, t) => ({ ...t, h: Math.max(1, (size().height * v) / 100) }));
    const angle = field('Úhel:', '°', (v, t) => ({ ...t, angle: (v * Math.PI) / 180 }));
    this.fields = { x: x.input, y: y.input, w: w.input, h: hh.input, angle: angle.input };
    const t = this.transform;
    if (t) this.syncFields(t);
    const element = h(
      'div',
      { class: 'tool-options' },
      h('span', {}, this.label),
      separator(),
      x.element,
      y.element,
      w.element,
      hh.element,
      angle.element,
      separator(),
      iconButton(X, 'Zrušit (Esc)', () => this.finish(false)),
      iconButton(Check, 'Potvrdit (Enter)', () => this.finish(true)),
    );
    return { element, dispose: () => (this.fields = null) };
  }
}
