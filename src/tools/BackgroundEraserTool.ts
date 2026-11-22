import { BrushCleaning } from 'lucide';
import { clipRect, cloneCanvas, get2d, unionRect, type Rect } from '../core/canvas';
import { parseHex } from '../core/color';
import { PaintCommand } from '../core/commands/layerCommands';
import type { Editor } from '../core/Editor';
import type { Layer } from '../core/Layer';
import type { SelectionMask } from '../core/selection/SelectionMask';
import { checkbox, selectField, SliderField } from '../ui/controls';
import { h } from '../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/*
 * Guma pozadí (E): maže v kruhu štětce jen pixely podobné vzorkované barvě – typicky pozadí kolem okraje objektu.
 * - Vzorkování: průběžně (barva pod středem štětce při každém otisku), jednou (na začátku tahu), barva pozadí.
 * - Omezení: nesouvislé (všechny podobné pixely v kruhu), souvislé (jen spojené se středem).
 * - Tolerance: rozdíl barev (největší z kanálů) do poloviny tolerance maže úplně, do tolerance zčásti (měkký okraj).
 * - Chránit barvu popředí: pixely podobné barvě popředí zůstanou.
 * Otisky po čtvrtině velikosti podél tahu (barvy i alfa z originálu, takže se překryvy nesčítají), výběr omezí mazání, celý tah = jeden krok historie. Zamčená
 * průhlednost a maska: nemaže (upozornění).
 */

type Sampling = 'continuous' | 'once' | 'background';

interface Stroke {
  layer: Layer;
  snapshot: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bounds: Rect | null;
  last: { x: number; y: number };
  /** Vzorkovaná barva (u „jednou“ a „barva pozadí“ pevná). */
  color: [number, number, number] | null;
  /** Zbytek vzdálenosti do dalšího otisku. */
  carry: number;
  selection: SelectionMask | null;
}

export class BackgroundEraserTool implements Tool {
  readonly id = 'bg-eraser';
  readonly name = 'Guma pozadí';
  readonly icon = BrushCleaning;
  readonly shortcut = 'E';
  readonly cursor = 'none';
  tolerance = 50;
  contiguous = false;
  sampling: Sampling = 'continuous';
  protectForeground = false;
  private current: Stroke | null = null;

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const target = this.editor.paintTarget();
    if (!target || !target.layer.visible) return;
    if (target.kind !== 'pixels' || this.editor.isLocked(target.layer, 'lockTransparency')) {
      this.editor.notice(target.kind !== 'pixels' ? 'Guma pozadí maže pixely vrstvy, ne masku.' : 'Vrstva má zamčenou průhlednost.');
      return;
    }
    const { layer } = target;
    const local = { x: p.x - layer.x, y: p.y - layer.y };
    let color: Stroke['color'] = null;
    if (this.sampling === 'background') {
      const c = parseHex(this.editor.settings.secondaryColor);
      color = [c.r, c.g, c.b];
    } else if (this.sampling === 'once') color = this.sample(target.ctx, local.x, local.y);
    this.current = { layer, snapshot: cloneCanvas(layer.canvas), ctx: target.ctx, bounds: null, last: local, color, carry: 0, selection: this.editor.doc.selection };
    this.dab(local.x, local.y);
  }

  pointerMove(p: ToolPointer): void {
    const s = this.current;
    if (!s) return;
    const to = { x: p.x - s.layer.x, y: p.y - s.layer.y };
    const step = Math.max(1, this.editor.settings.brushSize / 4);
    const len = Math.hypot(to.x - s.last.x, to.y - s.last.y);
    if (!len) return;
    let t = step - s.carry;
    while (t <= len) {
      this.dab(s.last.x + ((to.x - s.last.x) * t) / len, s.last.y + ((to.y - s.last.y) * t) / len);
      t += step;
    }
    s.carry = len - (t - step);
    s.last = to;
  }

  pointerUp(): void {
    const s = this.current;
    this.current = null;
    if (!s?.bounds) return;
    const { x, y, width, height } = s.bounds;
    const before = get2d(s.snapshot).getImageData(x, y, width, height);
    const after = s.ctx.getImageData(x, y, width, height);
    this.editor.history.push(new PaintCommand(this.editor.doc, s.layer.id, x, y, before, after, this.name, 'pixels'));
  }

  deactivate(): void {
    this.pointerUp();
  }

  /** Barva pixelu (bod plátna vrstvy) – z originálu na začátku tahu nebo aktuální. */
  private sample(ctx: CanvasRenderingContext2D, x: number, y: number): [number, number, number] | null {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= ctx.canvas.width || iy >= ctx.canvas.height) return null;
    const d = ctx.getImageData(ix, iy, 1, 1).data;
    return d[3] ? [d[0], d[1], d[2]] : null;
  }

  /** Jeden otisk štětce se středem (x, y) v souřadnicích plátna vrstvy. */
  dab(cx: number, cy: number): void {
    const s = this.current;
    if (!s) return;
    const size = this.editor.settings.brushSize;
    const r = size / 2;
    const rect = clipRect({ x: Math.floor(cx - r), y: Math.floor(cy - r), width: Math.ceil(size) + 2, height: Math.ceil(size) + 2 }, s.snapshot.width, s.snapshot.height);
    if (!rect) return;
    // Průběžné vzorkování bere barvu z originálu (smazaný střed by jinak nic nevzorkoval).
    const color = this.sampling === 'continuous' ? this.sample(get2d(s.snapshot), cx, cy) : s.color;
    if (!color) return;
    const img = s.ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
    // Barvy a alfa z originálu – překrývající se otisky tak částečné mazání nenásobí.
    const d = get2d(s.snapshot).getImageData(rect.x, rect.y, rect.width, rect.height).data;
    const cur = img.data;
    const { width, height } = rect;
    const tol = Math.max(1, this.tolerance * 2.55);
    const fg = parseHex(this.editor.settings.color);
    // Síla mazání pro každý pixel (0 = zůstane, 1 = smazat).
    const strength = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = rect.x + x + 0.5;
        const py = rect.y + y + 0.5;
        const dist = Math.hypot(px - cx, py - cy);
        // Kruh štětce s vyhlazeným okrajem (1 px).
        const cover = Math.min(1, Math.max(0, r - dist + 0.5));
        if (cover <= 0) continue;
        const p = (y * width + x) * 4;
        if (!d[p + 3]) continue;
        const diff = Math.max(Math.abs(d[p] - color[0]), Math.abs(d[p + 1] - color[1]), Math.abs(d[p + 2] - color[2]));
        if (diff >= tol) continue;
        if (this.protectForeground && Math.max(Math.abs(d[p] - fg.r), Math.abs(d[p + 1] - fg.g), Math.abs(d[p + 2] - fg.b)) < tol) continue;
        const k = diff <= tol / 2 ? 1 : 1 - (diff - tol / 2) / (tol / 2);
        let w = cover * k;
        if (s.selection) {
          const sx = rect.x + x + s.layer.x;
          const sy = rect.y + y + s.layer.y;
          w *= sx >= 0 && sy >= 0 && sx < s.selection.width && sy < s.selection.height ? s.selection.data[sy * s.selection.width + sx] / 255 : 0;
        }
        strength[y * width + x] = w;
      }
    }
    if (this.contiguous) keepConnected(strength, width, height, Math.floor(cx) - rect.x, Math.floor(cy) - rect.y);
    let changed = false;
    for (let i = 0; i < strength.length; i++) {
      const w = strength[i];
      if (w <= 0) continue;
      const next = Math.round(d[i * 4 + 3] * (1 - w));
      if (next < cur[i * 4 + 3]) {
        cur[i * 4 + 3] = next;
        changed = true;
      }
    }
    if (!changed) return;
    s.ctx.putImageData(img, rect.x, rect.y);
    s.bounds = unionRect(s.bounds, rect);
    this.editor.doc.notifyPixels(s.layer.id, { x: rect.x + s.layer.x, y: rect.y + s.layer.y, width, height });
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    if (!editor.pointer) return;
    const { x, y } = editor.viewport.toScreen(editor.pointer.x, editor.pointer.y);
    const r = Math.max(1, (editor.settings.brushSize / 2) * editor.viewport.zoom);
    ctx.save();
    for (const [color, rr] of [
      ['rgba(0,0,0,0.8)', r],
      ['rgba(255,255,255,0.8)', r + 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Křížek uprostřed = místo, odkud se vzorkuje barva.
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x + 4, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
    ctx.restore();
  }

  createOptions(): ToolOptionsUI {
    const editor = this.editor;
    const size = new SliderField({ label: 'Velikost:', value: editor.settings.brushSize, min: 1, max: 500, unit: ' px', onInput: (v) => editor.updateSettings({ brushSize: v }) });
    const unsubscribe = editor.on('settings', () => size.setValue(editor.settings.brushSize));
    const element = h(
      'div',
      { class: 'tool-options' },
      size.element,
      selectField(
        'Vzorkování:',
        [
          { value: 'continuous', label: 'Průběžně' },
          { value: 'once', label: 'Jednou' },
          { value: 'background', label: 'Barva pozadí' },
        ],
        this.sampling,
        (v) => (this.sampling = v as Sampling),
      ),
      selectField(
        'Omezení:',
        [
          { value: 'discontiguous', label: 'Nesouvislé' },
          { value: 'contiguous', label: 'Souvislé' },
        ],
        this.contiguous ? 'contiguous' : 'discontiguous',
        (v) => (this.contiguous = v === 'contiguous'),
      ),
      new SliderField({ label: 'Tolerance:', value: this.tolerance, min: 1, max: 100, unit: '%', onInput: (v) => (this.tolerance = v) }).element,
      checkbox('Chránit barvu popředí', this.protectForeground, (v) => (this.protectForeground = v)),
    );
    return { element, dispose: unsubscribe };
  }
}

/** Souvislé: ponechá jen pixely spojené (4-sousedstvím) se středem otisku, ostatní vynuluje. */
function keepConnected(strength: Float32Array, width: number, height: number, sx: number, sy: number): void {
  const seen = new Uint8Array(strength.length);
  const cx = Math.min(width - 1, Math.max(0, sx));
  const cy = Math.min(height - 1, Math.max(0, sy));
  const start = cy * width + cx;
  if (strength[start] > 0) {
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      const visit = (j: number) => {
        if (!seen[j] && strength[j] > 0) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (y > 0) visit(i - width);
      if (y < height - 1) visit(i + width);
    }
  }
  for (let i = 0; i < strength.length; i++) if (!seen[i]) strength[i] = 0;
}
