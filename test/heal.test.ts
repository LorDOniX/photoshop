import { describe, expect, it } from 'vitest';
import { findPatchOffset, healRegion, membrane, ring } from '../src/core/paint/heal';

describe('membrána (harmonická interpolace)', () => {
  it('mezi dvěma známými sloupci vyjde lineární průběh', () => {
    const w = 41;
    const h = 9;
    const v = new Float32Array(w * h);
    const known = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      known[y * w] = 1;
      known[y * w + w - 1] = 1;
      v[y * w + w - 1] = 100;
    }
    membrane(v, known, w, h, 1);
    for (const x of [10, 20, 30]) expect(Math.abs(v[4 * w + x] - (100 * x) / (w - 1))).toBeLessThan(3);
    expect(v[w - 1]).toBe(100);
  });

  it('bez známých hodnot nic nemění', () => {
    const v = new Float32Array([5, 6, 7, 8]);
    membrane(v, new Uint8Array(4), 2, 2, 1);
    expect(Array.from(v)).toEqual([5, 6, 7, 8]);
  });
});

describe('retušování', () => {
  const W = 40;
  const H = 40;
  const fill = (f: (x: number, y: number) => number) => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = f(x, y);
        d.set([v, v, v, 255], (y * W + x) * 4);
      }
    return d;
  };
  const inside = new Uint8Array(W * H);
  for (let y = 12; y < 28; y++) for (let x = 12; x < 28; x++) inside[y * W + x] = 1;

  it('textura ze zdroje, jas z okolí cíle', () => {
    const dst = fill(() => 100);
    const src = fill((x, y) => 200 + ((x + y) % 2 ? 20 : -20));
    const out = healRegion(dst, src, inside, W, H);
    let sum = 0;
    let n = 0;
    for (let y = 14; y < 26; y++)
      for (let x = 14; x < 26; x++) {
        const v = out[(y * W + x) * 4];
        sum += v;
        n++;
        // textura zůstane: sousedé se liší o ~40
        if (x > 14) expect(Math.abs(v - out[(y * W + x - 1) * 4])).toBeGreaterThan(30);
      }
    expect(Math.abs(sum / n - 100)).toBeLessThan(4);
    expect(out[0]).toBe(100);
    expect(out[3 + 20 * 4 * W + 20 * 4]).toBe(255);
  });

  it('okraj oblasti', () => {
    const r = ring(inside, W, H, 2);
    expect(r[20 * W + 11]).toBe(1);
    expect(r[20 * W + 10]).toBe(1);
    expect(r[20 * W + 9]).toBe(0);
    expect(r[20 * W + 20]).toBe(0);
  });

  it('bodové retušování najde podobné okolí', () => {
    // vlevo tmavá, vpravo světlá; vada v tmavé části → zdroj také v tmavé
    const img = fill((x) => (x < 30 ? 20 : 230));
    const small = new Uint8Array(W * H);
    for (let y = 16; y < 22; y++) for (let x = 8; x < 14; x++) small[y * W + x] = 1;
    for (let y = 16; y < 22; y++) for (let x = 8; x < 14; x++) img[(y * W + x) * 4] = 255;
    const o = findPatchOffset(img, small, W, H, 6)!;
    expect(o).not.toBeNull();
    for (let y = 16; y < 22; y++) for (let x = 8; x < 14; x++) expect(x + o.x).toBeLessThan(27);
  });
});
