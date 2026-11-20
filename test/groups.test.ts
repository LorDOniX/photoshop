import { describe, expect, it } from 'vitest';
import {
  buildTree,
  collapseNodes,
  depthOf,
  effectivelyVisible,
  flattenTree,
  isWithin,
  moveNode,
  parentForInsertion,
  removeNode,
  selectionRoots,
  shiftNode,
  ungroup,
  wrapInGroup,
  type FlatList,
  type TreeItem,
} from '../src/core/groups';

interface Item extends TreeItem {
  visible: boolean;
}

/** Zápis „id“ = vrstva, „G:id“ = skupina, „id>rodič“ = zařazení. Odspodu nahoru. */
function items(spec: string): Item[] {
  return spec.split(' ').map((s) => {
    const [head, parent] = s.split('>');
    const isGroup = head.startsWith('G:');
    return { id: isGroup ? head.slice(2) : head, parentId: parent ?? null, isGroup, visible: true };
  });
}

/** Zpět do zápisu (pro srovnání výsledku). */
function spec(list: FlatList<Item> | null): string {
  if (!list) return 'null';
  return list.items.map((i) => `${i.isGroup ? 'G:' : ''}${i.id}${list.parents.get(i.id) ? `>${list.parents.get(i.id)}` : ''}`).join(' ');
}

// a, b ve skupině g, c nad skupinou
const base = () => items('a>g b>g G:g c');

describe('strom skupin', () => {
  it('strom a zploštění jsou inverzní', () => {
    const roots = buildTree(base());
    expect(roots.map((n) => n.item.id)).toEqual(['g', 'c']);
    expect(roots[0].children.map((n) => n.item.id)).toEqual(['a', 'b']);
    expect(spec(flattenTree(roots))).toBe('a>g b>g G:g c');
  });

  it('hloubka, předci a viditelnost včetně skupiny', () => {
    const list = items('a>h G:h>g G:g');
    expect(depthOf(list, 'a')).toBe(2);
    expect(isWithin(list, 'a', 'g')).toBe(true);
    expect(isWithin(list, 'g', 'a')).toBe(false);
    list[2].visible = false;
    expect(effectivelyVisible(list, 'a')).toBe(false);
  });

  it('seskupit a zrušit seskupení', () => {
    const g2 = { id: 'n', parentId: null, isGroup: true, visible: true };
    expect(spec(wrapInGroup(base(), 'c', g2))).toBe('a>g b>g G:g c>n G:n');
    expect(spec(wrapInGroup(base(), 'g', g2))).toBe('a>g b>g G:g>n G:n c');
    expect(spec(ungroup(base(), 'g'))).toBe('a b c');
    expect(ungroup(base(), 'a')).toBeNull();
  });

  it('přesun nad / pod / do skupiny; skupina nejde do sebe', () => {
    expect(spec(moveNode(base(), 'c', 'a', 'below'))).toBe('c>g a>g b>g G:g');
    expect(spec(moveNode(base(), 'a', 'c', 'above'))).toBe('b>g G:g c a');
    expect(spec(moveNode(base(), 'c', 'g', 'into'))).toBe('a>g b>g c>g G:g');
    expect(spec(moveNode(base(), 'c', 'g', 'below'))).toBe('c a>g b>g G:g');
    expect(moveNode(base(), 'g', 'a', 'above')).toBeNull();
    expect(moveNode(base(), 'c', 'a', 'into')).toBeNull();
  });

  it('Ctrl+] / Ctrl+[ mezi sourozenci, na okraji ze skupiny ven', () => {
    expect(spec(shiftNode(base(), 'a', 1))).toBe('b>g a>g G:g c');
    expect(spec(shiftNode(base(), 'b', 1))).toBe('a>g G:g b c');
    expect(spec(shiftNode(base(), 'a', -1))).toBe('a b>g G:g c');
    expect(spec(shiftNode(base(), 'c', -1))).toBe('c a>g b>g G:g');
    expect(spec(shiftNode(base(), 'g', 1))).toBe('c a>g b>g G:g');
    expect(shiftNode(base(), 'c', 1)).toBeNull();
    expect(spec(shiftNode(base(), 'c', -1, true))).toBe('c a>g b>g G:g');
    expect(shiftNode(base(), 'b', 1, true)).toBeNull();
  });

  it('smazání skupiny smaže i obsah', () => {
    expect(spec(removeNode(base(), 'g'))).toBe('c');
  });

  it('rodič vložené vrstvy podle místa v seznamu', () => {
    const list = base();
    expect(parentForInsertion(list, 1)).toBe('g'); // nad a
    expect(parentForInsertion(list, 2)).toBe('g'); // nad b (pod záhlavím)
    expect(parentForInsertion(list, 3)).toBeNull(); // nad skupinou
    expect(parentForInsertion(list, 0)).toBe('g'); // úplně dole = dno skupiny
    expect(parentForInsertion(items('G:e'), 0)).toBe('e'); // prázdná skupina
    expect(parentForInsertion([], 0)).toBeNull();
  });

  it('kořeny výběru vynechají vrstvy vybraných skupin', () => {
    expect(selectionRoots(base(), ['a', 'g', 'c'])).toEqual(['g', 'c']);
    expect(selectionRoots(base(), ['a', 'x'])).toEqual(['a']);
  });

  it('více vybraných: seskupit na místo nejvyšší, smazat, nahradit', () => {
    const list = items('a b>g G:g c d');
    const group = { id: 'n', parentId: null, isGroup: true, visible: true };
    // a (kořen) a b (ve skupině g) do nové skupiny na místě b
    expect(spec(collapseNodes(list, ['a', 'b'], (removed) => ({ item: group, children: removed })))).toBe('a>n b>n G:n>g G:g c d');
    expect(spec(collapseNodes(list, ['a', 'c'], (removed) => ({ item: group, children: removed })))).toBe('b>g G:g a>n c>n G:n d');
    expect(spec(collapseNodes(list, ['g', 'd'], null))).toBe('a c');
    const merged = { id: 'm', parentId: null, isGroup: false, visible: true };
    expect(spec(collapseNodes(list, ['a', 'c'], { item: merged, children: [] }))).toBe('b>g G:g m d');
    expect(collapseNodes(list, [], null)).toBeNull();
  });
});
