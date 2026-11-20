/*
 * Skupiny vrstev. Dokument drží PLOCHÝ seznam vrstev (odspodu nahoru); skupina je v něm „záhlaví“
 * (vrstva s isGroup) a její potomci leží souvisle těsně pod ní a mají parentId = id skupiny.
 * Strukturální operace se počítají nad stromem (čisté funkce, testovatelné bez DOM)
 * a výsledek se zploští zpět do seznamu + mapy rodičů.
 */

export interface TreeItem {
  readonly id: string;
  parentId: string | null;
  readonly isGroup: boolean;
}

export interface TreeNode<T extends TreeItem> {
  item: T;
  /** Odspodu nahoru (stejně jako seznam vrstev). */
  children: TreeNode<T>[];
}

/** Strom z plochého seznamu. Položky, jejichž rodič v seznamu není, jsou kořeny. */
export function buildTree<T extends TreeItem>(items: readonly T[]): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>();
  for (const item of items) nodes.set(item.id, { item, children: [] });
  const roots: TreeNode<T>[] = [];
  for (const item of items) {
    const node = nodes.get(item.id)!;
    const parent = item.parentId ? nodes.get(item.parentId) : undefined;
    if (parent && parent.item.isGroup) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export interface FlatList<T extends TreeItem> {
  items: T[];
  parents: Map<string, string | null>;
}

/** Zploštění stromu: potomci pod záhlavím skupiny, odspodu nahoru. */
export function flattenTree<T extends TreeItem>(roots: readonly TreeNode<T>[]): FlatList<T> {
  const items: T[] = [];
  const parents = new Map<string, string | null>();
  const walk = (nodes: readonly TreeNode<T>[], parent: string | null) => {
    for (const n of nodes) {
      walk(n.children, n.item.id);
      items.push(n.item);
      parents.set(n.item.id, parent);
    }
  };
  walk(roots, null);
  return { items, parents };
}

export interface Located<T extends TreeItem> {
  node: TreeNode<T>;
  /** Pole sourozenců, ve kterém uzel leží (kořeny nebo children rodiče). */
  siblings: TreeNode<T>[];
  index: number;
  parent: TreeNode<T> | null;
}

export function findNode<T extends TreeItem>(roots: TreeNode<T>[], id: string, parent: TreeNode<T> | null = null): Located<T> | null {
  const siblings = parent ? parent.children : roots;
  for (let i = 0; i < siblings.length; i++) {
    const n = siblings[i];
    if (n.item.id === id) return { node: n, siblings, index: i, parent };
    const inner = findNode(roots, id, n);
    if (inner) return inner;
  }
  return null;
}

/** Všechny položky podstromu (včetně kořene), odspodu nahoru. */
export function subtreeItems<T extends TreeItem>(node: TreeNode<T>): T[] {
  return flattenTree([node]).items;
}

/** Hloubka zanoření (0 = kořen). */
export function depthOf(items: readonly TreeItem[], id: string): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  let depth = 0;
  let p = byId.get(id)?.parentId ?? null;
  while (p && byId.has(p) && depth < 100) {
    depth++;
    p = byId.get(p)!.parentId;
  }
  return depth;
}

/** Je `ancestorId` předkem (nebo samotnou položkou) `id`? */
export function isWithin(items: readonly TreeItem[], id: string, ancestorId: string): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  let cur: string | null = id;
  for (let guard = 0; cur && guard < 100; guard++) {
    if (cur === ancestorId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

/** Viditelnost včetně předků (vrstva ve skryté skupině se nevykresluje). */
export function effectivelyVisible(items: readonly (TreeItem & { visible: boolean })[], id: string): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  let cur = byId.get(id);
  for (let guard = 0; cur && guard < 100; guard++) {
    if (!cur.visible) return false;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return true;
}

export type DropPosition = 'above' | 'below' | 'into';

/**
 * Přesune uzel `id` vedle cíle (nad / pod něj jako sourozence) nebo do skupiny (navrch jejích potomků).
 * Vrací null, pokud by se skupina přesouvala sama do sebe.
 */
export function moveNode<T extends TreeItem>(items: readonly T[], id: string, targetId: string, position: DropPosition): FlatList<T> | null {
  if (id === targetId || isWithin(items, targetId, id)) return null;
  const roots = buildTree(items);
  const src = findNode(roots, id);
  if (!src) return null;
  src.siblings.splice(src.index, 1);
  const dst = findNode(roots, targetId);
  if (!dst) return null;
  if (position === 'into') {
    if (!dst.node.item.isGroup) return null;
    dst.node.children.push(src.node);
  } else dst.siblings.splice(dst.index + (position === 'above' ? 1 : 0), 0, src.node);
  return flattenTree(roots);
}

/**
 * Posun o jedno místo mezi sourozenci (+1 = nahoru). Na okraji skupiny uzel ze skupiny vystoupí
 * (nad / pod ni) – jako Ctrl+] / Ctrl+[ ve Photoshopu. `toEnd` = až navrch / úplně dolů v rámci rodiče.
 */
export function shiftNode<T extends TreeItem>(items: readonly T[], id: string, dir: 1 | -1, toEnd = false): FlatList<T> | null {
  const roots = buildTree(items);
  const loc = findNode(roots, id);
  if (!loc) return null;
  const { siblings, index, node, parent } = loc;
  const last = siblings.length - 1;
  if (toEnd) {
    if ((dir > 0 && index === last) || (dir < 0 && index === 0)) return null;
    siblings.splice(index, 1);
    if (dir > 0) siblings.push(node);
    else siblings.unshift(node);
    return flattenTree(roots);
  }
  const atEdge = dir > 0 ? index === last : index === 0;
  if (atEdge) {
    if (!parent) return null;
    const outer = findNode(roots, parent.item.id)!;
    siblings.splice(index, 1);
    outer.siblings.splice(outer.index + (dir > 0 ? 1 : 0), 0, node);
    return flattenTree(roots);
  }
  siblings.splice(index, 1);
  siblings.splice(index + dir, 0, node);
  return flattenTree(roots);
}

/** Obalí uzel novou skupinou (Ctrl+G). */
export function wrapInGroup<T extends TreeItem>(items: readonly T[], id: string, group: T): FlatList<T> | null {
  const roots = buildTree(items);
  const loc = findNode(roots, id);
  if (!loc) return null;
  loc.siblings.splice(loc.index, 1, { item: group, children: [loc.node] });
  return flattenTree(roots);
}

/** Nová prázdná skupina nad uzlem `aboveId` (nebo navrch). */
export function insertGroup<T extends TreeItem>(items: readonly T[], aboveId: string | null, group: T): FlatList<T> {
  const roots = buildTree(items);
  const loc = aboveId ? findNode(roots, aboveId) : null;
  const node = { item: group, children: [] };
  if (loc) loc.siblings.splice(loc.index + 1, 0, node);
  else roots.push(node);
  return flattenTree(roots);
}

/** Zruší skupinu – její potomci zůstanou na jejím místě (Shift+Ctrl+G). */
export function ungroup<T extends TreeItem>(items: readonly T[], groupId: string): FlatList<T> | null {
  const roots = buildTree(items);
  const loc = findNode(roots, groupId);
  if (!loc || !loc.node.item.isGroup) return null;
  loc.siblings.splice(loc.index, 1, ...loc.node.children);
  return flattenTree(roots);
}

/** Odstraní uzel i s celým podstromem. */
export function removeNode<T extends TreeItem>(items: readonly T[], id: string): FlatList<T> | null {
  const roots = buildTree(items);
  const loc = findNode(roots, id);
  if (!loc) return null;
  loc.siblings.splice(loc.index, 1);
  return flattenTree(roots);
}

/** Nahradí uzel (i s podstromem) jinými uzly – sloučení skupiny, duplikát. */
export function replaceNode<T extends TreeItem>(items: readonly T[], id: string, replacement: TreeNode<T>[]): FlatList<T> | null {
  const roots = buildTree(items);
  const loc = findNode(roots, id);
  if (!loc) return null;
  loc.siblings.splice(loc.index, 1, ...replacement);
  return flattenTree(roots);
}

/** Rodič pro vrstvu vloženou na index `index` plochého seznamu (nad položku index − 1). */
export function parentForInsertion(items: readonly TreeItem[], index: number): string | null {
  const below = items[index - 1];
  if (below) return below.parentId;
  const first = items[0];
  if (!first) return null;
  return first.isGroup ? first.id : first.parentId;
}

/** Z vybraných id ponechá jen „kořeny“ výběru (položky, jejichž žádný předek není také vybraný). */
export function selectionRoots(items: readonly TreeItem[], ids: readonly string[]): string[] {
  const set = new Set(ids);
  const byId = new Map(items.map((i) => [i.id, i]));
  return ids.filter((id) => {
    for (let p = byId.get(id)?.parentId ?? null, guard = 0; p && guard < 100; guard++) {
      if (set.has(p)) return false;
      p = byId.get(p)?.parentId ?? null;
    }
    return byId.has(id);
  });
}

/**
 * Odebere uzly `ids` (i s podstromy) a na místo NEJVYŠŠÍHO z nich vloží `replacement`
 * (nic = jen smazat). `replacement` může být funkce, která dostane odebrané uzly odspodu nahoru
 * – tak vznikne skupina z vybraných vrstev.
 */
export function collapseNodes<T extends TreeItem>(
  items: readonly T[],
  ids: readonly string[],
  replacement: TreeNode<T> | null | ((removed: TreeNode<T>[]) => TreeNode<T> | null),
): FlatList<T> | null {
  const roots = selectionRoots(items, ids);
  if (!roots.length) return null;
  const index = new Map(items.map((it, i) => [it.id, i]));
  const ordered = [...roots].sort((a, b) => index.get(a)! - index.get(b)!);
  const tree = buildTree(items);
  const top = findNode(tree, ordered[ordered.length - 1]);
  if (!top) return null;
  // Zarážka na místě nejvyššího uzlu – ostatní odebrání ji neposune o špatný index.
  const marker: TreeNode<T> = { item: top.node.item, children: [] };
  top.siblings.splice(top.index, 1, marker);
  const removed: TreeNode<T>[] = [];
  for (const id of ordered.slice(0, -1)) {
    const loc = findNode(tree, id);
    if (!loc) continue;
    loc.siblings.splice(loc.index, 1);
    removed.push(loc.node);
  }
  removed.push(top.node);
  const node = typeof replacement === 'function' ? replacement(removed) : replacement;
  const at = findNode(tree, marker.item.id)!;
  at.siblings.splice(at.index, 1, ...(node ? [node] : []));
  return flattenTree(tree);
}

/**
 * Základní vrstva ořezové masky: nejbližší sourozenec pod vrstvou, který sám není ořezaný.
 * Ořezaná vrstva má účinek jen nad vrstvou s pixely (ne nad skupinou) – jinak vrací null.
 */
export function clippingBase<T extends TreeItem & { clipped: boolean }>(items: readonly T[], id: string): T | null {
  const loc = findNode(buildTree(items), id);
  if (!loc || !loc.node.item.clipped || loc.node.item.isGroup) return null;
  for (let i = loc.index - 1; i >= 0; i--) {
    const below = loc.siblings[i].item;
    if (below.isGroup) return null;
    if (!below.clipped) return below;
  }
  return null;
}

/** Má vrstva nad sebou ořezané vrstvy (je základem ořezové masky)? */
export function isClippingBase<T extends TreeItem & { clipped: boolean }>(items: readonly T[], id: string): boolean {
  const loc = findNode(buildTree(items), id);
  if (!loc || loc.node.item.isGroup || loc.node.item.clipped) return false;
  const above = loc.siblings[loc.index + 1]?.item;
  return !!above && !above.isGroup && above.clipped;
}
