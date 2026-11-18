import type { Command } from '../History';
import type { ImageDocument } from '../ImageDocument';
import type { Layer, LayerProps } from '../Layer';

export class AddLayerCommand implements Command {
  private prevActive: string | null = null;

  constructor(
    private readonly doc: ImageDocument,
    private readonly layer: Layer,
    private readonly index: number,
    readonly label = 'Nová vrstva',
  ) {}

  do(): void {
    this.prevActive = this.doc.activeLayerId;
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

/** Několik příkazů jako jeden krok historie (do v pořadí, undo pozpátku). */
export class MacroCommand implements Command {
  constructor(
    readonly label: string,
    private readonly commands: Command[],
  ) {}

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

  private apply(data: ImageData): void {
    const layer = this.doc.getLayer(this.layerId);
    const canvas = this.target === 'mask' ? layer?.mask : layer?.canvas;
    if (!layer || !canvas) return;
    canvas.getContext('2d')?.putImageData(data, this.x, this.y);
    this.doc.notifyPixels(this.layerId);
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
