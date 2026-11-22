import { createCanvas, get2d, type Rect } from './canvas';
import { PaintCommand } from './commands/layerCommands';
import type { Editor } from './Editor';
import { filterReach, scaleFilter, type Filter } from './filters';
import type { Job } from './jobs';
import type { BlendMode } from './Layer';
import { PixelSession, sessionTarget } from './pixelSession';

/*
 * Filtr s náhledem naživo (Filtr → …): oblast výběru i s okolím, na které filtr potřebuje dosáhnout
 * (rozostření), se spočítá na pozadí z originálu (PixelSession), smíchá podle výběru a zapíše přímo do
 * vrstvy. U velkých oblastí je během úprav hned vidět zmenšený náhled. V masce se filtruje její šedá.
 */
export class FilterSession extends PixelSession<Filter> {
  /** Začne filtr na aktivní vrstvě (u vrstvy úprav na její masce). */
  static start(editor: Editor): FilterSession | null {
    const target = sessionTarget(editor, true);
    return target ? new FilterSession(editor, target) : null;
  }

  protected reach(f: Filter): number {
    return filterReach(f);
  }

  protected job(f: Filter, area: Rect, scale: number): Job {
    // Zmenšený náhled: délky filtru zmenšené, výběr se přimíchá až na plátně.
    if (scale < 1) return { type: 'filter', filter: scaleFilter(f, scale), area };
    return { type: 'filter', filter: f, area, weights: this.weights ?? undefined };
  }
}

/**
 * Úpravy → Zeslabit: poslední filtr / úpravu (pokud je posledním krokem historie) prolne s původním stavem
 * krytím a režimem. Vrací náhled / potvrzení, nebo null, když není co zeslabit.
 */
export class FadeSession {
  private done = false;
  private result: ImageData | null = null;

  private constructor(
    private readonly editor: Editor,
    private readonly cmd: PaintCommand,
  ) {}

  static start(editor: Editor): FadeSession | null {
    const cmd = editor.lastFadeable();
    return cmd ? new FadeSession(editor, cmd) : null;
  }

  get label(): string {
    return this.cmd.label;
  }

  private get canvas(): HTMLCanvasElement | null {
    const layer = this.editor.doc.getLayer(this.cmd.layerId);
    return (this.cmd.target === 'mask' ? layer?.mask : layer?.canvas) ?? null;
  }

  update(opacity: number, blend: BlendMode): void {
    if (this.done) return;
    const { before, after, x, y, target } = this.cmd;
    const w = before.width;
    const h = before.height;
    let image: ImageData;
    if (blend === 'source-over' || target === 'mask') {
      image = new ImageData(new Uint8ClampedArray(after.data), w, h);
      const d = image.data;
      for (let p = 0; p < d.length; p++) d[p] = before.data[p] + (after.data[p] - before.data[p]) * opacity;
    } else {
      const c = createCanvas(w, h);
      const ctx = get2d(c);
      ctx.putImageData(before, 0, 0);
      const top = createCanvas(w, h);
      get2d(top).putImageData(after, 0, 0);
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = blend;
      ctx.drawImage(top, 0, 0);
      image = ctx.getImageData(0, 0, w, h);
    }
    this.result = image;
    this.put(image, x, y);
  }

  private put(image: ImageData, x: number, y: number): void {
    const canvas = this.canvas;
    const layer = this.editor.doc.getLayer(this.cmd.layerId);
    if (!canvas || !layer) return;
    get2d(canvas).putImageData(image, x, y);
    this.editor.doc.notifyPixels(layer.id, { x: x + layer.x, y: y + layer.y, width: image.width, height: image.height });
  }

  commit(): boolean {
    if (this.done) return false;
    this.done = true;
    const { after, x, y, target, layerId, label } = this.cmd;
    this.put(after, x, y);
    if (!this.result) return false;
    const cmd = new PaintCommand(this.editor.doc, layerId, x, y, after, this.result, `Zeslabit: ${label}`, target);
    cmd.do();
    this.editor.history.push(cmd);
    this.editor.fadeable = null;
    return true;
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    this.put(this.cmd.after, this.cmd.x, this.cmd.y);
  }
}
