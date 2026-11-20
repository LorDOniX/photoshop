import { canvasBytes, type Command } from '../History';
import type { ImageDocument } from '../ImageDocument';
import { parentForInsertion } from '../groups';
import type { Layer, LayerProps } from '../Layer';

export class AddLayerCommand implements Command {
  private prevActive: string | null = null;
  private parent: string | null | undefined;

  constructor(
    private readonly doc: ImageDocument,
    private readonly layer: Layer,
    private readonly index: number,
    readonly label = 'Nová vrstva',
  ) {}

  get bytes(): number {
    return canvasBytes(this.layer.canvas) + canvasBytes(this.layer.mask);
  }

  do(): void {
    this.prevActive = this.doc.activeLayerId;
    // Vrstva vložená mezi vrstvy skupiny do ní patří (rodič se určí při prvním provedení).
    this.parent ??= parentForInsertion(this.doc.layers, Math.min(this.index, this.doc.layers.length));
    this.layer.parentId = this.parent;
    this.doc.insertLayer(this.layer, this.index);
    this.doc.setActive(this.layer.id);
  }

  undo(): void {
    this.doc.removeLayer(this.layer.id);
    this.doc.setActive(this.prevActive);
  }
}

export class RemoveLayerCommand implements Command {
  private removed: { layer: Layer; index: number } | null = null;
  private prevActive: string | null = null;

  constructor(
    private readonly doc: ImageDocument,
    private readonly layerId: string,
    readonly label = 'Smazat vrstvu',
  ) {}

  get bytes(): number {
    const l = this.removed?.layer;
    return l ? canvasBytes(l.canvas) + canvasBytes(l.mask) : 0;
  }

  do(): void {
    this.prevActive = this.doc.activeLayerId;
    this.removed = this.doc.removeLayer(this.layerId);
  }

  undo(): void {
    if (!this.removed) return;
    this.doc.insertLayer(this.removed.layer, this.removed.index);
    this.doc.setActive(this.prevActive);
  }
}

export class MoveLayerCommand implements Command {
  private from = -1;

  constructor(
    private readonly doc: ImageDocument,
    private readonly layerId: string,
    private readonly toIndex: number,
    readonly label = 'Změna pořadí vrstev',
  ) {}

  do(): void {
    this.from = this.doc.indexOf(this.layerId);
    this.doc.moveLayer(this.layerId, this.toIndex);
  }

  undo(): void {
    this.doc.moveLayer(this.layerId, this.from);
  }
}

export class SetLayerPropsCommand implements Command {
  constructor(
    private readonly doc: ImageDocument,
    private readonly layerId: string,
    private readonly before: Partial<LayerProps>,
    private readonly after: Partial<LayerProps>,
    readonly label = 'Vlastnosti vrstvy',
  ) {}

  do(): void {
    this.doc.updateLayer(this.layerId, this.after);
  }

  undo(): void {
    this.doc.updateLayer(this.layerId, this.before);
  }
}

/**
 * Výměna celého seznamu vrstev i jejich zařazení do skupin (slučování, zploštění, skupiny,
 * přesun ve stromu). Vrstvy se nekopírují – příkaz drží reference na seznam a rodiče před a po.
 */
export class LayerListCommand implements Command {
  private readonly before: Layer[];
  private readonly beforeActive: string | null;
  private readonly beforeParents: Map<Layer, string | null>;
  private readonly afterParents: Map<Layer, string | null>;
  /** Výběr více vrstev před změnou – undo ho vrátí. */
  private readonly beforeSelected: string[];

  constructor(
    private readonly doc: ImageDocument,
    private readonly after: Layer[],
    private readonly afterActive: string | null,
    readonly label: string,
    /** Rodiče po změně (id → id skupiny); chybějící = aktuální `parentId` vrstvy. */
    parents?: Map<string, string | null>,
  ) {
    this.before = [...doc.layers];
    this.beforeActive = doc.activeLayerId;
    this.beforeSelected = doc.selectedLayerIds;
    this.beforeParents = new Map(this.before.map((l) => [l, l.parentId]));
    this.afterParents = new Map(after.map((l) => [l, parents?.has(l.id) ? parents.get(l.id)! : l.parentId]));
  }

  /** Vrstvy, které existují jen v jednom ze stavů (sloučené / odstraněné) – drží je historie. */
  get bytes(): number {
    const a = new Set(this.after);
    const b = new Set(this.before);
    let sum = 0;
    for (const l of [...this.before.filter((x) => !a.has(x)), ...this.after.filter((x) => !b.has(x))]) sum += canvasBytes(l.canvas) + canvasBytes(l.mask);
    return sum;
  }

  private apply(layers: Layer[], parents: Map<Layer, string | null>, active: string | null): void {
    for (const [layer, parent] of parents) layer.parentId = parent;
    this.doc.setLayers(layers, active);
  }

  do(): void {
    this.apply(this.after, this.afterParents, this.afterActive);
  }

  undo(): void {
    this.apply(this.before, this.beforeParents, this.beforeActive);
    if (this.beforeActive && this.beforeSelected.length > 1) this.doc.setLayerSelection(this.beforeSelected, this.beforeActive);
  }
}

/** Několik příkazů jako jeden krok historie (do v pořadí, undo pozpátku). */
export class MacroCommand implements Command {
  constructor(
    readonly label: string,
    private readonly commands: Command[],
  ) {}

  get bytes(): number {
    return this.commands.reduce((sum, c) => sum + (c.bytes ?? 0), 0);
  }

  do(): void {
    for (const c of this.commands) c.do();
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo();
  }
}

/** Co se na vrstvě upravuje: obrazové pixely, nebo maska. */
export type PaintTargetKind = 'pixels' | 'mask';

/** Změna pixelů v obdélníku vrstvy (nebo její masky) – drží stav před a po (jen dotčená oblast). */
export class PaintCommand implements Command {
  constructor(
    private readonly doc: ImageDocument,
    private readonly layerId: string,
    private readonly x: number,
    private readonly y: number,
    private readonly before: ImageData,
    private readonly after: ImageData,
    readonly label = 'Malování',
    private readonly target: PaintTargetKind = 'pixels',
  ) {}

  get bytes(): number {
    return this.before.data.length + this.after.data.length;
  }

  private apply(data: ImageData): void {
    const layer = this.doc.getLayer(this.layerId);
    const canvas = this.target === 'mask' ? layer?.mask : layer?.canvas;
    if (!layer || !canvas) return;
    canvas.getContext('2d')?.putImageData(data, this.x, this.y);
    this.doc.notifyPixels(this.layerId, { x: this.x + layer.x, y: this.y + layer.y, width: data.width, height: data.height });
  }

  do(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }
}

/** Přidání / odebrání / výměna masky vrstvy. Přidaná maska se zároveň zapne. */
export class SetMaskCommand implements Command {
  private prevEnabled = true;

  constructor(
    private readonly doc: ImageDocument,
    private readonly layerId: string,
    private readonly before: HTMLCanvasElement | null,
    private readonly after: HTMLCanvasElement | null,
    readonly label: string,
  ) {}

  get bytes(): number {
    return canvasBytes(this.before) + canvasBytes(this.after);
  }

  do(): void {
    const layer = this.doc.getLayer(this.layerId);
    if (!layer) return;
    this.prevEnabled = layer.maskEnabled;
    if (this.after) this.doc.updateLayer(this.layerId, { maskEnabled: true });
    this.doc.setLayerMask(this.layerId, this.after);
  }

  undo(): void {
    this.doc.setLayerMask(this.layerId, this.before);
    this.doc.updateLayer(this.layerId, { maskEnabled: this.prevEnabled });
  }
}
