import { describe, expect, it } from 'vitest';
import { adjustmentLuts, applyAdjustment, autoLevels, curveLut, defaultAdjustment, histogram, histogramRange, levelsLut, toneWeights, type Adjustment } from '../src/core/adjust';

const px = (...colors: number[][]) => new Uint8ClampedArray(colors.flat());
const run = (a: Adjustment, ...colors: number[][]) => {
  const d = px(...colors);
  applyAdjustment(d, a);
  return Array.from(d);
};

describe('úpravy – tabulky', () => {
  it('úrovně', () => {
    expect(Array.from(levelsLut({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }))).toEqual(Array.from({ length: 256 }, (_, i) => i));
    const l = levelsLut({ inBlack: 50, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 });
    expect([l[0], l[50], l[125], l[200], l[255]]).toEqual([0, 0, 128, 255, 255]);
    expect(levelsLut({ inBlack: 0, inWhite: 255, gamma: 2, outBlack: 0, outWhite: 255 })[128]).toBe(181);
    const o = levelsLut({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 20, outWhite: 220 });
    expect([o[0], o[255]]).toEqual([20, 220]);
  });

  it('křivky: body, monotonie, vodorovně mimo body', () => {
    expect(Array.from(curveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }]))).toEqual(Array.from({ length: 256 }, (_, i) => i));
    const pts = [{ x: 30, y: 10 }, { x: 128, y: 180 }, { x: 220, y: 240 }];
    const l = curveLut(pts);
    for (const p of pts) expect(l[p.x]).toBe(p.y);
    expect(l[0]).toBe(10);
    expect(l[255]).toBe(240);
    for (let i = 31; i < 220; i++) expect(l[i]).toBeGreaterThanOrEqual(l[i - 1]);
    // pořadí bodů nezáleží
    expect(Array.from(curveLut([...pts].reverse()))).toEqual(Array.from(l));
  });

  it('neutrální výchozí hodnoty nic nemění', () => {
    const sample = [[10, 200, 90, 255], [255, 0, 0, 128], [128, 128, 128, 255]];
    for (const kind of ['brightnessContrast', 'levels', 'curves', 'exposure', 'vibrance', 'hueSaturation', 'colorBalance'] as const) {
      const out = run(defaultAdjustment(kind), ...sample);
      out.forEach((v, i) => expect(Math.abs(v - sample.flat()[i])).toBeLessThanOrEqual(1));
    }
    expect(run({ ...defaultAdjustment('photoFilter'), density: 0 }, ...sample)).toEqual(sample.flat());
  });

  it('kanál úrovní se skládá s RGB', () => {
    const a = defaultAdjustment('levels');
    a.channels.r.outWhite = 128;
    a.channels.rgb.inWhite = 128;
    const [r, g] = adjustmentLuts(a)!;
    expect(r[255]).toBe(255);
    expect(r[128]).toBe(128);
    expect(g[128]).toBe(255);
  });
});

describe('úpravy – pixely', () => {
  it('invertovat, posterizace, práh, odbarvit', () => {
    expect(run({ kind: 'invert' }, [0, 100, 255, 77])).toEqual([255, 155, 0, 77]);
    expect(run({ kind: 'posterize', levels: 2 }, [100, 130, 255, 255])).toEqual([0, 255, 255, 255]);
    expect(run({ kind: 'threshold', level: 128 }, [255, 0, 0, 255], [0, 255, 0, 255])).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(run({ kind: 'desaturate' }, [255, 0, 0, 255])).toEqual([76, 76, 76, 255]);
  });

  it('odstín/sytost: otočení, šedá zůstane šedá, kolorizace', () => {
    expect(run({ kind: 'hueSaturation', hue: 120, saturation: 0, lightness: 0, colorize: false }, [255, 0, 0, 255])).toEqual([0, 255, 0, 255]);
    expect(run({ kind: 'hueSaturation', hue: 0, saturation: 100, lightness: 0, colorize: false }, [120, 120, 120, 255])).toEqual([120, 120, 120, 255]);
    expect(run({ kind: 'hueSaturation', hue: 0, saturation: -100, lightness: 0, colorize: false }, [255, 0, 0, 255])).toEqual([128, 128, 128, 255]);
    expect(run({ kind: 'hueSaturation', hue: 0, saturation: 0, lightness: 100, colorize: false }, [255, 0, 0, 255])).toEqual([255, 255, 255, 255]);
    const c = run({ kind: 'hueSaturation', hue: 240, saturation: 100, lightness: 0, colorize: true }, [128, 128, 128, 255]);
    expect(c[2]).toBeGreaterThan(c[0] + 100);
  });

  it('živost nesytí šedou a slabé barvy sytí víc', () => {
    expect(run({ kind: 'vibrance', vibrance: 100, saturation: 0 }, [100, 100, 100, 255])).toEqual([100, 100, 100, 255]);
    const weak = run({ kind: 'vibrance', vibrance: 50, saturation: 0 }, [140, 120, 120, 255]);
    const strong = run({ kind: 'vibrance', vibrance: 50, saturation: 0 }, [250, 20, 20, 255]);
    expect(weak[0] - weak[1]).toBeGreaterThan(20 * 1.4);
    expect(strong[0] - strong[1]).toBeLessThan(230 * 1.1);
  });

  it('černobílý podle vah Photoshopu', () => {
    const bw = defaultAdjustment('blackWhite');
    expect(run(bw, [255, 0, 0, 255])).toEqual([102, 102, 102, 255]);
    expect(run(bw, [255, 255, 0, 255])).toEqual([153, 153, 153, 255]);
    expect(run(bw, [0, 0, 255, 255])).toEqual([51, 51, 51, 255]);
    expect(run(bw, [90, 90, 90, 255])).toEqual([90, 90, 90, 255]);
  });

  it('vyvážení barev: střední tóny do červené, jas zachován', () => {
    const out = run({ ...defaultAdjustment('colorBalance'), midtones: [100, 0, 0], preserveLuminosity: false }, [128, 128, 128, 255]);
    expect(out[0]).toBeGreaterThan(160);
    expect(out[1]).toBe(128);
    expect(toneWeights(128)[1]).toBeGreaterThan(0.9);
    expect(toneWeights(10)[0]).toBe(1);
  });

  it('váhy výběru: 0 = beze změny, 128 = půl', () => {
    const d = px([0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]);
    applyAdjustment(d, { kind: 'invert' }, [0, 128, 255]);
    expect(Array.from(d)).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });
});

describe('histogram a automatické úrovně', () => {
  it('histogram vynechá průhledné a nevybrané pixely', () => {
    const d = px([10, 20, 30, 255], [10, 20, 30, 0], [200, 200, 200, 255]);
    expect(histogram(d, 'r')[10]).toBe(1);
    expect(histogram(d, 'g', [255, 255, 0])[200]).toBe(0);
    expect(histogram(d, 'rgb')[200]).toBe(1);
    expect(histogramRange(histogram(d, 'r'), 0)).toEqual([10, 200]);
  });

  it('automatický tón po kanálech, kontrast společně', () => {
    const d = px(...Array.from({ length: 100 }, (_, i) => [50 + i, 80 + i, 20 + i * 2, 255]));
    const tone = autoLevels(d, 'tone');
    expect([tone.channels.r.inBlack, tone.channels.r.inWhite, tone.channels.b.inBlack, tone.channels.b.inWhite]).toEqual([50, 149, 20, 218]);
    const contrast = autoLevels(d, 'contrast');
    expect([contrast.channels.rgb.inBlack, contrast.channels.rgb.inWhite, contrast.channels.r.inBlack]).toEqual([20, 218, 0]);
  });
});
