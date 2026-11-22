import { applyAdjustment } from '../core/adjust';
import { clipRect, createCanvas, get2d, type Rect } from '../core/canvas';
import type { ImageDocument } from '../core/ImageDocument';
import { buildTree, type TreeNode } from '../core/groups';
import { renderEffects, type RenderedEffects } from './effects';
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
 * Vykreslí jednu vrstvu (s maskou a styly vrstvy) posunutou o (−ox, −oy). `withProps` = i s krytím a režimem
 * prolnutí vrstvy; bez nich se kreslí jen obsah (sloučená vrstva si krytí a režim ponechá jako vlastnosti).
 * `withEffects` = včetně stylů vrstvy (stín, tah…).
 */
export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, ox = 0, oy = 0, withProps = true, withEffects = true): void {
  if (withProps && layer.opacity <= 0) return;
  if (layer.adjustment) return applyAdjustmentLayer(ctx, layer, ox, oy);
  ctx.save();
  ctx.globalAlpha = withProps ? layer.opacity : 1;
  const fx = withEffects ? renderEffects(layer) : null;
  if (fx) {
    // Stín a vnější záře se prolínají s okolím vlastním režimem, obsah a tah režimem vrstvy.
    drawUnder(ctx, layer, fx, ox, oy);
    ctx.globalCompositeOperation = withProps ? layer.blendMode : 'source-over';
    ctx.drawImage(fx.top, layer.x - ox - fx.pad, layer.y - oy - fx.pad);
  } else {
    ctx.globalCompositeOperation = withProps ? layer.blendMode : 'source-over';
    drawPixels(ctx, layer, ox, oy, 'raw');
  }
  ctx.restore();
}

/**
 * Vrstva úprav: upraví to, co už v `ctx` je (ve výřezu `region`), silou krytí × maska. Režim Normální se
 * počítá přesně po pixelech (průhlednost zůstane), jiné režimy prolnou upravený obraz s původním přes plátno.
 * (ox, oy) = poloha kontextu v dokumentu.
 */
function applyAdjustmentLayer(ctx: CanvasRenderingContext2D, layer: Layer, ox: number, oy: number): void {
  const a = layer.adjustment;
  if (!a || layer.opacity <= 0) return;
  const { width: cw, height: ch } = ctx.canvas;
  const r = clipRect(region ?? { x: 0, y: 0, width: cw, height: ch }, cw, ch);
  if (!r) return;
  const img = ctx.getImageData(r.x, r.y, r.width, r.height);
  // Síla úpravy na pixel: krytí × maska (mimo masku 0).
  let weights: Uint8Array | undefined;
  const k = layer.opacity;
  if (layer.hasActiveMask || k < 1) {
    weights = new Uint8Array(r.width * r.height);
    if (layer.hasActiveMask) {
      const mx = r.x + ox - layer.x;
      const my = r.y + oy - layer.y;
      const m = clipRect({ x: mx, y: my, width: r.width, height: r.height }, layer.width, layer.height);
      if (m) {
        const md = get2d(layer.mask!).getImageData(m.x, m.y, m.width, m.height).data;
        for (let y = 0; y < m.height; y++) {
          const row = (y + m.y - my) * r.width + (m.x - mx);
          for (let x = 0; x < m.width; x++) weights[row + x] = md[(y * m.width + x) * 4 + 3] * k;
        }
      }
    } else weights.fill(Math.round(255 * k));
  }
  if (layer.blendMode === 'source-over') {
    applyAdjustment(img.data, a, weights);
    ctx.putImageData(img, r.x, r.y);
    return;
  }
  const adjusted = new ImageData(new Uint8ClampedArray(img.data), r.width, r.height);
  applyAdjustment(adjusted.data, a);
  if (weights) for (let i = 0; i < weights.length; i++) adjusted.data[i * 4 + 3] = (adjusted.data[i * 4 + 3] * weights[i]) / 255;
  const tmp = createCanvas(r.width, r.height);
  get2d(tmp).putImageData(adjusted, 0, 0);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = layer.blendMode;
  ctx.drawImage(tmp, r.x, r.y);
  ctx.restore();
}

/** Vržený stín a vnější záře – každý s vlastním režimem prolnutí (krytí podle `ctx.globalAlpha`). */
function drawUnder(ctx: CanvasRenderingContext2D, layer: Layer, fx: RenderedEffects, ox: number, oy: number): void {
  for (const u of fx.under) {
    ctx.globalCompositeOperation = u.blend;
    ctx.drawImage(u.canvas, layer.x - ox - fx.pad, layer.y - oy - fx.pad);
  }
}

/** Pomocná plátna pro skupiny a ořezové masky podle účelu a hloubky zanoření. */
const buffers = new Map<string, HTMLCanvasElement>();

/**
 * Právě skládaný výřez (souřadnice cílového plátna) – pomocná plátna skupin a ořezových masek
 * se pak mažou a kreslí jen v něm. null = celé plátno.
 */
let region: Rect | null = null;

/** Připraví pomocné plátno (vymazané, oříznuté na výřez). Po použití je nutné zavolat `closeBuffer`. */
function openBuffer(key: number | string, width: number, height: number): CanvasRenderingContext2D {
  const name = String(key);
  let c = buffers.get(name);
  if (!c || c.width !== width || c.height !== height) {
    c = createCanvas(width, height);
    buffers.set(name, c);
  }
  const ctx = get2d(c);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (region) {
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.width, region.height);
    ctx.clip();
    ctx.clearRect(region.x, region.y, region.width, region.height);
  } else ctx.clearRect(0, 0, width, height);
  return ctx;
}

function closeBuffer(ctx: CanvasRenderingContext2D): void {
  ctx.restore();
}

/**
 * Vrstva ořezaná do pixelů, které už v `ctx` jsou (základ ořezové masky). Normální režim = `source-atop`
 * (přesně); jiné režimy: vrstva se nejdřív ořízne alfou základu a pak prolne.
 */
export function drawClippedLayer(ctx: CanvasRenderingContext2D, layer: Layer, ox: number, oy: number, depth: number | string = 'x'): void {
  if (layer.opacity <= 0) return;
  // Ořezaná vrstva úprav upraví jen základ (a vrstvy ořezané pod ní).
  if (layer.adjustment) return applyAdjustmentLayer(ctx, layer, ox, oy);
  if (layer.blendMode === 'source-over') {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = layer.opacity;
    drawPixels(ctx, layer, ox, oy);
    ctx.restore();
    return;
  }
  const tmp = openBuffer(`clip-tmp-${depth}`, ctx.canvas.width, ctx.canvas.height);
  drawPixels(tmp, layer, ox, oy);
  tmp.globalCompositeOperation = 'destination-in';
  tmp.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode;
  ctx.drawImage(tmp.canvas, 0, 0);
  ctx.restore();
  closeBuffer(tmp);
}

/**
 * Obsah vrstvy (s maskou) v aktuálním nastavení kontextu: `full` = i se styly vrstvy (stín a záře zde bez
 * vlastního režimu – použití u ořezaných vrstev), `pixels` = jen s vnitřními efekty (základ ořezové masky –
 * stín a tah se kreslí kolem celé ořezové masky), `raw` = bez stylů.
 */
function drawPixels(ctx: CanvasRenderingContext2D, layer: Layer, ox: number, oy: number, part: 'full' | 'pixels' | 'raw' = 'full'): void {
  const x = layer.x - ox;
  const y = layer.y - oy;
  const fx = part === 'raw' ? null : renderEffects(layer);
  if (fx) {
    // Krytí výplně je v `fx.pixels` (a `fx.top`) už započtené.
    if (part === 'full') for (const u of fx.under) ctx.drawImage(u.canvas, x - fx.pad, y - fx.pad);
    ctx.drawImage(part === 'full' ? fx.top : fx.pixels, x - fx.pad, y - fx.pad);
    return;
  }
  const fill = layer.fillOpacity;
  if (fill < 1) {
    ctx.save();
    ctx.globalAlpha *= fill;
  }
  if (layer.hasActiveMask) ctx.drawImage(maskedLayer(layer), 0, 0, layer.width, layer.height, x, y, layer.width, layer.height);
  else ctx.drawImage(layer.canvas, x, y);
  if (fill < 1) ctx.restore();
}

/** Ořezová maska: základ + ořezané vrstvy se složí zvlášť a vykreslí s krytím a režimem základu (jako Photoshop). */
function drawClipGroup(ctx: CanvasRenderingContext2D, base: Layer, clipped: readonly Layer[], ox: number, oy: number, depth: number): void {
  // Skrytý základ skryje celou ořezovou masku.
  if (!base.visible || base.opacity <= 0) return;
  const buffer = openBuffer(`clip-${depth}`, ctx.canvas.width, ctx.canvas.height);
  drawPixels(buffer, base, ox, oy, 'pixels');
  for (const layer of clipped) if (layer.visible) drawClippedLayer(buffer, layer, ox, oy, depth);
  // Stín, záře a tah základu patří celé ořezové masce (kreslí se pod / nad ní).
  const fx = renderEffects(base);
  if (fx?.over) buffer.drawImage(fx.over, base.x - ox - fx.pad, base.y - oy - fx.pad);
  ctx.save();
  ctx.globalAlpha = base.opacity;
  if (fx) drawUnder(ctx, base, fx, ox, oy);
  ctx.globalCompositeOperation = base.blendMode;
  ctx.drawImage(buffer.canvas, 0, 0);
  ctx.restore();
  closeBuffer(buffer);
}

export function drawNodes(ctx: CanvasRenderingContext2D, nodes: readonly TreeNode<Layer>[], ox = 0, oy = 0, depth = 0): void {
  for (let i = 0; i < nodes.length; i++) {
    const { item: layer, children } = nodes[i];
    // Vrstva s pixely a nad ní ořezané vrstvy = ořezová maska (vrstva úprav základem být nemůže).
    if (!layer.isGroup && !layer.clipped && !layer.adjustment) {
      let j = i + 1;
      while (j < nodes.length && !nodes[j].item.isGroup && nodes[j].item.clipped) j++;
      if (j > i + 1) {
        drawClipGroup(ctx, layer, nodes.slice(i + 1, j).map((n) => n.item), ox, oy, depth);
        i = j - 1;
        continue;
      }
    }
    if (!layer.visible) continue;
    if (!layer.isGroup) {
      drawLayer(ctx, layer, ox, oy);
      continue;
    }
    if (layer.opacity <= 0 || !children.length) continue;
    // Skupina se 100 % a režimem Normální je „průchozí“ – potomci se skládají přímo do okolí.
    if (layer.opacity >= 1 && layer.blendMode === 'source-over') {
      drawNodes(ctx, children, ox, oy, depth);
      continue;
    }
    const buffer = openBuffer(depth, ctx.canvas.width, ctx.canvas.height);
    drawNodes(buffer, children, ox, oy, depth + 1);
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    ctx.drawImage(buffer.canvas, 0, 0);
    ctx.restore();
    closeBuffer(buffer);
  }
}

/**
 * Složí viditelné vrstvy (zdola nahoru, se skupinami) do kontextu; (ox, oy) je poloha levého horního rohu
 * kontextu v souřadnicích dokumentu. Kontext se předem vymaže.
 */
export function compositeLayers(ctx: CanvasRenderingContext2D, layers: readonly Layer[], ox = 0, oy = 0): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawNodes(ctx, buildTree(layers), ox, oy, 0);
  ctx.restore();
}

/** Složí viditelné vrstvy dokumentu do kontextu o velikosti dokumentu (s maskami). */
/**
 * Složí uzly stromu vrstev jen ve výřezu `rect` cílového kontextu (bez posunu, souřadnice dokumentu).
 * `under` (volitelně) = hotové složení všeho pod uzly, `over` = hotové složení všeho nad nimi.
 */
export function compositeRegion(
  ctx: CanvasRenderingContext2D,
  nodes: readonly TreeNode<Layer>[],
  rect: Rect | null,
  under: HTMLCanvasElement | null = null,
  over: HTMLCanvasElement | null = null,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (rect) {
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
  } else ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (under) ctx.drawImage(under, 0, 0);
  const prev = region;
  region = rect;
  try {
    drawNodes(ctx, nodes);
  } finally {
    region = prev;
  }
  if (over) ctx.drawImage(over, 0, 0);
  ctx.restore();
}

export function compositeDocument(doc: ImageDocument, ctx: CanvasRenderingContext2D): void {
  compositeLayers(ctx, doc.layers);
}

export function flattenDocument(doc: ImageDocument): HTMLCanvasElement {
  const canvas = createCanvas(doc.width, doc.height);
  compositeDocument(doc, get2d(canvas));
  return canvas;
}
