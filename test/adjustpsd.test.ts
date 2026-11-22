import { describe, expect, it } from 'vitest';
import { readPsd, writePsdUint8Array, initializeCanvas } from 'ag-psd';
import { defaultAdjustment, LAYER_ADJUSTMENT_KINDS, type Adjustment } from '../src/core/adjust';
import { adjustmentFromPsd, adjustmentToPsd, fillFromPsd, fillToPsd } from '../src/io/psd';
import type { FillContent } from '../src/core/fillLayer';

initializeCanvas(() => { throw new Error('x'); }, (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) as ImageData);

const samples: Adjustment[] = [
  { kind: 'brightnessContrast', brightness: 40, contrast: -20 },
  (() => { const a = defaultAdjustment('levels'); a.channels.rgb = { inBlack: 10, inWhite: 240, gamma: 1.3, outBlack: 5, outWhite: 250 }; a.channels.g.inBlack = 30; return a; })(),
  (() => { const a = defaultAdjustment('curves'); a.channels.rgb = [{ x: 0, y: 0 }, { x: 100, y: 140 }, { x: 255, y: 255 }]; a.channels.b = [{ x: 0, y: 20 }, { x: 255, y: 230 }]; return a; })(),
  { kind: 'exposure', exposure: 1.5, offset: -0.02, gamma: 0.9 },
  { kind: 'vibrance', vibrance: 30, saturation: -10 },
  { kind: 'hueSaturation', hue: 25, saturation: 15, lightness: -5, colorize: false },
  { kind: 'hueSaturation', hue: 210, saturation: -50, lightness: 10, colorize: true },
  { kind: 'colorBalance', shadows: [10, -5, 0], midtones: [0, 20, -30], highlights: [5, 5, 5], preserveLuminosity: false },
  { kind: 'blackWhite', reds: 50, yellows: 70, greens: 30, cyans: 60, blues: 10, magentas: 90, tint: true, tintColor: '#e1d3b3' },
  { kind: 'photoFilter', color: '#00aaff', density: 40, preserveLuminosity: true },
  { kind: 'invert' },
  { kind: 'posterize', levels: 6 },
  { kind: 'threshold', level: 90 },
  { kind: 'gradientMap', gradient: { colors: [{ pos: 0, color: '#220044' }, { pos: 0.5, color: '#ff0000' }, { pos: 1, color: '#ffff00' }], alphas: [{ pos: 0, opacity: 1 }, { pos: 1, opacity: 1 }] }, reverse: true },
];
const fills: FillContent[] = [
  { kind: 'color', color: '#123456' },
  { kind: 'gradient', gradient: { colors: [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }], alphas: [{ pos: 0, opacity: 1 }, { pos: 1, opacity: 0.5 }] }, style: 'radial', angle: 30, scale: 0.8, reverse: true },
  { kind: 'pattern', patternId: 'builtin:dots', scale: 2 },
];

describe('PSD vrstvy úprav a výplně přes ag-psd', () => {
  it('všechny úpravy tam a zpět', () => {
    expect(new Set(samples.map((s) => s.kind)).size).toBe(LAYER_ADJUSTMENT_KINDS.length);
    const img = { width: 2, height: 2, data: new Uint8ClampedArray(16) } as ImageData;
    const psd = { width: 2, height: 2, children: [...samples.map((a, i) => ({ name: `a${i}`, adjustment: adjustmentToPsd(a)! })), ...fills.map((f, i) => ({ name: `f${i}`, imageData: img, vectorFill: fillToPsd(f) }))] };
    const back = readPsd(writePsdUint8Array(psd as never).buffer as ArrayBuffer, { useImageData: true });
    const notes: string[] = [];
    samples.forEach((a, i) => expect([i, adjustmentFromPsd(back.children![i].adjustment!, (n) => notes.push(n))]).toEqual([i, a]));
    fills.forEach((f, i) => expect(fillFromPsd(back.children![samples.length + i].vectorFill!, (n) => notes.push(n))).toEqual(f));
    expect(notes).toEqual([]);
  });
});
