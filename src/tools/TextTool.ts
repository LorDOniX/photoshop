import { AlignCenter, AlignLeft, AlignRight, Check, Type, X } from 'lucide';
import { AddLayerCommand, MacroCommand, RemoveLayerCommand, SetLayerPropsCommand } from '../core/commands/layerCommands';
import { LayerStateCommand } from '../core/commands/stateCommands';
import type { Command } from '../core/History';
import type { Editor } from '../core/Editor';
import { captureLayer, type LayerState } from '../core/ImageDocument';
import { Layer } from '../core/Layer';
import {
  autoLayerName,
  cssFont,
  DEFAULT_TEXT,
  FONT_FAMILIES,
  FONT_STYLES,
  getTextData,
  padX,
  padY,
  positionForClick,
  renderText,
  type FontStyle,
  type TextAlign,
  type TextData,
} from '../core/text';
import { iconButton, segmented, selectField, separator, SliderField } from '../ui/controls';
import { h } from '../ui/dom';
import type { Tool, ToolOptionsUI, ToolPointer } from './Tool';

interface EditSession {
  layer: Layer;
  /** Nová vrstva – při zrušení nebo prázdném textu zmizí. */
  add: AddLayerCommand | null;
  /** Stav existující vrstvy před úpravou. */
  before: LayerState | null;
  beforeName: string;
  data: TextData;
  textarea: HTMLTextAreaElement;
  unsubscribe: () => void;
}

const ALIGNS: TextAlign[] = ['left', 'center', 'right'];

/**
 * Vodorovný text (T). Klik do plátna založí textovou vrstvu, klik na existující text ho upraví.
 * Píše se přímo na plátně (průhledné textové pole nad vykresleným textem). Ctrl/Cmd+Enter nebo ✓ = potvrdit,
 * Esc nebo ✗ = zrušit, klik mimo text = potvrdit. Změna voleb bez úprav změní aktivní textovou vrstvu.
 */
export class TextTool implements Tool {
  readonly id = 'text';
  readonly name = 'Vodorovný text';
  readonly icon = Type;
  readonly shortcut = 'T';
  readonly cursor = 'text';
  /** Výchozí písmo pro nový text (barva se bere z popředí). */
  style: Omit<TextData, 'content' | 'color'> = { ...DEFAULT_TEXT };
  private session: EditSession | null = null;
  private refreshOptions: (() => void) | null = null;

  constructor(private readonly editor: Editor) {
    // Výběr textové vrstvy načte její písmo do lišty voleb.
    editor.on('docChange', (c) => {
      if ((c.kind === 'active' || c.kind === 'structure') && !this.session) this.refreshOptions?.();
    });
    editor.on('document', () => this.refreshOptions?.());
  }

  get editing(): boolean {
    return this.session !== null;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    // Klik na plátno mimo textové pole rozpracovaný text potvrdí.
    if (this.session) this.commit();
    const hit = this.textLayerAt(p.x, p.y);
    if (hit) this.editLayer(hit.id);
    else this.createAt(p.x, p.y);
  }

  deactivate(): void {
    this.commit();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' && !this.session) {
      const layer = this.editor.doc.activeLayer;
      if (layer?.text) {
        this.editLayer(layer.id);
        return true;
      }
    }
    return false;
  }

  /** Nejvyšší viditelná textová vrstva pod bodem dokumentu. */
  private textLayerAt(x: number, y: number): Layer | null {
    const layers = this.editor.doc.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.visible && l.text && x >= l.x && y >= l.y && x < l.x + l.width && y < l.y + l.height) return l;
    }
    return null;
  }

  private currentStyle(): TextData {
    return { ...this.style, content: '', color: this.editor.settings.color };
  }

  /** Nová textová vrstva s účařím v bodě kliknutí. */
  createAt(x: number, y: number): void {
    const { editor } = this;
    const data = this.currentStyle();
    const canvas = renderText(data);
    const pos = positionForClick(x, y, data, canvas.width);
    const layer = new Layer(canvas.width, canvas.height, { name: 'Text', ...pos });
    layer.setCanvas(canvas);
    const active = editor.doc.activeLayerId;
    const add = new AddLayerCommand(editor.doc, layer, active ? editor.doc.indexOf(active) + 1 : editor.doc.layers.length, 'Vodorovný text');
    add.do();
    this.begin(layer, data, add, null);
  }

  /** Úprava existující textové vrstvy. */
  editLayer(id: string): void {
    const { editor } = this;
    if (this.session?.layer.id === id) return;
    this.commit();
    const layer = editor.doc.getLayer(id);
    const data = layer?.text;
    if (!layer || !data || editor.isLocked(layer, 'lockPixels')) return;
    if (editor.activeTool !== this) editor.setTool(this.id);
    editor.doc.setActive(id);
    editor.setMaskTarget(false);
    this.begin(layer, data, null, captureLayer(layer));
  }

  private begin(layer: Layer, data: TextData, add: AddLayerCommand | null, before: LayerState | null): void {
    const textarea = h('textarea', { class: 'text-editor', spellcheck: false, wrap: 'off' });
    textarea.value = data.content;
    textarea.addEventListener('input', () => this.update({ content: textarea.value }));
    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      } else if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.commit();
      }
    });
    textarea.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(textarea);
    const unsubscribe = this.editor.on('view', () => this.place());
    this.session = { layer, add, before, beforeName: layer.name, data: { ...data }, textarea, unsubscribe };
    this.place();
    this.refreshOptions?.();
    // Fokus zůstane i po dokončení kliknutí – CanvasView v tom případě ruší výchozí akci mousedown.
    textarea.focus();
    textarea.select();
    this.editor.notifyView();
  }

  /** Změna textu nebo písma během úprav – vrstva se překreslí naživo (bez historie). */
  private update(patch: Partial<TextData>): void {
    const s = this.session;
    if (!s) return;
    s.data = { ...s.data, ...patch };
    this.editor.doc.setLayerState(s.layer.id, this.editor.textLayerState(s.layer, s.data));
    this.place();
  }

  /** Umístí textové pole přesně nad vykreslený text (souřadnice obrazovky). */
  private place(): void {
    const s = this.session;
    const view = document.querySelector<HTMLCanvasElement>('.viewport-canvas');
    if (!s || !view) return;
    const { zoom } = this.editor.viewport;
    const r = view.getBoundingClientRect();
    const p = this.editor.viewport.toScreen(s.layer.x, s.layer.y);
    const d = s.data;
    Object.assign(s.textarea.style, {
      left: `${r.left + p.x}px`,
      top: `${r.top + p.y}px`,
      width: `${s.layer.width * zoom}px`,
      height: `${s.layer.height * zoom}px`,
      padding: `${padY(d) * zoom}px ${padX(d) * zoom}px`,
      font: cssFont(d, d.size * zoom),
      lineHeight: `${d.size * d.lineHeight * zoom}px`,
      textAlign: d.align,
      caretColor: d.color,
    });
    s.textarea.scrollLeft = 0;
    s.textarea.scrollTop = 0;
  }

  private end(): EditSession | null {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    s.unsubscribe();
    s.textarea.remove();
    this.refreshOptions?.();
    this.editor.notifyView();
    return s;
  }

  /** Potvrdí úpravy jako jeden krok historie. Prázdný text vrstvu odstraní. */
  commit(): void {
    const s = this.end();
    if (!s) return;
    const { editor } = this;
    const { doc } = editor;
    const empty = !s.data.content.trim();
    if (s.add) {
      if (empty) return s.add.undo();
      s.layer.name = autoLayerName(s.data.content);
      editor.history.push(s.add);
      return;
    }
    if (!s.before) return;
    if (empty) {
      doc.setLayerState(s.layer.id, s.before);
      editor.execute(new RemoveLayerCommand(doc, s.layer.id, 'Smazat text'));
      return;
    }
    if (s.layer.canvas === s.before.canvas) return;
    const cmds: Command[] = [new LayerStateCommand(doc, s.layer.id, s.before, captureLayer(s.layer), 'Upravit text')];
    // Název odvozený z textu se aktualizuje, ručně přejmenovaná vrstva si název nechá.
    const oldText = getTextData(s.before.canvas)?.content ?? null;
    const newName = autoLayerName(s.data.content);
    if (oldText !== null && s.beforeName === autoLayerName(oldText) && newName !== s.beforeName) {
      const rename = new SetLayerPropsCommand(doc, s.layer.id, { name: s.beforeName }, { name: newName }, 'Přejmenovat');
      rename.do();
      cmds.push(rename);
    }
    editor.history.push(cmds.length === 1 ? cmds[0] : new MacroCommand('Upravit text', cmds));
  }

  /** Zahodí rozpracované úpravy. */
  cancel(): void {
    const s = this.end();
    if (!s) return;
    if (s.add) s.add.undo();
    else if (s.before) this.editor.doc.setLayerState(s.layer.id, s.before);
  }

  drawOverlay(ctx: CanvasRenderingContext2D, editor: Editor): void {
    const s = this.session;
    if (!s) return;
    const a = editor.viewport.toScreen(s.layer.x, s.layer.y);
    const z = editor.viewport.zoom;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(s.layer.width * z), Math.round(s.layer.height * z));
    ctx.lineDashOffset = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(s.layer.width * z), Math.round(s.layer.height * z));
    ctx.restore();
  }

  /** Písmo, na které se volby právě vztahují: upravovaný text, aktivní textová vrstva, nebo výchozí. */
  private optionsSource(): { data: TextData; layerId: string | null } {
    if (this.session) return { data: this.session.data, layerId: this.session.layer.id };
    const layer = this.editor.doc.activeLayer;
    if (layer?.text) return { data: layer.text, layerId: layer.id };
    return { data: this.currentStyle(), layerId: null };
  }

  /** Změna volby: během úprav naživo, u aktivní textové vrstvy jako krok historie, jinak jen výchozí písmo. */
  private applyOption(patch: Partial<TextData>, label: string): void {
    const { color: _c, content: _t, ...stylePatch } = patch;
    Object.assign(this.style, stylePatch);
    if (this.session) {
      this.update(patch);
      this.session.textarea.focus();
      return;
    }
    const { data, layerId } = this.optionsSource();
    if (layerId) this.editor.setTextData(layerId, { ...data, ...patch }, label);
    else if (patch.color) this.editor.updateSettings({ color: patch.color });
  }

  createOptions(): ToolOptionsUI {
    const family = selectField(null, FONT_FAMILIES, this.style.family, (v) => this.applyOption({ family: v }, 'Písmo')) as HTMLSelectElement;
    const style = selectField(null, FONT_STYLES, this.style.style, (v) => this.applyOption({ style: v as FontStyle }, 'Řez písma')) as HTMLSelectElement;
    const size = new SliderField({
      label: 'Velikost:',
      value: this.style.size,
      min: 1,
      max: 999,
      unit: ' px',
      onCommit: (v) => this.applyOption({ size: v }, 'Velikost písma'),
    });
    const color = h('input', { type: 'color', class: 'color-input', title: 'Barva textu' });
    color.addEventListener('change', () => this.applyOption({ color: color.value }, 'Barva textu'));
    const lineHeight = new SliderField({
      label: 'Řádkování:',
      value: Math.round(this.style.lineHeight * 100),
      min: 50,
      max: 300,
      unit: '%',
      onCommit: (v) => this.applyOption({ lineHeight: v / 100 }, 'Řádkování'),
    });
    let alignButtons: HTMLElement | null = null;
    const alignHost = h('span', {});
    const renderAlign = (align: TextAlign) => {
      alignButtons = segmented(
        [
          { icon: AlignLeft, title: 'Zarovnat vlevo' },
          { icon: AlignCenter, title: 'Zarovnat na střed' },
          { icon: AlignRight, title: 'Zarovnat vpravo' },
        ],
        ALIGNS.indexOf(align),
        (i) => this.applyOption({ align: ALIGNS[i] }, 'Zarovnání textu'),
      );
      alignHost.replaceChildren(alignButtons);
    };

    const commit = iconButton(Check, 'Potvrdit (Ctrl+Enter)', () => this.commit());
    const cancel = iconButton(X, 'Zrušit (Esc)', () => this.cancel());
    // Tlačítka voleb nesmí vzít textovému poli fokus dřív, než se změna použije.
    for (const el of [commit, cancel]) el.addEventListener('pointerdown', (e) => e.preventDefault());

    const sync = () => {
      const { data } = this.optionsSource();
      family.value = data.family;
      style.value = data.style;
      size.setValue(Math.round(data.size));
      color.value = data.color;
      lineHeight.setValue(Math.round(data.lineHeight * 100));
      renderAlign(data.align);
      commit.disabled = cancel.disabled = !this.session;
    };
    this.refreshOptions = sync;
    const unsubscribe = this.editor.on('settings', () => {
      if (!this.optionsSource().layerId) sync();
    });
    sync();
    return {
      element: h(
        'div',
        { class: 'tool-options' },
        family,
        style,
        size.element,
        h('label', { class: 'opt-field' }, 'Barva:', color),
        lineHeight.element,
        alignHost,
        separator(),
        cancel,
        commit,
      ),
      dispose: () => {
        unsubscribe();
        if (this.refreshOptions === sync) this.refreshOptions = null;
      },
    };
  }
}
