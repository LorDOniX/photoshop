import { Crosshair } from 'lucide';
import { averageColor, toHex } from '../core/color';
import type { Editor } from '../core/Editor';
import type { ImageDocument } from '../core/ImageDocument';
import { samplePixels, type SampleSource } from '../core/selection/raster';
import { selectField, textButton } from '../ui/controls';
import { h } from '../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

/*
 * Vzorkovač barev (I): až MAX_SAMPLERS pevných bodů v dokumentu, u kterých se průběžně ukazuje barva (RGB a hex) –
 * v liště voleb a u značky na plátně. Klik přidá bod, tažení bodu ho posune, Alt+klik na bod ho smaže,
 * *Vymazat vše* smaže všechny. Body patří dokumentu (každá záložka má své), do historie se nezapisují.
 */

export const MAX_SAMPLERS = 4;

interface Sampler {
  x: number;
  y: number;
}

const SAMPLE_SIZES = [1, 3, 5, 11, 31];
const SOURCES: Array<{ value: SampleSource; label: string }> = [
  { value: 'layer', label: 'Aktuální vrstva' },
  { value: 'below', label: 'Aktuální a nižší' },
  { value: 'all', label: 'Všechny vrstvy' },
];

/** Vzdálenost (px obrazovky), do které klik zasáhne značku. */
const HIT = 8;

export class ColorSamplerTool implements Tool {
  readonly id = 'color-sampler';
  readonly name = 'Vzorkovač barev';
  readonly icon = Crosshair;
  readonly shortcut = 'I';
  readonly cursor = 'crosshair';
  sampleSize = 1;
  source: SampleSource = 'all';
  private readonly points = new WeakMap<ImageDocument, Sampler[]>();
  private dragging: Sampler | null = null;
  /** Lišta voleb – řádky s hodnotami (dokud je lišta zobrazená). */
  private readout: HTMLElement | null = null;
  private refreshTimer = 0;
  private lastRefresh = 0;

  constructor(private readonly editor: Editor) {}

  /** Body aktuálního dokumentu. */
  get samplers(): Sampler[] {
    const doc = this.editor.doc;
    let list = this.points.get(doc);
    if (!list) this.points.set(doc, (list = []));
    return list;
  }

  /** Barva v bodě (null = mimo plátno nebo průhledné). */
  colorAt(s: Sampler): { r: number; g: number; b: number } | null {
    const { doc } = this.editor;
    if (s.x < 0 || s.y < 0 || s.x >= doc.width || s.y >= doc.height) return null;
    const img = samplePixels(doc, this.source);
    return averageColor(img.data, doc.width, doc.height, s.x, s.y, this.sampleSize);
  }

  private hit(p: ToolPointer): Sampler | null {
    const { viewport } = this.editor;
    for (const s of this.samplers) {
      const at = viewport.toScreen(s.x + 0.5, s.y + 0.5);
      if (Math.hypot(at.x - p.screenX, at.y - p.screenY) <= HIT) return s;
    }
    return null;
  }

  cursorAt(p: ToolPointer): string | null {
    return this.hit(p) ? (p.altKey ? 'pointer' : 'move') : null;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const list = this.samplers;
    const hit = this.hit(p);
    if (hit) {
      if (p.altKey) {
        list.splice(list.indexOf(hit), 1);
        this.changed();
      } else this.dragging = hit;
      return;
    }
    if (p.altKey) return;
    const { doc } = this.editor;
    if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
    if (list.length >= MAX_SAMPLERS) {
      this.editor.notice(`Vzorkovačů může být nejvýš ${MAX_SAMPLERS} – přesuňte nebo smažte (Alt+klik) některý z nich.`);
      return;
    }
    const s = { x: Math.floor(p.x), y: Math.floor(p.y) };
    list.push(s);
    this.dragging = s;
    this.changed();
  }

  pointerMove(p: ToolPointer): void {
    const s = this.dragging;
    if (!s) return;
    const { doc } = this.editor;
    const x = Math.min(doc.width - 1, Math.max(0, Math.floor(p.x)));
    const y = Math.min(doc.height - 1, Math.max(0, Math.floor(p.y)));
    if (x === s.x && y === s.y) return;
    s.x = x;
    s.y = y;
    this.changed();
  }

  pointerUp(): void {
    this.dragging = null;
  }

  deactivate(): void {
    this.dragging = null;
  }

  clear(): void {
    this.samplers.length = 0;
    this.changed();
  }

  private changed(): void {
    this.refresh();
    this.editor.notifyView();
  }

  /** Přepíše hodnoty v liště. */
  private refresh(): void {
    window.clearTimeout(this.refreshTimer);
    this.lastRefresh = performance.now();
    const el = this.readout;
    if (!el) return;
    el.replaceChildren(
      ...this.samplers.map((s, i) => {
        const c = this.colorAt(s);
        return h(
          'span',
          { class: 'sampler-readout' },
          h('span', { class: 'color-chip', style: { background: c ? toHex(c) : 'transparent' } }),
          c ? `#${i + 1}  R ${c.r}  G ${c.g}  B ${c.b}` : `#${i + 1}  –`,
        );
      }),
    );
  }

  /** Při změně obrazu obnovit hodnoty nejvýš 4× za sekundu (složení celého dokumentu není zadarmo). */
  private scheduleRefresh(): void {
    if (!this.samplers.length) return;
    const wait = 250 - (performance.now() - this.lastRefresh);
    window.clearTimeout(this.refreshTimer);
    if (wait <= 0) this.refresh();
    else this.refreshTimer = window.setTimeout(() => this.refresh(), wait);
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';
    this.samplers.forEach((s, i) => {
      const { x, y } = editor.viewport.toScreen(s.x + 0.5, s.y + 0.5);
      for (const [color, width] of [
        ['rgba(0,0,0,0.85)', 3],
        ['rgba(255,255,255,0.95)', 1],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.moveTo(x - 9, y);
        ctx.lineTo(x + 9, y);
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x, y + 9);
        ctx.stroke();
      }
      const label = String(i + 1);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(label, x + 8, y + 9);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 8, y + 9);
    });
    ctx.restore();
  }

  createOptions(): ToolOptionsUI {
    const editor = this.editor;
    this.readout = h('span', { class: 'sampler-readouts' });
    const disposers = [
      editor.on('docChange', () => this.scheduleRefresh()),
      editor.on('document', () => this.refresh()),
    ];
    const element = h(
      'div',
      { class: 'tool-options' },
      selectField(
        'Velikost vzorku:',
        SAMPLE_SIZES.map((n) => ({ value: String(n), label: n === 1 ? 'Bod' : `Průměr ${n} × ${n}` })),
        String(this.sampleSize),
        (v) => {
          this.sampleSize = Number(v);
          this.refresh();
        },
      ),
      selectField('Vzorek:', SOURCES, this.source, (v) => {
        this.source = v as SampleSource;
        this.refresh();
      }),
      textButton('Vymazat vše', () => this.clear()),
      this.readout,
    );
    this.refresh();
    return {
      element,
      dispose: () => {
        disposers.forEach((d) => d());
        window.clearTimeout(this.refreshTimer);
        this.readout = null;
      },
    };
  }
}
