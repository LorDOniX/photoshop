import { createCanvas, get2d } from './canvas';
import { overlayPoints, usedPatternIds } from './effects';
import type { Layer } from './Layer';
import { buildLut, gradientStops, renderGradient, type GradientDef, type GradientType } from './paint/gradient';
import { canvasPattern } from './patterns';

/*
 * Výplňová vrstva (Vrstva → Nová výplňová vrstva): pixely se vykreslí z nastavení a nastavení zůstane
 * u plátna (jako textová data – viz core/text.ts). Úprava pixelů vrstvu zrastruje, nové plátno data nemá.
 */

export type FillContent =
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; gradient: GradientDef; style: GradientType; angle: number; scale: number; reverse: boolean }
  | { kind: 'pattern'; patternId: string; scale: number };

export const FILL_NAMES: Record<FillContent['kind'], string> = {
  color: 'Výplň barvou',
  gradient: 'Výplň přechodem',
  pattern: 'Výplň vzorkem',
};

const fills = new WeakMap<HTMLCanvasElement, FillContent>();

export function getFillData(canvas: HTMLCanvasElement): FillContent | null {
  return fills.get(canvas) ?? null;
}

export function setFillData(canvas: HTMLCanvasElement, fill: FillContent): void {
  fills.set(canvas, structuredClone(fill));
}

/** Vykreslí výplň do nového plátna (přechod přes celé plátno, vzorek od levého horního rohu). */
export function renderFill(fill: FillContent, width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  if (fill.kind === 'color') {
    ctx.fillStyle = fill.color;
    ctx.fillRect(0, 0, width, height);
  } else if (fill.kind === 'gradient') {
    const { start, end } = overlayPoints({ x: 0, y: 0, width, height }, fill);
    const image = new ImageData(width, height);
    renderGradient(image.data, width, height, 0, 0, { type: fill.style, start, end, lut: buildLut(gradientStops(fill.gradient)), reverse: fill.reverse, dither: true });
    ctx.putImageData(image, 0, 0);
  } else {
    const pattern = canvasPattern(ctx, fill.patternId, 0, 0, fill.scale);
    if (pattern) {
      ctx.imageSmoothingEnabled = !(fill.scale >= 1 && Number.isInteger(fill.scale));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
    }
  }
  setFillData(canvas, fill);
  return canvas;
}

/** Vzorky, které vrstva používá (styl překrytí vzorkem i výplň vzorkem) – k uložení do souboru. */
export function layerPatternIds(layer: Layer): string[] {
  const fill = layer.fill;
  return [...usedPatternIds(layer.effects), ...(fill?.kind === 'pattern' ? [fill.patternId] : [])];
}
