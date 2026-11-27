import { Droplet, Moon, Pointer, SprayCan, Sun, Triangle } from 'lucide';
import { clipRect, cloneCanvas, createCanvas, get2d, unionRect, type Rect } from '../core/canvas';
import { parseHex } from '../core/color';
import { PaintCommand, type PaintTargetKind } from '../core/commands/layerCommands';
import type { Editor } from '../core/Editor';
import type { Img } from '../core/filters';
import type { Layer } from '../core/Layer';
import { restoreAlpha } from '../core/paint/alpha';
import { blurImage, blurSigma, brushWeight, mixByWeight, sharpenImage, smudgeCarry, smudgeDab, spongeImage, toneImage, type ToneRange } from '../core/paint/retouch';
import type { SelectionMask } from '../core/selection/SelectionMask';
import { compositeLayers } from '../render/composite';
import { checkbox, selectField, SliderField } from '../ui/controls';
import { h } from '../ui/dom';
import type { IconNode } from '../ui/icons';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/*
 * Retušovací tahy: Rozostření, Zostření, Rozmazání, Zesvětlení, Ztmavení, Houba.
 * - Rozostření, zostření, zesvětlení, ztmavení a houba: efekt se počítá z obrazu na začátku tahu (po dlaždicích, až když
 *   na ně tah dosáhne) a do vrstvy se míchá podle měkké stopy štětce – přetahování v jednom tahu efekt nesčítá,
 *   další tah ano (jako ve Photoshopu bez airbrushe). Rozostření a zostření mohou brát obraz ze všech vrstev.
 * - Rozmazání nese barvu podél tahu (hustě kladené otisky, `smudgeDab`); malování prstem začne barvou popředí.
 * Výběr omezí tah, zamčená průhlednost se dodrží, v režimu úprav masky se upravuje maska (jako šedý obraz; houba
 * masku nemění). Celý tah = jeden krok historie.
 */

export type RetouchMode = 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge';

const INFO: Record<RetouchMode, [string, string, IconNode, string | undefined]> = {
  blur: ['blur', 'Rozostření', Droplet, undefined],
  sharpen: ['sharpen', 'Zostření', Triangle, undefined],
  smudge: ['smudge', 'Rozmazání', Pointer, undefined],
  dodge: ['dodge', 'Zesvětlení', Sun, 'O'],
  burn: ['burn', 'Ztmavení', Moon, 'O'],
  sponge: ['sponge', 'Houba', SprayCan, 'O'],
};

/** Velikost dlaždice předpočítaného efektu. */
const TILE = 128;

/** Rozestup otisků rozmazání – řidší otisky by na stopě nechávaly „žebra“. */
const smudgeStep = (size: number) => Math.max(1, size / 25);

interface Stroke {
  layer: Layer;
  target: PaintTargetKind;
  ctx: CanvasRenderingContext2D;
  snapshot: HTMLCanvasElement;
  last: { x: number; y: number };
  bounds: Rect | null;
  size: number;
  hardness: number;
  selection: SelectionMask | null;
  lockAlpha: boolean;
  /** Stopa štětce (0–255, maximum z otisků) v souřadnicích plátna cíle – efektové režimy. */
  coverage: Uint8Array | null;
  /** Obraz, ze kterého se efekt počítá: složené vrstvy (dokument), jinak kopie cíle. */
  source: HTMLCanvasElement;
  sourceX: number;
  sourceY: number;
  /** Spočítané dlaždice efektu (klíč = index dlaždice). */
  tiles: Map<number, Uint8ClampedArray>;
  /** Rozmazání: nesená barva a velikost otisku. */
  carry: Float32Array | null;
  dab: number;
  /** Zbytek vzdálenosti do dalšího otisku. */
  carryDist: number;
}

export class RetouchTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon: IconNode;
  readonly shortcut: string | undefined;
  readonly cursor = 'none';
  /** Síla (rozostření, zostření, rozmazání), expozice (zesvětlení, ztmavení), tok (houba) – 0..1. */
  strength = 0.5;
  /** Tvrdost štětce 0..1 (0 = měkký okraj od středu). */
  hardness = 0.5;
  /** Rozostření / zostření: obraz ze všech viditelných vrstev. */
  sampleAll = false;
  /** Rozmazání: začít barvou popředí. */
  fingerPainting = false;
  range: ToneRange = 'midtones';
  protectTones = true;
  spongeMode: 'desaturate' | 'saturate' = 'desaturate';
  vibrance = true;
  private current: Stroke | null = null;

  constructor(
    private readonly editor: Editor,
    readonly mode: RetouchMode,
  ) {
    [this.id, this.name, this.icon, this.shortcut] = INFO[mode];
    if (mode === 'sharpen') this.strength = 0.3;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const target = this.editor.paintTarget();
    if (!target || !target.layer.visible) return;
    const { layer, canvas } = target;
    const isMask = target.kind === 'mask';
    if (isMask && this.mode === 'sponge') {
      this.editor.notice('Houba mění sytost pixelů, maska je šedá.');
      return;
    }
    const snapshot = cloneCanvas(canvas);
    let source = snapshot;
    let sourceX = 0;
    let sourceY = 0;
    if (this.sampleAll && !isMask && (this.mode === 'blur' || this.mode === 'sharpen')) {
      const doc = this.editor.doc;
      source = createCanvas(doc.width, doc.height);
      compositeLayers(get2d(source), doc.layers);
      sourceX = -layer.x;
      sourceY = -layer.y;
    }
    const local = { x: p.x - layer.x, y: p.y - layer.y };
    const size = this.editor.settings.brushSize;
    const dab = Math.ceil(size) + 2;
    const s: Stroke = {
      layer,
      target: target.kind,
      ctx: target.ctx,
      snapshot,
      last: local,
      bounds: null,
      size,
      hardness: this.hardness,
      selection: this.editor.doc.selection,
      lockAlpha: !isMask && this.editor.isLocked(layer, 'lockTransparency'),
      coverage: this.mode === 'smudge' ? null : new Uint8Array(canvas.width * canvas.height),
      source,
      sourceX,
      sourceY,
      tiles: new Map(),
      carry: null,
      dab,
      carryDist: 0,
    };
    this.current = s;
    if (this.mode === 'smudge') {
      const r = this.dabRect(s, local.x, local.y);
      const px = this.read(s, s.ctx.canvas, r);
      let color: [number, number, number] | undefined;
      if (this.fingerPainting) {
        const c = parseHex(this.editor.settings.color);
        // V masce se nese jas barvy popředí.
        const v = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        color = isMask ? [v, v, v] : [c.r, c.g, c.b];
      }
      s.carry = smudgeCarry(px, color);
      if (this.fingerPainting) this.smudgeAt(local.x, local.y);
      return;
    }
    this.segment(local, local);
  }

  pointerMove(p: ToolPointer): void {
    const s = this.current;
    if (!s) return;
    const local = { x: p.x - s.layer.x, y: p.y - s.layer.y };
    if (local.x === s.last.x && local.y === s.last.y) return;
    if (this.mode === 'smudge') {
      const step = smudgeStep(s.size);
      const len = Math.hypot(local.x - s.last.x, local.y - s.last.y);
      let t = step - s.carryDist;
      while (t <= len) {
        this.smudgeAt(s.last.x + ((local.x - s.last.x) * t) / len, s.last.y + ((local.y - s.last.y) * t) / len);
        t += step;
      }
      s.carryDist = len - (t - step);
    } else this.segment(s.last, local);
    s.last = local;
  }

  pointerUp(): void {
    const s = this.current;
    this.current = null;
    if (!s?.bounds) return;
    const { x, y, width, height } = s.bounds;
    const before = get2d(s.snapshot).getImageData(x, y, width, height);
    const after = s.ctx.getImageData(x, y, width, height);
    const label = `${this.name}${s.target === 'mask' ? ' (maska)' : ''}`;
    this.editor.history.push(new PaintCommand(this.editor.doc, s.layer.id, x, y, before, after, label, s.target));
  }

  deactivate(): void {
    this.pointerUp();
  }

  // ---- efektové režimy ----

  /** Úsek tahu: otisky do stopy a přepočet dotčeného obdélníku. */
  private segment(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const s = this.current!;
    const cov = s.coverage!;
    const W = s.snapshot.width;
    const H = s.snapshot.height;
    const r = s.size / 2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const step = Math.max(1, s.size / 10);
    const n = Math.max(1, Math.ceil(len / step));
    let dirty: Rect | null = null;
    for (let k = 1; k <= n; k++) {
      const cx = a.x + ((b.x - a.x) * k) / n;
      const cy = a.y + ((b.y - a.y) * k) / n;
      const rect = clipRect({ x: Math.floor(cx - r - 1), y: Math.floor(cy - r - 1), width: Math.ceil(2 * r) + 3, height: Math.ceil(2 * r) + 3 }, W, H);
      if (!rect) continue;
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          const w = brushWeight(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), r, s.hardness);
          if (w <= 0) continue;
          const v = Math.round(w * 255);
          const i = y * W + x;
          if (v > cov[i]) cov[i] = v;
        }
      }
      dirty = unionRect(dirty, rect);
    }
    if (dirty) this.compose(dirty);
  }

  /** Přepočet obdélníku: originál + (efekt − originál) · stopa · výběr. */
  private compose(rect: Rect): void {
    const s = this.current!;
    const { x, y, width, height } = rect;
    const W = s.snapshot.width;
    const weights = new Float32Array(width * height);
    let any = false;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const c = s.coverage![(y + j) * W + x + i];
        if (!c) continue;
        const w = (c / 255) * this.selectionAt(s, x + i, y + j);
        weights[j * width + i] = w;
        if (w > 0) any = true;
      }
    }
    if (!any) return;
    const before = get2d(s.snapshot).getImageData(x, y, width, height).data;
    const effect = this.effectRegion(rect);
    let out: Uint8ClampedArray;
    if (s.target === 'mask') {
      out = new Uint8ClampedArray(before);
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i];
        if (w > 0) out[i * 4 + 3] = before[i * 4 + 3] + (effect[i * 4] - before[i * 4 + 3]) * w;
      }
    } else out = mixByWeight(before, effect, weights, s.lockAlpha);
    s.ctx.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, width, height), x, y);
    s.bounds = unionRect(s.bounds, rect);
    this.editor.doc.notifyPixels(s.layer.id, { x: x + s.layer.x, y: y + s.layer.y, width, height });
  }

  /** Síla výběru (0..1) v bodě plátna cíle. */
  private selectionAt(s: Stroke, x: number, y: number): number {
    const sel = s.selection;
    if (!sel) return 1;
    const sx = x + s.layer.x;
    const sy = y + s.layer.y;
    return sx >= 0 && sy >= 0 && sx < sel.width && sy < sel.height ? sel.data[sy * sel.width + sx] / 255 : 0;
  }

  /** Pixely efektu v obdélníku plátna cíle (z dlaždic, chybějící se dopočítají). */
  private effectRegion(rect: Rect): Uint8ClampedArray {
    const s = this.current!;
    const out = new Uint8ClampedArray(rect.width * rect.height * 4);
    const cols = Math.ceil(s.snapshot.width / TILE);
    for (let ty = Math.floor(rect.y / TILE); ty * TILE < rect.y + rect.height; ty++) {
      for (let tx = Math.floor(rect.x / TILE); tx * TILE < rect.x + rect.width; tx++) {
        const key = ty * cols + tx;
        let tile = s.tiles.get(key);
        if (!tile) {
          tile = this.computeTile(s, tx * TILE, ty * TILE);
          s.tiles.set(key, tile);
        }
        // Průnik dlaždice s obdélníkem.
        const x0 = Math.max(rect.x, tx * TILE);
        const y0 = Math.max(rect.y, ty * TILE);
        const x1 = Math.min(rect.x + rect.width, (tx + 1) * TILE);
        const y1 = Math.min(rect.y + rect.height, (ty + 1) * TILE);
        for (let y = y0; y < y1; y++) {
          const from = ((y - ty * TILE) * TILE + (x0 - tx * TILE)) * 4;
          out.set(tile.subarray(from, from + (x1 - x0) * 4), ((y - rect.y) * rect.width + (x0 - rect.x)) * 4);
        }
      }
    }
    return out;
  }

  /** Efekt pro dlaždici TILE × TILE s počátkem (x, y) v plátně cíle; rozostření bere i okolí. */
  private computeTile(s: Stroke, x: number, y: number): Uint8ClampedArray {
    const m = this.mode === 'blur' ? Math.ceil(3 * blurSigma(this.strength)) + 2 : this.mode === 'sharpen' ? 5 : 0;
    // Okolí jen v rámci zdroje – rozostření za okrajem prodlouží krajní pixely.
    const srcW = s.source.width;
    const srcH = s.source.height;
    const want = { x: x - m + s.sourceX, y: y - m + s.sourceY, width: TILE + 2 * m, height: TILE + 2 * m };
    const area = clipRect(want, srcW, srcH);
    const tile = new Uint8ClampedArray(TILE * TILE * 4);
    if (!area) return tile;
    const img: Img = { data: this.read(s, s.source, area), width: area.width, height: area.height };
    const res = this.effect(img);
    // Počátek dlaždice ve výsledku.
    const ox = x + s.sourceX - area.x;
    const oy = y + s.sourceY - area.y;
    for (let j = 0; j < TILE; j++) {
      const sy = oy + j;
      if (sy < 0 || sy >= area.height) continue;
      const i0 = Math.max(0, -ox);
      const i1 = Math.min(TILE, area.width - ox);
      if (i1 <= i0) continue;
      tile.set(res.data.subarray((sy * area.width + ox + i0) * 4, (sy * area.width + ox + i1) * 4), (j * TILE + i0) * 4);
    }
    return tile;
  }

  private effect(img: Img): Img {
    switch (this.mode) {
      case 'blur':
        return blurImage(img, this.strength);
      case 'sharpen':
        return sharpenImage(img, this.strength);
      case 'dodge':
      case 'burn':
        return toneImage(img, this.mode, this.range, this.strength, this.protectTones);
      case 'sponge':
        return spongeImage(img, this.spongeMode, this.strength, this.vibrance);
      default:
        return img;
    }
  }

  /** Pixely obdélníku plátna; v masce jako šedý neprůhledný obraz (hodnota masky v RGB). */
  private read(s: Stroke, canvas: HTMLCanvasElement, r: Rect): Uint8ClampedArray {
    const d = get2d(canvas).getImageData(r.x, r.y, r.width, r.height).data;
    if (s.target === 'mask') {
      for (let p = 0; p < d.length; p += 4) {
        const v = d[p + 3];
        d[p] = d[p + 1] = d[p + 2] = v;
        d[p + 3] = 255;
      }
    }
    return d;
  }

  // ---- rozmazání ----

  private dabRect(s: Stroke, cx: number, cy: number): Rect {
    return { x: Math.round(cx - s.dab / 2), y: Math.round(cy - s.dab / 2), width: s.dab, height: s.dab };
  }

  /** Jeden otisk rozmazání se středem (cx, cy) v plátně cíle. */
  private smudgeAt(cx: number, cy: number): void {
    const s = this.current!;
    const r = this.dabRect(s, cx, cy);
    const W = s.snapshot.width;
    const H = s.snapshot.height;
    const px = this.read(s, s.ctx.canvas, r);
    const weights = new Float32Array(r.width * r.height);
    const rad = s.size / 2;
    // Střed otisku v pixelech výřezu (výřez je zaokrouhlený – nesená barva se posouvá po celých pixelech).
    const mx = r.x + r.width / 2;
    const my = r.y + r.height / 2;
    for (let j = 0; j < r.height; j++) {
      for (let i = 0; i < r.width; i++) {
        const x = r.x + i;
        const y = r.y + j;
        if (x < 0 || y < 0 || x >= W || y >= H) {
          weights[j * r.width + i] = -1;
          continue;
        }
        weights[j * r.width + i] = brushWeight(Math.hypot(x + 0.5 - mx, y + 0.5 - my), rad, s.hardness) * this.selectionAt(s, x, y);
      }
    }
    // Síla = kolik nesené barvy zůstane po posunu o 1/10 velikosti štětce (nezávisle na hustotě otisků).
    smudgeDab(px, s.carry!, weights, Math.pow(this.strength, smudgeStep(s.size) / Math.max(1, s.size / 10)));
    const clip = clipRect(r, W, H);
    if (!clip) return;
    if (s.target === 'mask') {
      const cur = s.ctx.getImageData(r.x, r.y, r.width, r.height);
      for (let p = 0; p < px.length; p += 4) cur.data[p + 3] = px[p];
      s.ctx.putImageData(cur, r.x, r.y);
    } else {
      s.ctx.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), r.x, r.y);
      if (s.lockAlpha) restoreAlpha(s.ctx, clip.x, clip.y, get2d(s.snapshot).getImageData(clip.x, clip.y, clip.width, clip.height));
    }
    s.bounds = unionRect(s.bounds, clip);
    this.editor.doc.notifyPixels(s.layer.id, { x: clip.x + s.layer.x, y: clip.y + s.layer.y, width: clip.width, height: clip.height });
  }

  // ---- UI ----

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    if (!editor.pointer) return;
    const { x, y } = editor.viewport.toScreen(editor.pointer.x, editor.pointer.y);
    const r = Math.max(1, (editor.settings.brushSize / 2) * editor.viewport.zoom);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  createOptions(): ToolOptionsUI {
    const editor = this.editor;
    const size = new SliderField({ label: 'Velikost:', value: editor.settings.brushSize, min: 1, max: 500, unit: ' px', onInput: (v) => editor.updateSettings({ brushSize: v }) });
    const unsubscribe = editor.on('settings', () => size.setValue(editor.settings.brushSize));
    const percent = (label: string, value: number, set: (v: number) => void, min = 1) =>
      new SliderField({ label, value: Math.round(value * 100), min, max: 100, unit: '%', onInput: (v) => set(v / 100) }).element;
    const parts: Array<Node | null> = [size.element, percent('Tvrdost:', this.hardness, (v) => (this.hardness = v), 0)];
    switch (this.mode) {
      case 'blur':
      case 'sharpen':
        parts.push(
          percent('Síla:', this.strength, (v) => (this.strength = v)),
          checkbox('Ze všech vrstev', this.sampleAll, (v) => (this.sampleAll = v)),
        );
        break;
      case 'smudge':
        parts.push(
          percent('Síla:', this.strength, (v) => (this.strength = v)),
          checkbox('Malování prstem', this.fingerPainting, (v) => (this.fingerPainting = v)),
        );
        break;
      case 'dodge':
      case 'burn':
        parts.push(
          selectField(
            'Rozsah:',
            [
              { value: 'shadows', label: 'Stíny' },
              { value: 'midtones', label: 'Střední tóny' },
              { value: 'highlights', label: 'Světla' },
            ],
            this.range,
            (v) => (this.range = v as ToneRange),
          ),
          percent('Expozice:', this.strength, (v) => (this.strength = v)),
          checkbox('Chránit tóny', this.protectTones, (v) => (this.protectTones = v)),
        );
        break;
      case 'sponge':
        parts.push(
          selectField(
            'Režim:',
            [
              { value: 'desaturate', label: 'Odbarvit' },
              { value: 'saturate', label: 'Sytost' },
            ],
            this.spongeMode,
            (v) => (this.spongeMode = v as 'desaturate' | 'saturate'),
          ),
          percent('Tok:', this.strength, (v) => (this.strength = v)),
          checkbox('Živost', this.vibrance, (v) => (this.vibrance = v)),
        );
        break;
    }
    return { element: h('div', { class: 'tool-options' }, ...parts), dispose: unsubscribe };
  }
}
