import {
  AddLayerCommand,
  MacroCommand,
  MoveLayerCommand,
  PaintCommand,
  RemoveLayerCommand,
  SetLayerPropsCommand,
  SetMaskCommand,
  type PaintTargetKind,
} from './commands/layerCommands';
import { SetSelectionCommand } from './commands/selectionCommands';
import { DocStateCommand } from './commands/stateCommands';
import { clipRect, createCanvas, get2d, type Rect } from './canvas';
import { Emitter } from './Emitter';
import { History, type Command } from './History';
import { createBlankDocument, type DocChange, type DocState, type ImageDocument } from './ImageDocument';
import { cropDocument, flipDocument, resizeCanvas, resizeImage, revealAllBounds, rotateDocument, trimBounds } from './imageOps';
import type { Transform } from './transform/geometry';
import { TransformSession } from './transform/session';
import { Layer, type LayerProps } from './Layer';
import { createMask, luminance, maskFromAlpha, maskFromSelection, paintMaskValue } from './mask';
import { extractPixels, layerAlphaMask, maskToCanvas, rasterizeMask, samplePixels } from './selection/raster';
import { growSelection } from './selection/floodFill';
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
  /** Přepnutí cíle úprav mezi pixely vrstvy a její maskou. */
  target: boolean;
}

/** Kam se kreslí: obrazové pixely aktivní vrstvy, nebo její maska. */
export interface PaintTarget {
  layer: Layer;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  kind: PaintTargetKind;
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
  /** Úpravy jdou do masky aktivní vrstvy (klik na náhled masky). */
  maskTarget = false;

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
    this.unsubscribeDoc = this.doc.on('change', (c) => {
      // Cíl „maska“ platí jen, dokud ji aktivní vrstva má.
      if (this.maskTarget && !this.doc.activeLayer?.mask) this.setMaskTarget(false);
      this.emit('docChange', c);
    });
  }

  setDocument(doc: ImageDocument, fileName = 'bez-nazvu'): void {
    this.doc = doc;
    this.fileName = fileName;
    this.layerCounter = doc.layers.length;
    this.lastSelection = null;
    this.maskTarget = false;
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

  /** Výběr → Zvětšit (souvisle) / Podobné (v celém obraze) podle tolerance kouzelné hůlky. */
  growSelection(contiguous: boolean): void {
    const sel = this.doc.selection;
    if (!sel) return;
    const img = samplePixels(this.doc, this.selectionOptions.sampleAll);
    const grown = growSelection(img.data, this.doc.width, this.doc.height, sel, this.selectionOptions.tolerance, contiguous);
    this.setSelection(grown, contiguous ? 'Zvětšit výběr' : 'Podobné');
  }

  /** Upřesnit okraj: vyhlazení, posun okraje (+ rozšířit / − zúžit) a prolnutí v jednom kroku. */
  refineEdge(o: { smooth: number; shift: number; feather: number }): void {
    this.modifySelection((m) => {
      let r = m.smooth(o.smooth);
      if (o.shift > 0) r = r.expand(o.shift);
      else if (o.shift < 0) r = r.contract(-o.shift);
      return r.feather(o.feather);
    }, 'Upřesnit okraj');
  }

  /** Ořízne plátno na hranice výběru. */
  cropToSelection(): void {
    const b = this.doc.selection?.bounds();
    if (b) this.applyDocState(cropDocument(this.doc, b, true), 'Oříznout');
  }

  // ---- operace s celým dokumentem (0.4) ----

  /** Zapíše nový stav dokumentu jako jeden krok historie. */
  applyDocState(state: DocState, label: string): void {
    this.execute(new DocStateCommand(this.doc, this.doc.captureState(), state, label));
  }

  resizeImage(width: number, height: number, smooth: boolean): void {
    if (width === this.doc.width && height === this.doc.height) return;
    this.applyDocState(resizeImage(this.doc, width, height, smooth), 'Velikost obrazu');
  }

  resizeCanvas(width: number, height: number, anchor: number, fill: string | null): void {
    if (width === this.doc.width && height === this.doc.height) return;
    this.applyDocState(resizeCanvas(this.doc, width, height, anchor, fill), 'Velikost plátna');
  }

  rotateDocument(quarterTurns: 1 | 2 | 3): void {
    const labels = { 1: 'Otočit plátno o 90° ↻', 2: 'Otočit plátno o 180°', 3: 'Otočit plátno o 90° ↺' };
    this.applyDocState(rotateDocument(this.doc, quarterTurns), labels[quarterTurns]);
  }

  flipDocument(axis: 'h' | 'v'): void {
    this.applyDocState(flipDocument(this.doc, axis), axis === 'h' ? 'Převrátit plátno vodorovně' : 'Převrátit plátno svisle');
  }

  cropDocument(rect: Rect, deletePixels: boolean): void {
    if (rect.width < 1 || rect.height < 1) return;
    this.applyDocState(cropDocument(this.doc, rect, deletePixels), 'Oříznout');
  }

  trim(basis: 'transparent' | 'topLeft' | 'bottomRight'): boolean {
    const b = trimBounds(this.doc, basis);
    if (!b || (b.width === this.doc.width && b.height === this.doc.height)) return false;
    this.applyDocState(cropDocument(this.doc, b, true), 'Ořezat');
    return true;
  }

  revealAll(): void {
    const b = revealAllBounds(this.doc);
    if (b.x !== 0 || b.y !== 0 || b.width !== this.doc.width || b.height !== this.doc.height) {
      this.applyDocState(cropDocument(this.doc, b, false), 'Odkrýt vše');
    }
  }

  /** Úpravy → Transformovat → otočit / převrátit aktivní vrstvu (s výběrem jen vybrané pixely). */
  transformQuick(kind: 'cw' | 'ccw' | '180' | 'flipH' | 'flipV'): void {
    const session = TransformSession.start(this);
    if (!session) return;
    const t = session.initial;
    const changes: Record<typeof kind, [Partial<Transform>, string]> = {
      cw: [{ angle: Math.PI / 2 }, 'Otočit o 90° ↻'],
      ccw: [{ angle: -Math.PI / 2 }, 'Otočit o 90° ↺'],
      '180': [{ angle: Math.PI }, 'Otočit o 180°'],
      flipH: [{ flipX: true }, 'Převrátit vodorovně'],
      flipV: [{ flipY: true }, 'Převrátit svisle'],
    };
    const [patch, label] = changes[kind];
    session.apply({ ...t, ...patch });
    session.commit(label);
  }

  // ---- úpravy pixelů (omezené výběrem) ----

  /**
   * Změní pixely vrstvy (nebo její masky) v obdélníku (souřadnice vrstvy). Krok do historie se nezapisuje –
   * vrací se příkaz (pro složené operace) nebo null, pokud obdélník leží mimo vrstvu.
   */
  paintLayer(
    layer: Layer,
    rect: Rect,
    label: string,
    draw: (ctx: CanvasRenderingContext2D) => void,
    target: PaintTargetKind = 'pixels',
  ): PaintCommand | null {
    const canvas = target === 'mask' ? layer.mask : layer.canvas;
    const r = canvas && clipRect(rect, canvas.width, canvas.height);
    if (!canvas || !r) return null;
    const ctx = get2d(canvas);
    const before = ctx.getImageData(r.x, r.y, r.width, r.height);
    ctx.save();
    draw(ctx);
    ctx.restore();
    const after = ctx.getImageData(r.x, r.y, r.width, r.height);
    this.doc.notifyPixels(layer.id);
    return new PaintCommand(this.doc, layer.id, r.x, r.y, before, after, label, target);
  }

  /** Obdélník výběru (nebo celé vrstvy) v souřadnicích vrstvy. */
  private selectionRectIn(layer: Layer): Rect {
    const b = this.doc.selection?.bounds();
    return b ? { x: b.x - layer.x, y: b.y - layer.y, width: b.width, height: b.height } : { x: 0, y: 0, width: layer.width, height: layer.height };
  }

  /** Vymaže vybrané pixely aktivní vrstvy (bez výběru celou vrstvu). V masce vyplní barvou pozadí (jako Photoshop). */
  clearSelection(): void {
    const t = this.paintTarget();
    const sel = this.doc.selection;
    if (!t) return;
    if (t.kind === 'mask') return this.fillMask(t, luminance(this.settings.secondaryColor), 'Vymazat');
    const { layer } = t;
    const cmd = this.paintLayer(layer, this.selectionRectIn(layer), 'Vymazat', (ctx) => {
      if (sel) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(maskToCanvas(sel), -layer.x, -layer.y);
      } else ctx.clearRect(0, 0, layer.width, layer.height);
    });
    if (cmd) this.history.push(cmd);
  }

  /** Vyplní výběr (bez výběru celou vrstvu) barvou; v masce jasem barvy. */
  fillSelection(color: string, label = 'Vyplnit'): void {
    const t = this.paintTarget();
    const sel = this.doc.selection;
    if (!t) return;
    if (t.kind === 'mask') return this.fillMask(t, luminance(color), label);
    const { layer } = t;
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

  /** Nastaví masku ve výběru (nebo celou) na hodnotu 0..1. */
  private fillMask(t: PaintTarget, value: number, label: string): void {
    const sel = this.doc.selection;
    const { layer } = t;
    const cmd = this.paintLayer(
      layer,
      this.selectionRectIn(layer),
      label,
      (ctx) => paintMaskValue(ctx, sel ? maskToCanvas(sel) : null, -layer.x, -layer.y, value),
      'mask',
    );
    if (cmd) this.history.push(cmd);
  }

  // ---- masky vrstev ----

  setMaskTarget(on: boolean): void {
    const next = on && !!this.doc.activeLayer?.mask;
    if (next === this.maskTarget) return;
    this.maskTarget = next;
    this.emit('target', next);
  }

  /** Aktuální cíl úprav (pixely aktivní vrstvy nebo její maska). */
  paintTarget(): PaintTarget | null {
    const layer = this.doc.activeLayer;
    if (!layer) return null;
    if (this.maskTarget && layer.mask) return { layer, canvas: layer.mask, ctx: get2d(layer.mask), kind: 'mask' };
    return { layer, canvas: layer.canvas, ctx: layer.ctx, kind: 'pixels' };
  }

  /**
   * Přidá masku aktivní vrstvě. Varianty podle Photoshopu: odkrýt / skrýt vše, odkrýt / skrýt výběr,
   * z průhlednosti. Maska z výběru výběr zruší. Nová maska se stane cílem úprav.
   */
  addMask(kind: MaskKind): void {
    const layer = this.doc.activeLayer;
    const sel = this.doc.selection;
    if (!layer || layer.mask) return;
    const { width, height } = layer;
    const masks: Record<MaskKind, () => HTMLCanvasElement | null> = {
      revealAll: () => createMask(width, height, 1),
      hideAll: () => createMask(width, height, 0),
      revealSelection: () => (sel ? maskFromSelection(sel, layer, false) : null),
      hideSelection: () => (sel ? maskFromSelection(sel, layer, true) : null),
      fromTransparency: () => maskFromAlpha(layer),
    };
    const mask = masks[kind]();
    if (!mask) return;
    const add = new SetMaskCommand(this.doc, layer.id, null, mask, 'Přidat masku vrstvy');
    if (sel && (kind === 'revealSelection' || kind === 'hideSelection')) {
      this.execute(new MacroCommand('Přidat masku vrstvy', [new SetSelectionCommand(this.doc, sel, null, 'Odznačit'), add]));
    } else this.execute(add);
    this.setMaskTarget(true);
  }

  deleteMask(): void {
    const layer = this.doc.activeLayer;
    if (layer?.mask) this.execute(new SetMaskCommand(this.doc, layer.id, layer.mask, null, 'Smazat masku vrstvy'));
  }

  /** Použije masku: skryté pixely se smažou a maska zmizí. */
  applyMask(): void {
    const layer = this.doc.activeLayer;
    const mask = layer?.mask;
    if (!layer || !mask) return;
    const paint = layer.maskEnabled
      ? this.paintLayer(layer, { x: 0, y: 0, width: layer.width, height: layer.height }, 'Použít masku', (ctx) => {
          ctx.globalCompositeOperation = 'destination-in';
          ctx.drawImage(mask, 0, 0);
        })
      : null;
    const remove = new SetMaskCommand(this.doc, layer.id, mask, null, 'Použít masku');
    remove.do();
    this.history.push(new MacroCommand('Použít masku vrstvy', paint ? [paint, remove] : [remove]));
  }

  toggleMask(): void {
    const layer = this.doc.activeLayer;
    if (!layer?.mask) return;
    this.setLayerProps(layer.id, { maskEnabled: !layer.maskEnabled }, layer.maskEnabled ? 'Vypnout masku' : 'Zapnout masku');
  }

  /** Výběr podle masky (Ctrl+klik na náhled masky). */
  selectionFromMask(layerId?: string): void {
    const layer = layerId ? this.doc.getLayer(layerId) : this.doc.activeLayer;
    const mask = layer?.mask;
    if (!layer || !mask) return;
    this.setSelection(
      rasterizeMask(this.doc.width, this.doc.height, (ctx) => ctx.drawImage(mask, layer.x, layer.y)),
      'Výběr z masky',
    );
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

export type MaskKind = 'revealAll' | 'hideAll' | 'revealSelection' | 'hideSelection' | 'fromTransparency';

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
