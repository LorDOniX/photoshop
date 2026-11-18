import { Brush, Contrast, Eye, FilePlus, Folder, Grid2x2, Link2, Lock, Move, SquareDot, Trash2 } from 'lucide';
import type { Editor } from '../core/Editor';
import { BLEND_MODES, type BlendMode, type Layer } from '../core/Layer';
import { drawMaskPreview } from '../core/mask';
import { iconButton, SliderField, toggleButton } from './controls';
import { h, rafThrottle } from './dom';
import { icon } from './icons';
import { showContextMenu, type MenuItem } from './Menu';

const THUMB_W = 34;
const THUMB_H = 24;
const THUMB_SCALE = 2;

export class LayersPanel {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly blend: HTMLSelectElement;
  private readonly opacity: SliderField;
  private readonly thumbs = new Map<string, HTMLCanvasElement>();
  private readonly maskThumbs = new Map<string, HTMLCanvasElement>();
  private readonly dirtyThumbs = new Set<string>();
  private opacityBefore: number | null = null;
  private dragId: string | null = null;

  constructor(
    private readonly editor: Editor,
    /** Kontextová menu vrstvy a její masky (pravé tlačítko). */
    private readonly menus: { row: MenuItem[]; mask: MenuItem[] } = { row: [], mask: [] },
  ) {
    this.blend = h(
      'select',
      { class: 'opt-select blend-select', title: 'Režim prolnutí' },
      ...BLEND_MODES.flatMap((m, i) => [
        i > 0 && BLEND_MODES[i - 1].group !== m.group ? h('option', { disabled: true }, '──────────') : null,
        h('option', { value: m.value }, m.label),
      ]),
    );
    this.blend.addEventListener('change', () => {
      const layer = editor.doc.activeLayer;
      if (layer) editor.setLayerProps(layer.id, { blendMode: this.blend.value as BlendMode }, 'Režim prolnutí');
    });

    // Během tažení se krytí mění naživo, do historie jde jen výsledná hodnota.
    this.opacity = new SliderField({
      label: 'Krytí:',
      value: 100,
      min: 0,
      max: 100,
      unit: '%',
      onInput: (v) => {
        const layer = editor.doc.activeLayer;
        if (!layer) return;
        this.opacityBefore ??= layer.opacity;
        editor.doc.updateLayer(layer.id, { opacity: v / 100 });
      },
      onCommit: () => {
        const layer = editor.doc.activeLayer;
        if (layer && this.opacityBefore !== null && this.opacityBefore !== layer.opacity) {
          editor.commitLayerProps(layer.id, { opacity: this.opacityBefore }, { opacity: layer.opacity }, 'Krytí vrstvy');
        }
        this.opacityBefore = null;
      },
    });

    this.list = h('div', { class: 'layer-list' });

    const run = (action: string) => () => editor.actions.run(action);
    const todo = (title: string) => `${title} – připravujeme`;

    this.element = h(
      'div',
      { class: 'layers-panel' },
      h('div', { class: 'layer-controls' }, this.blend, this.opacity.element),
      h(
        'div',
        { class: 'layer-controls' },
        h('span', { class: 'muted' }, 'Zámek:'),
        toggleButton(Grid2x2, todo('Zamknout průhledné pixely')),
        toggleButton(Brush, todo('Zamknout obrazové pixely')),
        toggleButton(Move, todo('Zamknout pozici')),
        toggleButton(Lock, todo('Zamknout vše')),
        h('span', { class: 'flex-spacer' }),
        new SliderField({ label: 'Výplň:', value: 100, min: 0, max: 100, unit: '%' }).element,
      ),
      this.list,
      h(
        'footer',
        { class: 'panel-footer' },
        iconButton(Link2, todo('Propojit vrstvy')),
        h('button', { class: 'icon-btn fx-btn', type: 'button', title: todo('Styly vrstvy') }, 'eff'),
        iconButton(SquareDot, 'Přidat masku vrstvy (z výběru, je-li nějaký; Alt = skrýt)', (e) =>
          editor.actions.run(editor.doc.selection ? (e.altKey ? 'mask.hideSelection' : 'mask.revealSelection') : e.altKey ? 'mask.hideAll' : 'mask.revealAll'),
        ),
        iconButton(Contrast, todo('Nová vrstva úprav')),
        iconButton(Folder, todo('Nová skupina')),
        iconButton(FilePlus, 'Nová vrstva', run('layer.new')),
        iconButton(Trash2, 'Smazat vrstvu', run('layer.delete')),
      ),
    );

    const rebuild = rafThrottle(() => this.render());
    const refreshThumbs = rafThrottle(() => this.refreshThumbs());
    editor.on('document', rebuild);
    editor.on('target', rebuild);
    editor.on('docChange', (c) => {
      if (c.kind === 'selection') return;
      if (c.kind === 'pixels') {
        this.dirtyThumbs.add(c.layerId);
        refreshThumbs();
      } else rebuild();
    });
    this.render();
  }

  private render(): void {
    const { doc } = this.editor;
    const active = doc.activeLayer;
    this.blend.value = active?.blendMode ?? 'source-over';
    this.blend.disabled = !active;
    this.opacity.setValue(Math.round((active?.opacity ?? 1) * 100));
    this.opacity.disabled = !active;

    this.thumbs.clear();
    this.maskThumbs.clear();
    const rows = [...doc.layers].reverse().map((layer) => this.renderRow(layer, layer.id === doc.activeLayerId));
    this.list.replaceChildren(...rows);
  }

  private renderRow(layer: Layer, active: boolean): HTMLElement {
    const { editor } = this;
    const targeted = active ? (editor.maskTarget ? 'mask' : 'pixels') : null;
    const thumb = h('canvas', {
      class: `thumb${targeted === 'pixels' && layer.mask ? ' targeted' : ''}`,
      width: THUMB_W * THUMB_SCALE,
      height: THUMB_H * THUMB_SCALE,
      title: 'Klik = upravovat pixely, Ctrl+klik = vybrat pixely vrstvy',
    });
    thumb.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.stopPropagation();
        editor.selectLayerPixels(layer.id);
        return;
      }
      editor.doc.setActive(layer.id);
      editor.setMaskTarget(false);
    });
    this.thumbs.set(layer.id, thumb);
    this.drawThumb(layer, thumb);

    let maskThumb: HTMLCanvasElement | null = null;
    if (layer.mask) {
      maskThumb = h('canvas', {
        class: `thumb mask-thumb${targeted === 'mask' ? ' targeted' : ''}${layer.maskEnabled ? '' : ' mask-off'}`,
        width: THUMB_W * THUMB_SCALE,
        height: THUMB_H * THUMB_SCALE,
        title: 'Maska vrstvy – klik = upravovat masku, Shift+klik = zapnout/vypnout, Ctrl+klik = výběr z masky',
      });
      const wrap = maskThumb;
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.doc.setActive(layer.id);
        if (e.ctrlKey || e.metaKey) editor.selectionFromMask(layer.id);
        else if (e.shiftKey) editor.toggleMask();
        else editor.setMaskTarget(true);
      });
      wrap.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editor.doc.setActive(layer.id);
        editor.setMaskTarget(true);
        if (this.menus.mask.length) showContextMenu(editor.actions, this.menus.mask, e.clientX, e.clientY);
      });
      this.maskThumbs.set(layer.id, maskThumb);
      this.drawMaskThumb(layer, maskThumb);
    }

    const eye = h(
      'button',
      {
        class: 'eye',
        type: 'button',
        title: layer.visible ? 'Skrýt vrstvu' : 'Zobrazit vrstvu',
        onClick: (e: Event) => {
          e.stopPropagation();
          editor.setLayerProps(layer.id, { visible: !layer.visible }, layer.visible ? 'Skrýt vrstvu' : 'Zobrazit vrstvu');
        },
      },
      layer.visible ? icon(Eye, 15) : null,
    );

    const name = h('span', { class: 'layer-name', title: 'Dvojklikem přejmenujete' }, layer.name);
    name.addEventListener('dblclick', () => this.startRename(layer, name));

    const row = h(
      'div',
      {
        class: `layer-row${active ? ' active' : ''}${layer.visible ? '' : ' hidden'}`,
        draggable: 'true',
        onClick: () => editor.doc.setActive(layer.id),
      },
      eye,
      thumb,
      maskThumb,
      name,
      layer.opacity < 1 ? h('span', { class: 'badge' }, `${Math.round(layer.opacity * 100)} %`) : null,
    );

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      editor.doc.setActive(layer.id);
      if (this.menus.row.length) showContextMenu(editor.actions, this.menus.row, e.clientX, e.clientY);
    });
    row.addEventListener('dragstart', (e) => {
      this.dragId = layer.id;
      e.dataTransfer?.setData('text/plain', layer.id);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      this.dragId = null;
      row.classList.remove('dragging');
      this.list.querySelectorAll('.drop-above, .drop-below').forEach((el) => el.classList.remove('drop-above', 'drop-below'));
    });
    row.addEventListener('dragover', (e) => {
      if (!this.dragId) return;
      e.preventDefault();
      const above = this.isUpperHalf(row, e);
      row.classList.toggle('drop-above', above);
      row.classList.toggle('drop-below', !above);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const dragId = this.dragId;
      if (!dragId || dragId === layer.id) return;
      const doc = editor.doc;
      const from = doc.indexOf(dragId);
      let target = doc.indexOf(layer.id) + (this.isUpperHalf(row, e) ? 1 : 0);
      if (from < target) target -= 1;
      editor.moveLayer(dragId, target);
    });
    return row;
  }

  private isUpperHalf(el: HTMLElement, e: DragEvent): boolean {
    const r = el.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  }

  private startRename(layer: Layer, nameEl: HTMLElement): void {
    const input = h('input', { class: 'rename', value: layer.name });
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (commit && value && value !== layer.name) this.editor.setLayerProps(layer.id, { name: value }, 'Přejmenovat vrstvu');
      else input.replaceWith(nameEl);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  private refreshThumbs(): void {
    for (const id of this.dirtyThumbs) {
      const layer = this.editor.doc.getLayer(id);
      const thumb = this.thumbs.get(id);
      const maskThumb = this.maskThumbs.get(id);
      if (layer && thumb) this.drawThumb(layer, thumb);
      if (layer && maskThumb) this.drawMaskThumb(layer, maskThumb);
    }
    this.dirtyThumbs.clear();
  }

  /** Umístění vrstvy v náhledu (náhled zobrazuje celé plátno dokumentu). */
  private thumbGeometry(layer: Layer) {
    const { width, height } = this.editor.doc;
    const tw = THUMB_W * THUMB_SCALE;
    const th = THUMB_H * THUMB_SCALE;
    const scale = Math.min(tw / width, th / height);
    const w = width * scale;
    const hgt = height * scale;
    const ox = (tw - w) / 2;
    const oy = (th - hgt) / 2;
    return { tw, th, scale, w, hgt, ox, oy, lx: ox + layer.x * scale, ly: oy + layer.y * scale };
  }

  /** Náhled masky: bílá = odkryto, černá = skryto (mimo vrstvu šedě). */
  private drawMaskThumb(layer: Layer, thumb: HTMLCanvasElement): void {
    const ctx = thumb.getContext('2d');
    if (!ctx || !layer.mask) return;
    const g = this.thumbGeometry(layer);
    ctx.clearRect(0, 0, g.tw, g.th);
    ctx.fillStyle = '#808080';
    ctx.fillRect(g.ox, g.oy, g.w, g.hgt);
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.ox, g.oy, g.w, g.hgt);
    ctx.clip();
    drawMaskPreview(ctx, layer.mask, g.lx, g.ly, layer.width * g.scale, layer.height * g.scale);
    ctx.restore();
    if (!layer.maskEnabled) {
      ctx.strokeStyle = '#e53935';
      ctx.lineWidth = 3 * THUMB_SCALE;
      ctx.beginPath();
      ctx.moveTo(g.ox, g.oy);
      ctx.lineTo(g.ox + g.w, g.oy + g.hgt);
      ctx.moveTo(g.ox + g.w, g.oy);
      ctx.lineTo(g.ox, g.oy + g.hgt);
      ctx.stroke();
    }
  }

  /** Náhled vrstvy v kontextu plátna dokumentu (vč. posunu). */
  private drawThumb(layer: Layer, thumb: HTMLCanvasElement): void {
    const ctx = thumb.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.editor.doc;
    const tw = THUMB_W * THUMB_SCALE;
    const th = THUMB_H * THUMB_SCALE;
    const scale = Math.min(tw / width, th / height);
    const w = width * scale;
    const hgt = height * scale;
    const ox = (tw - w) / 2;
    const oy = (th - hgt) / 2;
    ctx.clearRect(0, 0, tw, th);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, w, hgt);
    ctx.fillStyle = '#d0d0d0';
    const cell = 4 * THUMB_SCALE;
    for (let y = 0; y < hgt; y += cell) {
      for (let x = (Math.floor(y / cell) % 2) * cell; x < w; x += cell * 2) ctx.fillRect(ox + x, oy + y, cell, cell);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, w, hgt);
    ctx.clip();
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(layer.canvas, ox + layer.x * scale, oy + layer.y * scale, layer.width * scale, layer.height * scale);
    ctx.restore();
  }
}
