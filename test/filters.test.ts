import { describe, expect, it } from 'vitest';
import { applyFilter, boxesForGauss, colorToAlpha, gaussianBlur, median, motionBlur, offset, scaleFilter, seededRandom, type Img } from '../src/core/filters';

const img = (w: number, h: number, px: (x: number, y: number) => number[]): Img => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
};
const at = (i: Img, x: number, y: number) => Array.from(i.data.slice((y * i.width + x) * 4, (y * i.width + x) * 4 + 4));

describe('rozostření', () => {
  it('rámečky pro Gausse mají správný rozptyl', () => {
    for (const sigma of [3, 5, 10, 25]) {
      const variance = boxesForGauss(sigma).reduce((s, r) => s + ((2 * r + 1) ** 2 - 1) / 12, 0);
      expect(Math.abs(Math.sqrt(variance) - sigma) / sigma).toBeLessThan(0.08);
    }
  });

  it('Gauss zachová plochu a průměr, průhledné okolí neztmaví okraj', () => {
    const flat = img(20, 20, () => [100, 150, 200, 255]);
    for (const r of [1, 4]) expect(at(gaussianBlur(flat, r), 10, 10)).toEqual([100, 150, 200, 255]);
    // červený čtverec na průhledném: barva na okraji zůstane červená, jen alfa klesne
    const sq = img(30, 30, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    for (const r of [1.5, 5]) {
      const b = gaussianBlur(sq, r);
      const edge = at(b, 9, 15);
      expect(edge[3]).toBeGreaterThan(10);
      expect(edge[3]).toBeLessThan(200);
      expect(edge.slice(0, 3)).toEqual([255, 0, 0]);
    }
    // součet alfy se zachová
    const sum = (i: Img) => { let s = 0; for (let p = 3; p < i.data.length; p += 4) s += i.data[p]; return s; };
    expect(Math.abs(sum(gaussianBlur(sq, 3)) - sum(sq)) / sum(sq)).toBeLessThan(0.02);
  });

  it('pohybem jen ve směru úhlu', () => {
    const line = img(21, 21, (_x, y) => (y === 10 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const h = motionBlur(line, 0, 9);
    expect(at(h, 10, 10)).toEqual([255, 255, 255, 255]);
    expect(at(h, 10, 9)[0]).toBe(0);
    const v = motionBlur(line, 90, 9);
    expect(at(v, 10, 10)[0]).toBe(28);
    expect(at(v, 10, 13)[0]).toBe(28);
  });

  it('průměr vybrané oblasti', () => {
    const two = img(2, 1, (x) => (x ? [200, 0, 0, 255] : [0, 0, 100, 255]));
    expect(at(applyFilter(two, { kind: 'average' }), 0, 0)).toEqual([100, 0, 50, 255]);
    expect(at(applyFilter(two, { kind: 'average' }, { x: 0, y: 0, width: 2, height: 1 }, [0, 255]), 0, 0)).toEqual([200, 0, 0, 255]);
  });
});

describe('šum, medián, zostření', () => {
  it('šum se semínkem je opakovatelný, průhlednost nechá', () => {
    const g = img(10, 10, (x, y) => [128, 128, 128, x === 0 && y === 0 ? 0 : 255]);
    const a = applyFilter(g, { kind: 'addNoise', amount: 25, gaussian: true, monochromatic: true, seed: 7 });
    const b = applyFilter(g, { kind: 'addNoise', amount: 25, gaussian: true, monochromatic: true, seed: 7 });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(at(a, 0, 0)).toEqual([128, 128, 128, 0]);
    const p = at(a, 5, 5);
    expect(p[0]).toBe(p[1]);
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });

  it('medián odstraní osamělý pixel a nechá hranu', () => {
    const spot = img(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(at(median(spot, 1), 4, 4)).toEqual([0, 0, 0, 255]);
    const edge = img(9, 9, (x) => (x < 4 ? [0, 0, 0, 255] : [200, 200, 200, 255]));
    const m = median(edge, 2);
    expect([at(m, 3, 4)[0], at(m, 4, 4)[0]]).toEqual([0, 200]);
    // stejně jako hrubá síla
    const rnd = seededRandom(3);
    const noisy = img(12, 7, () => [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256), 255]);
    const fast = median(noisy, 2);
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 12; x++) {
        const vals: number[] = [];
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) vals.push(noisy.data[(Math.min(6, Math.max(0, y + dy)) * 12 + Math.min(11, Math.max(0, x + dx))) * 4]);
        vals.sort((p, q) => p - q);
        expect(fast.data[(y * 12 + x) * 4]).toBe(vals[12]);
      }
    }
  });

  it('maska rozostření zvýší kontrast hrany, plochu nechá', () => {
    const edge = img(20, 5, (x) => (x < 10 ? [100, 100, 100, 255] : [150, 150, 150, 255]));
    const s = applyFilter(edge, { kind: 'unsharpMask', amount: 100, radius: 2, threshold: 0 });
    expect(at(s, 9, 2)[0]).toBeLessThan(100);
    expect(at(s, 10, 2)[0]).toBeGreaterThan(150);
    expect(at(s, 1, 2)[0]).toBe(100);
    const t = applyFilter(edge, { kind: 'unsharpMask', amount: 100, radius: 2, threshold: 40 });
    expect(at(t, 9, 2)[0]).toBe(100);
    const hp = applyFilter(edge, { kind: 'highPass', radius: 2 });
    expect(at(hp, 1, 2)[0]).toBe(128);
  });
});

describe('ostatní', () => {
  it('posun: zalomení, opakování okraje, průhlednost', () => {
    const row = img(4, 1, (x) => [x * 10, 0, 0, 255]);
    const area = { x: 0, y: 0, width: 4, height: 1 };
    expect([0, 1, 2, 3].map((x) => at(offset(row, area, 1, 0, 'wrap'), x, 0)[0])).toEqual([30, 0, 10, 20]);
    expect([0, 1, 2, 3].map((x) => at(offset(row, area, 1, 0, 'repeat'), x, 0)[0])).toEqual([0, 0, 10, 20]);
    expect(at(offset(row, area, 1, 0, 'transparent'), 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('mozaika a barva na alfu', () => {
    const g = img(4, 2, (x) => [x < 2 ? 0 : 200, 0, 0, 255]);
    const m = applyFilter(g, { kind: 'mosaic', size: 4 });
    expect(at(m, 0, 0)).toEqual([100, 0, 0, 255]);
    const white = colorToAlpha(img(1, 1, () => [255, 255, 255, 255]), '#ffffff');
    expect(at(white, 0, 0)[3]).toBe(0);
    const gray = colorToAlpha(img(1, 1, () => [128, 128, 128, 255]), '#ffffff');
    expect(at(gray, 0, 0)).toEqual([0, 0, 0, 127]);
  });
});

describe('deformace, stylizace, vykreslení', () => {
  const area = (i: Img) => ({ x: 0, y: 0, width: i.width, height: i.height });
  const grad = img(40, 40, (x, y) => [x * 6, y * 6, 100, 255]);
  const same = (a: Img, b: Img, tol = 1) => a.data.every((v, i) => Math.abs(v - b.data[i]) <= tol);

  it('nulové hodnoty nic nemění', () => {
    for (const f of [{ kind: 'twirl', angle: 0 }, { kind: 'pinch', amount: 0 }, { kind: 'spherize', amount: 0 }, { kind: 'ripple', amount: 0, size: 10 }] as const) {
      expect(same(applyFilter(grad, f), grad)).toBe(true);
    }
  });

  it('zkroucení otáčí uvnitř elipsy, mimo nic', () => {
    const t = applyFilter(grad, { kind: 'twirl', angle: 90 });
    expect(at(t, 0, 0)).toEqual(at(grad, 0, 0));
    expect(at(t, 20, 10)).not.toEqual(at(grad, 20, 10));
  });

  it('kulovitost zvětší střed, sevření zmenší', () => {
    // vodorovný řez x: vzdálenost od středu podle červené
    const red = (i: Img, x: number) => at(i, x, 20)[0];
    const sph = applyFilter(grad, { kind: 'spherize', amount: 100 });
    const pin = applyFilter(grad, { kind: 'pinch', amount: 100 });
    expect(Math.abs(red(sph, 24) - red(sph, 20))).toBeLessThan(Math.abs(red(grad, 24) - red(grad, 20)));
    expect(Math.abs(red(pin, 24) - red(pin, 20))).toBeGreaterThan(Math.abs(red(grad, 24) - red(grad, 20)));
  });

  it('polární souřadnice tam a zpět zhruba vrátí obraz', () => {
    const smooth = img(64, 64, (x, y) => [x * 4, y * 4, 128, 255]);
    const back = applyFilter(applyFilter(smooth, { kind: 'polar', toPolar: true }), { kind: 'polar', toPolar: false });
    // střed obrazu (mimo okraje a švy) se vrátí přibližně
    const a = at(back, 40, 30);
    const b = at(smooth, 40, 30);
    expect(Math.abs(a[0] - b[0])).toBeLessThan(25);
    expect(Math.abs(a[1] - b[1])).toBeLessThan(25);
  });

  it('radiální rozostření: střed zůstane, okraj se rozmaže', () => {
    const checker = img(41, 41, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
    const r = applyFilter(checker, { kind: 'radialBlur', mode: 'spin', amount: 30 });
    expect(at(r, 20, 20)).toEqual(at(checker, 20, 20));
    const v = at(r, 38, 20)[0];
    expect(v).toBeGreaterThan(20);
    expect(v).toBeLessThan(235);
  });

  it('najít hrany, reliéf, solarizace', () => {
    const edge = img(10, 10, (x) => (x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const e = applyFilter(edge, { kind: 'findEdges' });
    expect(at(e, 1, 5)).toEqual([255, 255, 255, 255]);
    expect(at(e, 5, 5)[0]).toBeLessThan(50);
    const em = applyFilter(edge, { kind: 'emboss', angle: 0, height: 1, amount: 100 });
    expect(at(em, 1, 5)[0]).toBe(128);
    expect(at(em, 5, 5)[0]).not.toBe(128);
    expect(at(applyFilter(img(1, 1, () => [200, 50, 128, 255]), { kind: 'solarize' }), 0, 0)).toEqual([55, 50, 127, 255]);
  });

  it('mraky: opakovatelné, mezi barvami, neprůhledné', () => {
    const empty = img(64, 64, () => [0, 0, 0, 0]);
    const f = { kind: 'clouds', fg: '#000000', bg: '#ff0000', scale: 16, seed: 5 } as const;
    const a = applyFilter(empty, f, area(empty));
    expect(Array.from(applyFilter(empty, f, area(empty)).data)).toEqual(Array.from(a.data));
    let lo = 255;
    let hi = 0;
    for (let p = 0; p < a.data.length; p += 4) {
      expect(a.data[p + 1]).toBe(0);
      expect(a.data[p + 3]).toBe(255);
      lo = Math.min(lo, a.data[p]);
      hi = Math.max(hi, a.data[p]);
    }
    expect(hi - lo).toBeGreaterThan(100);
  });

  it('zmenšený náhled zmenší délky', () => {
    expect(scaleFilter({ kind: 'gaussianBlur', radius: 10 }, 0.5)).toEqual({ kind: 'gaussianBlur', radius: 5 });
    expect(scaleFilter({ kind: 'median', radius: 1 }, 0.3)).toEqual({ kind: 'median', radius: 1 });
    expect(scaleFilter({ kind: 'twirl', angle: 40 }, 0.5)).toEqual({ kind: 'twirl', angle: 40 });
  });
});
