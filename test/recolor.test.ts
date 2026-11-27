import { describe, expect, it } from 'vitest';
import { recolor, redEyeMask, redness, removeRedEye } from '../src/core/paint/recolor';
import { keepConnected, toleranceWeight } from '../src/core/paint/tolerance';
import { measure, straightenAngle } from '../src/core/measure';

const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const sat = (c: number[]) => Math.max(...c) - Math.min(...c);

describe('přebarvení', () => {
  const base: [number, number, number] = [180, 60, 60];
  const paint: [number, number, number] = [40, 90, 220];

  it('barva: odstín a sytost z barvy, jas z pixelu', () => {
    const c = recolor(base, paint, 'color');
    expect(lum(c)).toBeCloseTo(lum(base), 0);
    expect(c[2]).toBeGreaterThan(c[0]);
  });

  it('odstín: sytost i jas z pixelu', () => {
    const c = recolor(base, paint, 'hue');
    expect(lum(c)).toBeCloseTo(lum(base), 0);
    expect(sat(c)).toBeCloseTo(sat(base), 0);
    expect(c[2]).toBeGreaterThan(c[0]);
  });

  it('sytost a světlost', () => {
    const s = recolor([120, 120, 120], paint, 'saturation');
    // Šedá nemá odstín – sytost nejde přenést, zůstane šedá.
    expect(sat(s)).toBe(0);
    const l = recolor(base, paint, 'luminosity');
    expect(lum(l)).toBeCloseTo(lum(paint), 0);
    expect(l[0]).toBeGreaterThan(l[2]);
  });

  it('výsledek zůstane v rozsahu 0..255', () => {
    for (const mode of ['hue', 'saturation', 'color', 'luminosity'] as const) {
      const c = recolor([250, 250, 240], [255, 0, 0], mode);
      for (const v of c) {
        expect(v).toBeGreaterThanOrEqual(-0.001);
        expect(v).toBeLessThanOrEqual(255.001);
      }
    }
  });
});

describe('tolerance', () => {
  it('s vyhlazením měkký okraj, bez něj ostrý', () => {
    expect(toleranceWeight(10, 100)).toBe(1);
    expect(toleranceWeight(75, 100)).toBeCloseTo(0.5);
    expect(toleranceWeight(100, 100)).toBe(0);
    expect(toleranceWeight(75, 100, false)).toBe(1);
  });

  it('souvislé ponechá jen oblast spojenou se středem', () => {
    const s = new Float32Array([1, 1, 0, 1, 1, 0, 0, 0, 1]);
    keepConnected(s, 3, 3, 0, 0);
    expect(Array.from(s)).toEqual([1, 1, 0, 1, 1, 0, 0, 0, 0]);
  });
});

describe('červené oči', () => {
  it('červenost: zornice ano, pleť a tmavé ne; větší zornice je citlivější', () => {
    expect(redness(200, 40, 40)).toBe(1);
    expect(redness(220, 160, 130)).toBe(0);
    expect(redness(30, 0, 0)).toBe(0);
    expect(redness(180, 90, 90, 90)).toBeGreaterThan(redness(180, 90, 90, 10));
  });

  const W = 40;
  const H = 20;
  const image = () => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) d.set([220, 170, 140, 255], i * 4);
    // Dvě červené zornice: (10, 10) a (30, 10), poloměr 4.
    for (const cx of [10, 30])
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - 10) ** 2 <= 16) d.set([210, 30, 40, 255], (y * W + x) * 4);
    return d;
  };

  it('klik opraví jen zornici spojenou s bodem, obdélník všechny', () => {
    const d = image();
    const one = redEyeMask(d, W, H, 50, { x: 12, y: 9 });
    expect(one[10 * W + 10]).toBe(1);
    expect(one[10 * W + 30]).toBe(0);
    expect(one[2 * W + 2]).toBe(0);
    const all = redEyeMask(d, W, H, 50);
    expect(all[10 * W + 30]).toBe(1);
    // Klik mimo červenou (dál než 12 px) nenajde nic.
    expect(redEyeMask(d, W, H, 50, { x: 20, y: 30 }).some((v) => v > 0)).toBe(false);
  });

  it('oprava: zornice tmavá a neutrální, pleť beze změny', () => {
    const d = image();
    expect(removeRedEye(d, redEyeMask(d, W, H, 50), 50)).toBe(true);
    const p = (10 * W + 10) * 4;
    expect(d[p]).toBeLessThan(40);
    expect(Math.abs(d[p] - d[p + 1])).toBeLessThan(10);
    expect(Array.from(d.subarray(0, 4))).toEqual([220, 170, 140, 255]);
    expect(removeRedEye(d, new Float32Array(W * H), 50)).toBe(false);
  });
});

describe('pravítko', () => {
  it('úhel proti směru hodinových ručiček, délka', () => {
    expect(measure({ a: { x: 0, y: 0 }, b: { x: 10, y: -10 } }).angle).toBeCloseTo(45);
    expect(measure({ a: { x: 0, y: 0 }, b: { x: -10, y: 0 } }).angle).toBe(180);
    expect(measure({ a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }).length).toBe(5);
  });

  it('narovnání k nejbližší ose', () => {
    // Úsečka mírně klesá doprava (5°) → otočit o −5°.
    const t = (5 * Math.PI) / 180;
    expect(straightenAngle({ a: { x: 0, y: 0 }, b: { x: Math.cos(t) * 100, y: Math.sin(t) * 100 } })).toBeCloseTo(-t);
    // Skoro svislá (88° od vodorovné) → srovnat na svislou (o +2°).
    const v = (88 * Math.PI) / 180;
    expect(straightenAngle({ a: { x: 0, y: 0 }, b: { x: Math.cos(v) * 100, y: Math.sin(v) * 100 } })).toBeCloseTo((2 * Math.PI) / 180);
    // Úsečka zprava doleva se srovná stejně.
    expect(straightenAngle({ a: { x: 100, y: 10 }, b: { x: 0, y: 0 } })).toBeCloseTo(-Math.atan2(10, 100));
  });
});
