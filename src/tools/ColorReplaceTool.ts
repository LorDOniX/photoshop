import { Replace } from 'lucide';
import { clipRect, cloneCanvas, get2d, unionRect, type Rect } from '../core/canvas';
import { parseHex } from '../core/color';
import { PaintCommand } from '../core/commands/layerCommands';
import type { Editor } from '../core/Editor';
import type { Layer } from '../core/Layer';
import { recolor, type RecolorMode } from '../core/paint/recolor';
import { colorDiff, keepConnected, toleranceWeight } from '../core/paint/tolerance';
import type { SelectionMask } from '../core/selection/SelectionMask';
import { checkbox, selectField, SliderField } from '../ui/controls';
import { h } from '../ui/dom';
import { eyedropperOf } from './EyedropperTool';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/*
 * Nahrazení barvy (B): štětec přebarví barvou popředí jen pixely podobné vzorkované barvě – jas (a podle režimu i sytost)
 * zůstane, takže stíny a kresba zůstanou zachované.
 * - Režim: odstín, sytost, barva (výchozí), světlost – neoddělitelné režimy prolnutí (core/paint/recolor.ts).
 * - Vzorkování: průběžně (barva pod středem štětce), jednou (na začátku tahu), barva pozadí.
 * - Omezení: nesouvislé / souvislé (spojené se středem otisku); tolerance s vyhlazením (měkký okraj) nebo bez.
 * Barvy se berou z originálu na začátku tahu a síla v pixelu se jen zvětšuje (překrývající se otisky se nesčítají).
 * Výběr omezí tah, Alt+klik nabere barvu popředí, celý tah = jeden krok historie; maska se nepřebarvuje.
 */

type Sampling = 'continuous' | 'once' | 'background';

interface Stroke {
  layer: Layer;
  snapshot: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bounds: Rect | null;
  last: { x: number; y: number };
  color: [number, number, number] | null;
  paint: [number, number, number];
  /** Už použitá síla v pixelu (0–255). */
  applied: Uint8Array;
  carry: number;
  selection: SelectionMask | null;
}

export class ColorReplaceTool implements Tool {
  readonly id = 'color-replace';
  readonly name = 'Nahrazení barvy';
  readonly icon = Replace;
  readonly shortcut = 'B';
  readonly cursor = 'none';
  mode: RecolorMode = 'color';
  sampling: Sampling = 'continuous';
  contiguous = true;
  tolerance = 30;
  antialias = true;
  private current: Stroke | null = null;
  private picking = false;

  constructor(private readonly editor: Editor) {}

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const picker = p.altKey ? eyedropperOf(this.editor) : null;
    if (picker) {
      this.picking = true;
      picker.begin(p, 'color');
      return;
    }
    const target = this.editor.paintTarget();
    if (!target || !target.layer.visible) return;
    if (target.kind !== 'pixels') {
      this.editor.notice('Nahrazení barvy mění pixely vrstvy, ne masku.');
      return;
    }
    const { layer } = target;
    const local = { x: p.x - layer.x, y: p.y - layer.y };
    const snapshot = cloneCanvas(layer.canvas);
    let color: Stroke['color'] = null;
    if (this.sampling === 'background') {
      const c = parseHex(this.editor.settings.secondaryColor);
      color = [c.r, c.g, c.b];
    } else if (this.sampling === 'once') color = sampleAt(snapshot, local.x, local.y);
    const fg = parseHex(this.editor.settings.color);
    this.current = {
      layer,
      snapshot,
      ctx: target.ctx,
      bounds: null,
      last: local,
      color,
      paint: [fg.r, fg.g, fg.b],
      applied: new Uint8Array(snapshot.width * snapshot.height),
      carry: 0,
      selection: this.editor.doc.selection,
    };
    this.dab(local.x, local.y);
  }

  pointerMove(p: ToolPointer): void {
    if (this.picking) return eyedropperOf(this.editor)?.move(p);
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
    if (this.picking) {
      this.picking = false;
      eyedropperOf(this.editor)?.end();
      return;
    }
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

  /** Jeden otisk se středem (cx, cy) v souřadnicích plátna vrstvy. */
  dab(cx: number, cy: number): void {
    const s = this.current;
    if (!s) return;
    const size = this.editor.settings.brushSize;
    const r = size / 2;
    const W = s.snapshot.width;
    const rect = clipRect({ x: Math.floor(cx - r), y: Math.floor(cy - r), width: Math.ceil(size) + 2, height: Math.ceil(size) + 2 }, W, s.snapshot.height);
    if (!rect) return;
    const color = this.sampling === 'continuous' ? sampleAt(s.snapshot, cx, cy) : s.color;
    if (!color) return;
    const { width, height } = rect;
    const d = get2d(s.snapshot).getImageData(rect.x, rect.y, width, height).data;
    const tol = Math.max(1, this.tolerance * 2.55);
    const strength = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cover = Math.min(1, Math.max(0, r - Math.hypot(rect.x + x + 0.5 - cx, rect.y + y + 0.5 - cy) + 0.5));
        const p = (y * width + x) * 4;
        if (cover <= 0 || !d[p + 3]) continue;
        let w = cover * toleranceWeight(colorDiff(d, p, color), tol, this.antialias);
        if (w > 0 && s.selection) {
          const sx = rect.x + x + s.layer.x;
          const sy = rect.y + y + s.layer.y;
          const sel = s.selection;
          w *= sx >= 0 && sy >= 0 && sx < sel.width && sy < sel.height ? sel.data[sy * sel.width + sx] / 255 : 0;
        }
        strength[y * width + x] = w;
      }
    }
    if (this.contiguous) keepConnected(strength, width, height, Math.floor(cx) - rect.x, Math.floor(cy) - rect.y);
    const img = s.ctx.getImageData(rect.x, rect.y, width, height);
    const cur = img.data;
    let changed = false;
    for (let i = 0; i < strength.length; i++) {
      const v = Math.round(strength[i] * 255);
      const ai = (rect.y + Math.floor(i / width)) * W + rect.x + (i % width);
      if (v <= s.applied[ai]) continue;
      s.applied[ai] = v;
      const w = v / 255;
      const p = i * 4;
      const rc = recolor([d[p], d[p + 1], d[p + 2]], s.paint, this.mode);
      cur[p] = d[p] + (rc[0] - d[p]) * w;
      cur[p + 1] = d[p + 1] + (rc[1] - d[p + 1]) * w;
      cur[p + 2] = d[p + 2] + (rc[2] - d[p + 2]) * w;
      changed = true;
    }
    if (!changed) return;
    s.ctx.putImageData(img, rect.x, rect.y);
    s.bounds = unionRect(s.bounds, rect);
    this.editor.doc.notifyPixels(s.layer.id, { x: rect.x + s.layer.x, y: rect.y + s.layer.y, width, height });
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    if (this.picking) return eyedropperOf(editor)?.drawOverlay(ctx, editor);
    if (!editor.pointer) return;
    const { x, y } = editor.viewport.toScreen(editor.pointer.x, editor.pointer.y);
    const r = Math.max(1, (editor.settings.brushSize / 2) * editor.viewport.zoom);
    ctx.save();
    ctx.lineWidth = 1;
    for (const [color, rr] of [
      ['rgba(0,0,0,0.8)', r],
      ['rgba(255,255,255,0.8)', r + 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Křížek = místo, odkud se vzorkuje barva.
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
        'Režim:',
        [
          { value: 'hue', label: 'Odstín' },
          { value: 'saturation', label: 'Sytost' },
          { value: 'color', label: 'Barva' },
          { value: 'luminosity', label: 'Světlost' },
        ],
        this.mode,
        (v) => (this.mode = v as RecolorMode),
      ),
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
      checkbox('Vyhlazování', this.antialias, (v) => (this.antialias = v)),
    );
    return { element, dispose: unsubscribe };
  }
}

/** Barva pixelu plátna (null = mimo nebo průhledný). */
function sampleAt(canvas: HTMLCanvasElement, x: number, y: number): [number, number, number] | null {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= canvas.width || iy >= canvas.height) return null;
  const d = get2d(canvas).getImageData(ix, iy, 1, 1).data;
  return d[3] ? [d[0], d[1], d[2]] : null;
}
