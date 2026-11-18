import { createCanvas, get2d } from '../core/canvas';
import type { ImageDocument } from '../core/ImageDocument';
import type { Layer } from '../core/Layer';

/** Pomocný canvas pro vrstvy s maskou (znovupoužívá se). */
let scratch: HTMLCanvasElement | null = null;

function maskedLayer(layer: Layer): HTMLCanvasElement {
  if (!scratch || scratch.width < layer.width || scratch.height < layer.height) {
    scratch = createCanvas(Math.max(layer.width, scratch?.width ?? 0), Math.max(layer.height, scratch?.height ?? 0));
  }
  const ctx = get2d(scratch);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, scratch.width, scratch.height);
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(layer.mask!, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return scratch;
}

/** Složí viditelné vrstvy dokumentu do kontextu o velikosti dokumentu (s maskami). */
export function compositeDocument(doc: ImageDocument, ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, doc.width, doc.height);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    if (layer.hasActiveMask) {
      ctx.drawImage(maskedLayer(layer), 0, 0, layer.width, layer.height, layer.x, layer.y, layer.width, layer.height);
    } else ctx.drawImage(layer.canvas, layer.x, layer.y);
  }
  ctx.restore();
}

export function flattenDocument(doc: ImageDocument): HTMLCanvasElement {
  const canvas = createCanvas(doc.width, doc.height);
  compositeDocument(doc, get2d(canvas));
  return canvas;
}
