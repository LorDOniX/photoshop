import { createCanvas, get2d } from './canvas';
import { createId } from './id';

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** Režimy prolnutí ve skupinách (oddělovače v nabídce jako ve Photopea). */
export const BLEND_MODES: ReadonlyArray<{ value: BlendMode; label: string; group: number }> = [
  { value: 'source-over', label: 'Normální', group: 0 },
  { value: 'darken', label: 'Ztmavit', group: 1 },
  { value: 'multiply', label: 'Násobit', group: 1 },
  { value: 'color-burn', label: 'Ztmavit barvy', group: 1 },
  { value: 'lighten', label: 'Zesvětlit', group: 2 },
  { value: 'screen', label: 'Závoj', group: 2 },
  { value: 'color-dodge', label: 'Zesvětlit barvy', group: 2 },
  { value: 'overlay', label: 'Překrýt', group: 3 },
  { value: 'soft-light', label: 'Měkké světlo', group: 3 },
  { value: 'hard-light', label: 'Tvrdé světlo', group: 3 },
  { value: 'difference', label: 'Rozdíl', group: 4 },
  { value: 'exclusion', label: 'Vyloučit', group: 4 },
  { value: 'hue', label: 'Odstín', group: 5 },
  { value: 'saturation', label: 'Sytost', group: 5 },
  { value: 'color', label: 'Barva', group: 5 },
  { value: 'luminosity', label: 'Světlost', group: 5 },
];

export interface LayerProps {
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
  /** Posun vrstvy v souřadnicích dokumentu. */
  x: number;
  y: number;
}

export interface LayerInit extends Partial<LayerProps> {
  id?: string;
}

/** Rastrová vrstva – pixely drží vlastní canvas, vlastnosti řídí kompozici. */
export class Layer implements LayerProps {
  readonly id: string;
  name = 'Vrstva';
  visible = true;
  opacity = 1;
  blendMode: BlendMode = 'source-over';
  x = 0;
  y = 0;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor(width: number, height: number, init: LayerInit = {}) {
    const { id, ...props } = init;
    this.id = id ?? createId();
    this.canvas = createCanvas(width, height);
    this.ctx = get2d(this.canvas);
    this.setProps(props);
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  getProps(): LayerProps {
    const { name, visible, opacity, blendMode, x, y } = this;
    return { name, visible, opacity, blendMode, x, y };
  }

  setProps(props: Partial<LayerProps>): void {
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) (this as Record<string, unknown>)[key] = value;
    }
  }

  duplicate(): Layer {
    const copy = new Layer(this.width, this.height, { ...this.getProps(), name: `${this.name} kopie` });
    copy.ctx.drawImage(this.canvas, 0, 0);
    return copy;
  }
}
