import type { Adjustment } from './adjust';
import { getFillData, setFillData, type FillContent } from './fillLayer';
import { cloneCanvas, createCanvas, get2d } from './canvas';
import type { LayerEffects } from './effects';
import { createId } from './id';
import { getTextData, setTextData, type TextData } from './text';

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
  /**
   * Krytí výplně 0..1 (Výplň v panelu): ovlivní obsah a vnitřní styly (překrytí, vnitřní stín a záře),
   * ne stín, vnější záři a tah – s výplní 0 zůstanou vidět jen styly.
   */
  fillOpacity: number;
  blendMode: BlendMode;
  /** Posun vrstvy v souřadnicích dokumentu. */
  x: number;
  y: number;
  /** Maska se uplatňuje (Shift+klik na náhled masky ji vypne). */
  maskEnabled: boolean;
  /** Zámky: průhledné pixely (kreslí se jen do neprůhledných), obrazové pixely, pozice. */
  lockTransparency: boolean;
  lockPixels: boolean;
  lockPosition: boolean;
  /** Ořezová maska: vrstva je vidět jen v pixelech základní vrstvy pod ní (viz core/groups.ts clippingBase). */
  clipped: boolean;
  /** Styly vrstvy (stín, záře, tah, překrytí barvou); null = žádné. Viz core/effects.ts. */
  effects: LayerEffects | null;
  /**
   * Vrstva úprav: úprava všeho pod vrstvou (krytí a maska = síla); vlastní pixely nemá. Viz core/adjust.ts
   * a render/composite.ts.
   */
  adjustment: Adjustment | null;
}

export type LockKind = 'lockTransparency' | 'lockPixels' | 'lockPosition';
export const LOCK_KINDS: readonly LockKind[] = ['lockTransparency', 'lockPixels', 'lockPosition'];

export interface LayerInit extends Partial<LayerProps> {
  id?: string;
  /** Skupina vrstev (složka) – nemá vlastní pixely. */
  group?: boolean;
  parentId?: string | null;
}

/** Rastrová vrstva – pixely drží vlastní canvas, vlastnosti řídí kompozici. */
export class Layer implements LayerProps {
  readonly id: string;
  /** Skupina (složka) – v seznamu vrstev leží nad svými potomky, pixely nemá (plátno 1 × 1). */
  readonly isGroup: boolean;
  /** Skupina, do které vrstva patří (null = kořen dokumentu). Viz core/groups.ts. */
  parentId: string | null = null;
  /** Skupina je v panelu Vrstvy sbalená (jen stav zobrazení, nejde do historie). */
  collapsed = false;
  name = 'Vrstva';
  visible = true;
  opacity = 1;
  fillOpacity = 1;
  blendMode: BlendMode = 'source-over';
  x = 0;
  y = 0;
  maskEnabled = true;
  lockTransparency = false;
  lockPixels = false;
  lockPosition = false;
  clipped = false;
  effects: LayerEffects | null = null;
  adjustment: Adjustment | null = null;
  /** Počítadlo změn pixelů (ImageDocument.notifyPixels) – cache efektů pozná, že je má přepočítat. */
  pixelVersion = 0;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /**
   * Rastrová maska vrstvy: canvas stejné velikosti a pozice jako vrstva, viditelnost = **alfa** masky
   * (0 = skryto, 255 = odkryto). Posouvá se spolu s vrstvou.
   */
  mask: HTMLCanvasElement | null = null;

  constructor(width: number, height: number, init: LayerInit = {}) {
    const { id, group, parentId, ...props } = init;
    this.id = id ?? createId();
    this.isGroup = !!group;
    this.parentId = parentId ?? null;
    this.canvas = createCanvas(group ? 1 : width, group ? 1 : height);
    this.ctx = get2d(this.canvas);
    this.setProps(props);
  }

  get width(): number {
    return this.canvas.width;
  }

  /** Nahradí plátno vrstvy (jiná velikost po transformaci apod.). */
  setCanvas(canvas: HTMLCanvasElement): void {
    if (canvas === this.canvas) return;
    this.canvas = canvas;
    this.ctx = get2d(canvas);
  }

  get height(): number {
    return this.canvas.height;
  }

  /** Textová data, pokud je vrstva textová (vázaná na aktuální plátno – viz core/text.ts). */
  get text(): TextData | null {
    return getTextData(this.canvas);
  }

  /** Data výplňové vrstvy (vázaná na aktuální plátno – viz core/fillLayer.ts). */
  get fill(): FillContent | null {
    return getFillData(this.canvas);
  }

  /** Maska existuje a je zapnutá. */
  get hasActiveMask(): boolean {
    return this.mask !== null && this.maskEnabled;
  }

  getProps(): LayerProps {
    const { name, visible, opacity, fillOpacity, blendMode, x, y, maskEnabled, lockTransparency, lockPixels, lockPosition, clipped, effects, adjustment } = this;
    return { name, visible, opacity, fillOpacity, blendMode, x, y, maskEnabled, lockTransparency, lockPixels, lockPosition, clipped, effects, adjustment };
  }

  setProps(props: Partial<LayerProps>): void {
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) (this as Record<string, unknown>)[key] = value;
    }
  }

  duplicate(): Layer {
    const copy = new Layer(this.width, this.height, { ...this.getProps(), name: `${this.name} kopie` });
    copy.ctx.drawImage(this.canvas, 0, 0);
    const text = this.text;
    if (text) setTextData(copy.canvas, text);
    const fill = this.fill;
    if (fill) setFillData(copy.canvas, fill);
    if (this.adjustment) copy.adjustment = structuredClone(this.adjustment);
    if (this.mask) copy.mask = cloneCanvas(this.mask);
    return copy;
  }
}
