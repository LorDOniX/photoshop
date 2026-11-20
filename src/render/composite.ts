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

/**
 * Vykreslí jednu vrstvu (s maskou) posunutou o (−ox, −oy). `withProps` = i s krytím a režimem prolnutí
 * vrstvy; bez nich se kreslí jen pixely (sloučená vrstva si krytí a režim ponechá jako vlastnosti).
 */
export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, ox = 0, oy = 0, withProps = true): void {
  if (withProps && layer.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = withProps ? layer.opacity : 1;
  ctx.globalCompositeOperation = withProps ? layer.blendMode : 'source-over';
  const x = layer.x - ox;
  const y = layer.y - oy;
  if (layer.hasActiveMask) {
    ctx.drawImage(maskedLayer(layer), 0, 0, layer.width, layer.height, x, y, layer.width, layer.height);
  } else ctx.drawImage(layer.canvas, x, y);
  ctx.restore();
}

/**
 * Složí viditelné vrstvy (zdola nahoru) do kontextu; (ox, oy) je poloha levého horního rohu
 * kontextu v souřadnicích dokumentu. Kontext se předem vymaže.
 */
export function compositeLayers(ctx: CanvasRenderingContext2D, layers: readonly Layer[], ox = 0, oy = 0): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const layer of layers) if (layer.visible) drawLayer(ctx, layer, ox, oy);
  ctx.restore();
}

/** Složí viditelné vrstvy dokumentu do kontextu o velikosti dokumentu (s maskami). */
export function compositeDocument(doc: ImageDocument, ctx: CanvasRenderingContext2D): void {
  compositeLayers(ctx, doc.layers);
}

export function flattenDocument(doc: ImageDocument): HTMLCanvasElement {
  const canvas = createCanvas(doc.width, doc.height);
  compositeDocument(doc, get2d(canvas));
  return canvas;
}
