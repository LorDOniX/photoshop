import { describe, expect, it } from 'vitest';
import { averageColor, parseHex, toHex } from '../src/core/color';
import { restoreAlphaData } from '../src/core/paint/alpha';
import { multiplyMasks, softenEdge } from '../src/core/paint/fill';
import { buildLut, gradientParam, gradientStops, presetStops, renderGradient, reverseGradient, sampleGradient, snapAngle, twoColorGradient, type GradientDef } from '../src/core/paint/gradient';
import { SelectionMask } from '../src/core/selection/SelectionMask';

/** RGBA buffer w × h vyplněný barvou. */
function solid(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) d.set(rgba, i);
  return d;
}

describe('barvy', () => {
  it('hex ↔ rgb', () => {
    expect(parseHex('#ff8000')).toEqual({ r: 255, g: 128, b: 0, a: 255 });
    expect(parseHex('#0f0')).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect(toHex({ r: 255, g: 128, b: 0 })).toBe('#ff8000');
    expect(toHex({ r: 300, g: -5, b: 15.6 })).toBe('#ff0010');
  });

  it('kapátko: bod, průměr a vážení alfou', () => {
    const d = solid(3, 3, [0, 0, 0, 255]);
    d.set([255, 0, 0, 255], (1 * 3 + 1) * 4); // střed červený
    expect(averageColor(d, 3, 3, 1, 1, 1)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(averageColor(d, 3, 3, 1, 1, 3)?.r).toBe(Math.round(255 / 9));
    // Průhledné pixely barvu neovlivní, jen sníží alfu.
    const t = solid(2, 1, [0, 0, 255, 0]);
    t.set([0, 255, 0, 255], 0);
    expect(averageColor(t, 2, 1, 0, 0, 3)).toEqual({ r: 0, g: 255, b: 0, a: 128 });
    expect(averageColor(solid(2, 2, [9, 9, 9, 0]), 2, 2, 0, 0, 3)).toBeNull();
  });
});

describe('přechod', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 10, y: 0 };

  it('poloha v přechodu podle typu', () => {
    expect(gradientParam('linear', start, end)(5, 3)).toBeCloseTo(0.5);
    expect(gradientParam('linear', start, end)(-4, 0)).toBe(0);
    expect(gradientParam('linear', start, end)(20, 0)).toBe(1);
    expect(gradientParam('reflected', start, end)(-5, 0)).toBeCloseTo(0.5);
    expect(gradientParam('radial', start, end)(0, 5)).toBeCloseTo(0.5);
    expect(gradientParam('diamond', start, end)(2.5, 2.5)).toBeCloseTo(0.5);
    expect(gradientParam('diamond', start, end)(0, 10)).toBe(1);
    const angle = gradientParam('angle', start, end);
    expect(angle(10, 0)).toBeCloseTo(0);
    // Proti směru hodinových ručiček na obrazovce (osa y míří dolů).
    expect(angle(0, -10)).toBeCloseTo(0.25);
    expect(angle(-10, 0)).toBeCloseTo(0.5);
    expect(gradientParam('linear', start, start)(3, 3)).toBe(0);
  });

  it('tabulka barev interpoluje mezi body', () => {
    const lut = buildLut(presetStops('black-white', '#123456', '#654321'));
    expect([lut[0], lut[3]]).toEqual([0, 255]);
    const last = lut.length - 4;
    expect([lut[last], lut[last + 1], lut[last + 2]]).toEqual([255, 255, 255]);
    const mid = Math.round((lut.length / 4 - 1) / 2) * 4;
    expect(lut[mid]).toBeCloseTo(127.6, 0);
  });

  it('předvolby podle barev popředí a pozadí', () => {
    expect(presetStops('fg-bg', '#ff0000', '#0000ff').map((s) => s.color)).toEqual([
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 0, b: 255, a: 255 },
    ]);
    expect(presetStops('fg-transparent', '#ff0000', '#000000')[1].color).toEqual({ r: 255, g: 0, b: 0, a: 0 });
  });

  it('vykreslení lineárního přechodu, obrácení a rozptýlení', () => {
    const lut = buildLut(presetStops('black-white', '#000', '#fff'));
    const out = new Uint8ClampedArray(10 * 4);
    renderGradient(out, 10, 1, 0, 0, { type: 'linear', start, end, lut });
    const reds = Array.from({ length: 10 }, (_, i) => out[i * 4]);
    expect(reds[0]).toBeLessThan(20);
    expect(reds[9]).toBeGreaterThan(235);
    for (let i = 1; i < 10; i++) expect(reds[i]).toBeGreaterThan(reds[i - 1]);

    renderGradient(out, 10, 1, 0, 0, { type: 'linear', start, end, lut, reverse: true });
    expect(out[0]).toBeGreaterThan(235);

    const plain = new Uint8ClampedArray(10 * 4);
    const noisy = new Uint8ClampedArray(10 * 4);
    renderGradient(plain, 10, 1, 0, 0, { type: 'linear', start, end, lut });
    renderGradient(noisy, 10, 1, 0, 0, { type: 'linear', start, end, lut, dither: true, random: () => 0.99 });
    for (let i = 0; i < 10; i++) expect(Math.abs(noisy[i * 4] - plain[i * 4])).toBeLessThan(2);
  });

  it('Shift přichytí úhel k 45°', () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(Math.hypot(10, 1));
    const d = snapAngle({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(d.x).toBeCloseTo(d.y);
  });
});

describe('plechovka', () => {
  it('vyhlazení přidá lem jen kolem oblasti', () => {
    const m = SelectionMask.rect(6, 6, { x: 2, y: 2, width: 2, height: 2 });
    const s = softenEdge(m);
    expect(s.get(2, 2)).toBe(255);
    expect(s.get(1, 2)).toBe(Math.round((2 * 255) / 9));
    expect(s.get(1, 1)).toBe(Math.round(255 / 9));
    expect(s.get(0, 0)).toBe(0);
    expect(softenEdge(new SelectionMask(4, 4)).isEmpty()).toBe(true);
  });

  it('oblast se násobí výběrem', () => {
    const a = SelectionMask.all(2, 1);
    const b = new SelectionMask(2, 1, new Uint8ClampedArray([255, 128]));
    expect(Array.from(multiplyMasks(a, b).data)).toEqual([255, 128]);
    expect(multiplyMasks(a, null)).toBe(a);
  });
});

describe('zámek průhlednosti', () => {
  it('vrátí původní alfu, průhledné zůstane průhledné', () => {
    const after = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 9, 9, 9, 10]);
    const before = new Uint8ClampedArray([0, 0, 255, 128, 0, 0, 0, 0, 0, 0, 0, 200]);
    restoreAlphaData(after, before);
    expect(Array.from(after)).toEqual([255, 0, 0, 128, 0, 0, 0, 0, 9, 9, 9, 200]);
  });
});

describe('vícebarevné přechody', () => {
  const def: GradientDef = {
    colors: [
      { pos: 0, color: '#ff0000' },
      { pos: 0.5, color: '#00ff00' },
      { pos: 1, color: '#0000ff' },
    ],
    alphas: [
      { pos: 0, opacity: 1 },
      { pos: 0.25, opacity: 0 },
      { pos: 1, opacity: 1 },
    ],
  };

  it('barva a krytí se interpolují zvlášť', () => {
    expect(sampleGradient(def, 0.25)).toEqual({ r: 127.5, g: 127.5, b: 0, a: 0 });
    expect(sampleGradient(def, 0.75)).toEqual({ r: 0, g: 127.5, b: 127.5, a: (2 / 3) * 255 });
    expect(sampleGradient(def, -1).r).toBe(255);
  });

  it('zastávky = sjednocení poloh, tabulka sedí', () => {
    expect(gradientStops(def).map((s) => s.pos)).toEqual([0, 0.25, 0.5, 1]);
    const lut = buildLut(gradientStops(def));
    const at = (t: number) => Math.round(t * 1023) * 4;
    expect(Math.round(lut[at(0.25) + 3])).toBeLessThan(2);
    expect(Math.round(lut[at(0.5) + 1])).toBe(255);
  });

  it('obrácení a dvoubarevný přechod', () => {
    expect(reverseGradient(def).colors.map((c) => c.color)).toEqual(['#0000ff', '#00ff00', '#ff0000']);
    expect(reverseGradient(def).alphas.map((a) => a.pos)).toEqual([0, 0.75, 1]);
    expect(gradientStops(twoColorGradient('#000000', '#ffffff')).length).toBe(2);
  });
});
