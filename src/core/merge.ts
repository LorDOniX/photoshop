import { createCanvas, get2d, unionRect, type Rect } from './canvas';
import { buildTree, effectivelyVisible, findNode, flattenTree, replaceNode, subtreeItems, type FlatList, type TreeNode } from './groups';
import type { ImageDocument } from './ImageDocument';
import { Layer } from './Layer';
import { compositeLayers, drawClippedLayer, drawLayer } from '../render/composite';

/*
 * Slučování vrstev. Funkce jen spočítají nový seznam vrstev (i se zařazením do skupin) – zápis do historie
 * (LayerListCommand) dělá Editor. Původní vrstvy zůstávají beze změny (kvůli undo).
 */

export interface LayerList extends FlatList<Layer> {
  active: string;
}

export function layerRect(layer: Layer): Rect {
  return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

function boundsOf(layers: readonly Layer[]): Rect | null {
  let rect: Rect | null = null;
  for (const l of layers) if (!l.isGroup) rect = unionRect(rect, layerRect(l));
  return rect;
}

/**
 * Vrstva pro „Sloučit dolů“ – sourozenec těsně pod aktivní vrstvou (ne skupina); u aktivní skupiny
 * se slučuje skupina sama. Null = sloučit nejde.
 */
export function mergeDownTarget(doc: ImageDocument): Layer | null {
  const upper = doc.activeLayer;
  if (!upper || !upper.visible) return null;
  if (upper.isGroup) return boundsOf(groupContent(doc, upper)) ? upper : null;
  const below = doc.layers[doc.indexOf(upper.id) - 1];
  return below && !below.isGroup && below.parentId === upper.parentId ? below : null;
}

/** Vrstvy uvnitř skupiny (bez jejího záhlaví). */
function groupContent(doc: ImageDocument, group: Layer): Layer[] {
  const loc = findNode(buildTree(doc.layers), group.id);
  return loc ? subtreeItems(loc.node).filter((l) => l !== group) : [];
}

/**
 * Sloučit dolů: aktivní vrstva se (se svým krytím, režimem prolnutí a maskou) vykreslí do vrstvy pod ní.
 * Výsledek převezme vlastnosti spodní vrstvy (název, krytí, režim) – jako ve Photoshopu; masky se použijí.
 * Je-li aktivní skupina, sloučí se její obsah do jedné vrstvy (Sloučit skupinu).
 */
export function mergeDown(doc: ImageDocument): LayerList | null {
  const upper = doc.activeLayer;
  const lower = mergeDownTarget(doc);
  if (!upper || !lower) return null;
  if (upper.isGroup) return mergeGroup(doc, upper);
  const rect = unionRect(layerRect(lower), layerRect(upper));
  const merged = new Layer(rect.width, rect.height, { ...lower.getProps(), x: rect.x, y: rect.y, visible: true, maskEnabled: true });
  merged.parentId = lower.parentId;
  drawLayer(merged.ctx, lower, rect.x, rect.y, false);
  // Ořezaná vrstva sloučená do svého základu se do něj ořízne.
  if (upper.clipped && !lower.clipped) drawClippedLayer(merged.ctx, upper, rect.x, rect.y);
  else drawLayer(merged.ctx, upper, rect.x, rect.y, true);
  const list = replaceNode(
    doc.layers.filter((l) => l !== upper),
    lower.id,
    [{ item: merged, children: [] }],
  );
  return list && { ...list, active: merged.id };
}

/** Obsah skupiny do jedné vrstvy; ta převezme název, krytí a režim skupiny. */
export function mergeGroup(doc: ImageDocument, group: Layer): LayerList | null {
  const content = groupContent(doc, group);
  const rect = boundsOf(content);
  if (!rect) return null;
  const { name, opacity, blendMode, visible } = group;
  const merged = new Layer(rect.width, rect.height, { name, opacity, blendMode, visible, x: rect.x, y: rect.y });
  compositeLayers(merged.ctx, content, rect.x, rect.y);
  const list = replaceNode(doc.layers, group.id, [{ item: merged, children: [] }]);
  return list && { ...list, active: merged.id };
}

/** Vrstvy s pixely, které jsou opravdu vidět (samy i všechny jejich skupiny). */
export function visibleLayers(doc: ImageDocument): Layer[] {
  return doc.layers.filter((l) => !l.isGroup && effectivelyVisible(doc.layers, l.id));
}

/**
 * Sloučit viditelné: vše viditelné do jedné vrstvy (na místo nejspodnější z nich, s jejím názvem).
 * Skryté vrstvy (i ve skupinách) zůstanou, skupiny, které tím zůstanou prázdné, zmizí.
 */
export function mergeVisible(doc: ImageDocument): LayerList | null {
  const visible = visibleLayers(doc);
  if (visible.length < 2) return null;
  const r = boundsOf(visible)!;
  const bottom = visible[0];
  const merged = new Layer(r.width, r.height, { name: bottom.name, x: r.x, y: r.y });
  compositeLayers(merged.ctx, doc.layers, r.x, r.y);

  const gone = new Set(visible);
  const prune = (nodes: TreeNode<Layer>[]): TreeNode<Layer>[] =>
    nodes.flatMap((n) => {
      if (!n.item.isGroup) return gone.has(n.item) ? [] : [n];
      const children = prune(n.children);
      return children.length ? [{ item: n.item, children }] : [];
    });
  const roots = prune(buildTree(doc.layers));
  // Sloučená vrstva jde na kořenovou úroveň nad všechny bloky, které celé leží pod nejspodnější viditelnou vrstvou.
  const bottomIndex = doc.indexOf(bottom.id);
  const position = roots.filter((n) => Math.max(...subtreeItems(n).map((l) => doc.indexOf(l.id))) < bottomIndex).length;
  roots.splice(position, 0, { item: merged, children: [] });
  return { ...flattenTree(roots), active: merged.id };
}

/** Zploštit obraz: viditelné vrstvy na bílé pozadí velikosti plátna, skryté vrstvy a skupiny se zahodí. */
export function flatten(doc: ImageDocument, background = '#ffffff'): LayerList {
  const flat = new Layer(doc.width, doc.height, { name: 'Pozadí' });
  const tmp = createCanvas(doc.width, doc.height);
  compositeLayers(get2d(tmp), doc.layers);
  flat.ctx.fillStyle = background;
  flat.ctx.fillRect(0, 0, doc.width, doc.height);
  flat.ctx.drawImage(tmp, 0, 0);
  return { items: [flat], parents: new Map([[flat.id, null]]), active: flat.id };
}
