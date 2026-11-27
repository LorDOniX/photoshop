import { createCanvas, get2d, unionRect, type Rect } from '../core/canvas';
import { effectPadding } from '../core/effects';
import { buildTree, type TreeNode } from '../core/groups';
import type { DocChange, ImageDocument } from '../core/ImageDocument';
import type { Layer } from '../core/Layer';
import { compositeRegion, drawNodes } from './composite';

/*
 * Rychlé překreslování velkých dokumentů. Kořenové uzly stromu vrstev se rozdělí na tři úseky:
 *   pod   – hotové složení v plátně `under`,
 *   střed – uzel s aktivní vrstvou (u ořezové masky celá ořezová skupina) – skládá se při každé změně,
 *   nad   – hotové složení v plátně `over`.
 * Úpravy aktivní vrstvy (tah štětcem, krytí, přesun) tak stojí jen „pod + střed + nad“ a u tahu jen
 * ve změněném výřezu. Úsek „nad“ jde předskládat jen tehdy, když se celý skládá režimem Normální
 * (operace „přes“ je asociativní); jinak se rozdělení nepoužije a skládá se vše (ale stále jen ve výřezu).
 */

interface Split {
  /** Klíč struktury, pro kterou rozdělení platí. */
  key: string;
  mid: TreeNode<Layer>[];
  /** Id všech vrstev ve středu (včetně potomků skupin). */
  midIds: Set<string>;
  hasUnder: boolean;
  hasOver: boolean;
}

/** Skládá se uzel do okolí jen operací „přes“ (source-over)? */
function overSafe(node: TreeNode<Layer>): boolean {
  const l = node.item;
  // Vrstva úprav mění všechno pod sebou – úsek s ní nejde předskládat zvlášť.
  if (!l.isGroup) return l.blendMode === 'source-over' && !l.adjustment;
  // Průchozí skupina (100 %, Normální) skládá potomky přímo do okolí.
  if (l.opacity >= 1 && l.blendMode === 'source-over') return node.children.every(overSafe);
  return l.blendMode === 'source-over';
}

function collectIds(nodes: readonly TreeNode<Layer>[], out: Set<string>): Set<string> {
  for (const n of nodes) {
    out.add(n.item.id);
    collectIds(n.children, out);
  }
  return out;
}

export class CompositeCache {
  /** Výsledné složení dokumentu. */
  composite: HTMLCanvasElement;
  private under: HTMLCanvasElement | null = null;
  private over: HTMLCanvasElement | null = null;
  private split: Split | null = null;
  /** Celé složení (i úseky pod / nad) je neplatné. */
  private allDirty = true;
  /** Neplatný střed – celý (true) nebo jen výřez. */
  private midDirty: Rect | true | null = null;

  constructor(private doc: ImageDocument) {
    this.composite = createCanvas(doc.width, doc.height);
  }

  setDocument(doc: ImageDocument): void {
    this.doc = doc;
    this.invalidate();
  }

  invalidate(): void {
    this.allDirty = true;
  }

  /** Zpracuje změnu dokumentu – rozhodne, co je potřeba přeskládat. */
  onChange(c: DocChange): void {
    if (c.kind === 'selection' || c.kind === 'guides') return;
    if (c.kind === 'pixels' || c.kind === 'props') {
      if (this.split?.midIds.has(c.layerId)) {
        if (c.kind === 'pixels' && c.rect && this.midDirty !== true) {
          // Stín / tah vrstvy sahá i mimo změněné pixely.
          const pad = effectPadding(this.doc.getLayer(c.layerId)?.effects);
          const r = c.rect;
          this.midDirty = unionRect(this.midDirty, { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
        } else this.midDirty = true;
        // Změna režimu prolnutí apod. se projeví v klíči struktury – update() pak rozdělení přepočítá.
        return;
      }
    }
    this.allDirty = true;
  }

  /** Klíč struktury: pořadí, rodiče, aktivní vrstva a vlastnosti ovlivňující rozdělení. */
  private structureKey(): string {
    const d = this.doc;
    return `${d.width}x${d.height}|${d.activeLayerId}|${d.layers.map((l) => `${l.id}:${l.parentId}:${l.clipped ? 1 : 0}:${l.blendMode}:${l.isGroup ? (l.opacity >= 1 ? 'g1' : 'g') : ''}${l.adjustment ? 'a' : ''}`).join(',')}`;
  }

  /** Rozdělí kořenové uzly na pod / střed / nad podle aktivní vrstvy. */
  private computeSplit(roots: TreeNode<Layer>[]): { under: TreeNode<Layer>[]; mid: TreeNode<Layer>[]; over: TreeNode<Layer>[] } {
    const all = { under: [], mid: roots, over: [] };
    const active = this.doc.activeLayerId;
    if (!active) return all;
    let i = roots.findIndex((n) => collectIds([n], new Set()).has(active));
    if (i < 0) return all;
    // Ořezová maska se musí skládat celá: základ + ořezané vrstvy nad ním.
    const isClipped = (n: TreeNode<Layer> | undefined) => !!n && !n.item.isGroup && n.item.clipped;
    let start = i;
    while (start > 0 && isClipped(roots[start])) start--;
    let end = i + 1;
    while (end < roots.length && isClipped(roots[end])) end++;
    i = start;
    const over = roots.slice(end);
    if (!over.every(overSafe)) return all;
    return { under: roots.slice(0, i), mid: roots.slice(i, end), over };
  }

  private canvasFor(current: HTMLCanvasElement | null): HTMLCanvasElement {
    const { width, height } = this.doc;
    return current && current.width === width && current.height === height ? current : createCanvas(width, height);
  }

  /**
   * Přeskládá, co je potřeba. Vrací změněný výřez složení (null = beze změny, 'all' = celé).
   */
  update(): Rect | 'all' | null {
    const doc = this.doc;
    if (this.composite.width !== doc.width || this.composite.height !== doc.height) {
      this.composite = createCanvas(doc.width, doc.height);
      this.allDirty = true;
    }
    const key = this.split ? this.structureKey() : '';
    if (!this.allDirty && this.split && this.split.key !== key) this.allDirty = true;

    if (this.allDirty) {
      const roots = buildTree(doc.layers);
      const parts = this.computeSplit(roots);
      this.under = parts.under.length ? this.canvasFor(this.under) : null;
      this.over = parts.over.length ? this.canvasFor(this.over) : null;
      if (this.under) compositeRegion(get2d(this.under), parts.under, null);
      if (this.over) compositeRegion(get2d(this.over), parts.over, null);
      this.split = {
        key: this.structureKey(),
        mid: parts.mid,
        midIds: collectIds(parts.mid, new Set()),
        hasUnder: !!this.under,
        hasOver: !!this.over,
      };
      compositeRegion(get2d(this.composite), parts.mid, null, this.under, this.over);
      this.allDirty = false;
      this.midDirty = null;
      return 'all';
    }
    if (!this.midDirty || !this.split) return null;
    const rect = this.midDirty === true ? null : this.midDirty;
    // Strom středu se staví znovu (vlastnosti uzlů se mohly změnit, objekty vrstev zůstávají).
    const mid = buildTree(doc.layers).filter((n) => this.split!.midIds.has(n.item.id));
    compositeRegion(get2d(this.composite), mid, rect, this.under, this.over);
    this.midDirty = null;
    return rect ?? 'all';
  }

  /** Pro ladění / testy: kolik úseků se právě předskládává. */
  get stats(): { split: boolean; under: boolean; over: boolean; mid: number } {
    return { split: !!this.split, under: !!this.under, over: !!this.over, mid: this.split?.mid.length ?? 0 };
  }
}

/** Vykreslení celého dokumentu bez cache (export, testy). */
export function compositeAll(doc: ImageDocument, ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawNodes(ctx, buildTree(doc.layers));
}
