import { createCanvas, get2d } from '../core/canvas';
import type { Editor } from '../core/Editor';
import { outlinePath } from '../core/selection/raster';
import { compositeDocument } from './composite';

/**
 * Vykresluje dokument do viewportu. Kompozice vrstev se cachuje a přepočítává jen při změně
 * dokumentu; posun/zoom pouze překreslí hotový obraz. Vše se slučuje do jednoho snímku (rAF).
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private composite: HTMLCanvasElement;
  private compositeDirty = true;
  private frame = 0;
  private antsTimer = 0;
  private antsOffset = 0;
  private readonly checker: CanvasPattern | null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly editor: Editor,
  ) {
    this.ctx = get2d(canvas);
    this.composite = createCanvas(editor.doc.width, editor.doc.height);
    this.checker = this.createChecker();

    editor.on('docChange', (c) => {
      if (c.kind === 'selection') {
        this.updateAnts();
        this.requestRender();
      } else this.invalidate();
    });
    editor.on('document', () => {
      this.updateAnts();
      this.invalidate();
    });
    editor.on('view', () => this.requestRender());
    editor.on('tool', () => this.requestRender());
  }

  /** Animace obrysu výběru běží jen, když nějaký výběr existuje. */
  private updateAnts(): void {
    const has = !!this.editor.doc.selection;
    if (has && !this.antsTimer) {
      this.antsTimer = window.setInterval(() => {
        this.antsOffset = (this.antsOffset + 1) % 8;
        this.requestRender();
      }, 120);
    } else if (!has && this.antsTimer) {
      clearInterval(this.antsTimer);
      this.antsTimer = 0;
    }
  }

  private drawSelection(ctx: CanvasRenderingContext2D, dpr: number): void {
    const sel = this.editor.doc.selection;
    if (!sel) return;
    const { zoom, panX, panY } = this.editor.viewport;
    const path = outlinePath(sel);
    ctx.save();
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.strokeStyle = '#000';
    ctx.lineDashOffset = -this.antsOffset / zoom;
    ctx.stroke(path);
    ctx.strokeStyle = '#fff';
    ctx.lineDashOffset = (4 - this.antsOffset) / zoom;
    ctx.stroke(path);
    ctx.restore();
  }

  private createChecker(): CanvasPattern | null {
    const size = 8;
    const tile = createCanvas(size * 2, size * 2);
    const t = get2d(tile);
    t.fillStyle = '#ffffff';
    t.fillRect(0, 0, size * 2, size * 2);
    t.fillStyle = '#cccccc';
    t.fillRect(0, 0, size, size);
    t.fillRect(size, size, size, size);
    return this.ctx.createPattern(tile, 'repeat');
  }

  invalidate(): void {
    this.compositeDirty = true;
    this.requestRender();
  }

  requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Přizpůsobí rozlišení plátna velikosti prvku (včetně devicePixelRatio). */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.editor.viewport.width = cssWidth;
    this.editor.viewport.height = cssHeight;
    this.requestRender();
  }

  private render(): void {
    const { doc, viewport: vp } = this.editor;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;

    if (this.compositeDirty) {
      if (this.composite.width !== doc.width || this.composite.height !== doc.height) {
        this.composite = createCanvas(doc.width, doc.height);
      }
      compositeDocument(doc, get2d(this.composite));
      this.compositeDirty = false;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#252525';
    ctx.fillRect(0, 0, vp.width, vp.height);

    const w = doc.width * vp.zoom;
    const h = doc.height * vp.zoom;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = this.checker ?? '#ffffff';
    ctx.translate(vp.panX, vp.panY);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    ctx.imageSmoothingEnabled = vp.zoom < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.composite, vp.panX, vp.panY, w, h);

    this.drawSelection(ctx, dpr);
    this.editor.activeTool?.drawOverlay?.(ctx, this.editor);
  }
}
