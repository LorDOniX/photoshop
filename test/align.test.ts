import { describe, expect, it } from 'vitest';
import { alignOffsets, alphaBounds, distributeOffsets } from '../src/core/align';
import { clippingBase, isClippingBase, type TreeItem } from '../src/core/groups';
import { squaredDistance, strokeMask } from '../src/core/paint/stroke';
import { SelectionMask } from '../src/core/selection/SelectionMask';

const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('zarovnání vrstev', () => {
  const rects = [r(10, 10, 20, 20), r(50, 30, 40, 10)];
  const ref = r(0, 0, 100, 100);
  it('okraje a středy', () => {
    expect(alignOffsets(rects, ref, 'left')).toEqual([{ dx: -10, dy: 0 }, { dx: -50, dy: 0 }]);
    expect(alignOffsets(rects, ref, 'right')).toEqual([{ dx: 70, dy: 0 }, { dx: 10, dy: 0 }]);
    expect(alignOffsets(rects, ref, 'hcenter')).toEqual([{ dx: 30, dy: 0 }, { dx: -20, dy: 0 }]);
    expect(alignOffsets(rects, ref, 'bottom')).toEqual([{ dx: 0, dy: 70 }, { dx: 0, dy: 60 }]);
    expect(alignOffsets(rects, ref, 'vcenter')).toEqual([{ dx: 0, dy: 30 }, { dx: 0, dy: 15 }]);
  });

  it('stejné mezery: krajní zůstanou, prostřední se posunou', () => {
    const three = [r(0, 0, 10, 10), r(80, 0, 20, 10), r(15, 0, 10, 10)];
    // rozpětí 0..100, šířky 40 → mezery 30
    expect(distributeOffsets(three, 'h')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 25, dy: 0 }]);
    expect(distributeOffsets(three.slice(0, 2), 'h')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  });

  it('obdélník neprůhledných pixelů', () => {
    const d = new Uint8ClampedArray(5 * 4 * 4);
    d[(1 * 5 + 2) * 4 + 3] = 255;
    d[(3 * 5 + 3) * 4 + 3] = 10;
    expect(alphaBounds(d, 5, 4)).toEqual(r(2, 1, 2, 3));
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});

describe('obrys výběru', () => {
  it('vzdálenostní transformace je euklidovská', () => {
    const d = squaredDistance((p) => p === 0, 4, 4);
    expect(d[0]).toBe(0);
    expect(d[3]).toBe(9);
    expect(d[15]).toBe(18);
  });

  // čtverec 10..20 v plátně 30 × 30
  const sel = SelectionMask.rect(30, 30, r(10, 10, 10, 10));
  it('vně: pás 3 px mimo výběr, kulaté rohy', () => {
    const m = strokeMask(sel, 3, 'outside');
    expect(m.get(15, 9)).toBe(255);
    expect(m.get(15, 7)).toBe(255);
    expect(m.get(15, 6)).toBe(0);
    expect(m.get(15, 10)).toBe(0);
    // roh: (7,7) je od rohu (10,10) vzdálen √18 > 3 → mimo
    expect(m.get(7, 7)).toBe(0);
    expect(m.get(9, 9)).toBe(255);
  });
  it('uvnitř a na střed', () => {
    const inside = strokeMask(sel, 2, 'inside');
    expect([inside.get(10, 15), inside.get(11, 15), inside.get(12, 15), inside.get(9, 15)]).toEqual([255, 255, 0, 0]);
    const center = strokeMask(sel, 2, 'center');
    expect([center.get(9, 15), center.get(10, 15), center.get(11, 15)]).toEqual([255, 255, 0]);
  });
});

describe('ořezová maska', () => {
  type Item = TreeItem & { clipped: boolean };
  const it_ = (id: string, clipped = false, parentId: string | null = null, isGroup = false): Item => ({ id, clipped, parentId, isGroup });
  it('základ = nejbližší neořezaný sourozenec pod vrstvou s pixely', () => {
    const list = [it_('a'), it_('b', true), it_('c', true), it_('d')];
    expect(clippingBase(list, 'c')?.id).toBe('a');
    expect(clippingBase(list, 'b')?.id).toBe('a');
    expect(clippingBase(list, 'd')).toBeNull();
    expect(isClippingBase(list, 'a')).toBe(true);
    expect(isClippingBase(list, 'd')).toBe(false);
  });
  it('nad skupinou ani na dně skupiny ořezová maska nepůsobí', () => {
    const list = [it_('x', false, 'g'), it_('g', false, null, true), it_('b', true)];
    expect(clippingBase(list, 'b')).toBeNull();
    const inGroup = [it_('x', true, 'g'), it_('g', false, null, true)];
    expect(clippingBase(inGroup, 'x')).toBeNull();
  });
});
