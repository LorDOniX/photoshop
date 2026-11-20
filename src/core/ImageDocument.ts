import type { Rect } from './canvas';
import { Emitter } from './Emitter';
import { Layer, type LayerProps } from './Layer';
import type { SelectionMask } from './selection/SelectionMask';

export type DocChange =
  | { kind: 'structure' }
  | { kind: 'active' }
  | { kind: 'props'; layerId: string }
  /** `rect` = změněná oblast v souřadnicích dokumentu (chybí = celá vrstva). */
  | { kind: 'pixels'; layerId: string; rect?: Rect }
  | { kind: 'selection' }
  | { kind: 'size' };

/**
 * Dokument = rozměry plátna + seznam vrstev (index 0 = nejspodnější) + výběr.
 * Metody jsou „nízkoúrovňové“ a nezapisují do historie – to dělají příkazy (commands).
 */
export class ImageDocument extends Emitter<{ change: DocChange }> {
  layers: Layer[] = [];
  activeLayerId: string | null = null;
  /** Další vrstvy vybrané v panelu spolu s aktivní (výběr více vrstev, není v historii). */
  private extraSelected = new Set<string>();
  /** Aktuální výběr (maska o velikosti dokumentu) nebo null = nic není vybráno. */
  selection: SelectionMask | null = null;
  /** Zvyšuje se při každé změně – slouží k invalidaci cache (vzorkování pixelů apod.). */
  version = 0;

  constructor(
    public width: number,
    public height: number,
  ) {
    super();
  }

  private changed(change: DocChange): void {
    this.version++;
    this.emit('change', change);
  }

  setSelection(mask: SelectionMask | null): void {
    const next = mask && !mask.isEmpty() ? mask : null;
    if (next === this.selection) return;
    this.selection = next;
    this.changed({ kind: 'selection' });
  }

  /** Změní rozměry plátna (vrstvy ani výběr neupravuje – to dělají příkazy). */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.changed({ kind: 'size' });
  }

  get activeLayer(): Layer | null {
    return this.activeLayerId ? this.getLayer(this.activeLayerId) : null;
  }

  getLayer(id: string): Layer | null {
    return this.layers.find((l) => l.id === id) ?? null;
  }

  indexOf(id: string): number {
    return this.layers.findIndex((l) => l.id === id);
  }

  private requireIndex(id: string): number {
    const index = this.indexOf(id);
    if (index < 0) throw new Error(`Vrstva ${id} neexistuje`);
    return index;
  }

  insertLayer(layer: Layer, index = this.layers.length): void {
    const i = Math.max(0, Math.min(index, this.layers.length));
    this.layers.splice(i, 0, layer);
    if (!this.activeLayerId) this.activeLayerId = layer.id;
    this.changed({ kind: 'structure' });
  }

  removeLayer(id: string): { layer: Layer; index: number } {
    const index = this.requireIndex(id);
    const [layer] = this.layers.splice(index, 1);
    if (this.activeLayerId === id) {
      const neighbour = this.layers[Math.min(index, this.layers.length - 1)] ?? null;
      this.activeLayerId = neighbour?.id ?? null;
    }
    this.changed({ kind: 'structure' });
    return { layer, index };
  }

  moveLayer(id: string, toIndex: number): void {
    const from = this.requireIndex(id);
    const to = Math.max(0, Math.min(toIndex, this.layers.length - 1));
    if (from === to) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(to, 0, layer);
    this.changed({ kind: 'structure' });
  }

  /** Nahradí celý seznam vrstev (slučování, zploštění, skupiny). Rodiče vrstev nastavuje volající. */
  setLayers(layers: Layer[], activeId: string | null): void {
    this.layers = [...layers];
    this.activeLayerId = activeId && this.getLayer(activeId) ? activeId : (this.layers.at(-1)?.id ?? null);
    this.extraSelected.clear();
    this.changed({ kind: 'structure' });
  }

  setActive(id: string | null): void {
    if (id !== null && !this.getLayer(id)) return;
    if (this.activeLayerId === id && !this.extraSelected.size) return;
    this.activeLayerId = id;
    this.extraSelected.clear();
    this.changed({ kind: 'active' });
  }

  /** Vybrané vrstvy (aktivní + další vybrané) v pořadí seznamu, odspodu nahoru. */
  get selectedLayerIds(): string[] {
    return this.layers.filter((l) => l.id === this.activeLayerId || this.extraSelected.has(l.id)).map((l) => l.id);
  }

  isSelected(id: string): boolean {
    return id === this.activeLayerId || this.extraSelected.has(id);
  }

  /** Výběr více vrstev v panelu: `active` je hlavní (vlastnosti, kreslení), ostatní jsou přibrané. */
  setLayerSelection(ids: readonly string[], active: string): void {
    if (!this.getLayer(active)) return;
    this.activeLayerId = active;
    this.extraSelected = new Set(ids.filter((id) => id !== active && this.getLayer(id)));
    this.changed({ kind: 'active' });
  }

  updateLayer(id: string, props: Partial<LayerProps>): void {
    this.layers[this.requireIndex(id)].setProps(props);
    this.changed({ kind: 'props', layerId: id });
  }

  /** Nastaví / odebere masku vrstvy (null = bez masky). */
  setLayerMask(id: string, mask: HTMLCanvasElement | null): void {
    this.layers[this.requireIndex(id)].mask = mask;
    this.changed({ kind: 'props', layerId: id });
  }

  /** Oznámí změnu struktury bez změny seznamu (sbalení skupiny v panelu). */
  notifyStructure(): void {
    this.changed({ kind: 'structure' });
  }

  /** Oznámí změnu pixelů vrstvy (překreslení, náhledy). */
  notifyPixels(layerId: string, rect?: Rect): void {
    this.changed({ kind: 'pixels', layerId, rect });
  }

  /** Nahradí plátno, masku a pozici vrstvy (transformace, přesun pixelů, změna velikosti). */
  setLayerState(id: string, state: LayerState): void {
    const layer = this.layers[this.requireIndex(id)];
    layer.setCanvas(state.canvas);
    layer.mask = state.mask;
    layer.x = state.x;
    layer.y = state.y;
    this.changed({ kind: 'props', layerId: id });
  }

  /** Stav celého dokumentu (rozměry, plátna vrstev, výběr) – reference, ne kopie. */
  captureState(): DocState {
    return {
      width: this.width,
      height: this.height,
      selection: this.selection,
      layers: new Map(this.layers.map((l) => [l.id, captureLayer(l)])),
    };
  }

  applyState(state: DocState): void {
    if (state.width !== this.width || state.height !== this.height) this.resize(state.width, state.height);
    for (const [id, ls] of state.layers) if (this.getLayer(id)) this.setLayerState(id, ls);
    this.setSelection(state.selection);
  }
}

/** Plátno, maska a pozice vrstvy. Plátna se při operacích nahrazují novými, proto stačí reference. */
export interface LayerState {
  canvas: HTMLCanvasElement;
  mask: HTMLCanvasElement | null;
  x: number;
  y: number;
}

export interface DocState {
  width: number;
  height: number;
  selection: SelectionMask | null;
  layers: Map<string, LayerState>;
}

export function captureLayer(layer: Layer): LayerState {
  return { canvas: layer.canvas, mask: layer.mask, x: layer.x, y: layer.y };
}

export function createBlankDocument(width: number, height: number, background: string | null): ImageDocument {
  const doc = new ImageDocument(width, height);
  const layer = new Layer(width, height, { name: background ? 'Pozadí' : 'Vrstva 1' });
  if (background) {
    layer.ctx.fillStyle = background;
    layer.ctx.fillRect(0, 0, width, height);
  }
  doc.insertLayer(layer);
  return doc;
}
