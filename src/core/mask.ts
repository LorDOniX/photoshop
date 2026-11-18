import { createCanvas, get2d } from './canvas';
import type { Layer } from './Layer';
import { maskToCanvas } from './selection/raster';
import type { SelectionMask } from './selection/SelectionMask';

/*
 * Masky vrstev: hodnota masky je uložená v ALFA kanálu canvasu (0 = skryto, 255 = odkryto),
 * takže se při skládání použije přímo `destination-in`.
 */

/** Jas barvy #rrggbb v rozsahu 0..1 (černá = skrýt, bílá = odkrýt). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Number.parseInt(v, 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Nová maska vyplněná hodnotou 0..1. */
export function createMask(width: number, height: number, value: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  if (value > 0) {
    const ctx = get2d(canvas);
    ctx.globalAlpha = value;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

/**
 * Nastaví masku směrem k hodnotě `value` (0..1) tam, kde je `source` neprůhledný:
 * nová = stará · (1 − a) + value · a, kde a = alfa zdroje × `alpha`.
 * `source = null` znamená celou plochu.
 */
export function paintMaskValue(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource | null,
  dx: number,
  dy: number,
  value: number,
  alpha = 1,
): void {
  const draw = () => {
    if (source) ctx.drawImage(source, dx, dy);
    else ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  };
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'destination-out';
  draw();
  if (value > 0) {
    ctx.globalAlpha = alpha * value;
    ctx.globalCompositeOperation = 'lighter';
    draw();
  }
  ctx.restore();
}

/** Maska z výběru (v souřadnicích vrstvy); `invert` = skrýt výběr. */
export function maskFromSelection(selection: SelectionMask, layer: Layer, invert: boolean): HTMLCanvasElement {
  const mask = createMask(layer.width, layer.height, invert ? 1 : 0);
  const ctx = get2d(mask);
  ctx.globalCompositeOperation = invert ? 'destination-out' : 'source-over';
  ctx.drawImage(maskToCanvas(selection), -layer.x, -layer.y);
  return mask;
}

/** Maska z průhlednosti vrstvy (neprůhledné pixely = odkryto). */
export function maskFromAlpha(layer: Layer): HTMLCanvasElement {
  const mask = createCanvas(layer.width, layer.height);
  const ctx = get2d(mask);
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, mask.width, mask.height);
  return mask;
}

/** Náhled masky ve stupních šedi (bílá = odkryto) – pro panel vrstev. */
export function drawMaskPreview(target: CanvasRenderingContext2D, mask: HTMLCanvasElement, dx: number, dy: number, dw: number, dh: number): void {
  const tmp = createCanvas(Math.max(1, Math.round(dw)), Math.max(1, Math.round(dh)));
  const t = get2d(tmp);
  t.drawImage(mask, 0, 0, tmp.width, tmp.height);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = '#fff';
  t.fillRect(0, 0, tmp.width, tmp.height);
  target.fillStyle = '#000';
  target.fillRect(dx, dy, dw, dh);
  target.drawImage(tmp, dx, dy, dw, dh);
}
