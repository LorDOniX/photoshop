import { createCanvas, get2d } from '../core/canvas';
import type { ImageDocument } from '../core/ImageDocument';

/** Složí viditelné vrstvy dokumentu do kontextu o velikosti dokumentu. */
export function compositeDocument(doc: ImageDocument, ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, doc.width, doc.height);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    ctx.drawImage(layer.canvas, layer.x, layer.y);
  }
  ctx.restore();
}

export function flattenDocument(doc: ImageDocument): HTMLCanvasElement {
  const canvas = createCanvas(doc.width, doc.height);
  compositeDocument(doc, get2d(canvas));
  return canvas;
}
