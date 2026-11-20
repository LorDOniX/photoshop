import { createCanvas, get2d } from './canvas';
import type { DocState, ImageDocument, LayerState } from './ImageDocument';
import { maskToCanvas, rasterizeMask } from './selection/raster';
import type { SelectionMask } from './selection/SelectionMask';
import type { Bounds } from './selection/SelectionMask';
import { compositeDocument } from '../render/composite';
import { refitMask, renderText } from './text';

/*
 * Operace s celým dokumentem. Každá vrací NOVÝ stav (nová plátna), původní zůstává beze změny –
 * editor pak oba stavy uloží do DocStateCommand (vratné).
 */

function mapLayers(doc: ImageDocument, fn: (s: LayerState) => LayerState): Map<string, LayerState> {
  const out = new Map<string, LayerState>();
  // Záhlaví skupin nemají pixely – zůstávají beze změny.
  for (const l of doc.layers) if (!l.isGroup) out.set(l.id, fn({ canvas: l.canvas, mask: l.mask, x: l.x, y: l.y }));
  return out;
}

/** Nakreslí zdroj do nového plátna dané velikosti. */
function redraw(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  draw(ctx);
  return canvas;
}

/** Výběr přenesený do nové velikosti dokumentu stejnou kreslicí operací jako vrstvy. */
function mapSelection(sel: SelectionMask | null, width: number, height: number, draw: (ctx: CanvasRenderingContext2D, src: HTMLCanvasElement) => void): SelectionMask | null {
  if (!sel) return null;
  const mask = rasterizeMask(width, height, (ctx) => draw(ctx, maskToCanvas(sel)));
  return mask.isEmpty() ? null : mask;
}

/** Velikost obrazu: převzorkuje všechny vrstvy, masky i výběr. */
export function resizeImage(doc: ImageDocument, width: number, height: number, smooth: boolean): DocState {
  const sx = width / doc.width;
  const sy = height / doc.height;
  const scale = (c: HTMLCanvasElement) =>
    redraw(Math.max(1, Math.round(c.width * sx)), Math.max(1, Math.round(c.height * sy)), (ctx) => {
      ctx.imageSmoothingEnabled = smooth;
      ctx.drawImage(c, 0, 0, ctx.canvas.width, ctx.canvas.height);
    });
  const layers = mapLayers(doc, (s) => ({ canvas: scale(s.canvas), mask: s.mask && scale(s.mask), x: Math.round(s.x * sx), y: Math.round(s.y * sy) }));
  // Textové vrstvy zůstanou textem – písmo se zvětší a text se vykreslí znovu (ostře).
  for (const l of doc.layers) {
    const text = l.text;
    const s = layers.get(l.id);
    if (!text || !s) continue;
    const canvas = renderText({ ...text, size: Math.max(1, Math.round(text.size * ((sx + sy) / 2) * 10) / 10) });
    const rect = { x: s.x, y: s.y, width: canvas.width, height: canvas.height };
    const mask = s.mask && refitMask(s.mask, { x: s.x, y: s.y, width: s.mask.width, height: s.mask.height }, rect);
    layers.set(l.id, { canvas, mask, x: s.x, y: s.y });
  }
  return {
    width,
    height,
    layers,
    selection: mapSelection(doc.selection, width, height, (ctx, src) => {
      ctx.imageSmoothingEnabled = smooth;
      ctx.drawImage(src, 0, 0, width, height);
    }),
  };
}

/** Posun obsahu podle kotvy (0 = vlevo nahoře … 8 = vpravo dole) při změně velikosti plátna. */
export function anchorOffset(oldW: number, oldH: number, newW: number, newH: number, anchor: number): { dx: number; dy: number } {
  const ax = anchor % 3;
  const ay = Math.floor(anchor / 3);
  return { dx: Math.round(((newW - oldW) * ax) / 2), dy: Math.round(((newH - oldH) * ay) / 2) };
}

/**
 * Velikost plátna: vrstvy se posunou podle kotvy. Spodní vrstva, která pokrývala celé plátno (pozadí),
 * se rozšíří a nová plocha se vyplní barvou `fill` (null = průhledná).
 */
export function resizeCanvas(doc: ImageDocument, width: number, height: number, anchor: number, fill: string | null): DocState {
  const { dx, dy } = anchorOffset(doc.width, doc.height, width, height, anchor);
  const bottom = doc.layers[0];
  const isBackground = (s: LayerState) => s.x === 0 && s.y === 0 && s.canvas.width === doc.width && s.canvas.height === doc.height;
  return {
    width,
    height,
    layers: mapLayers(doc, (s) => {
      if (fill && s.canvas === bottom?.canvas && isBackground(s)) {
        const canvas = redraw(width, height, (ctx) => {
          ctx.fillStyle = fill;
          ctx.fillRect(0, 0, width, height);
          ctx.clearRect(dx, dy, s.canvas.width, s.canvas.height);
          ctx.drawImage(s.canvas, dx, dy);
        });
        const mask =
          s.mask &&
          redraw(width, height, (ctx) => {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, width, height);
            ctx.clearRect(dx, dy, s.canvas.width, s.canvas.height);
            ctx.drawImage(s.mask!, dx, dy);
          });
        return { canvas, mask, x: 0, y: 0 };
      }
      return { ...s, x: s.x + dx, y: s.y + dy };
    }),
    selection: mapSelection(doc.selection, width, height, (ctx, src) => ctx.drawImage(src, dx, dy)),
  };
}

/** Otočení celého dokumentu o `quarterTurns` × 90° po směru hodinových ručiček (1, 2, 3). */
export function rotateDocument(doc: ImageDocument, quarterTurns: 1 | 2 | 3): DocState {
  const W = doc.width;
  const H = doc.height;
  const swap = quarterTurns % 2 === 1;
  const width = swap ? H : W;
  const height = swap ? W : H;
  const angle = (quarterTurns * Math.PI) / 2;
  /** Otočené plátno (rozměry se u 90°/270° prohodí). */
  const rot = (c: HTMLCanvasElement) =>
    redraw(swap ? c.height : c.width, swap ? c.width : c.height, (ctx) => {
      ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
      ctx.rotate(angle);
      ctx.drawImage(c, -c.width / 2, -c.height / 2);
    });
  const position = (s: LayerState) => {
    const w = s.canvas.width;
    const h = s.canvas.height;
    if (quarterTurns === 1) return { x: H - (s.y + h), y: s.x };
    if (quarterTurns === 2) return { x: W - (s.x + w), y: H - (s.y + h) };
    return { x: s.y, y: W - (s.x + w) };
  };
  return {
    width,
    height,
    layers: mapLayers(doc, (s) => ({ canvas: rot(s.canvas), mask: s.mask && rot(s.mask), ...position(s) })),
    selection: mapSelection(doc.selection, width, height, (ctx, src) => {
      ctx.translate(width / 2, height / 2);
      ctx.rotate(angle);
      ctx.drawImage(src, -W / 2, -H / 2);
    }),
  };
}

/** Převrácení celého dokumentu vodorovně (`h`) nebo svisle (`v`). */
export function flipDocument(doc: ImageDocument, axis: 'h' | 'v'): DocState {
  const W = doc.width;
  const H = doc.height;
  const flip = (c: HTMLCanvasElement, w = c.width, h = c.height) =>
    redraw(w, h, (ctx) => {
      if (axis === 'h') ctx.setTransform(-1, 0, 0, 1, w, 0);
      else ctx.setTransform(1, 0, 0, -1, 0, h);
      ctx.drawImage(c, 0, 0);
    });
  return {
    width: W,
    height: H,
    layers: mapLayers(doc, (s) => ({
      canvas: flip(s.canvas),
      mask: s.mask && flip(s.mask),
      x: axis === 'h' ? W - (s.x + s.canvas.width) : s.x,
      y: axis === 'v' ? H - (s.y + s.canvas.height) : s.y,
    })),
    selection: mapSelection(doc.selection, W, H, (ctx, src) => {
      if (axis === 'h') ctx.setTransform(-1, 0, 0, 1, W, 0);
      else ctx.setTransform(1, 0, 0, -1, 0, H);
      ctx.drawImage(src, 0, 0);
    }),
  };
}

/**
 * Oříznutí na obdélník (může i přesahovat plátno – pak se plátno zvětší). `deletePixels` = pixely mimo
 * nové plátno se z vrstev skutečně odstraní (jinak zůstanou skryté mimo plátno).
 */
export function cropDocument(doc: ImageDocument, rect: Bounds, deletePixels: boolean): DocState {
  const { width, height } = rect;
  return {
    width,
    height,
    selection: null,
    layers: mapLayers(doc, (s) => {
      const x = s.x - rect.x;
      const y = s.y - rect.y;
      if (!deletePixels) return { ...s, x, y };
      const x0 = Math.max(0, x);
      const y0 = Math.max(0, y);
      const x1 = Math.min(width, x + s.canvas.width);
      const y1 = Math.min(height, y + s.canvas.height);
      if (x1 <= x0 || y1 <= y0) return { canvas: createCanvas(1, 1), mask: s.mask && createCanvas(1, 1), x: 0, y: 0 };
      const cut = (c: HTMLCanvasElement) => redraw(x1 - x0, y1 - y0, (ctx) => ctx.drawImage(c, x - x0, y - y0));
      return { canvas: cut(s.canvas), mask: s.mask && cut(s.mask), x: x0, y: y0 };
    }),
  };
}

/**
 * Ořezat: obdélník obsahu bez průhledných okrajů (`transparent`) nebo bez okrajů barvy
 * levého horního / pravého dolního pixelu.
 */
export function trimBounds(doc: ImageDocument, basis: 'transparent' | 'topLeft' | 'bottomRight'): Bounds | null {
  const canvas = createCanvas(doc.width, doc.height);
  const ctx = get2d(canvas);
  compositeDocument(doc, ctx);
  const data = ctx.getImageData(0, 0, doc.width, doc.height).data;
  const w = doc.width;
  const h = doc.height;
  const ref = basis === 'topLeft' ? 0 : (w * h - 1) * 4;
  const isBorder = (p: number) => {
    const i = p * 4;
    if (basis === 'transparent') return data[i + 3] === 0;
    return data[i] === data[ref] && data[i + 1] === data[ref + 1] && data[i + 2] === data[ref + 2] && data[i + 3] === data[ref + 3];
  };
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isBorder(y * w + x)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Odkrýt vše: obdélník pokrývající plátno i všechny vrstvy (i jejich části mimo plátno). */
export function revealAllBounds(doc: ImageDocument): Bounds {
  let x0 = 0;
  let y0 = 0;
  let x1 = doc.width;
  let y1 = doc.height;
  for (const l of doc.layers) {
    if (l.isGroup) continue;
    x0 = Math.min(x0, l.x);
    y0 = Math.min(y0, l.y);
    x1 = Math.max(x1, l.x + l.width);
    y1 = Math.max(y1, l.y + l.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
