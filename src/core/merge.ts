import { createCanvas, get2d, unionRect, type Rect } from './canvas';
import type { ImageDocument } from './ImageDocument';
import { Layer } from './Layer';
import { compositeLayers, drawLayer } from '../render/composite';

/*
 * Slučování vrstev. Funkce jen spočítají nový seznam vrstev – zápis do historie
 * (LayerListCommand) dělá Editor. Původní vrstvy zůstávají beze změny (kvůli undo).
 */

export interface LayerList {
  layers: Layer[];
  active: string;
}

export function layerRect(layer: Layer): Rect {
  return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

/** Vrstva pro „Sloučit dolů“ – vrstva pod aktivní; null, pokud sloučit nejde. */
export function mergeDownTarget(doc: ImageDocument): Layer | null {
  const upper = doc.activeLayer;
  const index = upper ? doc.indexOf(upper.id) : -1;
  return upper && index > 0 && upper.visible ? doc.layers[index - 1] : null;
}

/**
 * Sloučit dolů: aktivní vrstva se (se svým krytím, režimem prolnutí a maskou) vykreslí do vrstvy pod ní.
 * Výsledek převezme vlastnosti spodní vrstvy (název, krytí, režim) – jako ve Photoshopu; masky se použijí.
 */
export function mergeDown(doc: ImageDocument): LayerList | null {
  const upper = doc.activeLayer;
  const lower = mergeDownTarget(doc);
  if (!upper || !lower) return null;
  const rect = unionRect(layerRect(lower), layerRect(upper));
  const merged = new Layer(rect.width, rect.height, { ...lower.getProps(), x: rect.x, y: rect.y, visible: true, maskEnabled: true });
  drawLayer(merged.ctx, lower, rect.x, rect.y, false);
  drawLayer(merged.ctx, upper, rect.x, rect.y, true);
  const layers = doc.layers.filter((l) => l !== upper).map((l) => (l === lower ? merged : l));
  return { layers, active: merged.id };
}

export function visibleLayers(doc: ImageDocument): Layer[] {
  return doc.layers.filter((l) => l.visible);
}

/**
 * Sloučit viditelné: všechny viditelné vrstvy do jedné (na místo nejspodnější z nich, s jejím názvem).
 * Skryté vrstvy zůstanou. Výsledek pokrývá všechny sloučené vrstvy, i mimo plátno.
 */
export function mergeVisible(doc: ImageDocument): LayerList | null {
  const visible = visibleLayers(doc);
  if (visible.length < 2) return null;
  let rect: Rect | null = null;
  for (const l of visible) rect = unionRect(rect, layerRect(l));
  const r = rect!;
  const bottom = visible[0];
  const merged = new Layer(r.width, r.height, { name: bottom.name, x: r.x, y: r.y });
  compositeLayers(merged.ctx, visible, r.x, r.y);
  const layers: Layer[] = [];
  for (const l of doc.layers) {
    if (l === bottom) layers.push(merged);
    else if (!l.visible) layers.push(l);
  }
  return { layers, active: merged.id };
}

/** Zploštit obraz: viditelné vrstvy na bílé pozadí velikosti plátna, skryté vrstvy se zahodí. */
export function flatten(doc: ImageDocument, background = '#ffffff'): LayerList {
  const flat = new Layer(doc.width, doc.height, { name: 'Pozadí' });
  const tmp = createCanvas(doc.width, doc.height);
  compositeLayers(get2d(tmp), doc.layers);
  flat.ctx.fillStyle = background;
  flat.ctx.fillRect(0, 0, doc.width, doc.height);
  flat.ctx.drawImage(tmp, 0, 0);
  return { layers: [flat], active: flat.id };
}
