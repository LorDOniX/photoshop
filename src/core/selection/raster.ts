import { createCanvas, get2d, type Rect } from '../canvas';
import type { ImageDocument } from '../ImageDocument';
import type { Layer } from '../Layer';
import { compositeDocument } from '../../render/composite';
import { computeEdgeMap } from './livewire';
import { SelectionMask } from './SelectionMask';

/*
 * Napojení výběru na Canvas 2D (pouze v prohlížeči). Výsledky se cachují podle instance masky
 * (masky jsou neměnné) nebo podle verze dokumentu.
 */

const canvasCache = new WeakMap<SelectionMask, HTMLCanvasElement>();
const pathCache = new WeakMap<SelectionMask, Path2D>();

/** Maska jako bílý canvas s alfou = hodnota výběru (pro `destination-in` / `destination-out`). */
export function maskToCanvas(mask: SelectionMask): HTMLCanvasElement {
  let canvas = canvasCache.get(mask);
  if (canvas) return canvas;
  canvas = createCanvas(mask.width, mask.height);
  const ctx = get2d(canvas);
  const img = ctx.createImageData(mask.width, mask.height);
  const d = img.data;
  for (let p = 0, i = 0; p < mask.data.length; p++, i += 4) {
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = mask.data[p];
  }
  ctx.putImageData(img, 0, 0);
  canvasCache.set(mask, canvas);
  return canvas;
}

/** Obrys výběru jako Path2D v souřadnicích dokumentu („pochodující mravenci“). */
export function outlinePath(mask: SelectionMask): Path2D {
  let path = pathCache.get(mask);
  if (path) return path;
  path = new Path2D();
  const s = mask.outline();
  for (let i = 0; i < s.length; i += 4) {
    path.moveTo(s[i], s[i + 1]);
    path.lineTo(s[i + 2], s[i + 3]);
  }
  pathCache.set(mask, path);
  return path;
}

/** Vykreslí tvar (cestu vyplněnou bílou) a převede ho na masku. */
export function rasterizeMask(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  antiAlias = true,
): SelectionMask {
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  draw(ctx);
  const src = ctx.getImageData(0, 0, width, height).data;
  const mask = new SelectionMask(width, height);
  for (let p = 0, i = 3; p < mask.data.length; p++, i += 4) {
    mask.data[p] = antiAlias ? src[i] : src[i] >= 128 ? 255 : 0;
  }
  return mask;
}

/** Polygon (body [x0, y0, x1, y1, ...]) jako maska. */
export function polygonMask(width: number, height: number, points: readonly number[], antiAlias = true): SelectionMask {
  return rasterizeMask(
    width,
    height,
    (ctx) => {
      ctx.beginPath();
      ctx.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
      ctx.closePath();
      ctx.fill('evenodd');
    },
    antiAlias,
  );
}

/** Výběr z neprůhledných pixelů vrstvy (Ctrl+klik na náhled ve Photoshopu). */
export function layerAlphaMask(doc: ImageDocument, layer: Layer): SelectionMask {
  return rasterizeMask(doc.width, doc.height, (ctx) => ctx.drawImage(layer.canvas, layer.x, layer.y));
}

interface PixelCache {
  version: number;
  key: string;
  image: ImageData;
  edges?: Uint8Array;
}
const pixelCache = new WeakMap<ImageDocument, PixelCache>();

/**
 * Pixely dokumentu v souřadnicích dokumentu – buď složený obraz (`sampleAll`), nebo jen aktivní vrstva.
 * Cache se zneplatní při jakékoli změně dokumentu.
 */
export function samplePixels(doc: ImageDocument, sampleAll: boolean): ImageData {
  return sampleEntry(doc, sampleAll).image;
}

/** Mapa hran pro magnetické laso (ze složeného obrazu). */
export function edgeMap(doc: ImageDocument): Uint8Array {
  const entry = sampleEntry(doc, true);
  entry.edges ??= computeEdgeMap(entry.image.data, doc.width, doc.height);
  return entry.edges;
}

function sampleEntry(doc: ImageDocument, sampleAll: boolean): PixelCache {
  const key = sampleAll ? 'all' : `layer:${doc.activeLayerId}`;
  const cached = pixelCache.get(doc);
  if (cached && cached.version === doc.version && cached.key === key) return cached;
  const canvas = createCanvas(doc.width, doc.height);
  const ctx = get2d(canvas);
  if (sampleAll) compositeDocument(doc, ctx);
  else {
    const layer = doc.activeLayer;
    if (layer) ctx.drawImage(layer.canvas, layer.x, layer.y);
  }
  const entry: PixelCache = { version: doc.version, key, image: ctx.getImageData(0, 0, doc.width, doc.height) };
  pixelCache.set(doc, entry);
  return entry;
}

/**
 * Vyřízne pixely zdroje (vrstva nebo složený obraz) podle výběru. Bez výběru vrátí celý zdroj.
 * Výsledek má pozici v souřadnicích dokumentu.
 */
export function extractPixels(
  source: { canvas: HTMLCanvasElement; x: number; y: number },
  mask: SelectionMask | null,
): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  const srcRect: Rect = { x: source.x, y: source.y, width: source.canvas.width, height: source.canvas.height };
  const b = mask?.bounds() ?? srcRect;
  const x0 = Math.max(b.x, srcRect.x);
  const y0 = Math.max(b.y, srcRect.y);
  const x1 = Math.min(b.x + b.width, srcRect.x + srcRect.width);
  const y1 = Math.min(b.y + b.height, srcRect.y + srcRect.height);
  if (x1 <= x0 || y1 <= y0) return null;
  const canvas = createCanvas(x1 - x0, y1 - y0);
  const ctx = get2d(canvas);
  ctx.drawImage(source.canvas, source.x - x0, source.y - y0);
  if (mask) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskToCanvas(mask), -x0, -y0);
  }
  return { canvas, x: x0, y: y0 };
}
