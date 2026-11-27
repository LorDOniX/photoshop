import { get2d } from '../core/canvas';
import { averageColor, toHex } from '../core/color';
import type { Editor } from '../core/Editor';
import { measure } from '../core/measure';
import { ColorSamplerTool } from '../tools/ColorSamplerTool';
import { RulerTool } from '../tools/RulerTool';
import { h, rafThrottle } from './dom';

/*
 * Panel Info: barva složeného obrazu pod kurzorem (RGB, hex), poloha kurzoru, rozměry dokumentu a výběru,
 * hodnoty vzorkovačů barev a měření pravítka. Obnovuje se jednou za snímek a jen když je panel vidět.
 */

export class InfoPanel {
  readonly element: HTMLElement;
  private readonly color: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly position: HTMLElement;
  private readonly size: HTMLElement;
  private readonly selection: HTMLElement;
  private readonly extra: HTMLElement;

  constructor(
    private readonly editor: Editor,
    /** Složený obraz dokumentu v plném rozlišení (mezipaměť rendereru). */
    private readonly composite: () => HTMLCanvasElement,
  ) {
    this.chip = h('span', { class: 'color-chip info-chip' });
    this.color = h('span', { class: 'info-value' });
    this.position = h('span', { class: 'info-value' });
    this.size = h('span', { class: 'info-value' });
    this.selection = h('span', { class: 'info-value' });
    this.extra = h('div', { class: 'info-extra' });
    this.element = h(
      'div',
      { class: 'info-panel' },
      h('div', { class: 'info-row' }, h('span', { class: 'info-label' }, 'Barva'), this.chip, this.color),
      h('div', { class: 'info-row' }, h('span', { class: 'info-label' }, 'Poloha'), this.position),
      h('div', { class: 'info-row' }, h('span', { class: 'info-label' }, 'Rozměry'), this.size),
      h('div', { class: 'info-row' }, h('span', { class: 'info-label' }, 'Výběr'), this.selection),
      this.extra,
    );
    const update = rafThrottle(() => this.update());
    editor.on('view', update);
    editor.on('docChange', update);
    editor.on('document', update);
    editor.on('tool', update);
    this.update();
  }

  update(): void {
    if (!this.element.isConnected) return;
    const { editor } = this;
    const { doc, pointer } = editor;
    const inside = pointer && pointer.x >= 0 && pointer.y >= 0 && pointer.x < doc.width && pointer.y < doc.height;
    let rgb: { r: number; g: number; b: number } | null = null;
    if (inside) {
      const c = this.composite();
      if (c.width === doc.width && c.height === doc.height) {
        const d = get2d(c).getImageData(Math.floor(pointer.x), Math.floor(pointer.y), 1, 1).data;
        if (d[3]) rgb = { r: d[0], g: d[1], b: d[2] };
      }
    }
    this.chip.style.background = rgb ? toHex(rgb) : 'transparent';
    this.color.textContent = rgb ? `R ${rgb.r}  G ${rgb.g}  B ${rgb.b}   ${toHex(rgb)}` : inside ? 'průhledné' : '–';
    this.position.textContent = pointer ? `X ${Math.floor(pointer.x)}  Y ${Math.floor(pointer.y)}` : '–';
    const sel = doc.selection?.bounds();
    this.size.textContent = `${doc.width} × ${doc.height} px`;
    this.selection.textContent = sel ? `${sel.width} × ${sel.height}  (X ${sel.x}  Y ${sel.y})` : '–';

    const rows: HTMLElement[] = [];
    const sampler = editor.tools.get('color-sampler');
    if (sampler instanceof ColorSamplerTool) {
      sampler.samplers.forEach((s, i) => {
        // Ze všech vrstev = ze složeného obrazu rendereru (levné i během kreslení), jinak podle voleb vzorkovače.
        const c = sampler.source === 'all' ? this.average(s.x, s.y, sampler.sampleSize) : sampler.colorAt(s);
        rows.push(
          h(
            'div',
            { class: 'info-row' },
            h('span', { class: 'info-label' }, `#${i + 1}`),
            h('span', { class: 'color-chip info-chip', style: { background: c ? toHex(c) : 'transparent' } }),
            h('span', { class: 'info-value' }, c ? `R ${c.r}  G ${c.g}  B ${c.b}` : '–'),
          ),
        );
      });
    }
    const ruler = editor.tools.get('ruler');
    const line = ruler instanceof RulerTool ? ruler.line : null;
    if (line) {
      const m = measure(line);
      const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('cs-CZ');
      rows.push(
        h(
          'div',
          { class: 'info-row' },
          h('span', { class: 'info-label' }, 'Pravítko'),
          h('span', { class: 'info-value' }, `D ${fmt(m.length)}  Ú ${fmt(m.angle)}°  Š ${m.dx}  V ${m.dy}`),
        ),
      );
    }
    this.extra.replaceChildren(...rows);
  }

  /** Průměrná barva čtverce `size` × `size` složeného obrazu (null = mimo nebo průhledné). */
  private average(x: number, y: number, size: number): { r: number; g: number; b: number } | null {
    const c = this.composite();
    const half = Math.floor(size / 2);
    const x0 = Math.max(0, x - half);
    const y0 = Math.max(0, y - half);
    const x1 = Math.min(c.width, x + half + 1);
    const y1 = Math.min(c.height, y + half + 1);
    if (x1 <= x0 || y1 <= y0) return null;
    const d = get2d(c).getImageData(x0, y0, x1 - x0, y1 - y0).data;
    return averageColor(d, x1 - x0, y1 - y0, x - x0, y - y0, size);
  }
}
