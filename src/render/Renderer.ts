import { createCanvas, get2d, unionRect, type Rect } from '../core/canvas';
import type { Editor } from '../core/Editor';
import { outlinePath } from '../core/selection/raster';
import { CompositeCache } from './CompositeCache';

/** Okraj pro stín plátna (px). */
const SHADOW = 24;

/**
 * Vykresluje dokument do viewportu. Složení vrstev drží CompositeCache (přeskládá jen změněnou část);
 * při oddálení se navíc cachuje zmenšený obraz, takže posun pohledu nic nepřepočítává.
 * Vše se slučuje do jednoho snímku (rAF).
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  readonly cache: CompositeCache;
  /** Zmenšený obraz pro zobrazení při zoomu < 1 (v pixelech obrazovky). */
  private scaled: { canvas: HTMLCanvasElement; scale: number } | null = null;
  /** Výřez složení změněný od posledního snímku, který ještě není ve zmenšeném obrazu. */
  private pending: Rect | 'all' | null = 'all';
  private frame = 0;
  private antsTimer = 0;
  private antsOffset = 0;
  private readonly checker: CanvasPattern | null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly editor: Editor,
  ) {
    this.ctx = get2d(canvas);
    this.cache = new CompositeCache(editor.doc);
    this.checker = this.createChecker();

    editor.on('docChange', (c) => {
      if (c.kind === 'selection') this.updateAnts();
      else this.cache.onChange(c);
      this.requestRender();
    });
    editor.on('document', (doc) => {
      this.updateAnts();
      this.cache.setDocument(doc);
      this.requestRender();
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

  /**
   * Zmenšené složení pro daný zoom. Přepočítá se celé jen při změně zoomu nebo celého složení,
   * jinak jen změněný výřez.
   */
  private scaledComposite(composite: HTMLCanvasElement, scale: number): HTMLCanvasElement {
    const sw = Math.max(1, Math.round(composite.width * scale));
    const sh = Math.max(1, Math.round(composite.height * scale));
    let s = this.scaled;
    let region = this.pending;
    if (!s || s.scale !== scale || s.canvas.width !== sw || s.canvas.height !== sh) {
      s = this.scaled = { canvas: createCanvas(sw, sh), scale };
      region = 'all';
    }
    if (region) {
      const sctx = get2d(s.canvas);
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      if (region === 'all') {
        sctx.clearRect(0, 0, sw, sh);
        sctx.drawImage(composite, 0, 0, sw, sh);
      } else {
        // Celé pixely zmenšeniny (s okrajem kvůli vyhlazení) a jim přesně odpovídající zdroj.
        const kx = composite.width / sw;
        const ky = composite.height / sh;
        const dx = Math.max(0, Math.floor(region.x / kx) - 1);
        const dy = Math.max(0, Math.floor(region.y / ky) - 1);
        const dx2 = Math.min(sw, Math.ceil((region.x + region.width) / kx) + 1);
        const dy2 = Math.min(sh, Math.ceil((region.y + region.height) / ky) + 1);
        if (dx2 > dx && dy2 > dy) {
          sctx.clearRect(dx, dy, dx2 - dx, dy2 - dy);
          sctx.drawImage(composite, dx * kx, dy * ky, (dx2 - dx) * kx, (dy2 - dy) * ky, dx, dy, dx2 - dx, dy2 - dy);
        }
      }
    }
    this.pending = null;
    return s.canvas;
  }

  private shadow: { canvas: HTMLCanvasElement; w: number; h: number } | null = null;

  /** Stín plátna jako obrázek (jen do rozumné velikosti; u obřího zvětšení je stín stejně mimo okno). */
  private shadowFor(w: number, h: number): HTMLCanvasElement | null {
    const rw = Math.round(w);
    const rh = Math.round(h);
    if (rw * rh > 16_000_000) return null;
    if (this.shadow && this.shadow.w === rw && this.shadow.h === rh) return this.shadow.canvas;
    const canvas = createCanvas(rw + SHADOW * 2, rh + SHADOW * 2);
    const sctx = get2d(canvas);
    sctx.shadowColor = 'rgba(0,0,0,0.6)';
    sctx.shadowBlur = 12;
    sctx.fillStyle = '#000';
    sctx.fillRect(SHADOW, SHADOW, rw, rh);
    this.shadow = { canvas, w: rw, h: rh };
    return canvas;
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
    this.cache.invalidate();
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

    const changed = this.cache.update();
    if (changed === 'all' || !this.pending) this.pending = changed;
    else if (changed && this.pending !== 'all') this.pending = unionRect(this.pending, changed);
    const composite = this.cache.composite;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#252525';
    ctx.fillRect(0, 0, vp.width, vp.height);

    const w = doc.width * vp.zoom;
    const h = doc.height * vp.zoom;

    // Stín kolem plátna je drahý (rozostření) – vykreslí se jednou a pak se jen kopíruje.
    const shadow = this.shadowFor(w, h);
    if (shadow) ctx.drawImage(shadow, vp.panX - SHADOW, vp.panY - SHADOW, w + SHADOW * 2, h + SHADOW * 2);
    ctx.save();
    ctx.fillStyle = this.checker ?? '#ffffff';
    ctx.translate(vp.panX, vp.panY);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const scale = vp.zoom * dpr;
    if (scale < 1) {
      const scaled = this.scaledComposite(composite, scale);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(scaled, Math.round(vp.panX * dpr), Math.round(vp.panY * dpr));
      ctx.restore();
    } else {
      this.scaled = null;
      this.pending = null;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(composite, vp.panX, vp.panY, w, h);
    }

    const o = this.editor.viewOptions;
    if (o.extras && o.selectionEdges) this.drawSelection(ctx, dpr);
    this.drawGuides(ctx);
    this.editor.activeTool?.drawOverlay?.(ctx, this.editor);
  }

  /** Vodítka přes celý pohled (azurová čára 1 px); tažené vodítko i při skrytých vodítkách. */
  private drawGuides(ctx: CanvasRenderingContext2D): void {
    const { doc, viewport: vp, guideDrag } = this.editor;
    const list = this.editor.guidesVisible ? doc.guides.filter((_, i) => i !== guideDrag?.index) : [];
    if (guideDrag) list.push(guideDrag.guide);
    if (!list.length) return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.editor.viewOptions.lockGuides ? 'rgba(0, 200, 220, 0.6)' : '#00d8ff';
    ctx.beginPath();
    for (const g of list) {
      if (g.dir === 'v') {
        const x = Math.round(vp.panX + g.pos * vp.zoom) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, vp.height);
      } else {
        const y = Math.round(vp.panY + g.pos * vp.zoom) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(vp.width, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}
