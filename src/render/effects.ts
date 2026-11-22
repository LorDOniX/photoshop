import { createCanvas, get2d } from '../core/canvas';
import { parseHex } from '../core/color';
import { effectBlend, effectPadding, effectsKey, hasActiveEffects, overlayGradient, overlayPoints, shadowOffset, type LayerEffects } from '../core/effects';
import { bevelReachesOutside, bevelShading, type BevelShading } from '../core/paint/bevel';
import { buildLut, gradientStops, renderGradient } from '../core/paint/gradient';
import { canvasPattern, patternsVersion } from '../core/patterns';
import type { BlendMode, Layer } from '../core/Layer';
import { strokeMask } from '../core/paint/stroke';
import { SelectionMask } from '../core/selection/SelectionMask';
import { maskToCanvas } from '../core/selection/raster';

/*
 * Vykreslení stylů vrstvy. Výsledek se cachuje podle pixelů vrstvy (identita plátna + pixelVersion),
 * masky a nastavení efektů – při běžném překreslení (posun pohledu, jiná vrstva) se nic nepočítá.
 *
 * Všechna plátna mají rozměr vrstvy + okraj `pad` na každé straně (efekty přesahují vrstvu)
 * a kreslí se na (layer.x − pad, layer.y − pad).
 */

export interface RenderedEffects {
  pad: number;
  /** Pod obsahem: vržený stín a vnější záře – každý s vlastním režimem prolnutí (prolínají se s tím, co je pod vrstvou). */
  under: Array<{ canvas: HTMLCanvasElement; blend: BlendMode }>;
  /** Pixely vrstvy (s maskou) s vnitřními efekty (překrytí, vnitřní stín a záře). */
  pixels: HTMLCanvasElement;
  /** Nad obsahem: tah. */
  over: HTMLCanvasElement | null;
  /** Pixely + tah – kreslí se s režimem prolnutí vrstvy. */
  top: HTMLCanvasElement;
}

const cache = new WeakMap<Layer, { key: string; value: RenderedEffects }>();
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object | null) => {
  if (!o) return 0;
  let id = ids.get(o);
  if (!id) ids.set(o, (id = nextId++));
  return id;
};

function rgba(hex: string, alpha: number): string {
  const c = parseHex(hex);
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

/**
 * Stín tvaru bez tvaru samotného – jako by se tvar nakreslil na (x, y). Tvar se kreslí daleko mimo plátno
 * a stín se posune zpět (funguje ve všech prohlížečích, na rozdíl od `ctx.filter`).
 */
function drawShadowOf(ctx: CanvasRenderingContext2D, shape: HTMLCanvasElement, color: string, blur: number, x: number, y: number): void {
  const far = shape.width + shape.height + ctx.canvas.width + 100;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = far;
  ctx.shadowOffsetY = 0;
  ctx.drawImage(shape, x - far, y);
  ctx.restore();
}

/**
 * Pokrytí od okraje dovnitř tvaru (základ vnitřního stínu a záře): rozostřený stín „okolí“ tvaru
 * posunutý o (dx, dy), v barvě `color`. Okolí má okraj, aby rozostření u kraje plátna nesvětlalo.
 */
function innerEdge(shape: HTMLCanvasElement, color: string, blur: number, dx: number, dy: number): HTMLCanvasElement {
  const { width: w, height: h } = shape;
  const m = Math.ceil(blur * 1.5 + Math.max(Math.abs(dx), Math.abs(dy))) + 2;
  const outside = createCanvas(w + 2 * m, h + 2 * m);
  const ictx = get2d(outside);
  ictx.fillStyle = '#000';
  ictx.fillRect(0, 0, outside.width, outside.height);
  ictx.globalCompositeOperation = 'destination-out';
  ictx.drawImage(shape, m, m);
  const out = createCanvas(w, h);
  drawShadowOf(get2d(out), outside, color, blur, dx - m, dy - m);
  return out;
}

/** Alfa kanál plátna (0..255 na pixel). */
function alphaOf(canvas: HTMLCanvasElement): Uint8Array {
  const d = get2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  const a = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return a;
}

/** Efekty vrstvy (null = vrstva žádné zapnuté nemá). */
export function renderEffects(layer: Layer): RenderedEffects | null {
  const e = layer.effects;
  if (!hasActiveEffects(e) || layer.isGroup || layer.adjustment) return null;
  const key = `${effectsKey(e)}|${idOf(layer.canvas)}|${layer.pixelVersion}|${idOf(layer.mask)}|${layer.maskEnabled}|${layer.fillOpacity}|${e.patternOverlay?.enabled ? patternsVersion() : ''}`;
  const hit = cache.get(layer);
  if (hit?.key === key) return hit.value;
  const value = compute(layer, e);
  cache.set(layer, { key, value });
  return value;
}

/**
 * Vnitřní efekty se kreslí na neprůhlednou kopii obsahu a průhlednost se pak vrátí původní – výsledná barva
 * je tak přesně „obsah prolnutý s efektem“ i na poloprůhledných okrajích a průhlednost vrstvy se nemění.
 */
/** Plátno barvy `color` s alfou podle hodnot 0..1 (× krytí). */
function tint(values: Float32Array, color: string, width: number, height: number, opacity = 1): HTMLCanvasElement {
  const c = parseHex(color);
  const img = new ImageData(width, height);
  const d = img.data;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v <= 0) continue;
    d[i * 4] = c.r;
    d[i * 4 + 1] = c.g;
    d[i * 4 + 2] = c.b;
    d[i * 4 + 3] = v * opacity * 255;
  }
  const canvas = createCanvas(width, height);
  get2d(canvas).putImageData(img, 0, 0);
  return canvas;
}

function applyInterior(pixels: HTMLCanvasElement, shape: HTMLCanvasElement, e: LayerEffects, bevel: BevelShading | null, pad: number): void {
  const { width: w, height: h } = pixels;
  const ctx = get2d(pixels);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const alpha = new Uint8ClampedArray(w * h);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const a = d[i * 4 + 3];
      if (!a) continue;
      alpha[i] = a;
      d[i * 4 + 3] = 255;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return;
  ctx.putImageData(img, 0, 0);
  const paint = (blend: BlendMode, opacity: number, draw: () => void) => {
    ctx.save();
    ctx.globalCompositeOperation = blend;
    ctx.globalAlpha = opacity;
    draw();
    ctx.restore();
  };

  const po = e.patternOverlay;
  if (po?.enabled) {
    // Vzorek začíná v levém horním rohu vrstvy (pixels mají okraj `pad`).
    const pattern = canvasPattern(ctx, po.patternId, pad, pad, po.scale);
    if (pattern) {
      paint(effectBlend(po), po.opacity, () => {
        // Celočíselné zvětšení bez vyhlazení – pixelové vzorky (cihly, šachovnice) zůstanou ostré.
        ctx.imageSmoothingEnabled = !(po.scale >= 1 && Number.isInteger(po.scale));
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      });
    }
  }
  const go = e.gradientOverlay;
  if (go?.enabled) {
    const bounds = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    const { start, end } = overlayPoints(bounds, go);
    const piece = new ImageData(bounds.width, bounds.height);
    renderGradient(piece.data, bounds.width, bounds.height, bounds.x, bounds.y, {
      type: go.style,
      start,
      end,
      lut: buildLut(gradientStops(overlayGradient(go))),
      reverse: go.reverse,
    });
    const g = createCanvas(w, h);
    get2d(g).putImageData(piece, bounds.x, bounds.y);
    paint(effectBlend(go), go.opacity, () => ctx.drawImage(g, 0, 0));
  }
  const co = e.colorOverlay;
  if (co?.enabled) {
    paint(effectBlend(co), co.opacity, () => {
      ctx.fillStyle = co.color;
      ctx.fillRect(0, 0, w, h);
    });
  }
  const sa = e.satin;
  if (sa?.enabled) {
    // Rozdíl (xor) dvou kopií tvaru posunutých proti sobě, rozostřený; obrácení = 1 − lesk.
    const { dx, dy } = shadowOffset(sa.angle, sa.distance);
    const diff = createCanvas(w, h);
    const dctx = get2d(diff);
    dctx.drawImage(shape, dx, dy);
    dctx.globalCompositeOperation = 'xor';
    dctx.drawImage(shape, -dx, -dy);
    const gloss = createCanvas(w, h);
    const gctx = get2d(gloss);
    drawShadowOf(gctx, diff, sa.color, sa.size, 0, 0);
    let result = gloss;
    if (sa.invert) {
      result = createCanvas(w, h);
      const rctx = get2d(result);
      rctx.fillStyle = sa.color;
      rctx.fillRect(0, 0, w, h);
      rctx.globalCompositeOperation = 'destination-out';
      rctx.drawImage(gloss, 0, 0);
    }
    paint(effectBlend(sa), sa.opacity, () => ctx.drawImage(result, 0, 0));
  }
  const ig = e.innerGlow;
  if (ig?.enabled) {
    let glow: HTMLCanvasElement;
    if (ig.source === 'center') {
      glow = createCanvas(w, h);
      const gctx = get2d(glow);
      gctx.fillStyle = ig.color;
      gctx.fillRect(0, 0, w, h);
      gctx.globalCompositeOperation = 'destination-out';
      gctx.drawImage(innerEdge(shape, '#000', ig.size, 0, 0), 0, 0);
    } else glow = innerEdge(shape, ig.color, ig.size, 0, 0);
    paint(effectBlend(ig), ig.opacity, () => ctx.drawImage(glow, 0, 0));
  }
  const is = e.innerShadow;
  if (is?.enabled) {
    const { dx, dy } = shadowOffset(is.angle, is.distance);
    const shadow = innerEdge(shape, is.color, is.size, dx, dy);
    paint(effectBlend(is), is.opacity, () => ctx.drawImage(shadow, 0, 0));
  }
  const bv = e.bevel;
  if (bv?.enabled && bevel) {
    paint(bv.shadowBlend, bv.shadowOpacity, () => ctx.drawImage(tint(bevel.dark, bv.shadowColor, w, h), 0, 0));
    paint(bv.highlightBlend, bv.highlightOpacity, () => ctx.drawImage(tint(bevel.light, bv.highlightColor, w, h), 0, 0));
  }

  const out = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < alpha.length; i++) out.data[i * 4 + 3] = alpha[i];
  ctx.putImageData(out, 0, 0);
}

function compute(layer: Layer, e: LayerEffects): RenderedEffects {
  const pad = effectPadding(e);
  const w = layer.width + pad * 2;
  const h = layer.height + pad * 2;

  // Obsah vrstvy (s maskou) – zároveň tvar pro stíny, záře a tah.
  const pixels = createCanvas(w, h);
  const pctx = get2d(pixels);
  pctx.drawImage(layer.canvas, pad, pad);
  if (layer.hasActiveMask) {
    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(layer.mask!, pad, pad);
    pctx.globalCompositeOperation = 'source-over';
  }
  const shape = createCanvas(w, h);
  get2d(shape).drawImage(pixels, 0, 0);

  const bv = e.bevel?.enabled ? e.bevel : null;
  const bevel = bv && bv.size > 0 ? bevelShading(alphaOf(shape), w, h, bv) : null;
  const interior = e.patternOverlay?.enabled || e.gradientOverlay?.enabled || e.colorOverlay?.enabled || e.satin?.enabled || e.innerGlow?.enabled || e.innerShadow?.enabled;
  if (interior || bevel) applyInterior(pixels, shape, e, bevel, pad);

  // Krytí výplně: obsah a vnitřní efekty (stín, záře a tah zůstanou).
  if (layer.fillOpacity < 1) {
    pctx.save();
    pctx.globalCompositeOperation = 'destination-in';
    pctx.fillStyle = `rgba(0,0,0,${layer.fillOpacity})`;
    pctx.fillRect(0, 0, w, h);
    pctx.restore();
  }

  const under: RenderedEffects['under'] = [];
  const s = e.dropShadow;
  if (s?.enabled) {
    const c = createCanvas(w, h);
    const sctx = get2d(c);
    const { dx, dy } = shadowOffset(s.angle, s.distance);
    drawShadowOf(sctx, shape, rgba(s.color, s.opacity), s.size, dx, dy);
    // „Vrstva vykrojí vržený stín“ (výchozí ve Photoshopu): pod obsahem stín není – vidět s výplní < 100 %.
    sctx.globalCompositeOperation = 'destination-out';
    sctx.drawImage(shape, 0, 0);
    under.push({ canvas: c, blend: effectBlend(s) });
  }
  const g = e.outerGlow;
  if (g?.enabled) {
    const c = createCanvas(w, h);
    drawShadowOf(get2d(c), shape, rgba(g.color, g.opacity), g.size, 0, 0);
    under.push({ canvas: c, blend: effectBlend(g) });
  }

  // Vnější část úkosu (vnější úkos, reliéf, polštář) – mimo tvar, nad stínem a září.
  if (bv && bevel && bevelReachesOutside(bv.style)) {
    for (const [values, color, opacity, blend] of [
      [bevel.dark, bv.shadowColor, bv.shadowOpacity, bv.shadowBlend],
      [bevel.light, bv.highlightColor, bv.highlightOpacity, bv.highlightBlend],
    ] as const) {
      const c = tint(values, color, w, h, opacity);
      const cctx = get2d(c);
      cctx.globalCompositeOperation = 'destination-out';
      cctx.drawImage(shape, 0, 0);
      under.push({ canvas: c, blend });
    }
  }

  let over: HTMLCanvasElement | null = null;
  const st = e.stroke;
  if (st?.enabled && st.size > 0) {
    const sel = new SelectionMask(w, h);
    sel.data.set(alphaOf(shape));
    const band = maskToCanvas(strokeMask(sel, st.size, st.position));
    over = createCanvas(w, h);
    const octx = get2d(over);
    octx.drawImage(band, 0, 0);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = rgba(st.color, st.opacity);
    octx.fillRect(0, 0, w, h);
  }

  let top = pixels;
  if (over) {
    top = createCanvas(w, h);
    const tctx = get2d(top);
    tctx.drawImage(pixels, 0, 0);
    tctx.drawImage(over, 0, 0);
  }
  return { pad, under, pixels, over, top };
}
