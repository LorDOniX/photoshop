import { cloneCanvas, createCanvas, get2d } from '../canvas';
import type { LayerState } from '../ImageDocument';
import { maskToCanvas } from '../selection/raster';
import type { SelectionMask } from '../selection/SelectionMask';
import { boundingBox, type Transform } from './geometry';

export interface Piece {
  canvas: HTMLCanvasElement;
  /** Pozice levého horního rohu v souřadnicích dokumentu. */
  x: number;
  y: number;
}

/** Vykreslí zdroj s transformací; výsledek má velikost ohraničujícího obdélníku. */
export function renderTransformed(src: HTMLCanvasElement, t: Transform, smooth = true): Piece {
  const b = boundingBox(t);
  const canvas = createCanvas(b.width, b.height);
  const ctx = get2d(canvas);
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(t.cx - b.x, t.cy - b.y);
  ctx.rotate(t.angle);
  ctx.scale((t.flipX ? -1 : 1) * (t.w / src.width), (t.flipY ? -1 : 1) * (t.h / src.height));
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return { canvas, x: b.x, y: b.y };
}

/** Transformuje celou vrstvu (plátno i masku stejně). */
export function transformLayerState(state: LayerState, t: Transform): LayerState {
  const pixels = renderTransformed(state.canvas, t);
  let mask: HTMLCanvasElement | null = null;
  if (state.mask) {
    // Maska mimo původní plochu je skrytá (nic tam není); uvnitř se transformuje spolu s vrstvou.
    mask = renderTransformed(state.mask, t).canvas;
  }
  return { canvas: pixels.canvas, mask, x: pixels.x, y: pixels.y };
}

/** Kopie stavu vrstvy, ve které jsou vybrané pixely vymazané. */
export function clearSelected(state: LayerState, selection: SelectionMask): LayerState {
  const canvas = cloneCanvas(state.canvas);
  const ctx = get2d(canvas);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(maskToCanvas(selection), -state.x, -state.y);
  return { ...state, canvas };
}

/**
 * Vloží kus (v souřadnicích dokumentu) do vrstvy. Pokud kus přesahuje plátno vrstvy, plátno se zvětší;
 * maska se v nové ploše vyplní jako odkrytá.
 */
export function composeOnto(base: LayerState, piece: Piece): LayerState {
  const x0 = Math.min(base.x, piece.x);
  const y0 = Math.min(base.y, piece.y);
  const x1 = Math.max(base.x + base.canvas.width, piece.x + piece.canvas.width);
  const y1 = Math.max(base.y + base.canvas.height, piece.y + piece.canvas.height);
  const canvas = createCanvas(x1 - x0, y1 - y0);
  const ctx = get2d(canvas);
  ctx.drawImage(base.canvas, base.x - x0, base.y - y0);
  ctx.drawImage(piece.canvas, piece.x - x0, piece.y - y0);
  let mask = base.mask;
  if (mask && (canvas.width !== mask.width || canvas.height !== mask.height)) {
    const grown = createCanvas(canvas.width, canvas.height);
    const m = get2d(grown);
    m.fillStyle = '#fff';
    m.fillRect(0, 0, grown.width, grown.height);
    m.clearRect(base.x - x0, base.y - y0, mask.width, mask.height);
    m.drawImage(mask, base.x - x0, base.y - y0);
    mask = grown;
  }
  return { canvas, mask, x: x0, y: y0 };
}
