import { Check, Crop, X } from 'lucide';
import type { Editor } from '../core/Editor';
import { dragHandle, identityTransform, type Point, type Transform } from '../core/transform/geometry';
import { checkbox, iconButton, selectField, separator } from '../ui/controls';
import { h } from '../ui/dom';
import { cursorForHit, drawBox, hitTestBox, type BoxHit } from './boxHandles';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

const RATIOS: Array<{ value: string; label: string }> = [
  { value: 'free', label: 'Volný poměr' },
  { value: 'original', label: 'Původní poměr' },
  { value: '1:1', label: '1 : 1' },
  { value: '4:3', label: '4 : 3' },
  { value: '3:2', label: '3 : 2' },
  { value: '16:9', label: '16 : 9' },
  { value: '3:4', label: '3 : 4 (na výšku)' },
  { value: '2:3', label: '2 : 3 (na výšku)' },
];

/**
 * Oříznutí (C): rámeček přes celé plátno, úchyty mění velikost, tažení uvnitř posouvá,
 * tažení mimo rámeček vytvoří nový. Enter / ✓ ořízne, Esc / ✗ vrátí rámeček na celé plátno.
 */
export class CropTool implements Tool {
  readonly id = 'crop';
  readonly name = 'Oříznutí';
  readonly icon = Crop;
  readonly shortcut = 'C';
  readonly cursor = 'crosshair';
  private rect: Transform | null = null;
  private ratio = 'free';
  private deletePixels = true;
  private drag: { hit: BoxHit; start: Transform; from: Point } | null = null;
  private sizeLabel: HTMLElement | null = null;

  constructor(private readonly editor: Editor) {
    editor.on('document', () => (this.rect = null));
    editor.on('docChange', (c) => {
      if (c.kind === 'size') this.rect = null;
    });
  }

  /** Aktuální rámeček (výchozí = celé plátno). */
  private get box(): Transform {
    return this.rect ?? identityTransform(0, 0, this.editor.doc.width, this.editor.doc.height);
  }

  private ratioValue(): number | null {
    if (this.ratio === 'free') return null;
    if (this.ratio === 'original') return this.editor.doc.width / this.editor.doc.height;
    const [a, b] = this.ratio.split(':').map(Number);
    return a / b;
  }

  /** Přizpůsobí rámeček zvolenému poměru (zmenší se kolem středu). */
  private applyRatio(): void {
    const r = this.ratioValue();
    if (!r) return;
    const t = this.box;
    const w = Math.min(t.w, t.h * r);
    this.rect = { ...t, w, h: w / r };
    this.changed();
  }

  activate(): void {
    this.rect = null;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const t = this.box;
    let hit = hitTestBox(this.editor, t, p, { rotate: false, edges: !this.ratioValue() });
    // Výchozí rámeček (celé plátno): tah uvnitř nakreslí nový rámeček, jako ve Photoshopu.
    if (!this.rect && hit.kind === 'move') hit = { kind: 'outside' };
    // Nový rámeček začíná v přichyceném bodě (vodítka, okraje).
    this.drag = { hit, start: t, from: hit.kind === 'outside' ? this.editor.snap(p) : { x: p.x, y: p.y } };
  }

  pointerMove(pointer: ToolPointer): void {
    const d = this.drag;
    if (!d) return;
    // Úchyty a nový rámeček se přichytávají, posun celého rámečku ne.
    const p = d.hit.kind === 'move' ? pointer : { ...pointer, ...this.editor.snap(pointer) };
    const ratio = this.ratioValue();
    if (d.hit.kind === 'handle') this.rect = dragHandle(d.start, d.hit.handle, p, !!ratio, p.altKey);
    else if (d.hit.kind === 'move') this.rect = { ...d.start, cx: d.start.cx + (p.x - d.from.x), cy: d.start.cy + (p.y - d.from.y) };
    else {
      // Nový rámeček tažením.
      let w = p.x - d.from.x;
      let hh = p.y - d.from.y;
      if (ratio || p.shiftKey) {
        const r = ratio ?? 1;
        const size = Math.max(Math.abs(w), Math.abs(hh) * r);
        w = Math.sign(w || 1) * size;
        hh = Math.sign(hh || 1) * (size / r);
      }
      if (Math.abs(w) < 1 || Math.abs(hh) < 1) return;
      this.rect = identityTransform(Math.min(d.from.x, d.from.x + w), Math.min(d.from.y, d.from.y + hh), Math.abs(w), Math.abs(hh));
    }
    this.changed();
  }

  pointerUp(): void {
    this.drag = null;
  }

  cursorAt(p: ToolPointer): string | null {
    if (this.drag) return null;
    const hit = hitTestBox(this.editor, this.box, p, { rotate: false, edges: !this.ratioValue() });
    return !this.rect && hit.kind === 'move' ? 'crosshair' : cursorForHit(hit, this.box);
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Enter') this.commit();
    else if (e.key === 'Escape') this.reset();
    else return false;
    return true;
  }

  private reset(): void {
    this.rect = null;
    this.changed();
  }

  private commit(): void {
    const t = this.box;
    const x = Math.round(t.cx - t.w / 2);
    const y = Math.round(t.cy - t.h / 2);
    const rect = { x, y, width: Math.max(1, Math.round(t.w)), height: Math.max(1, Math.round(t.h)) };
    const { doc } = this.editor;
    this.rect = null;
    if (rect.x === 0 && rect.y === 0 && rect.width === doc.width && rect.height === doc.height) return;
    this.editor.cropDocument(rect, this.deletePixels);
  }

  private changed(): void {
    const t = this.box;
    if (this.sizeLabel) this.sizeLabel.textContent = `${Math.round(t.w)} × ${Math.round(t.h)} px`;
    this.editor.notifyView();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    const t = this.box;
    const vp = editor.viewport;
    const a = vp.toScreen(t.cx - t.w / 2, t.cy - t.h / 2);
    const b = vp.toScreen(t.cx + t.w / 2, t.cy + t.h / 2);
    ctx.save();
    // Ztmavení všeho mimo rámeček.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, vp.width, vp.height);
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.fill('evenodd');
    ctx.restore();
    drawBox(ctx, editor, t, { edges: !this.ratioValue(), thirds: true });
  }

  createOptions(): ToolOptionsUI {
    this.sizeLabel = h('span', { class: 'muted' });
    this.changed();
    const element = h(
      'div',
      { class: 'tool-options' },
      selectField(null, RATIOS, this.ratio, (v) => {
        this.ratio = v;
        this.applyRatio();
      }),
      this.sizeLabel,
      separator(),
      checkbox('Smazat oříznuté pixely', this.deletePixels, (v) => (this.deletePixels = v)),
      separator(),
      iconButton(X, 'Zrušit (Esc)', () => this.reset()),
      iconButton(Check, 'Oříznout (Enter)', () => this.commit()),
    );
    return { element, dispose: () => (this.sizeLabel = null) };
  }
}
