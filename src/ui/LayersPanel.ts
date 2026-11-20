import { Brush, ChevronDown, CornerLeftDown, ChevronRight, Contrast, Eye, FilePlus, Folder, FolderOpen, Grid2x2, Link2, Lock, Move, SquareDot, Trash2 } from 'lucide';
import type { Editor } from '../core/Editor';
import { clippingBase, depthOf, isClippingBase, type DropPosition } from '../core/groups';
import { BLEND_MODES, LOCK_KINDS, type BlendMode, type Layer, type LayerProps, type LockKind } from '../core/Layer';
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
  /** Krytí vybraných vrstev před tažením posuvníku. */
  private opacityBefore: Map<string, Partial<LayerProps>> | null = null;
  private dragId: string | null = null;
  /** Id zobrazených řádků shora dolů (pro výběr rozsahu se Shift). */
  private rowOrder: string[] = [];
  /** Tlačítka zámků (platí pro vybrané vrstvy); „vše“ zapne všechny tři zámky. */
  private readonly lockButtons = (
    [
      [Grid2x2, 'Zamknout průhledné pixely', ['lockTransparency']],
      [Brush, 'Zamknout obrazové pixely', ['lockPixels']],
      [Move, 'Zamknout pozici', ['lockPosition']],
      [Lock, 'Zamknout vše', LOCK_KINDS],
    ] as const
  ).map(([iconNode, title, kinds]) => {
    const button = toggleButton(iconNode, title, false, () => {
      const layer = this.editor.doc.activeLayer;
      if (!layer) return;
      const on = !kinds.every((k) => layer[k]);
      const patch: Partial<Record<LockKind, boolean>> = {};
      for (const k of kinds) patch[k] = on;
      this.editor.setLocks(patch, on ? title : title.replace('Zamknout', 'Odemknout'));
    });
    return { button, kinds };
  });

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
    // Režim a krytí platí pro všechny vybrané vrstvy.
    this.blend.addEventListener('change', () => editor.setSelectionProps({ blendMode: this.blend.value as BlendMode }, 'Režim prolnutí'));

    // Během tažení se krytí mění naživo, do historie jde jen výsledná hodnota.
    this.opacity = new SliderField({
      label: 'Krytí:',
      value: 100,
      min: 0,
      max: 100,
      unit: '%',
      onInput: (v) => {
        const layers = editor.selectedRoots();
        if (!layers.length) return;
        this.opacityBefore ??= new Map(layers.map((l) => [l.id, { opacity: l.opacity }]));
        for (const l of layers) editor.doc.updateLayer(l.id, { opacity: v / 100 });
      },
      onCommit: () => {
        if (this.opacityBefore) editor.commitSelectionProps(this.opacityBefore, 'Krytí vrstvy');
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
        ...this.lockButtons.map((b) => b.button),
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
        iconButton(Folder, 'Nová skupina', run('layer.newGroup')),
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
    for (const { button, kinds } of this.lockButtons) {
      button.classList.toggle('active', !!active && kinds.every((k) => active[k]));
      button.disabled = !active;
    }

    this.thumbs.clear();
    this.maskThumbs.clear();
    // Shora dolů; vrstvy ve sbalené skupině se nezobrazují.
    const byId = new Map(doc.layers.map((l) => [l.id, l]));
    const hiddenByCollapse = (layer: Layer) => {
      for (let p = layer.parentId, guard = 0; p && guard < 100; guard++) {
        const parent = byId.get(p);
        if (!parent) break;
        if (parent.collapsed) return true;
        p = parent.parentId;
      }
      return false;
    };
    const shown = [...doc.layers].reverse().filter((layer) => !hiddenByCollapse(layer));
    this.rowOrder = shown.map((l) => l.id);
    const rows = shown.map((layer) => this.renderRow(layer, layer.id === doc.activeLayerId, depthOf(doc.layers, layer.id)));
    this.list.replaceChildren(...rows);
  }

  private renderRow(layer: Layer, active: boolean, depth: number): HTMLElement {
    const { editor } = this;
    if (layer.isGroup) return this.renderGroupRow(layer, active, depth);
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
      // Shift+klik nechá výběr rozsahu na řádku; prostý klik vybere vrstvu a cíl „pixely“.
      if (e.shiftKey) return;
      editor.doc.setActive(layer.id);
      editor.setMaskTarget(false);
    });
    if (layer.text) {
      thumb.title = 'Textová vrstva – dvojklik = upravit text';
      thumb.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        editor.actions.run('text.edit');
      });
    }
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

    const base = isClippingBase(editor.doc.layers, layer.id);
    const name = h('span', { class: `layer-name${base ? ' clip-base' : ''}`, title: 'Dvojklikem přejmenujete' }, layer.name);
    name.addEventListener('dblclick', () => this.startRename(layer, name));
    // Ořezaná vrstva má místo odsazení šipku k základní vrstvě (jako ve Photoshopu).
    const clippedTo = clippingBase(editor.doc.layers, layer.id);
    const indent = h(
      'span',
      { class: `layer-indent${clippedTo ? ' clip-arrow' : ''}`, style: { width: `${depth * 16 + 16}px` }, title: clippedTo ? `Ořezáno do vrstvy „${clippedTo.name}“` : undefined },
      clippedTo ? icon(CornerLeftDown, 14) : null,
    );

    const row = h(
      'div',
      {
        class: `layer-row${active ? ' active' : ''}${this.selectedClass(layer)}${layer.visible ? '' : ' hidden'}`,
        draggable: 'true',
        onClick: (e: MouseEvent) => this.selectRow(layer.id, e),
      },
      eye,
      indent,
      thumb,
      maskThumb,
      name,
      layer.opacity < 1 ? h('span', { class: 'badge' }, `${Math.round(layer.opacity * 100)} %`) : null,
      this.lockBadge(layer),
    );

    this.attachRowEvents(row, layer);
    return row;
  }

  /** Řádek skupiny: šipka sbalení, ikona složky, název. */
  private renderGroupRow(layer: Layer, active: boolean, depth: number): HTMLElement {
    const { editor } = this;
    const eye = h(
      'button',
      {
        class: 'eye',
        type: 'button',
        title: layer.visible ? 'Skrýt skupinu' : 'Zobrazit skupinu',
        onClick: (e: Event) => {
          e.stopPropagation();
          editor.setLayerProps(layer.id, { visible: !layer.visible }, layer.visible ? 'Skrýt skupinu' : 'Zobrazit skupinu');
        },
      },
      layer.visible ? icon(Eye, 15) : null,
    );
    const toggle = h(
      'button',
      {
        class: 'group-toggle',
        type: 'button',
        title: layer.collapsed ? 'Rozbalit skupinu' : 'Sbalit skupinu',
        onClick: (e: Event) => {
          e.stopPropagation();
          editor.toggleCollapsed(layer.id);
        },
      },
      icon(layer.collapsed ? ChevronRight : ChevronDown, 14),
    );
    const folder = h('span', { class: 'group-icon', title: 'Ctrl+klik = vybrat pixely skupiny' }, icon(layer.collapsed ? Folder : FolderOpen, 18));
    folder.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.stopPropagation();
      editor.selectLayerPixels(layer.id);
    });
    const name = h('span', { class: 'layer-name', title: 'Dvojklikem přejmenujete' }, layer.name);
    name.addEventListener('dblclick', () => this.startRename(layer, name));
    const row = h(
      'div',
      {
        class: `layer-row group-row${active ? ' active' : ''}${this.selectedClass(layer)}${layer.visible ? '' : ' hidden'}`,
        draggable: 'true',
        onClick: (e: MouseEvent) => this.selectRow(layer.id, e),
      },
      eye,
      h('span', { class: 'layer-indent', style: { width: `${depth * 16}px` } }),
      toggle,
      folder,
      name,
      layer.opacity < 1 ? h('span', { class: 'badge' }, `${Math.round(layer.opacity * 100)} %`) : null,
      this.lockBadge(layer),
    );
    this.attachRowEvents(row, layer);
    return row;
  }

  /** Ikona zámku v řádku (plný zámek = vše, jinak částečný). */
  private lockBadge(layer: Layer): HTMLElement | null {
    const locked = LOCK_KINDS.filter((k) => layer[k]);
    if (!locked.length) return null;
    const full = locked.length === LOCK_KINDS.length;
    return h('span', { class: `lock-badge${full ? '' : ' partial'}`, title: full ? 'Zamčeno' : 'Částečně zamčeno' }, icon(Lock, 12));
  }

  private selectedClass(layer: Layer): string {
    const doc = this.editor.doc;
    return layer.id !== doc.activeLayerId && doc.isSelected(layer.id) ? ' selected' : '';
  }

  /**
   * Klik na řádek: vybere jen tuto vrstvu; Ctrl/Cmd+klik přidá / odebere vrstvu z výběru,
   * Shift+klik vybere rozsah od aktivní vrstvy (jako ve Photoshopu).
   */
  private selectRow(id: string, e: MouseEvent): void {
    const doc = this.editor.doc;
    const active = doc.activeLayerId;
    if ((e.ctrlKey || e.metaKey) && active) {
      const ids = doc.selectedLayerIds;
      if (doc.isSelected(id)) {
        const rest = ids.filter((x) => x !== id);
        if (!rest.length) return;
        doc.setLayerSelection(rest, id === active ? rest[rest.length - 1] : active);
      } else doc.setLayerSelection([...ids, id], id);
      return;
    }
    if (e.shiftKey && active) {
      const a = this.rowOrder.indexOf(active);
      const b = this.rowOrder.indexOf(id);
      if (a >= 0 && b >= 0) {
        doc.setLayerSelection(this.rowOrder.slice(Math.min(a, b), Math.max(a, b) + 1), id);
        return;
      }
    }
    doc.setActive(id);
  }

  /** Kontextové menu a přetahování řádku (nad / pod vrstvu, u skupiny i dovnitř). */
  private attachRowEvents(row: HTMLElement, layer: Layer): void {
    const { editor } = this;
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Pravé tlačítko na vybrané vrstvě výběr více vrstev zachová (menu pak platí pro všechny).
      if (!editor.doc.isSelected(layer.id)) editor.doc.setActive(layer.id);
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
      this.clearDropMarks();
    });
    row.addEventListener('dragover', (e) => {
      if (!this.dragId) return;
      e.preventDefault();
      const pos = this.dropPosition(row, layer, e);
      row.classList.toggle('drop-above', pos === 'above');
      row.classList.toggle('drop-below', pos === 'below');
      row.classList.toggle('drop-into', pos === 'into');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below', 'drop-into'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const dragId = this.dragId;
      this.clearDropMarks();
      if (!dragId || dragId === layer.id) return;
      editor.moveLayerTo(dragId, layer.id, this.dropPosition(row, layer, e));
    });
  }

  private clearDropMarks(): void {
    this.list.querySelectorAll('.drop-above, .drop-below, .drop-into').forEach((el) => el.classList.remove('drop-above', 'drop-below', 'drop-into'));
  }

  /** Horní část řádku = nad, dolní = pod; prostředek řádku skupiny (u rozbalené i spodek) = do skupiny. */
  private dropPosition(el: HTMLElement, layer: Layer, e: DragEvent): DropPosition {
    const r = el.getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    if (!layer.isGroup) return t < 0.5 ? 'above' : 'below';
    if (t < 0.3) return 'above';
    return layer.collapsed && t > 0.7 ? 'below' : 'into';
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

  /** Náhled vrstvy v kontextu plátna dokumentu (vč. posunu). Textová vrstva má značku „T“ jako ve Photoshopu. */
  private drawThumb(layer: Layer, thumb: HTMLCanvasElement): void {
    const ctx = thumb.getContext('2d');
    if (!ctx) return;
    if (layer.text) {
      const tw = THUMB_W * THUMB_SCALE;
      const th = THUMB_H * THUMB_SCALE;
      ctx.clearRect(0, 0, tw, th);
      ctx.fillStyle = '#d9d9d9';
      ctx.fillRect(tw / 2 - th / 2, 0, th, th);
      ctx.fillStyle = '#222';
      ctx.font = `bold ${Math.round(th * 0.7)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('T', tw / 2, th / 2 + 1);
      return;
    }
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
