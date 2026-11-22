import {
  AddLayerCommand,
  LayerListCommand,
  MacroCommand,
  MoveLayerCommand,
  PaintCommand,
  RemoveLayerCommand,
  SetLayerPropsCommand,
  SetMaskCommand,
  type PaintTargetKind,
} from './commands/layerCommands';
import { SetSelectionCommand } from './commands/selectionCommands';
import { DocStateCommand, LayerStateCommand } from './commands/stateCommands';
import { clipRect, cloneCanvas, createCanvas, get2d, unionRect, type Rect } from './canvas';
import { Emitter } from './Emitter';
import { History, type Command } from './History';
import { captureLayer, createBlankDocument, type DocChange, type DocState, type ImageDocument, type LayerState } from './ImageDocument';
import { anchoredPosition, positionForClick, refitMask, renderText, type TextData } from './text';
import { cropDocument, flipDocument, resizeCanvas, resizeImage, revealAllBounds, rotateDocument, trimBounds } from './imageOps';
import type { Transform } from './transform/geometry';
import { TransformSession } from './transform/session';
import { Layer, type LayerProps, type LockKind } from './Layer';
import { restoreAlpha } from './paint/alpha';
import { strokeMask, type StrokePosition } from './paint/stroke';
import { alignOffsets, alphaBounds, distributeOffsets, type AlignKind, type DistributeAxis, type Offset } from './align';
import { canvasPattern, getPattern } from './patterns';
import type { Adjustment } from './adjust';
import { renderFill, type FillContent } from './fillLayer';
import { flatten, layerRectWithEffects, mergeDown, mergeVisible, type LayerList } from './merge';
import {
  buildTree,
  findNode,
  insertGroup,
  moveNode,
  removeNode,
  replaceNode,
  shiftNode,
  subtreeItems,
  ungroup,
  wrapInGroup,
  collapseNodes,
  selectionRoots,
  type DropPosition,
  type FlatList,
  type TreeNode,
} from './groups';
import { createMask, luminance, maskFromAlpha, maskFromSelection, paintMaskValue } from './mask';
import { extractPixels, layerAlphaMask, maskToCanvas, rasterizeMask, samplePixels } from './selection/raster';
import { growSelection } from './selection/floodFill';
import { SelectionMask, type SelectionMode } from './selection/SelectionMask';
import { Viewport } from './Viewport';
import { ActionRegistry } from './actions';
import { compositeLayers, flattenDocument } from '../render/composite';
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
  /** Aktivní dokument se změnil (nový / otevřený / přepnutí záložky). */
  document: ImageDocument;
  /** Změnil se seznam otevřených dokumentů (záložky) nebo stav jejich uložení. */
  documents: void;
  docChange: DocChange;
  history: void;
  tool: Tool;
  /** Změna pohledu nebo pozice kurzoru – stačí překreslit. */
  view: void;
  settings: EditorSettings;
  selectionOptions: SelectionOptions;
  /** Přepnutí cíle úprav mezi pixely vrstvy a její maskou. */
  target: boolean;
  /** Krátké upozornění pro uživatele (např. „nejdřív nastavte zdroj razítka“). */
  notice: string;
}

/** Kam se kreslí: obrazové pixely aktivní vrstvy, nebo její maska. */
export interface PaintTarget {
  layer: Layer;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  kind: PaintTargetKind;
}

/** Otevřený dokument (záložka) – vlastní historie, pohled a stav uložení. */
export interface DocSession {
  readonly id: string;
  readonly doc: ImageDocument;
  readonly history: History;
  fileName: string;
  /** Uložený pohled pro návrat na záložku (null = při prvním zobrazení přizpůsobit oknu). */
  view: { zoom: number; panX: number; panY: number } | null;
  /** Poslední zrušený výběr pro „Znovu vybrat“. */
  lastSelection: SelectionMask | null;
  layerCounter: number;
  /** Poslední krok historie v okamžiku uložení (null = výchozí stav). */
  savedAt: Command | null;
}

let sessionCounter = 0;

/** Výchozí limit paměti historie na záložku: 1 GB. */
export const DEFAULT_HISTORY_MEMORY = 1024 * 1024 * 1024;

/** Značka „obnoveno z automatického uložení“ – neodpovídá žádnému kroku historie, takže dokument je neuložený. */
const RESTORED: Command = { label: 'Obnoveno', do: () => {}, undo: () => {} };

/** Centrální stav aplikace – otevřené dokumenty, historie, pohled, nástroje a akce. */
export class Editor extends Emitter<EditorEvents> {
  /** Otevřené dokumenty v pořadí záložek. */
  readonly sessions: DocSession[] = [];
  /** Aktivní dokument. */
  session!: DocSession;
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
  /** Úpravy jdou do masky aktivní vrstvy (klik na náhled masky). */
  maskTarget = false;
  /** Poslední filtr / úprava, kterou jde zeslabit (Úpravy → Zeslabit), dokud je posledním krokem historie. */
  fadeable: PaintCommand | null = null;

  private unsubscribeDoc: (() => void) | null = null;
  private untitledCounter = 0;
  /** Limit paměti historie každé záložky (bajty); nejstarší kroky nad limit se zahodí. */
  historyMemoryLimit = DEFAULT_HISTORY_MEMORY;

  constructor() {
    super();
    this.openDocument(createBlankDocument(1200, 800, '#ffffff'));
  }

  get doc(): ImageDocument {
    return this.session.doc;
  }

  get history(): History {
    return this.session.history;
  }

  get fileName(): string {
    return this.session.fileName;
  }

  set fileName(name: string) {
    this.session.fileName = name;
    this.emit('documents');
  }

  private get lastSelection(): SelectionMask | null {
    return this.session.lastSelection;
  }

  private set lastSelection(mask: SelectionMask | null) {
    this.session.lastSelection = mask;
  }

  /** Název pro nový dokument bez souboru. */
  nextUntitledName(): string {
    this.untitledCounter += 1;
    return this.untitledCounter === 1 ? 'bez-nazvu' : `bez-nazvu-${this.untitledCounter}`;
  }

  /** Otevře dokument v nové záložce a přepne na ni. */
  openDocument(doc: ImageDocument, fileName = this.nextUntitledName()): DocSession {
    const session: DocSession = {
      id: `doc${++sessionCounter}`,
      doc,
      history: new History(Number.POSITIVE_INFINITY, this.historyMemoryLimit),
      fileName,
      view: null,
      lastSelection: null,
      layerCounter: doc.layers.length,
      savedAt: null,
    };
    session.history.on('change', () => {
      if (session === this.session) this.emit('history');
      this.emit('documents');
    });
    this.sessions.push(session);
    this.activateDocument(session.id);
    return session;
  }

  /** Přepne na jinou záložku. Rozpracovaná operace nástroje (transformace…) se nejdřív dokončí. */
  activateDocument(id: string): void {
    const next = this.sessions.find((s) => s.id === id);
    if (!next || next === this.session) return;
    const prev = this.session as DocSession | undefined;
    if (prev) {
      this.activeTool?.deactivate?.();
      prev.view = { zoom: this.viewport.zoom, panX: this.viewport.panX, panY: this.viewport.panY };
    }
    this.session = next;
    this.maskTarget = false;
    if (next.view) Object.assign(this.viewport, next.view);
    else if (this.viewport.width > 0) this.viewport.fit(next.doc.width, next.doc.height, false);
    this.bindDocument();
    if (prev) this.activeTool?.activate?.();
    this.emit('document', next.doc);
    this.emit('history');
    this.emit('documents');
    this.emit('view');
  }

  /** Nastaví limit paměti historie všem záložkám (přebytečné nejstarší kroky se hned zahodí). */
  setHistoryMemoryLimit(bytes: number): void {
    this.historyMemoryLimit = bytes;
    for (const s of this.sessions) {
      s.history.memoryLimit = bytes;
      s.history.trim();
    }
  }

  /** Vymaže historii aktivní záložky (uvolní paměť). Neuložené změny zůstanou označené. */
  clearHistory(): void {
    const dirty = this.isDirty();
    this.history.clear();
    this.history.dropped = 0;
    if (dirty) this.session.savedAt = RESTORED;
    this.emit('documents');
  }

  /** Neuložené změny od posledního uložení (nebo otevření). */
  isDirty(session: DocSession = this.session): boolean {
    const h = session.history;
    return (h.entries[h.position - 1] ?? null) !== session.savedAt;
  }

  /** Dokument obnovený z automatického uložení – má neuložené změny, dokud se neuloží do souboru. */
  markRestored(session: DocSession): void {
    session.savedAt = RESTORED;
    this.emit('documents');
  }

  markSaved(session: DocSession = this.session): void {
    const h = session.history;
    session.savedAt = h.entries[h.position - 1] ?? null;
    this.emit('documents');
  }

  /** Zavře záložku. Poslední zavřená záložka se nahradí prázdným dokumentem. */
  closeDocument(id: string): void {
    const index = this.sessions.findIndex((s) => s.id === id);
    if (index < 0) return;
    const [closing] = this.sessions.splice(index, 1);
    if (closing === this.session) {
      const neighbour = this.sessions[Math.min(index, this.sessions.length - 1)];
      if (neighbour) this.activateDocument(neighbour.id);
      else this.openDocument(createBlankDocument(1200, 800, '#ffffff'));
    }
    closing.history.clear();
    this.emit('documents');
  }

  private bindDocument(): void {
    this.unsubscribeDoc?.();
    this.unsubscribeDoc = this.doc.on('change', (c) => {
      // Cíl „maska“ platí jen, dokud ji aktivní vrstva má.
      if (this.maskTarget && !this.doc.activeLayer?.mask) this.setMaskTarget(false);
      this.emit('docChange', c);
    });
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
  /** Ukáže krátké upozornění (bublina u plátna). */
  notice(message: string): void {
    this.emit('notice', message);
  }

  notifyView(): void {
    this.emit('view');
  }

  execute(command: Command): void {
    this.history.execute(command);
  }

  // ---- operace s vrstvami ----

  nextLayerName(): string {
    this.session.layerCounter += 1;
    return `Vrstva ${this.session.layerCounter}`;
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

  /** Krok, který jde zeslabit – jen pokud je v historii poslední provedený. */
  lastFadeable(): PaintCommand | null {
    const cmd = this.fadeable;
    return cmd && this.history.entries[this.history.position - 1] === cmd ? cmd : null;
  }

  /** Maska nové vrstvy úprav / výplně: z výběru, bez něj odkrýt vše (jako Photoshop). */
  newLayerMask(): HTMLCanvasElement {
    const sel = this.doc.selection;
    if (sel) return cloneCanvas(maskToCanvas(sel));
    const mask = createCanvas(this.doc.width, this.doc.height);
    const ctx = get2d(mask);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, mask.width, mask.height);
    return mask;
  }

  /** Vytvoří vrstvu úprav (přes celé plátno, s maskou z výběru) nad aktivní vrstvou. */
  createAdjustmentLayer(adjustment: Adjustment, name: string): Layer {
    return new Layer(this.doc.width, this.doc.height, { name, adjustment: structuredClone(adjustment) });
  }

  /** Přidá hotovou vrstvu úprav / výplně (s maskou z výběru) jako krok historie; výběr se zruší. */
  addSpecialLayer(layer: Layer, label: string): void {
    layer.mask ??= this.newLayerMask();
    const add = new AddLayerCommand(this.doc, layer, this.insertionIndex(), label);
    const sel = this.doc.selection;
    this.execute(sel ? new MacroCommand(label, [add, new SetSelectionCommand(this.doc, sel, null, 'Odznačit')]) : add);
  }

  /**
   * Náhled nové vrstvy úprav / výplně během dialogu: vrstva se vloží bez historie; `commit` ji přidá
   * jako krok historie (i se zrušením výběru), `cancel` ji odebere.
   */
  previewNewLayer(layer: Layer, label: string): { commit(): void; cancel(): void } {
    layer.mask ??= this.newLayerMask();
    const add = new AddLayerCommand(this.doc, layer, this.insertionIndex(), label);
    add.do();
    return {
      commit: () => {
        add.undo();
        this.addSpecialLayer(layer, label);
      },
      cancel: () => add.undo(),
    };
  }

  /** Výplňová vrstva přes celé plátno. */
  createFillLayer(fill: FillContent, name: string): Layer {
    const layer = new Layer(1, 1, { name });
    layer.setCanvas(renderFill(fill, this.doc.width, this.doc.height));
    return layer;
  }

  /** Změní nastavení výplňové vrstvy (vykreslí ji znovu). */
  setFillContent(layer: Layer, fill: FillContent, label = 'Upravit výplň'): void {
    const before = captureLayer(layer);
    const canvas = renderFill(fill, layer.width, layer.height);
    this.execute(new LayerStateCommand(this.doc, layer.id, before, { ...before, canvas }, label));
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
    if (!active.isGroup) {
      this.execute(new AddLayerCommand(this.doc, active.duplicate(), this.insertionIndex(), 'Duplikovat vrstvu'));
      return;
    }
    // Skupina se duplikuje i s obsahem (nová id), kopie leží nad originálem.
    const loc = findNode(buildTree(this.doc.layers), active.id);
    if (!loc) return;
    const cloneNode = (node: TreeNode<Layer>, root: boolean): TreeNode<Layer> => {
      const l = node.item;
      const name = root ? `${l.name} kopie` : l.name;
      const copy = l.isGroup ? new Layer(1, 1, { ...l.getProps(), name, group: true }) : l.duplicate();
      if (!l.isGroup) copy.name = name;
      copy.collapsed = l.collapsed;
      return { item: copy, children: node.children.map((c) => cloneNode(c, false)) };
    };
    const copy = cloneNode(loc.node, true);
    this.applyStructure(replaceNode(this.doc.layers, active.id, [loc.node, copy]), copy.item.id, 'Duplikovat skupinu');
  }

  /** Vrstvy, které nejsou skupinou (jen ty mají pixely). */
  pixelLayers(): Layer[] {
    return this.doc.layers.filter((l) => !l.isGroup);
  }

  /** Vybrané vrstvy bez těch, jejichž skupina je vybraná také (odspodu nahoru). */
  selectedRoots(): Layer[] {
    const ids = selectionRoots(this.doc.layers, this.doc.selectedLayerIds);
    return ids.map((id) => this.doc.getLayer(id)!).filter(Boolean);
  }

  /** Je vybráno víc vrstev najednou? */
  get multiSelection(): boolean {
    return this.selectedRoots().length > 1;
  }

  /** Vybere v panelu všechny vrstvy (Výběr → Všechny vrstvy). */
  selectAllLayers(): void {
    const active = this.doc.activeLayerId ?? this.doc.layers.at(-1)?.id;
    if (active) this.doc.setLayerSelection(this.doc.layers.map((l) => l.id), active);
  }

  /** Lze smazat vybrané vrstvy? Dokument musí mít aspoň jednu vrstvu s pixely. */
  canDeleteSelection(): boolean {
    const removed = new Set(this.selectedRoots().flatMap((l) => this.subtree(l)));
    return removed.size > 0 && this.pixelLayers().some((l) => !removed.has(l));
  }

  deleteActiveLayer(): void {
    const active = this.doc.activeLayer;
    if (!active || !this.canDeleteSelection()) return;
    const roots = this.selectedRoots();
    if (roots.length > 1) {
      const list = collapseNodes(this.doc.layers, roots.map((l) => l.id), null);
      const below = this.doc.layers[this.doc.indexOf(roots[0].id) - 1];
      this.applyStructure(list, list?.items.includes(below) ? below.id : (list?.items.at(-1)?.id ?? null), 'Smazat vrstvy');
      return;
    }
    const removed = new Set(this.subtree(active).map((l) => l.id));
    if (!active.isGroup) {
      this.execute(new RemoveLayerCommand(this.doc, active.id));
      return;
    }
    const list = removeNode(this.doc.layers, active.id);
    const index = this.doc.indexOf(active.id) - removed.size + 1;
    const next = list?.items[Math.min(Math.max(0, index), (list?.items.length ?? 1) - 1)];
    this.applyStructure(list, next?.id ?? null, 'Smazat skupinu');
  }

  /** Zapíše novou strukturu vrstev (pořadí + skupiny) jako jeden krok historie. */
  applyStructure(list: FlatList<Layer> | null, activeId: string | null, label: string): boolean {
    if (!list) return false;
    const same = list.items.length === this.doc.layers.length && list.items.every((l, i) => l === this.doc.layers[i] && list.parents.get(l.id) === l.parentId);
    if (same) return false;
    this.execute(new LayerListCommand(this.doc, list.items, activeId, label, list.parents));
    return true;
  }

  /** Vrstva i se všemi potomky (u skupiny), odspodu nahoru. */
  subtree(layer: Layer): Layer[] {
    if (!layer.isGroup) return [layer];
    const loc = findNode(buildTree(this.doc.layers), layer.id);
    return loc ? subtreeItems(loc.node) : [layer];
  }

  /** Vrstvy, které se posouvají spolu s vrstvou (u skupiny všechny její vrstvy s pixely). */
  movableLayers(layer: Layer): Layer[] {
    return this.subtree(layer).filter((l) => !l.isGroup);
  }

  /** Vrstvy, které posouvá nástroj Přesun: všechny vybrané (i obsah vybraných skupin) kromě zamčených. */
  movableSelection(): Layer[] {
    return [...new Set(this.selectedRoots().flatMap((l) => this.movableLayers(l)))].filter((l) => !this.isLocked(l, 'lockPosition'));
  }

  // ---- vlastnosti a zarovnání více vrstev (0.8) ----

  /** Nastaví vlastnosti všem vybraným vrstvám jako jeden krok historie. */
  setSelectionProps(props: Partial<LayerProps>, label: string): void {
    const cmds: Command[] = [];
    for (const l of this.selectedRoots()) {
      const before: Partial<LayerProps> = {};
      let changed = false;
      for (const key of Object.keys(props) as (keyof LayerProps)[]) {
        (before as Record<string, unknown>)[key] = l[key];
        if (l[key] !== props[key]) changed = true;
      }
      if (changed) cmds.push(new SetLayerPropsCommand(this.doc, l.id, before, props, label));
    }
    if (cmds.length) this.execute(cmds.length === 1 ? cmds[0] : new MacroCommand(label, cmds));
  }

  /** Zapíše změnu vlastností, která už proběhla naživo u více vrstev (posuvník krytí). */
  commitSelectionProps(before: Map<string, Partial<LayerProps>>, label: string): void {
    const cmds: Command[] = [];
    for (const [id, b] of before) {
      const l = this.doc.getLayer(id);
      if (!l) continue;
      const after: Partial<LayerProps> = {};
      let changed = false;
      for (const key of Object.keys(b) as (keyof LayerProps)[]) {
        (after as Record<string, unknown>)[key] = l[key];
        if (l[key] !== b[key]) changed = true;
      }
      if (changed) cmds.push(new SetLayerPropsCommand(this.doc, id, b, after, label));
    }
    if (cmds.length) this.history.push(cmds.length === 1 ? cmds[0] : new MacroCommand(label, cmds));
  }

  /** Obdélník neprůhledných pixelů vrstvy (u skupiny všech jejích vrstev) v souřadnicích dokumentu. */
  contentBounds(layer: Layer): Rect | null {
    let rect: Rect | null = null;
    for (const l of this.movableLayers(layer)) {
      if (!l.visible) continue;
      const b = alphaBounds(l.ctx.getImageData(0, 0, l.width, l.height).data, l.width, l.height);
      if (b) rect = unionRect(rect, { x: b.x + l.x, y: b.y + l.y, width: b.width, height: b.height });
    }
    return rect;
  }

  private moveRoots(roots: Layer[], offsets: Offset[], label: string): void {
    const cmds: Command[] = [];
    roots.forEach((root, i) => {
      const { dx, dy } = offsets[i];
      if (!dx && !dy) return;
      for (const l of this.movableLayers(root)) {
        if (this.isLocked(l, 'lockPosition')) continue;
        cmds.push(new SetLayerPropsCommand(this.doc, l.id, { x: l.x, y: l.y }, { x: l.x + dx, y: l.y + dy }, label));
      }
    });
    if (cmds.length) this.execute(cmds.length === 1 ? cmds[0] : new MacroCommand(label, cmds));
  }

  /** Vybrané vrstvy s obsahem a jeho obdélníky (zamčenou pozici přeskočí). */
  private alignItems(): { roots: Layer[]; rects: Rect[] } {
    const roots: Layer[] = [];
    const rects: Rect[] = [];
    for (const l of this.selectedRoots()) {
      const b = this.contentBounds(l);
      if (!b || this.isLocked(l, 'lockPosition')) continue;
      roots.push(l);
      rects.push(b);
    }
    return { roots, rects };
  }

  /**
   * Zarovnání vybraných vrstev: k výběru (je-li), jinak k sobě navzájem (více vrstev), jinak k plátnu.
   */
  alignLayers(kind: AlignKind): void {
    const { roots, rects } = this.alignItems();
    if (!roots.length) return;
    const sel = this.doc.selection?.bounds();
    let ref: Rect | null = sel ?? null;
    if (!ref && rects.length > 1) for (const r of rects) ref = unionRect(ref, r);
    ref ??= { x: 0, y: 0, width: this.doc.width, height: this.doc.height };
    const labels: Record<AlignKind, string> = {
      left: 'Zarovnat levé okraje',
      hcenter: 'Zarovnat na střed vodorovně',
      right: 'Zarovnat pravé okraje',
      top: 'Zarovnat horní okraje',
      vcenter: 'Zarovnat na střed svisle',
      bottom: 'Zarovnat dolní okraje',
    };
    this.moveRoots(roots, alignOffsets(rects, ref, kind), labels[kind]);
  }

  /** Stejné mezery mezi vybranými vrstvami (aspoň tři). */
  distributeLayers(axis: DistributeAxis): void {
    const { roots, rects } = this.alignItems();
    if (roots.length < 3) return;
    this.moveRoots(roots, distributeOffsets(rects, axis), axis === 'h' ? 'Rozmístit vodorovně' : 'Rozmístit svisle');
  }

  /** Ořezovou masku lze vytvořit (vrstva má pod sebou sourozence) nebo uvolnit. */
  canToggleClipping(): boolean {
    const active = this.doc.activeLayer;
    if (!active || active.isGroup) return false;
    if (active.clipped) return true;
    const below = this.doc.layers[this.doc.indexOf(active.id) - 1];
    return !!below && below.parentId === active.parentId && !below.isGroup;
  }

  /** Ctrl+Alt+G: vybrané vrstvy ořízne do vrstvy pod nimi, nebo ořezovou masku uvolní. */
  toggleClippingMask(): void {
    const active = this.doc.activeLayer;
    if (!active || !this.canToggleClipping()) return;
    const on = !active.clipped;
    const label = on ? 'Vytvořit ořezovou masku' : 'Uvolnit ořezovou masku';
    const layers = this.selectedRoots().filter((l) => !l.isGroup && l.clipped !== on);
    const cmds = layers.map((l) => new SetLayerPropsCommand(this.doc, l.id, { clipped: !on }, { clipped: on }, label));
    if (cmds.length) this.execute(cmds.length === 1 ? cmds[0] : new MacroCommand(label, cmds));
  }

  /**
   * Alt+klik na vrstvu v panelu: ořízne jen tuto vrstvu do vrstvy pod ní, nebo ořezovou masku uvolní.
   * Vrací false, když to nejde (skupina, pod vrstvou nic není).
   */
  toggleClippingOf(id: string): boolean {
    const layer = this.doc.getLayer(id);
    if (!layer || layer.isGroup) return false;
    const below = this.doc.layers[this.doc.indexOf(id) - 1];
    if (!layer.clipped && (!below || below.parentId !== layer.parentId || below.isGroup)) return false;
    const on = !layer.clipped;
    this.execute(new SetLayerPropsCommand(this.doc, id, { clipped: !on }, { clipped: on }, on ? 'Vytvořit ořezovou masku' : 'Uvolnit ořezovou masku'));
    return true;
  }

  /** Zámek vrstvy včetně zámků skupin, do kterých patří. */
  isLocked(layer: Layer, kind: LockKind): boolean {
    for (let l: Layer | null = layer, guard = 0; l && guard < 100; guard++) {
      if (l[kind]) return true;
      l = l.parentId ? this.doc.getLayer(l.parentId) : null;
    }
    return false;
  }

  /** Zamkne / odemkne vybrané vrstvy (zámek „vše“ = všechny tři zámky). */
  setLocks(patch: Partial<Pick<LayerProps, LockKind>>, label: string): void {
    const layers = this.selectedRoots();
    const cmds: Command[] = [];
    for (const l of layers) {
      const before: Partial<LayerProps> = {};
      for (const k of Object.keys(patch) as LockKind[]) before[k] = l[k];
      if (Object.keys(patch).some((k) => l[k as LockKind] !== patch[k as LockKind])) cmds.push(new SetLayerPropsCommand(this.doc, l.id, before, patch, label));
    }
    if (cmds.length) this.execute(cmds.length === 1 ? cmds[0] : new MacroCommand(label, cmds));
  }

  /** Posune vrstvy o (dx, dy) jako jeden krok historie. */
  offsetLayers(layers: Layer[], dx: number, dy: number, label: string): void {
    if (!layers.length || (!dx && !dy)) return;
    const cmds = layers.map((l) => new SetLayerPropsCommand(this.doc, l.id, { x: l.x, y: l.y }, { x: l.x + dx, y: l.y + dy }, label));
    this.execute(cmds.length === 1 ? cmds[0] : new MacroCommand(label, cmds));
  }

  /** Zapíše posun, který už proběhl naživo (tažení nástrojem Přesun). */
  commitLayerMoves(items: Array<{ id: string; x: number; y: number }>, label: string): void {
    const cmds: Command[] = [];
    for (const it of items) {
      const l = this.doc.getLayer(it.id);
      if (l && (l.x !== it.x || l.y !== it.y)) cmds.push(new SetLayerPropsCommand(this.doc, l.id, { x: it.x, y: it.y }, { x: l.x, y: l.y }, label));
    }
    if (cmds.length) this.history.push(cmds.length === 1 ? cmds[0] : new MacroCommand(label, cmds));
  }

  moveLayer(id: string, toIndex: number): void {
    const from = this.doc.indexOf(id);
    const to = Math.max(0, Math.min(toIndex, this.doc.layers.length - 1));
    if (from < 0 || from === to) return;
    this.execute(new MoveLayerCommand(this.doc, id, to));
  }

  /** Přesun vrstvy / skupiny ve stromu – nad nebo pod cíl, případně do skupiny (tažení v panelu). */
  moveLayerTo(id: string, targetId: string, position: DropPosition): boolean {
    return this.applyStructure(moveNode(this.doc.layers, id, targetId, position), id, 'Změna pořadí vrstev');
  }

  /** Ctrl+] / Ctrl+[ (se Shift = zcela nahoru / dolů) v rámci skupiny; na okraji vrstva ze skupiny vystoupí. */
  shiftActiveLayer(dir: 1 | -1, toEnd = false): boolean {
    const id = this.doc.activeLayerId;
    return !!id && this.applyStructure(shiftNode(this.doc.layers, id, dir, toEnd), id, 'Změna pořadí vrstev');
  }

  canShiftActive(dir: 1 | -1): boolean {
    const id = this.doc.activeLayerId;
    return !!id && shiftNode(this.doc.layers, id, dir) !== null;
  }

  // ---- skupiny vrstev (0.6) ----

  private nextGroupName(): string {
    const n = this.doc.layers.filter((l) => l.isGroup).length + 1;
    return `Skupina ${n}`;
  }

  /** Nová prázdná skupina nad aktivní vrstvou. */
  newGroup(): void {
    const group = new Layer(1, 1, { name: this.nextGroupName(), group: true });
    this.applyStructure(insertGroup(this.doc.layers, this.doc.activeLayerId, group), group.id, 'Nová skupina');
  }

  /** Ctrl+G: vybrané vrstvy (nebo aktivní vrstvu / skupinu) vloží do nové skupiny na místo nejvyšší z nich. */
  groupActiveLayer(): void {
    const active = this.doc.activeLayer;
    if (!active) return;
    const group = new Layer(1, 1, { name: this.nextGroupName(), group: true });
    const roots = this.selectedRoots();
    const list =
      roots.length > 1
        ? collapseNodes(this.doc.layers, roots.map((l) => l.id), (removed) => ({ item: group, children: removed }))
        : wrapInGroup(this.doc.layers, active.id, group);
    this.applyStructure(list, group.id, 'Seskupit vrstvy');
  }

  /** Sloučí vybrané vrstvy do jedné (Ctrl+E při výběru více vrstev); název dostane nejvyšší z nich. */
  mergeSelected(): boolean {
    const roots = this.selectedRoots();
    if (roots.length < 2) return false;
    const content = roots.flatMap((l) => this.subtree(l));
    const inOrder = this.doc.layers.filter((l) => content.includes(l));
    const leaves = inOrder.filter((l) => !l.isGroup);
    if (!leaves.length) return false;
    let rect: Rect | null = null;
    for (const l of leaves) rect = unionRect(rect, layerRectWithEffects(l));
    const r = rect!;
    const merged = new Layer(r.width, r.height, { name: roots[roots.length - 1].name, x: r.x, y: r.y });
    compositeLayers(merged.ctx, inOrder, r.x, r.y);
    const list = collapseNodes(this.doc.layers, roots.map((l) => l.id), { item: merged, children: [] });
    return this.applyStructure(list, merged.id, 'Sloučit vrstvy');
  }

  /** Shift+Ctrl+G: zruší aktivní skupinu (nebo skupinu, ve které je aktivní vrstva). */
  ungroupActive(): void {
    const active = this.doc.activeLayer;
    const groupId = active?.isGroup ? active.id : active?.parentId;
    if (!active || !groupId) return;
    const list = ungroup(this.doc.layers, groupId);
    const nextActive = active.isGroup ? (this.subtree(active)[this.subtree(active).length - 2]?.id ?? null) : active.id;
    this.applyStructure(list, nextActive, 'Zrušit seskupení');
  }

  /** Sbalí / rozbalí skupinu v panelu (bez historie). */
  toggleCollapsed(id: string): void {
    const layer = this.doc.getLayer(id);
    if (!layer?.isGroup) return;
    layer.collapsed = !layer.collapsed;
    this.doc.notifyStructure();
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

  // ---- slučování vrstev (0.5) ----

  private applyLayerList(list: LayerList | null, label: string): boolean {
    if (!list) return false;
    this.execute(new LayerListCommand(this.doc, list.items, list.active, label, list.parents));
    return true;
  }

  /** Sloučí aktivní vrstvu s vrstvou pod ní, u skupiny její obsah (Ctrl+E). */
  mergeDown(): boolean {
    return this.applyLayerList(mergeDown(this.doc), this.doc.activeLayer?.isGroup ? 'Sloučit skupinu' : 'Sloučit dolů');
  }

  /** Sloučí všechny viditelné vrstvy do jedné (Ctrl+Shift+E). */
  mergeVisible(): boolean {
    return this.applyLayerList(mergeVisible(this.doc), 'Sloučit viditelné');
  }

  /** Zploští obraz do jedné vrstvy Pozadí (skryté vrstvy se zahodí). */
  flattenImage(): void {
    this.applyLayerList(flatten(this.doc), 'Zploštit obraz');
  }

  // ---- textové vrstvy (0.6) ----

  /** Textovou vrstvu převede na rastrovou (kopie plátna bez textových dat) jako krok historie. */
  rasterizeLayer(layer: Layer, label = layer.fill ? 'Rastrovat výplňovou vrstvu' : 'Rastrovat text'): boolean {
    if ((!layer.text && !layer.fill) || this.isLocked(layer, 'lockPixels')) return false;
    const before = captureLayer(layer);
    this.execute(new LayerStateCommand(this.doc, layer.id, before, { ...before, canvas: cloneCanvas(layer.canvas) }, label));
    return true;
  }

  /** Stav textové vrstvy s novými daty – zarovnaný okraj zůstane na místě, maska se přizpůsobí. */
  textLayerState(layer: Layer, input: TextData): LayerState {
    const old = layer.text ?? input;
    const { origin, ...data } = input;
    const canvas = renderText(data);
    // Text z PSD se poprvé umístí podle účaří z Photoshopu, dál se drží zarovnaný okraj.
    const anchor = origin ?? old.origin;
    const pos = anchor
      ? positionForClick(anchor.x, anchor.y, data, canvas.width)
      : anchoredPosition({ x: layer.x, y: layer.y, width: layer.width, data: old }, { width: canvas.width, data });
    const rect = { ...pos, width: canvas.width, height: canvas.height };
    const mask = layer.mask && refitMask(layer.mask, { x: layer.x, y: layer.y, width: layer.width, height: layer.height }, rect);
    return { canvas, mask, ...pos };
  }

  /** Změní text / písmo textové vrstvy jako krok historie. */
  setTextData(layerId: string, data: TextData, label = 'Upravit text'): void {
    const layer = this.doc.getLayer(layerId);
    if (!layer?.text || this.isLocked(layer, 'lockPixels')) return;
    this.execute(new LayerStateCommand(this.doc, layer.id, captureLayer(layer), this.textLayerState(layer, data), label));
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
    if (!layer) return;
    // U skupiny se vyberou pixely všech jejích vrstev.
    const mask = layer.isGroup
      ? rasterizeMask(this.doc.width, this.doc.height, (ctx) => compositeLayers(ctx, this.subtree(layer).map(asVisible)))
      : layerAlphaMask(this.doc, layer);
    this.setSelection(mask, 'Vybrat pixely');
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
    if (target === 'pixels') {
      if (this.isLocked(layer, 'lockPixels')) return null;
      this.rasterizeLayer(layer);
    }
    const canvas = target === 'mask' ? layer.mask : layer.canvas;
    const r = canvas && clipRect(rect, canvas.width, canvas.height);
    if (!canvas || !r) return null;
    const ctx = get2d(canvas);
    const before = ctx.getImageData(r.x, r.y, r.width, r.height);
    ctx.save();
    draw(ctx);
    ctx.restore();
    if (target === 'pixels' && this.isLocked(layer, 'lockTransparency')) restoreAlpha(ctx, r.x, r.y, before);
    const after = ctx.getImageData(r.x, r.y, r.width, r.height);
    this.doc.notifyPixels(layer.id, { x: r.x + layer.x, y: r.y + layer.y, width: r.width, height: r.height });
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
    // Se zamčenou průhledností se maže barvou pozadí (jako ve Photoshopu).
    if (this.isLocked(t.layer, 'lockTransparency')) return this.fillSelection(this.settings.secondaryColor, 'Vymazat');
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

  /**
   * Úpravy → Vyplnit vzorkem: výběr (bez výběru celou vrstvu) dlaždicemi vzorku zarovnanými na počátek
   * dokumentu. Do masky nevyplňuje (vrací false).
   */
  fillPattern(patternId: string, label = 'Vyplnit vzorkem'): boolean {
    const t = this.paintTarget();
    if (!t || t.kind === 'mask' || !getPattern(patternId)) return false;
    const { layer } = t;
    const sel = this.doc.selection;
    const rect = this.selectionRectIn(layer);
    const cmd = this.paintLayer(layer, rect, label, (ctx) => {
      if (!sel) {
        ctx.fillStyle = canvasPattern(ctx, patternId, -layer.x, -layer.y)!;
        ctx.fillRect(0, 0, layer.width, layer.height);
        return;
      }
      const fill = createCanvas(sel.width, sel.height);
      const f = get2d(fill);
      f.drawImage(maskToCanvas(sel), 0, 0);
      f.globalCompositeOperation = 'source-in';
      f.fillStyle = canvasPattern(f, patternId)!;
      f.fillRect(0, 0, fill.width, fill.height);
      ctx.drawImage(fill, -layer.x, -layer.y);
    });
    if (!cmd) return false;
    this.history.push(cmd);
    return true;
  }

  /** Úpravy → Definovat vzorek: sloučený viditelný obraz ve výběru (bez výběru celé plátno). */
  patternSource(): ImageData | null {
    const piece = extractPixels({ canvas: flattenDocument(this.doc), x: 0, y: 0 }, this.doc.selection);
    if (!piece) return null;
    return get2d(piece.canvas).getImageData(0, 0, piece.canvas.width, piece.canvas.height);
  }

  /**
   * Úpravy → Obrys: obtáhne okraj výběru (bez výběru okraj obsahu aktivní vrstvy) barvou.
   * V masce kreslí jasem barvy. Vrací false, když není co obtáhnout.
   */
  strokeSelection(o: { width: number; position: StrokePosition; color: string; opacity: number }): boolean {
    const t = this.paintTarget();
    if (!t) return false;
    const { layer } = t;
    const source = this.doc.selection ?? layerAlphaMask(this.doc, layer);
    const band = strokeMask(source, o.width, o.position);
    const b = band.bounds();
    if (!b) return false;
    const shape = maskToCanvas(band);
    const rect = { x: b.x - layer.x, y: b.y - layer.y, width: b.width, height: b.height };
    const cmd = this.paintLayer(
      layer,
      rect,
      'Obrys',
      (ctx) => {
        if (t.kind === 'mask') return paintMaskValue(ctx, shape, -layer.x, -layer.y, luminance(o.color), o.opacity);
        const piece = createCanvas(b.width, b.height);
        const pctx = get2d(piece);
        pctx.drawImage(shape, -b.x, -b.y);
        pctx.globalCompositeOperation = 'source-in';
        pctx.fillStyle = o.color;
        pctx.fillRect(0, 0, b.width, b.height);
        ctx.globalAlpha = o.opacity;
        ctx.drawImage(piece, rect.x, rect.y);
      },
      t.kind,
    );
    if (!cmd) return false;
    this.history.push(cmd);
    return true;
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
    // Skupina nemá vlastní pixely.
    if (!layer || layer.isGroup) return null;
    if (this.maskTarget && layer.mask) return { layer, canvas: layer.mask, ctx: get2d(layer.mask), kind: 'mask' };
    // Vrstva úprav nemá pixely – kreslí se do její masky (jako ve Photoshopu).
    if (layer.adjustment) return layer.mask ? { layer, canvas: layer.mask, ctx: get2d(layer.mask), kind: 'mask' } : null;
    if (this.isLocked(layer, 'lockPixels')) return null;
    // Kreslit lze jen do rastrové vrstvy – text se nejdřív zrastruje (samostatný krok historie).
    this.rasterizeLayer(layer);
    return { layer, canvas: layer.canvas, ctx: layer.ctx, kind: 'pixels' };
  }

  /**
   * Přidá masku aktivní vrstvě. Varianty podle Photoshopu: odkrýt / skrýt vše, odkrýt / skrýt výběr,
   * z průhlednosti. Maska z výběru výběr zruší. Nová maska se stane cílem úprav.
   */
  addMask(kind: MaskKind): void {
    const layer = this.doc.activeLayer;
    const sel = this.doc.selection;
    if (!layer || layer.mask || layer.isGroup) return;
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
    const active = this.doc.activeLayer;
    const layer = active?.isGroup ? null : active;
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
    if (layer.isGroup) return this.duplicateActiveLayer();
    if (!this.doc.selection) return this.duplicateActiveLayer();
    const piece = extractPixels(layer, this.doc.selection);
    if (piece) this.addCanvasLayer(piece.canvas, piece.x, piece.y, this.nextLayerName(), 'Vrstva kopírováním');
  }

  /** Shift+Ctrl+J: vybrané pixely se přesunou do nové vrstvy. */
  layerViaCut(): void {
    const layer = this.doc.activeLayer;
    const sel = this.doc.selection;
    if (!layer || !sel || layer.isGroup) return;
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

/** Stejná vrstva, ale viditelná a se 100 % krytím (výběr pixelů skupiny bez ohledu na její zobrazení). */
function asVisible(layer: Layer): Layer {
  return Object.assign(Object.create(Object.getPrototypeOf(layer)) as Layer, layer, { visible: true });
}
