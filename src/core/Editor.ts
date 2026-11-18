import { AddLayerCommand, MacroCommand, MoveLayerCommand, PaintCommand, RemoveLayerCommand, SetLayerPropsCommand } from './commands/layerCommands';
import { CropCommand, SetSelectionCommand } from './commands/selectionCommands';
import { clipRect, createCanvas, get2d, type Rect } from './canvas';
import { Emitter } from './Emitter';
import { History, type Command } from './History';
import { createBlankDocument, type DocChange, type ImageDocument } from './ImageDocument';
import { Layer, type LayerProps } from './Layer';
import { extractPixels, layerAlphaMask, maskToCanvas } from './selection/raster';
import { SelectionMask, type SelectionMode } from './selection/SelectionMask';
import { Viewport } from './Viewport';
import { ActionRegistry } from './actions';
import { flattenDocument } from '../render/composite';
import { ToolRegistry, type Tool } from '../tools/Tool';

export interface EditorSettings {
  /** Barva popředí. */
  color: string;
  /** Barva pozadí. */
  secondaryColor: string;
  brushSize: number;
  /** 0..1 */
  brushOpacity: number;
}

interface EditorEvents {
  /** Dokument byl nahrazen jiným (nový / otevřený). */
  document: ImageDocument;
  docChange: DocChange;
  history: void;
  tool: Tool;
  /** Změna pohledu nebo pozice kurzoru – stačí překreslit. */
  view: void;
  settings: EditorSettings;
  selectionOptions: SelectionOptions;
}

/** Centrální stav aplikace – dokument, historie, pohled, nástroje a akce. */
export class Editor extends Emitter<EditorEvents> {
  doc: ImageDocument;
  fileName = 'bez-nazvu';
  readonly history = new History();
  readonly viewport = new Viewport();
  readonly tools = new ToolRegistry();
  readonly actions = new ActionRegistry();
  activeTool: Tool | null = null;
  /** Pozice kurzoru nad plátnem v souřadnicích dokumentu. */
  pointer: { x: number; y: number } | null = null;
  settings: EditorSettings = { color: '#000000', secondaryColor: '#ffffff', brushSize: 20, brushOpacity: 1 };
  selectionOptions: SelectionOptions = { ...DEFAULT_SELECTION_OPTIONS };
  /** Schránka aplikace (Ctrl+C / Ctrl+V) – pixely i s pozicí v dokumentu. */
  clipboard: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;
  /** Poslední zrušený výběr pro „Znovu vybrat“. */
  private lastSelection: SelectionMask | null = null;

  private unsubscribeDoc: (() => void) | null = null;
  private layerCounter = 1;

  constructor() {
    super();
    this.doc = createBlankDocument(1200, 800, '#ffffff');
    this.bindDocument();
    this.history.on('change', () => this.emit('history'));
  }

  private bindDocument(): void {
    this.unsubscribeDoc?.();
    this.unsubscribeDoc = this.doc.on('change', (c) => this.emit('docChange', c));
  }

  setDocument(doc: ImageDocument, fileName = 'bez-nazvu'): void {
    this.doc = doc;
    this.fileName = fileName;
    this.layerCounter = doc.layers.length;
    this.lastSelection = null;
    this.bindDocument();
    this.history.clear();
    this.emit('document', doc);
  }

  setTool(id: string): void {
    const tool = this.tools.get(id);
    if (!tool || tool === this.activeTool) return;
    this.activeTool?.deactivate?.();
    this.activeTool = tool;
    this.tools.markUsed(tool);
    tool.activate?.();
    this.emit('tool', tool);
  }

  updateSettings(patch: Partial<EditorSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.emit('settings', this.settings);
  }

  /** Překreslení bez změny dokumentu (pohled, kurzor, overlay nástroje). */
  notifyView(): void {
    this.emit('view');
  }

  execute(command: Command): void {
    this.history.execute(command);
  }

  // ---- operace s vrstvami ----

  nextLayerName(): string {
    this.layerCounter += 1;
    return `Vrstva ${this.layerCounter}`;
  }

  /** Index nad aktivní vrstvou (nebo navrch). */
  private insertionIndex(): number {
    const active = this.doc.activeLayerId;
    return active ? this.doc.indexOf(active) + 1 : this.doc.layers.length;
  }

  addLayer(): void {
    const layer = new Layer(this.doc.width, this.doc.height, { name: this.nextLayerName() });
    this.execute(new AddLayerCommand(this.doc, layer, this.insertionIndex()));
  }

  addImageLayer(image: CanvasImageSource & { width: number; height: number }, name: string): void {
    const layer = new Layer(image.width, image.height, {
      name,
      x: Math.round((this.doc.width - image.width) / 2),
      y: Math.round((this.doc.height - image.height) / 2),
    });
    layer.ctx.drawImage(image, 0, 0);
    this.execute(new AddLayerCommand(this.doc, layer, this.insertionIndex(), 'Vložit obrázek'));
  }

  duplicateActiveLayer(): void {
    const active = this.doc.activeLayer;
    if (!active) return;
    this.execute(new AddLayerCommand(this.doc, active.duplicate(), this.insertionIndex(), 'Duplikovat vrstvu'));
  }

  deleteActiveLayer(): void {
    const active = this.doc.activeLayer;
    if (!active || this.doc.layers.length <= 1) return;
    this.execute(new RemoveLayerCommand(this.doc, active.id));
  }

  moveLayer(id: string, toIndex: number): void {
    const from = this.doc.indexOf(id);
    const to = Math.max(0, Math.min(toIndex, this.doc.layers.length - 1));
    if (from < 0 || from === to) return;
    this.execute(new MoveLayerCommand(this.doc, id, to));
  }

  moveActiveLayer(delta: number): void {
    const id = this.doc.activeLayerId;
    if (id) this.moveLayer(id, this.doc.indexOf(id) + delta);
  }

  setLayerProps(id: string, props: Partial<LayerProps>, label?: string): void {
    const layer = this.doc.getLayer(id);
    if (!layer) return;
    const current = layer.getProps();
    const before: Partial<LayerProps> = {};
    let changed = false;
    for (const key of Object.keys(props) as (keyof LayerProps)[]) {
      (before as Record<string, unknown>)[key] = current[key];
      if (current[key] !== props[key]) changed = true;
    }
    if (!changed) return;
    this.execute(new SetLayerPropsCommand(this.doc, id, before, props, label));
  }

  /** Zapíše do historie změnu, která už byla aplikována „naživo“ (např. tažení posuvníkem). */
  commitLayerProps(id: string, before: Partial<LayerProps>, after: Partial<LayerProps>, label?: string): void {
    this.history.push(new SetLayerPropsCommand(this.doc, id, before, after, label));
  }

  /** Nová vrstva z hotového canvasu na dané pozici (vložení ze schránky, vrstva kopírováním). */
  addCanvasLayer(canvas: HTMLCanvasElement, x: number, y: number, name: string, label: string): AddLayerCommand {
    const layer = new Layer(canvas.width, canvas.height, { name, x, y });
    layer.ctx.drawImage(canvas, 0, 0);
    const command = new AddLayerCommand(this.doc, layer, this.insertionIndex(), label);
    this.execute(command);
    return command;
  }

  // ---- výběr ----

  updateSelectionOptions(patch: Partial<SelectionOptions>): void {
    this.selectionOptions = { ...this.selectionOptions, ...patch };
    this.emit('selectionOptions', this.selectionOptions);
  }

  /** Režim podle modifikátorů (Shift = přidat, Alt = odebrat, oba = průnik), jinak podle lišty voleb. */
  selectionModeFor(mods: { shiftKey: boolean; altKey: boolean }): SelectionMode {
    if (mods.shiftKey && mods.altKey) return 'intersect';
    if (mods.shiftKey) return 'add';
    if (mods.altKey) return 'subtract';
    return this.selectionOptions.mode;
  }

  /** Nastaví výběr (null = odznačit) jako krok historie. */
  setSelection(mask: SelectionMask | null, label: string): void {
    const before = this.doc.selection;
    const after = mask && !mask.isEmpty() ? mask : null;
    if (before === after) return;
    if (before && !after) this.lastSelection = before;
    this.execute(new SetSelectionCommand(this.doc, before, after, label));
  }

  /** Použije nový tvar výběru (s prolnutím z voleb) v daném režimu. */
  applySelectionShape(shape: SelectionMask, mode: SelectionMode, label: string): void {
    const feathered = shape.feather(this.selectionOptions.feather);
    const current = this.doc.selection;
    this.setSelection(!current || mode === 'replace' ? feathered : current.combine(feathered, mode), label);
  }

  selectAll(): void {
    this.setSelection(SelectionMask.all(this.doc.width, this.doc.height), 'Vybrat vše');
  }

  deselect(): void {
    this.setSelection(null, 'Odznačit');
  }

  reselect(): void {
    const last = this.lastSelection;
    if (last && last.width === this.doc.width && last.height === this.doc.height) this.setSelection(last, 'Znovu vybrat');
  }

  /** Úprava aktuálního výběru (inverze, rozšíření, prolnutí…). */
  modifySelection(fn: (mask: SelectionMask) => SelectionMask, label: string): void {
    const sel = this.doc.selection;
    if (sel) this.setSelection(fn(sel), label);
  }

  invertSelection(): void {
    const sel = this.doc.selection ?? new SelectionMask(this.doc.width, this.doc.height);
    this.setSelection(sel.invert(), 'Inverze výběru');
  }

  selectLayerPixels(layerId: string): void {
    const layer = this.doc.getLayer(layerId);
    if (layer) this.setSelection(layerAlphaMask(this.doc, layer), 'Vybrat pixely');
  }

  /** Ořízne plátno na hranice výběru. */
  cropToSelection(): void {
    const b = this.doc.selection?.bounds();
    if (b) this.execute(new CropCommand(this.doc, b));
  }

  // ---- úpravy pixelů (omezené výběrem) ----

  /**
   * Změní pixely vrstvy v obdélníku (souřadnice vrstvy) a zapíše krok do historie.
   * Vrací příkaz (pro složené operace) nebo null, pokud obdélník leží mimo vrstvu.
   */
  paintLayer(layer: Layer, rect: Rect, label: string, draw: (ctx: CanvasRenderingContext2D) => void): PaintCommand | null {
    const r = clipRect(rect, layer.width, layer.height);
    if (!r) return null;
    const before = layer.ctx.getImageData(r.x, r.y, r.width, r.height);
    layer.ctx.save();
    draw(layer.ctx);
    layer.ctx.restore();
    const after = layer.ctx.getImageData(r.x, r.y, r.width, r.height);
    this.doc.notifyPixels(layer.id);
    return new PaintCommand(this.doc, layer.id, r.x, r.y, before, after, label);
  }

  /** Obdélník výběru (nebo celé vrstvy) v souřadnicích vrstvy. */
  private selectionRectIn(layer: Layer): Rect {
    const b = this.doc.selection?.bounds();
    return b ? { x: b.x - layer.x, y: b.y - layer.y, width: b.width, height: b.height } : { x: 0, y: 0, width: layer.width, height: layer.height };
  }

  /** Vymaže vybrané pixely aktivní vrstvy (bez výběru celou vrstvu). */
  clearSelection(): void {
    const layer = this.doc.activeLayer;
    const sel = this.doc.selection;
    if (!layer) return;
    const cmd = this.paintLayer(layer, this.selectionRectIn(layer), 'Vymazat', (ctx) => {
      if (sel) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(maskToCanvas(sel), -layer.x, -layer.y);
      } else ctx.clearRect(0, 0, layer.width, layer.height);
    });
    if (cmd) this.history.push(cmd);
  }

  /** Vyplní výběr (bez výběru celou vrstvu) barvou. */
  fillSelection(color: string, label = 'Vyplnit'): void {
    const layer = this.doc.activeLayer;
    const sel = this.doc.selection;
    if (!layer) return;
    const rect = this.selectionRectIn(layer);
    const cmd = this.paintLayer(layer, rect, label, (ctx) => {
      if (!sel) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, layer.width, layer.height);
        return;
      }
      const fill = createCanvas(sel.width, sel.height);
      const f = get2d(fill);
      f.drawImage(maskToCanvas(sel), 0, 0);
      f.globalCompositeOperation = 'source-in';
      f.fillStyle = color;
      f.fillRect(0, 0, fill.width, fill.height);
      ctx.drawImage(fill, -layer.x, -layer.y);
    });
    if (cmd) this.history.push(cmd);
  }

  /** Zkopíruje výběr aktivní vrstvy (nebo složeného obrazu) do schránky aplikace. */
  copySelection(merged = false): boolean {
    const layer = this.doc.activeLayer;
    const source = merged ? { canvas: flattenDocument(this.doc), x: 0, y: 0 } : layer;
    if (!source) return false;
    const piece = extractPixels(source, this.doc.selection);
    this.clipboard = piece;
    return piece !== null;
  }

  cutSelection(): void {
    if (this.copySelection()) this.clearSelection();
  }

  /** Vloží obsah schránky aplikace jako novou vrstvu na původní místo. */
  pasteClipboard(): boolean {
    const clip = this.clipboard;
    if (!clip) return false;
    this.addCanvasLayer(clip.canvas, clip.x, clip.y, this.nextLayerName(), 'Vložit');
    return true;
  }

  /** Ctrl+J: s výběrem nová vrstva z vybraných pixelů, bez výběru duplikát vrstvy. */
  layerViaCopy(): void {
    const layer = this.doc.activeLayer;
    if (!layer) return;
    if (!this.doc.selection) return this.duplicateActiveLayer();
    const piece = extractPixels(layer, this.doc.selection);
    if (piece) this.addCanvasLayer(piece.canvas, piece.x, piece.y, this.nextLayerName(), 'Vrstva kopírováním');
  }

  /** Shift+Ctrl+J: vybrané pixely se přesunou do nové vrstvy. */
  layerViaCut(): void {
    const layer = this.doc.activeLayer;
    const sel = this.doc.selection;
    if (!layer || !sel) return;
    const piece = extractPixels(layer, sel);
    if (!piece) return;
    const clear = this.paintLayer(layer, this.selectionRectIn(layer), 'Vymazat', (ctx) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(maskToCanvas(sel), -layer.x, -layer.y);
    });
    const newLayer = new Layer(piece.canvas.width, piece.canvas.height, { name: this.nextLayerName(), x: piece.x, y: piece.y });
    newLayer.ctx.drawImage(piece.canvas, 0, 0);
    const add = new AddLayerCommand(this.doc, newLayer, this.insertionIndex(), 'Vrstva vyjmutím');
    add.do();
    this.history.push(new MacroCommand('Vrstva vyjmutím', clear ? [clear, add] : [add]));
  }
}

export interface SelectionOptions {
  mode: SelectionMode;
  /** Prolnutí nového tvaru v px. */
  feather: number;
  antiAlias: boolean;
  /** Obdélník/elipsa: normální, pevný poměr nebo pevná velikost. */
  style: 'normal' | 'ratio' | 'size';
  fixedWidth: number;
  fixedHeight: number;
  /** Kouzelná hůlka */
  tolerance: number;
  contiguous: boolean;
  sampleAll: boolean;
  /** Magnetické laso – šířka detekce (px), kontrast (%), frekvence kotev (0..100). */
  lassoWidth: number;
  lassoContrast: number;
  lassoFrequency: number;
}

export const DEFAULT_SELECTION_OPTIONS: SelectionOptions = {
  mode: 'replace',
  feather: 0,
  antiAlias: true,
  style: 'normal',
  fixedWidth: 64,
  fixedHeight: 64,
  tolerance: 32,
  contiguous: true,
  sampleAll: true,
  lassoWidth: 10,
  lassoContrast: 10,
  lassoFrequency: 57,
};
