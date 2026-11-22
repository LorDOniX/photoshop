import { luma } from './adjust';
import { clipRect, createCanvas, get2d, type Rect } from './canvas';
import type { PaintTargetKind } from './commands/layerCommands';
import { Cancelled, computeJob } from './compute';
import type { Editor } from './Editor';
import { runJob, type Job } from './jobs';
import type { Layer } from './Layer';

/*
 * Úprava pixelů aktivní vrstvy (nebo masky) ve výběru s náhledem naživo – společný základ úprav obrazu
 * (AdjustmentSession) a filtrů (FilterSession).
 *
 * - Plné rozlišení se počítá ve Web Workeru (core/compute.ts) z originálu: oblast výběru + okolí, na které
 *   úprava dosáhne (rozostření). Výsledek se smíchá podle výběru a zapíše do vrstvy – jen pokud mezitím
 *   nepřišla novější změna.
 * - Zmenšený náhled (`draft`) u velkých oblastí: originál se zmenší plátnem na ~0,6 Mpx, spočítá se hned
 *   a zvětší zpět – rychlá odezva při tažení posuvníku.
 * - Potvrzení = jeden krok historie (PaintCommand), zrušení vrátí originál. V masce se upravuje její šedá.
 */

/** Kolik pixelů má zmenšený náhled. */
export const DRAFT_PIXELS = 600_000;

export interface SessionTarget {
  layer: Layer;
  kind: PaintTargetKind;
  rect: Rect;
  weights: Uint8Array | null;
}

/** Cíl úpravy: aktivní vrstva (u vrstvy úprav / v režimu masky její maska), oblast výběru, váhy výběru. */
export function sessionTarget(editor: Editor, allowAdjustmentMask: boolean): SessionTarget | null {
  const layer = editor.doc.activeLayer;
  if (!layer || layer.isGroup) return null;
  const kind: PaintTargetKind = (editor.maskTarget && layer.mask) || (allowAdjustmentMask && layer.adjustment) ? 'mask' : 'pixels';
  if (kind === 'pixels' && (layer.adjustment || editor.isLocked(layer, 'lockPixels'))) return null;
  if (kind === 'mask' && !layer.mask) return null;
  const canvas = kind === 'mask' ? layer.mask! : layer.canvas;
  const sel = editor.doc.selection;
  const b = sel?.bounds();
  const area = b ? { x: b.x - layer.x, y: b.y - layer.y, width: b.width, height: b.height } : { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const rect = clipRect(area, canvas.width, canvas.height);
  if (!rect) return null;
  let weights: Uint8Array | null = null;
  if (sel) {
    weights = new Uint8Array(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) {
      const sy = y + rect.y + layer.y;
      if (sy < 0 || sy >= sel.height) continue;
      for (let x = 0; x < rect.width; x++) {
        const sx = x + rect.x + layer.x;
        if (sx >= 0 && sx < sel.width) weights[y * rect.width + x] = sel.data[sy * sel.width + sx];
      }
    }
  }
  return { layer, kind, rect, weights };
}

export abstract class PixelSession<P> {
  readonly layer: Layer;
  readonly kind: PaintTargetKind;
  /** Upravovaný obdélník v souřadnicích plátna vrstvy. */
  readonly rect: Rect;
  /** Síla úpravy na pixel (výběr), null = všude plně. */
  readonly weights: Uint8Array | null;
  /** Celé plátno před úpravou (kontext pro rozostření). */
  private readonly whole: ImageData;
  private readonly original: ImageData;
  /** Výsledek posledního výpočtu v plném rozlišení (pro potvrzení). */
  private result: ImageData | null = null;
  /** Pro jaké nastavení je `result` (JSON). */
  private resultFor = '';
  private done = false;
  /** Pořadí požadavků – ukáže se jen výsledek nejnovějšího. */
  private version = 0;
  private originalCanvas: HTMLCanvasElement | null = null;
  private selectionCanvas: HTMLCanvasElement | null = null;

  protected constructor(
    protected readonly editor: Editor,
    target: SessionTarget,
  ) {
    this.layer = target.layer;
    this.kind = target.kind;
    this.rect = target.rect;
    this.weights = target.weights;
    const canvas = this.canvas;
    this.whole = get2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
    const r = this.rect;
    this.original = get2d(canvas).getImageData(r.x, r.y, r.width, r.height);
  }

  /** Nezapisovat krok, když výsledek nic nezměnil (úprava s výchozími hodnotami); filtr se zapíše vždy. */
  protected readonly skipUnchanged: boolean = false;
  /** O kolik px úprava čte za okraj oblasti. */
  protected abstract reach(p: P): number;
  /** Úkol pro výpočet (`area` = oblast uvnitř vstupu, `scale` < 1 u zmenšeného náhledu). */
  protected abstract job(p: P, area: Rect, scale: number): Job;

  protected get canvas(): HTMLCanvasElement {
    return this.kind === 'mask' ? this.layer.mask! : this.layer.canvas;
  }

  /** Je oblast tak velká, že se během úprav vyplatí zmenšený náhled? */
  get large(): boolean {
    return this.rect.width * this.rect.height > DRAFT_PIXELS;
  }

  /** Barvy originálu v oblasti (u masky šedá) – histogram, automatické úrovně. */
  get pixels(): Uint8ClampedArray {
    return this.input(this.rect);
  }

  /** Vstup: kus originálu (u masky šedá z alfy, neprůhledná). */
  private input(r: Rect): Uint8ClampedArray {
    const { whole } = this;
    const src = new Uint8ClampedArray(r.width * r.height * 4);
    for (let y = 0; y < r.height; y++) {
      const from = ((y + r.y) * whole.width + r.x) * 4;
      src.set(whole.data.subarray(from, from + r.width * 4), y * r.width * 4);
    }
    if (this.kind === 'mask') {
      for (let p = 0; p < src.length; p += 4) {
        src[p] = src[p + 1] = src[p + 2] = src[p + 3];
        src[p + 3] = 255;
      }
    }
    return src;
  }

  /**
   * Spočítá a ukáže úpravu; null = originál (vypnutý náhled). `draft` = u velké oblasti hned zmenšený
   * náhled. Plné rozlišení běží na pozadí; promise se splní, až je výsledek vidět (nebo byl nahrazen).
   */
  async update(p: P | null, draft = false): Promise<void> {
    if (this.done) return;
    const version = ++this.version;
    if (!p) {
      this.result = null;
      this.show(this.original);
      return;
    }
    if (draft && this.large && this.kind === 'pixels') {
      this.showDraft(p);
      return;
    }
    const { rect, whole } = this;
    const reach = this.reach(p);
    const ctxRect = clipRect({ x: rect.x - reach, y: rect.y - reach, width: rect.width + 2 * reach, height: rect.height + 2 * reach }, whole.width, whole.height)!;
    const area = { x: rect.x - ctxRect.x, y: rect.y - ctxRect.y, width: rect.width, height: rect.height };
    let out: Uint8ClampedArray;
    try {
      out = await computeJob({ data: this.input(ctxRect), width: ctxRect.width, height: ctxRect.height }, this.job(p, area, 1));
    } catch (e) {
      if (e instanceof Cancelled) return;
      throw e;
    }
    if (this.done || version !== this.version) return;
    this.result = this.compose(out, ctxRect.width, area);
    this.resultFor = JSON.stringify(p);
    this.show(this.result);
  }

  /** Výsledek v obdélníku výběru, smíchaný s originálem podle výběru. */
  private compose(out: Uint8ClampedArray, width: number, area: Rect): ImageData {
    const { rect } = this;
    const res = new ImageData(new Uint8ClampedArray(this.original.data), rect.width, rect.height);
    const d = res.data;
    const keepAlpha = this.kind === 'pixels' && this.editor.isLocked(this.layer, 'lockTransparency');
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const i = y * rect.width + x;
        const w = this.weights ? this.weights[i] / 255 : 1;
        if (w <= 0) continue;
        const p = i * 4;
        const q = ((y + area.y) * width + x + area.x) * 4;
        if (this.kind === 'mask') {
          d[p + 3] += (luma(out[q], out[q + 1], out[q + 2]) - d[p + 3]) * w;
          continue;
        }
        for (let c = 0; c < (keepAlpha ? 3 : 4); c++) d[p + c] += (out[q + c] - d[p + c]) * w;
      }
    }
    return res;
  }

  /**
   * Zmenšený náhled: originál s okolím se zmenší plátnem, spočítá se zmenšenou úpravou na hlavním vlákně
   * (je malý) a zvětší zpět; výběr se přimíchá maskou na plátně.
   */
  private showDraft(p: P): void {
    const { rect, whole } = this;
    if (!this.originalCanvas) {
      this.originalCanvas = createCanvas(whole.width, whole.height);
      get2d(this.originalCanvas).putImageData(whole, 0, 0);
    }
    const reach = this.reach(p);
    const ctxRect = clipRect({ x: rect.x - reach, y: rect.y - reach, width: rect.width + 2 * reach, height: rect.height + 2 * reach }, whole.width, whole.height)!;
    const k = Math.min(1, Math.sqrt(DRAFT_PIXELS / (ctxRect.width * ctxRect.height)));
    const sw = Math.max(1, Math.round(ctxRect.width * k));
    const sh = Math.max(1, Math.round(ctxRect.height * k));
    const kx = sw / ctxRect.width;
    const ky = sh / ctxRect.height;
    const small = createCanvas(sw, sh);
    const sctx = get2d(small);
    sctx.imageSmoothingQuality = 'medium';
    sctx.drawImage(this.originalCanvas, ctxRect.x, ctxRect.y, ctxRect.width, ctxRect.height, 0, 0, sw, sh);
    const area = { x: (rect.x - ctxRect.x) * kx, y: (rect.y - ctxRect.y) * ky, width: rect.width * kx, height: rect.height * ky };
    const sArea = clipRect({ x: Math.floor(area.x), y: Math.floor(area.y), width: Math.max(1, Math.ceil(area.width)), height: Math.max(1, Math.ceil(area.height)) }, sw, sh) ?? { x: 0, y: 0, width: sw, height: sh };
    const out = runJob({ data: sctx.getImageData(0, 0, sw, sh).data, width: sw, height: sh }, this.job(p, sArea, kx));
    sctx.putImageData(new ImageData(new Uint8ClampedArray(out), sw, sh), 0, 0);
    const tmp = createCanvas(rect.width, rect.height);
    const tctx = get2d(tmp);
    tctx.drawImage(small, area.x, area.y, area.width, area.height, 0, 0, rect.width, rect.height);
    const ctx = get2d(this.canvas);
    ctx.save();
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    if (this.weights) {
      if (!this.selectionCanvas) {
        this.selectionCanvas = createCanvas(rect.width, rect.height);
        const m = new ImageData(rect.width, rect.height);
        for (let i = 0; i < this.weights.length; i++) m.data[i * 4 + 3] = this.weights[i];
        get2d(this.selectionCanvas).putImageData(m, 0, 0);
      }
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(this.selectionCanvas, 0, 0);
      ctx.drawImage(this.originalCanvas, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
    }
    ctx.drawImage(tmp, rect.x, rect.y);
    ctx.restore();
    this.result = null;
    this.notify();
  }

  private show(image: ImageData): void {
    get2d(this.canvas).putImageData(image, this.rect.x, this.rect.y);
    this.notify();
  }

  private notify(): void {
    const { rect } = this;
    this.editor.doc.notifyPixels(this.layer.id, { x: rect.x + this.layer.x, y: rect.y + this.layer.y, width: rect.width, height: rect.height });
  }

  /**
   * Spočítá `p` v plném rozlišení (pokud už není) a potvrdí jako krok historie. Vrací false, když se nic
   * nezměnilo nebo vrstva nejde upravit.
   */
  async commitWith(p: P, label: string): Promise<boolean> {
    if (this.done) return false;
    if (this.resultFor !== JSON.stringify(p) || !this.result) await this.update(p);
    return this.commit(label);
  }

  /** Potvrdí poslední výsledek v plném rozlišení jako krok historie. */
  commit(label: string): boolean {
    if (this.done) return false;
    this.done = true;
    const after = this.result;
    this.show(this.original);
    if (!after || (this.skipUnchanged && sameData(after.data, this.original.data))) return false;
    const { x, y } = this.rect;
    const cmd = this.editor.paintLayer(this.layer, this.rect, label, (ctx) => ctx.putImageData(after, x, y), this.kind);
    if (!cmd) return false;
    this.editor.history.push(cmd);
    this.editor.fadeable = cmd;
    return true;
  }

  /** Vrátí originál (rozpracovaný výpočet se zahodí). */
  cancel(): void {
    if (this.done) return;
    this.done = true;
    this.show(this.original);
  }
}

function sameData(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
