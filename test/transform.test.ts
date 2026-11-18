import { describe, expect, it } from 'vitest';
import { boundingBox, containsPoint, corners, dragHandle, dragRotate, identityTransform } from '../src/core/transform/geometry';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('geometrie volné transformace', () => {
  const t0 = identityTransform(10, 20, 100, 50);

  it('rohy a ohraničení bez transformace odpovídají obdélníku', () => {
    expect(corners(t0)).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);
    expect(boundingBox(t0)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('tažení pravého dolního rohu drží levý horní roh na místě', () => {
    const t = dragHandle(t0, { hx: 1, hy: 1 }, { x: 210, y: 120 }, false, false);
    const [tl, , br] = corners(t);
    close(tl.x, 10);
    close(tl.y, 20);
    close(br.x, 210);
    close(br.y, 120);
  });

  it('Shift u rohu zachová poměr stran', () => {
    const t = dragHandle(t0, { hx: 1, hy: 1 }, { x: 310, y: 80 }, true, false);
    close(t.w / t.h, 2);
    close(t.w, 300);
  });

  it('boční úchyt mění jen jednu osu', () => {
    const t = dragHandle(t0, { hx: 0, hy: 1 }, { x: 999, y: 120 }, false, false);
    close(t.w, 100);
    close(t.h, 100);
    close(corners(t)[0].y, 20);
  });

  it('otočení o 90° prohodí rozměry ohraničení a zachová střed', () => {
    const t = dragRotate(t0, { x: 160, y: 45 }, { x: 60, y: 95 }, true);
    close(t.angle, Math.PI / 2);
    expect(boundingBox(t)).toEqual({ x: 35, y: -5, width: 50, height: 100 });
    expect(containsPoint(t, { x: 60, y: 0 })).toBe(true);
    expect(containsPoint(t, { x: 15, y: 45 })).toBe(false);
  });
});
