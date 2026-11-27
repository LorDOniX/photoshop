import { describe, expect, it } from 'vitest';
import { flipGuides, hitGuide, offsetGuides, rotateGuides, scaleGuides, snapPoint, snapRectOffset, snapValue, type Guide } from '../src/core/guides';

const guides: Guide[] = [
  { dir: 'h', pos: 100 },
  { dir: 'v', pos: 30 },
];

describe('vodítka při změnách dokumentu', () => {
  it('změna velikosti a posun', () => {
    expect(scaleGuides(guides, 2, 0.5)).toEqual([
      { dir: 'h', pos: 50 },
      { dir: 'v', pos: 60 },
    ]);
    expect(offsetGuides(guides, -10, 20)).toEqual([
      { dir: 'h', pos: 120 },
      { dir: 'v', pos: 20 },
    ]);
  });

  it('otočení odpovídá otočení bodu', () => {
    const W = 400;
    const H = 300;
    // Bod na průsečíku vodítek (30, 100) se otočí stejně jako vodítka.
    const turn = (q: 1 | 2 | 3, x: number, y: number) => (q === 1 ? [H - y, x] : q === 2 ? [W - x, H - y] : [y, W - x]);
    for (const q of [1, 2, 3] as const) {
      const [x, y] = turn(q, 30, 100);
      const r = rotateGuides(guides, q, W, H);
      expect(r.find((g) => g.dir === 'v')!.pos).toBe(x);
      expect(r.find((g) => g.dir === 'h')!.pos).toBe(y);
    }
  });

  it('převrácení mění jen vodítka kolmá na osu převrácení', () => {
    expect(flipGuides(guides, 'h', 400, 300)).toEqual([
      { dir: 'h', pos: 100 },
      { dir: 'v', pos: 370 },
    ]);
    expect(flipGuides(guides, 'v', 400, 300)).toEqual([
      { dir: 'h', pos: 200 },
      { dir: 'v', pos: 30 },
    ]);
  });
});

describe('přichytávání', () => {
  const t = { xs: [0, 50, 100], ys: [0, 200] };

  it('nejbližší cíl v dosahu', () => {
    expect(snapValue(47, t.xs, 5)).toBe(50);
    expect(snapValue(44, t.xs, 5)).toBeNull();
    expect(snapPoint({ x: 98, y: 120 }, t, 5)).toEqual({ x: 100, y: 120 });
  });

  it('obdélník: okraj nebo střed, nejbližší vyhrává', () => {
    // Pravý okraj 97 → 100 (3 px), levý 57 → 50 (7 px, mimo dosah 5).
    expect(snapRectOffset({ x: 57, y: 10, width: 40, height: 20 }, t, 5)).toEqual({ dx: 3, dy: 0 });
    // Střed 48 → 50.
    expect(snapRectOffset({ x: 28, y: 190, width: 40, height: 20 }, t, 5).dx).toBe(2);
    // Spodní okraj 196 → 200 (střed 186 a horní 176 mimo dosah).
    expect(snapRectOffset({ x: 28, y: 176, width: 40, height: 20 }, t, 5).dy).toBe(4);
  });

  it('zásah vodítka', () => {
    expect(hitGuide(guides, 32, 500, 4)).toBe(1);
    expect(hitGuide(guides, 500, 97, 4)).toBe(0);
    expect(hitGuide(guides, 500, 500, 4)).toBe(-1);
  });
});
