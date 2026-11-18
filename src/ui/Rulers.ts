import type { Editor } from '../core/Editor';
import { h, rafThrottle } from './dom';

export const RULER_SIZE = 16;
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
const MIN_LABEL_SPACING = 48;

/** Pravítka nad a vlevo od plátna (jednotky = pixely dokumentu). */
export class Rulers {
  readonly top: HTMLCanvasElement;
  readonly left: HTMLCanvasElement;
  private width = 0;
  private height = 0;

  constructor(private readonly editor: Editor) {
    this.top = h('canvas', { class: 'ruler ruler-top' });
    this.left = h('canvas', { class: 'ruler ruler-left' });
    const draw = rafThrottle(() => this.draw());
    editor.on('view', draw);
    editor.on('document', draw);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const dpr = window.devicePixelRatio || 1;
    this.top.width = Math.max(1, Math.round(width * dpr));
    this.top.height = Math.round(RULER_SIZE * dpr);
    this.left.width = Math.round(RULER_SIZE * dpr);
    this.left.height = Math.max(1, Math.round(height * dpr));
    this.draw();
  }

  private draw(): void {
    const { zoom, panX, panY } = this.editor.viewport;
    const major = STEPS.find((s) => s * zoom >= MIN_LABEL_SPACING) ?? STEPS[STEPS.length - 1];
    const sub = major * zoom >= 100 ? 10 : major * zoom >= 50 ? 5 : 2;
    const minor = major / sub;
    const pointer = this.editor.pointer;
    this.drawRuler(this.top, this.width, panX, zoom, major, minor, pointer?.x, true);
    this.drawRuler(this.left, this.height, panY, zoom, major, minor, pointer?.y, false);
  }

  private drawRuler(
    canvas: HTMLCanvasElement,
    length: number,
    pan: number,
    zoom: number,
    major: number,
    minor: number,
    pointer: number | undefined,
    horizontal: boolean,
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!horizontal) {
      // Svislé pravítko kreslíme stejně jako vodorovné, jen otočené.
      ctx.transform(0, 1, 1, 0, 0, 0);
    }
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, length, RULER_SIZE);
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(0, RULER_SIZE - 1, length, 1);

    ctx.strokeStyle = '#8a8a8a';
    ctx.fillStyle = '#b4b4b4';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const first = Math.floor(-pan / zoom / minor);
    const last = Math.ceil((length - pan) / zoom / minor);
    const perMajor = Math.round(major / minor);
    for (let i = first; i <= last; i++) {
      const pos = Math.round(i * minor * zoom + pan) + 0.5;
      const isMajor = i % perMajor === 0;
      const isHalf = !isMajor && perMajor % 2 === 0 && i % (perMajor / 2) === 0;
      const tick = isMajor ? RULER_SIZE : isHalf ? 6 : 3;
      ctx.moveTo(pos, RULER_SIZE);
      ctx.lineTo(pos, RULER_SIZE - tick);
      if (isMajor) {
        const label = String(Math.round(i * minor));
        if (horizontal) ctx.fillText(label, pos + 2, 1);
        else this.drawVerticalLabel(ctx, label, pos);
      }
    }
    ctx.stroke();

    if (pointer !== undefined) {
      const pos = Math.round(pointer * zoom + pan) + 0.5;
      ctx.strokeStyle = '#e0e0e0';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, RULER_SIZE);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Číslice pod sebou (jako ve Photopea) – kreslí se v otočeném souřadném systému. */
  private drawVerticalLabel(ctx: CanvasRenderingContext2D, label: string, pos: number): void {
    ctx.save();
    ctx.transform(0, 1, 1, 0, 0, 0);
    let y = pos + 2;
    for (const ch of label) {
      ctx.fillText(ch, 2, y);
      y += 8;
    }
    ctx.restore();
  }
}
