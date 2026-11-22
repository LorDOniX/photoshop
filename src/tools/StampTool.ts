import { Bandage, Grid3x3, Highlighter, Stamp } from 'lucide';
import { luma } from '../core/adjust';
import { clipRect, cloneCanvas, createCanvas, get2d, unionRect, type Rect } from '../core/canvas';
import { PaintCommand, type PaintTargetKind } from '../core/commands/layerCommands';
import type { Editor } from '../core/Editor';
import type { ImageDocument } from '../core/ImageDocument';
import type { BlendMode, Layer } from '../core/Layer';
import { restoreAlpha } from '../core/paint/alpha';
import { findPatchOffset, healRegion } from '../core/paint/heal';
import { allPatterns, canvasPattern, getPattern, onPatternsChange } from '../core/patterns';
import { maskToCanvas } from '../core/selection/raster';
import { compositeLayers } from '../render/composite';
import { checkbox, selectField, SliderField } from '../ui/controls';
import { h } from '../ui/dom';
import type { IconNode } from '../ui/icons';
import { patternCss, showPatternPicker } from '../ui/patternPicker';
import { blendModeSelect } from './optionParts';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/*
 * Razítko, vzorkové razítko a retušovací štětce. Tah štětce (kulatá stopa velikosti a krytí štětce) se nekreslí barvou, ale
 * obrazem zdroje:
 * - Razítko: Alt+klik nastaví zdrojový bod (i v jiném otevřeném dokumentu). Tah kreslí obraz posunutý o rozdíl
 *   zdroje a místa, kde tah začal. Zarovnané = posun platí i pro další tahy (zdroj „putuje“ s kurzorem),
 *   jinak každý tah začne znovu ze zdrojového bodu. Zdroj je aktuální vrstva, aktuální a nižší, nebo všechny
 *   vrstvy – vždy ve stavu na začátku tahu (tah se neklonuje sám do sebe).
 * - Vzorkové razítko: kreslí vybraným vzorkem; zarovnané = dlaždice navazují v celém dokumentu, jinak začínají
 *   v místě tahu.
 * - Retušovací štětec: během tahu jako razítko, po puštění se oblast tahu přepočítá – textura zůstane ze zdroje,
 *   barva a jas se plynule napojí na okolí (core/paint/heal.ts).
 * - Bodový retušovací štětec: bez zdroje – tah se jen označí (ztmavení) a po puštění se zdroj najde v okolí
 *   (`findPatchOffset`: podobný okraj, mimo vadu) a oblast se retušuje.
 * Výběr omezí tah, zamčená průhlednost se dodrží, v masce se klonuje hodnota masky (vzorek podle jasu);
 * retušovat jde jen pixely.
 */

type StampMode = 'clone' | 'pattern' | 'heal' | 'spot';

type SampleMode = 'current' | 'below' | 'all';

interface Source {
  doc: ImageDocument;
  x: number;
  y: number;
}

interface Stroke {
  layer: Layer;
  target: PaintTargetKind;
  ctx: CanvasRenderingContext2D;
  snapshot: HTMLCanvasElement;
  /** Stopa štětce (bílá, plná) v souřadnicích plátna cíle. */
  stroke: HTMLCanvasElement;
  strokeCtx: CanvasRenderingContext2D;
  last: { x: number; y: number };
  bounds: Rect | null;
  opacity: number;
  size: number;
  selection: HTMLCanvasElement | null;
  lockAlpha: boolean;
  /** Obraz zdroje a jeho počátek v souřadnicích dokumentu (razítko). */
  image: HTMLCanvasElement | null;
  imageX: number;
  imageY: number;
  /** Posun zdroje vůči cíli v souřadnicích dokumentu (zdroj = cíl + posun). */
  dx: number;
  dy: number;
  /** Zdroj je složený obraz téhož dokumentu (aktuální a nižší / všechny vrstvy) – retušuje se vůči němu. */
  composite: boolean;
}

const INFO: Record<StampMode, [string, string, IconNode, string]> = {
  clone: ['stamp', 'Razítko', Stamp, 'S'],
  pattern: ['pattern-stamp', 'Vzorkové razítko', Grid3x3, 'S'],
  heal: ['healing', 'Retušovací štětec', Highlighter, 'J'],
  spot: ['spot-healing', 'Bodový retušovací štětec', Bandage, 'J'],
};

export const SAMPLE_MODES: Array<{ value: SampleMode; label: string }> = [
  { value: 'current', label: 'Aktuální vrstva' },
  { value: 'below', label: 'Aktuální a nižší' },
  { value: 'all', label: 'Všechny vrstvy' },
];

export class StampTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon: IconNode;
  readonly shortcut: string;
  readonly cursor = 'none';
  blendMode: BlendMode = 'source-over';
  aligned = true;
  sample: SampleMode = 'current';
  patternId = 'builtin:checker';
  /** Zdrojový bod (razítko). */
  source: Source | null = null;
  /** Posun zarovnaného razítka – nastaví ho první tah po výběru zdroje. */
  private offset: { dx: number; dy: number } | null = null;
  private current: Stroke | null = null;
  private altDown = false;

  constructor(
    private readonly editor: Editor,
    readonly mode: StampMode,
  ) {
    [this.id, this.name, this.icon, this.shortcut] = INFO[mode];
    if (mode === 'pattern' && !getPattern(this.patternId)) this.patternId = allPatterns()[0]?.id ?? '';
  }

  /** Bere obraz ze zdrojového bodu (Alt+klik)? */
  private get usesSource(): boolean {
    return this.mode === 'clone' || this.mode === 'heal';
  }

  private get heals(): boolean {
    return this.mode === 'heal' || this.mode === 'spot';
  }

  cursorAt(p: ToolPointer): string | null {
    this.altDown = p.altKey;
    return this.usesSource && p.altKey ? 'crosshair' : null;
  }

  /** Nastaví zdrojový bod razítka (Alt+klik). */
  setSource(x: number, y: number, doc: ImageDocument = this.editor.doc): void {
    this.source = { doc, x, y };
    this.offset = null;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    if (this.usesSource && p.altKey) {
      this.setSource(Math.round(p.x), Math.round(p.y));
      this.editor.notifyView();
      return;
    }
    const target = this.editor.paintTarget();
    if (!target || !target.layer.visible) return;
    const { layer, canvas } = target;
    const { brushSize, brushOpacity } = this.editor.settings;
    const isMask = target.kind === 'mask';
    if (isMask && this.heals) {
      this.editor.notice('Retušovat jde jen pixely vrstvy, ne masku.');
      return;
    }
    let dx = 0;
    let dy = 0;
    let image: HTMLCanvasElement | null = null;
    let imageX = 0;
    let imageY = 0;
    let composite = false;
    if (this.usesSource) {
      const src = this.source;
      if (!src || !this.editor.sessions.some((s) => s.doc === src.doc)) {
        this.source = null;
        this.editor.notice('Nejdřív nastavte zdroj: klik se stisknutým Alt.');
        return;
      }
      const start = { x: Math.round(p.x), y: Math.round(p.y) };
      if (!this.aligned || !this.offset) this.offset = { dx: src.x - start.x, dy: src.y - start.y };
      ({ dx, dy } = this.offset);
      ({ image, imageX, imageY } = this.sourceImage(src.doc, layer, canvas, isMask));
      composite = src.doc === this.editor.doc && this.sample !== 'current';
    } else if (this.mode === 'spot') {
      ({ image, imageX, imageY } = this.sourceImage(this.editor.doc, layer, canvas, false));
      composite = this.sample !== 'current';
    } else if (!this.aligned) {
      // Nezarovnaný vzorek začíná v místě tahu.
      dx = -Math.round(p.x);
      dy = -Math.round(p.y);
    }
    const stroke = createCanvas(canvas.width, canvas.height);
    const strokeCtx = get2d(stroke);
    strokeCtx.strokeStyle = strokeCtx.fillStyle = '#fff';
    strokeCtx.lineWidth = brushSize;
    strokeCtx.lineCap = 'round';
    strokeCtx.lineJoin = 'round';
    const local = { x: p.x - layer.x, y: p.y - layer.y };
    this.current = {
      layer,
      target: target.kind,
      ctx: target.ctx,
      snapshot: cloneCanvas(canvas),
      stroke,
      strokeCtx,
      last: local,
      bounds: null,
      opacity: brushOpacity,
      size: brushSize,
      selection: this.editor.doc.selection ? maskToCanvas(this.editor.doc.selection) : null,
      lockAlpha: !isMask && this.editor.isLocked(layer, 'lockTransparency'),
      image,
      imageX,
      imageY,
      dx,
      dy,
      composite,
    };
    this.segment(local, local);
  }

  /** Obraz, ze kterého razítko bere (stav na začátku tahu). */
  private sourceImage(doc: ImageDocument, layer: Layer, canvas: HTMLCanvasElement, isMask: boolean): { image: HTMLCanvasElement | null; imageX: number; imageY: number } {
    const same = doc === this.editor.doc;
    // V masce i u aktuální vrstvy téhož dokumentu je zdrojem cíl sám (kopie na začátku tahu).
    if (same && (isMask || this.sample === 'current')) return { image: cloneCanvas(canvas), imageX: layer.x, imageY: layer.y };
    if (this.sample === 'current' || isMask) {
      const l = doc.activeLayer;
      if (!l || l.isGroup) return { image: null, imageX: 0, imageY: 0 };
      return { image: cloneCanvas(l.canvas), imageX: l.x, imageY: l.y };
    }
    const c = createCanvas(doc.width, doc.height);
    const active = doc.activeLayer;
    const layers = this.sample === 'below' && active ? doc.layers.slice(0, doc.indexOf(active.id) + 1) : doc.layers;
    compositeLayers(get2d(c), layers);
    return { image: c, imageX: 0, imageY: 0 };
  }

  pointerMove(p: ToolPointer): void {
    this.altDown = p.altKey;
    const s = this.current;
    if (!s) return;
    const local = { x: p.x - s.layer.x, y: p.y - s.layer.y };
    if (local.x === s.last.x && local.y === s.last.y) return;
    this.segment(s.last, local);
    s.last = local;
  }

  pointerUp(): void {
    const s = this.current;
    this.current = null;
    if (!s?.bounds) return;
    if (this.heals && !this.finishHeal(s)) return;
    const { x, y, width, height } = s.bounds;
    const before = get2d(s.snapshot).getImageData(x, y, width, height);
    const after = s.ctx.getImageData(x, y, width, height);
    const label = `${this.name}${s.target === 'mask' ? ' (maska)' : ''}`;
    this.editor.history.push(new PaintCommand(this.editor.doc, s.layer.id, x, y, before, after, label, s.target));
  }

  deactivate(): void {
    this.pointerUp();
  }

  /**
   * Retušování po puštění: v obdélníku tahu (u bodového i s okolím, kde se hledá zdroj) se spočítá výsledek
   * a přes originál se nakreslí maskovaný stopou. False = nic se nezměnilo (originál vrácen).
   */
  private finishHeal(s: Stroke): boolean {
    const b = s.bounds!;
    const W = s.snapshot.width;
    const H = s.snapshot.height;
    const grow = (r: Rect, m: number) => clipRect({ x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m }, W, H)!;
    const area = grow(b, this.mode === 'spot' ? Math.ceil(s.size * 3.2) + 6 : 3);
    const { width, height } = area;
    // Cíl, vůči kterému se retušuje: vrstva, nebo složený obraz (vzorek ze všech vrstev).
    const dst = s.composite && s.image ? regionOf(s.image, area.x + s.layer.x - s.imageX, area.y + s.layer.y - s.imageY, width, height) : regionOf(s.snapshot, area.x, area.y, width, height);
    const stroke = get2d(s.stroke).getImageData(area.x, area.y, width, height).data;
    const inside = new Uint8Array(width * height);
    for (let i = 0; i < inside.length; i++) inside[i] = stroke[i * 4 + 3] > 0 ? 1 : 0;
    let src: Uint8ClampedArray;
    if (this.mode === 'spot') {
      const o = findPatchOffset(dst, inside, width, height, s.size);
      if (!o) {
        this.restore(s, area);
        this.editor.notice('V okolí není vhodné místo – zkuste menší štětec nebo Retušovací štětec se zdrojem.');
        return false;
      }
      src = new Uint8ClampedArray(dst.length);
      for (let y = 0; y < height; y++) {
        const sy = Math.min(height - 1, Math.max(0, y + o.y));
        for (let x = 0; x < width; x++) {
          const sx = Math.min(width - 1, Math.max(0, x + o.x));
          src.set(dst.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * width + x) * 4);
        }
      }
    } else {
      src = get2d(this.sourceTile(s, area, false)).getImageData(0, 0, width, height).data;
    }
    const healed = healRegion(dst, src, inside, width, height);
    const tile = createCanvas(width, height);
    const t = get2d(tile);
    t.putImageData(new ImageData(new Uint8ClampedArray(healed), width, height), 0, 0);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(s.stroke, area.x, area.y, width, height, 0, 0, width, height);
    const lc = s.ctx;
    lc.save();
    lc.clearRect(area.x, area.y, width, height);
    lc.drawImage(s.snapshot, area.x, area.y, width, height, area.x, area.y, width, height);
    lc.globalCompositeOperation = this.blendMode;
    lc.drawImage(tile, area.x, area.y);
    lc.restore();
    if (s.lockAlpha) restoreAlpha(lc, area.x, area.y, get2d(s.snapshot).getImageData(area.x, area.y, width, height));
    s.bounds = unionRect(s.bounds, area);
    this.editor.doc.notifyPixels(s.layer.id, { x: area.x + s.layer.x, y: area.y + s.layer.y, width, height });
    return true;
  }

  /** Vrátí originál ve výřezu (zrušený tah). */
  private restore(s: Stroke, r: Rect): void {
    s.ctx.clearRect(r.x, r.y, r.width, r.height);
    s.ctx.drawImage(s.snapshot, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
    this.editor.doc.notifyPixels(s.layer.id, { x: r.x + s.layer.x, y: r.y + s.layer.y, width: r.width, height: r.height });
  }

  /** Obraz zdroje pro výřez cíle (souřadnice plátna cíle), neprůhlednost podle stopy štětce. */
  private sourceTile(s: Stroke, r: Rect, masked = true): HTMLCanvasElement {
    const tile = createCanvas(r.width, r.height);
    const t = get2d(tile);
    // Bod výřezu (0, 0) = bod cíle (r.x, r.y) = bod dokumentu (r.x + layer.x, …) → zdroj + posun.
    const docX = r.x + s.layer.x + s.dx;
    const docY = r.y + s.layer.y + s.dy;
    if (this.mode === 'spot') {
      // Bodové retušování: během tahu jen označit místo.
      t.fillStyle = 'rgba(0,0,0,0.45)';
      t.fillRect(0, 0, r.width, r.height);
    } else if (this.usesSource) {
      if (s.image) t.drawImage(s.image, s.imageX - docX, s.imageY - docY);
    } else {
      const pattern = canvasPattern(t, this.patternId, -docX, -docY);
      if (pattern) {
        t.fillStyle = pattern;
        t.fillRect(0, 0, r.width, r.height);
      }
    }
    if (masked) {
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(s.stroke, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
    }
    return tile;
  }

  private segment(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const s = this.current;
    if (!s) return;
    const ctx = s.strokeCtx;
    ctx.beginPath();
    if (a.x === b.x && a.y === b.y) {
      ctx.arc(a.x, a.y, s.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const r = s.size / 2 + 2;
    const dirty = clipRect(
      { x: Math.floor(Math.min(a.x, b.x) - r), y: Math.floor(Math.min(a.y, b.y) - r), width: Math.ceil(Math.abs(a.x - b.x) + r * 2) + 1, height: Math.ceil(Math.abs(a.y - b.y) + r * 2) + 1 },
      s.snapshot.width,
      s.snapshot.height,
    );
    if (!dirty) return;
    s.bounds = unionRect(s.bounds, dirty);
    const { x, y, width, height } = dirty;
    if (s.selection) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(s.selection, -s.layer.x, -s.layer.y);
      ctx.restore();
    }
    const tile = this.sourceTile(s, dirty);
    const lc = s.ctx;
    if (s.target === 'mask') {
      // Maska: hodnota (alfa) = původní + (zdroj − původní) · stopa · krytí; vzorek podle jasu.
      const before = get2d(s.snapshot).getImageData(x, y, width, height).data;
      const src = get2d(tile).getImageData(0, 0, width, height).data;
      const stroke = s.strokeCtx.getImageData(x, y, width, height).data;
      const out = new ImageData(new Uint8ClampedArray(before), width, height);
      for (let p = 0; p < out.data.length; p += 4) {
        const w = (stroke[p + 3] / 255) * s.opacity;
        if (w <= 0) continue;
        // Výřez je násobený stopou: alfa zdroje se vydělí, barvy jsou z getImageData už nenásobené.
        const value = this.mode === 'clone' ? Math.min(255, src[p + 3] / (stroke[p + 3] / 255)) : luma(src[p], src[p + 1], src[p + 2]);
        out.data[p + 3] = before[p + 3] + (value - before[p + 3]) * w;
      }
      lc.putImageData(out, x, y);
    } else {
      lc.save();
      lc.clearRect(x, y, width, height);
      lc.drawImage(s.snapshot, x, y, width, height, x, y, width, height);
      // Retušování: během tahu náhled (klon / označení), výsledek až po puštění.
      lc.globalAlpha = this.heals ? 1 : s.opacity;
      lc.globalCompositeOperation = this.heals ? 'source-over' : this.blendMode;
      lc.drawImage(tile, x, y);
      lc.restore();
      if (s.lockAlpha) restoreAlpha(lc, x, y, get2d(s.snapshot).getImageData(x, y, width, height));
    }
    this.editor.doc.notifyPixels(s.layer.id, { x: x + s.layer.x, y: y + s.layer.y, width, height });
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    const pointer = editor.pointer;
    if (!pointer) return;
    const { viewport } = editor;
    const { x, y } = viewport.toScreen(pointer.x, pointer.y);
    ctx.save();
    if (this.usesSource && this.altDown && !this.current) {
      target(ctx, x, y, 8);
      ctx.restore();
      return;
    }
    const r = Math.max(1, (editor.settings.brushSize / 2) * viewport.zoom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.stroke();
    // Zdroj razítka: křížek tam, odkud se právě bere (nebo zdrojový bod před prvním tahem).
    const src = this.source;
    if (this.usesSource && src && src.doc === editor.doc) {
      const off = this.current ? { dx: this.current.dx, dy: this.current.dy } : this.aligned ? this.offset : null;
      const at = off ? viewport.toScreen(pointer.x + off.dx, pointer.y + off.dy) : viewport.toScreen(src.x, src.y);
      target(ctx, at.x, at.y, 6);
    }
    ctx.restore();
  }

  createOptions(): ToolOptionsUI {
    const editor = this.editor;
    const size = new SliderField({ label: 'Velikost:', value: editor.settings.brushSize, min: 1, max: 500, unit: ' px', onInput: (v) => editor.updateSettings({ brushSize: v }) });
    const opacity = new SliderField({
      label: 'Krytí:',
      value: Math.round(editor.settings.brushOpacity * 100),
      min: 1,
      max: 100,
      unit: '%',
      onInput: (v) => editor.updateSettings({ brushOpacity: v / 100 }),
    });
    const disposers = [
      editor.on('settings', () => {
        size.setValue(editor.settings.brushSize);
        opacity.setValue(Math.round(editor.settings.brushOpacity * 100));
      }),
    ];
    const parts: Array<Node | null> = [size.element, blendModeSelect(this.blendMode, (v) => (this.blendMode = v))];
    // Retušování nemá krytí (výsledek se napojuje na okolí), bodové ani zarovnání (nemá zdroj).
    if (!this.heals) parts.push(opacity.element);
    if (this.mode !== 'spot') {
      parts.push(
        checkbox('Zarovnané', this.aligned, (v) => {
          this.aligned = v;
          this.offset = null;
        }),
      );
    }
    if (this.usesSource) {
      parts.push(selectField('Vzorek:', SAMPLE_MODES, this.sample, (v) => (this.sample = v as SampleMode)));
    } else if (this.mode === 'spot') {
      parts.push(checkbox('Vzorek všech vrstev', this.sample === 'all', (v) => (this.sample = v ? 'all' : 'current')));
    } else {
      const swatch = h('button', { type: 'button', class: 'pattern-swatch', title: 'Vzorek' });
      const paint = () => {
        const p = getPattern(this.patternId);
        swatch.style.background = patternCss(p);
        swatch.title = p ? `Vzorek: ${p.name}` : 'Vzorek';
      };
      paint();
      swatch.addEventListener('click', async () => {
        const id = await showPatternPicker(this.patternId);
        if (id) {
          this.patternId = id;
          paint();
        }
      });
      disposers.push(onPatternsChange(paint));
      parts.push(h('span', { class: 'opt-field' }, 'Vzorek:', swatch));
    }
    const element = h('div', { class: 'tool-options' }, ...parts);
    return { element, dispose: () => disposers.forEach((d) => d()) };
  }
}

/** Zaměřovač (zdroj razítka). */
function target(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  for (const [color, width] of [
    ['rgba(0,0,0,0.85)', 3],
    ['rgba(255,255,255,0.95)', 1],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x - r - 4, y);
    ctx.lineTo(x + r + 4, y);
    ctx.moveTo(x, y - r - 4);
    ctx.lineTo(x, y + r + 4);
    ctx.stroke();
  }
}

/** Pixely výřezu plátna (mimo plátno průhledné). */
function regionOf(canvas: HTMLCanvasElement, x: number, y: number, width: number, height: number): Uint8ClampedArray {
  return get2d(canvas).getImageData(x, y, width, height).data;
}
