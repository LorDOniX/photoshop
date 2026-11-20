import { Pipette } from 'lucide';
import { averageColor, toHex } from '../core/color';
import type { Editor } from '../core/Editor';
import { samplePixels, type SampleSource } from '../core/selection/raster';
import { checkbox, selectField } from '../ui/controls';
import { h } from '../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

type ColorSlot = 'color' | 'secondaryColor';

export interface EyedropperOptions {
  /** Strana čtverce vzorku v px (1 = bod). */
  sampleSize: number;
  source: SampleSource;
  /** Při tažení ukazovat kroužek s novou (nahoře) a předchozí (dole) barvou. */
  ring: boolean;
}

const SAMPLE_SIZES = [1, 3, 5, 11, 31];
const SOURCES: Array<{ value: SampleSource; label: string }> = [
  { value: 'layer', label: 'Aktuální vrstva' },
  { value: 'below', label: 'Aktuální a nižší' },
  { value: 'all', label: 'Všechny vrstvy' },
];

/**
 * Nabírání barvy z obrazu. Používá ho nástroj Kapátko a také štětec, plechovka a přechod
 * při Alt+kliknutí (tažením lze barvu vybírat průběžně).
 */
export class ColorPicker {
  readonly options: EyedropperOptions = { sampleSize: 1, source: 'all', ring: true };
  private session: { slot: ColorSlot; previous: string } | null = null;

  constructor(private readonly editor: Editor) {}

  get active(): boolean {
    return this.session !== null;
  }

  /** Barva v bodě dokumentu podle voleb (null = mimo plátno nebo průhledné). */
  sample(x: number, y: number): string | null {
    const { doc } = this.editor;
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return null;
    const img = samplePixels(doc, this.options.source);
    const c = averageColor(img.data, doc.width, doc.height, px, py, this.options.sampleSize);
    return c ? toHex(c) : null;
  }

  begin(p: ToolPointer, slot: ColorSlot): void {
    this.session = { slot, previous: this.editor.settings[slot] };
    this.move(p);
  }

  move(p: ToolPointer): void {
    const s = this.session;
    if (!s) return;
    const color = this.sample(p.x, p.y);
    if (color && color !== this.editor.settings[s.slot]) this.editor.updateSettings({ [s.slot]: color });
  }

  end(): void {
    this.session = null;
  }

  /** Kroužek kolem kurzoru: nahoře nově nabraná barva, dole původní. */
  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    const s = this.session;
    if (!s || !this.options.ring || !editor.pointer) return;
    const { x, y } = editor.viewport.toScreen(editor.pointer.x, editor.pointer.y);
    const r = 44;
    const w = 16;
    ctx.save();
    ctx.lineWidth = w;
    ctx.strokeStyle = editor.settings[s.slot];
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = s.previous;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(128,128,128,0.9)';
    for (const rr of [r - w / 2, r + w / 2]) {
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Kapátko (I): klik / tažení nastaví barvu popředí, s Alt barvu pozadí. */
export class EyedropperTool implements Tool {
  readonly id = 'eyedropper';
  readonly name = 'Kapátko';
  readonly icon = Pipette;
  readonly shortcut = 'I';
  readonly cursor = 'crosshair';
  readonly picker: ColorPicker;

  constructor(editor: Editor) {
    this.picker = new ColorPicker(editor);
  }

  pointerDown(p: ToolPointer): void {
    if (p.button === 0) this.picker.begin(p, p.altKey ? 'secondaryColor' : 'color');
  }

  pointerMove(p: ToolPointer): void {
    this.picker.move(p);
  }

  pointerUp(): void {
    this.picker.end();
  }

  deactivate(): void {
    this.picker.end();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    this.picker.drawOverlay(ctx, editor);
  }

  createOptions(): ToolOptionsUI {
    const o = this.picker.options;
    return {
      element: h(
        'div',
        { class: 'tool-options' },
        selectField(
          'Velikost vzorku:',
          SAMPLE_SIZES.map((n) => ({ value: String(n), label: n === 1 ? 'Bod' : `Průměr ${n} × ${n}` })),
          String(o.sampleSize),
          (v) => (o.sampleSize = Number(v)),
        ),
        selectField('Vzorek:', SOURCES, o.source, (v) => (o.source = v as SampleSource)),
        checkbox('Vzorkovací kroužek', o.ring, (v) => (o.ring = v)),
      ),
    };
  }
}

/**
 * Alt+klik v kreslicích nástrojích nabere barvu popředí (jako ve Photoshopu).
 * Vrací sdílený ColorPicker kapátka, nebo null, když kapátko není registrované.
 */
export function eyedropperOf(editor: Editor): ColorPicker | null {
  const tool = editor.tools.get('eyedropper');
  return tool instanceof EyedropperTool ? tool.picker : null;
}
