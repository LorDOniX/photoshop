import { describe, expect, it } from 'vitest';
import { blurImage, brushWeight, mixByWeight, sharpenImage, smudgeCarry, smudgeDab, spongeImage, toneCurve, toneImage } from '../src/core/paint/retouch';

const px = (...rgba: number[][]) => ({ data: new Uint8ClampedArray(rgba.flat()), width: rgba.length, height: 1 });

describe('stopa štětce', () => {
  it('tvrdé jádro, měkký okraj, mimo kruh nula', () => {
    expect(brushWeight(0, 10, 0.5)).toBe(1);
    expect(brushWeight(5, 10, 0.5)).toBe(1);
    expect(brushWeight(7.5, 10, 0.5)).toBeCloseTo(0.5);
    expect(brushWeight(10, 10, 0.5)).toBe(0);
    expect(brushWeight(0, 10, 0)).toBe(1);
    expect(brushWeight(5, 10, 0)).toBeCloseTo(0.5);
  });

  it('tvrdost 100 % = ostrý kruh s vyhlazeným okrajem', () => {
    expect(brushWeight(9, 10, 1)).toBe(1);
    expect(brushWeight(10, 10, 1)).toBeCloseTo(0.5);
    expect(brushWeight(11, 10, 1)).toBe(0);
  });
});

describe('zesvětlení a ztmavení', () => {
  it('střední tóny: gama, černá a bílá zůstanou', () => {
    expect(toneCurve(0.5, 'dodge', 'midtones', 0.5)).toBeCloseTo(Math.pow(0.5, 1 / 1.5));
    expect(toneCurve(0.5, 'burn', 'midtones', 0.5)).toBeCloseTo(Math.pow(0.5, 1.5));
    for (const mode of ['dodge', 'burn'] as const) {
      expect(toneCurve(0, mode, 'midtones', 1)).toBe(0);
      expect(toneCurve(1, mode, 'midtones', 1)).toBe(1);
    }
  });

  it('stíny mění hlavně tmavé, světla hlavně světlé hodnoty', () => {
    const shift = (mode: 'dodge' | 'burn', range: 'shadows' | 'highlights', v: number) => Math.abs(toneCurve(v, mode, range, 0.5) - v);
    expect(shift('dodge', 'shadows', 0.2)).toBeGreaterThan(shift('dodge', 'shadows', 0.8));
    expect(shift('burn', 'highlights', 0.8)).toBeGreaterThan(shift('burn', 'highlights', 0.2));
    expect(toneCurve(0, 'dodge', 'shadows', 0.5)).toBeCloseTo(0.25);
    expect(toneCurve(1, 'burn', 'highlights', 0.5)).toBeCloseTo(0.75);
  });

  it('křivky jsou rostoucí (pořadí tónů zůstane)', () => {
    for (const mode of ['dodge', 'burn'] as const)
      for (const range of ['shadows', 'midtones', 'highlights'] as const) {
        let prev = -1;
        for (let i = 0; i <= 100; i++) {
          const out = toneCurve(i / 100, mode, range, 1);
          expect(out).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = out;
        }
      }
  });

  it('chránit tóny: odstín zůstane, bez ochrany se barva posune', () => {
    const src = px([200, 100, 50, 255]);
    const kept = toneImage(src, 'burn', 'midtones', 0.6, true).data;
    expect(kept[0]).toBeLessThan(200);
    // Poměr kanálů (odstín) zůstane.
    expect(kept[0] / kept[1]).toBeCloseTo(2, 1);
    expect(kept[1] / kept[2]).toBeCloseTo(2, 1);
    const raw = toneImage(src, 'burn', 'midtones', 0.6, false).data;
    expect(raw[0] / raw[2]).toBeGreaterThan(5);
    // Průhledné pixely se nemění, alfa zůstává.
    expect(Array.from(toneImage(px([10, 20, 30, 0]), 'dodge', 'midtones', 1, true).data)).toEqual([10, 20, 30, 0]);
    expect(toneImage(px([100, 100, 100, 128]), 'dodge', 'midtones', 1, true).data[3]).toBe(128);
  });
});

describe('houba', () => {
  it('odbarvení na plný tok dá šedou stejného jasu', () => {
    const d = spongeImage(px([200, 100, 50, 255]), 'desaturate', 1, false).data;
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
    expect(Math.abs(d[0] - (0.299 * 200 + 0.587 * 100 + 0.114 * 50))).toBeLessThan(1);
  });

  it('sytost zvětší rozdíl kanálů, živost zabrání ořezu', () => {
    const plain = spongeImage(px([180, 120, 100, 255]), 'saturate', 1, false).data;
    expect(plain[0] - plain[2]).toBeGreaterThan(80);
    const vivid = spongeImage(px([250, 120, 10, 255]), 'saturate', 1, true).data;
    // Bez ořezu: kanály zůstanou v poměru ke jasu (žádný nepřeteče na 0 / 255 víc, než dovolí nejbližší).
    expect(vivid[0]).toBeLessThanOrEqual(255);
    expect(vivid[2]).toBeGreaterThanOrEqual(0);
    const l = 0.299 * 250 + 0.587 * 120 + 0.114 * 10;
    expect((vivid[0] - l) / (250 - l)).toBeCloseTo((vivid[1] - l) / (120 - l), 1);
  });
});

describe('rozostření a zostření', () => {
  const W = 9;
  const edge = () => {
    const data = new Uint8ClampedArray(W * 4);
    for (let x = 0; x < W; x++) data.set(x < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255], x * 4);
    return { data, width: W, height: 1 };
  };

  it('rozostření změkčí hranu, silnější víc', () => {
    const weak = blurImage(edge(), 0.1).data;
    const strong = blurImage(edge(), 1).data;
    expect(weak[3 * 4]).toBeGreaterThan(0);
    expect(strong[2 * 4]).toBeGreaterThan(weak[2 * 4]);
  });

  it('zostření zvýrazní hranu (tmavší tmavá, světlejší světlá strana)', () => {
    const src = edge();
    src.data.set([60, 60, 60, 255], 3 * 4);
    src.data.set([190, 190, 190, 255], 4 * 4);
    const d = sharpenImage(src, 0.5).data;
    expect(d[3 * 4]).toBeLessThan(60);
    expect(d[4 * 4]).toBeGreaterThan(190);
  });
});

describe('rozmazání a míchání', () => {
  it('nesená barva se přenese a postupně slábne', () => {
    const red = new Uint8ClampedArray([255, 0, 0, 255]);
    const carry = smudgeCarry(red);
    const blue = new Uint8ClampedArray([0, 0, 255, 255]);
    smudgeDab(blue, carry, new Float32Array([1]), 0.8);
    // carry = 0.8 · červená + 0.2 · modrá → přenese se plně.
    expect(blue[0]).toBeCloseTo(204, -1);
    expect(blue[2]).toBeCloseTo(51, -1);
    const next = new Uint8ClampedArray([0, 0, 255, 255]);
    smudgeDab(next, carry, new Float32Array([1]), 0.8);
    expect(next[0]).toBeLessThan(blue[0]);
  });

  it('do průhledného okolí se nerozmazává černá, mimo vrstvu se nesená barva nemění', () => {
    const carry = smudgeCarry(new Uint8ClampedArray([255, 255, 255, 255]));
    const clear = new Uint8ClampedArray([0, 0, 0, 0]);
    smudgeDab(clear, carry, new Float32Array([1]), 0.5);
    expect(clear[3]).toBeGreaterThan(100);
    expect(clear[0]).toBe(255);
    const before = Array.from(carry);
    smudgeDab(new Uint8ClampedArray([0, 0, 0, 255]), carry, new Float32Array([-1]), 0.5);
    expect(Array.from(carry)).toEqual(before);
  });

  it('malování prstem začne barvou', () => {
    const carry = smudgeCarry(new Uint8ClampedArray([0, 0, 0, 0]), [10, 200, 30]);
    expect(Array.from(carry)).toEqual([10, 200, 30, 255]);
  });

  it('míchání podle váhy s předem vynásobenou alfou, zamčená průhlednost', () => {
    const before = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
    const effect = new Uint8ClampedArray([0, 0, 255, 255, 0, 255, 0, 255]);
    const out = mixByWeight(before, effect, new Float32Array([0.5, 0.5]), false);
    expect(Array.from(out.subarray(0, 4))).toEqual([128, 0, 128, 255]);
    // Průhledný originál: barva čistě z efektu, alfa napůl.
    expect(Array.from(out.subarray(4, 8))).toEqual([0, 255, 0, 128]);
    const locked = mixByWeight(before, effect, new Float32Array([0.5, 0.5]), true);
    expect(locked[7]).toBe(0);
  });
});
