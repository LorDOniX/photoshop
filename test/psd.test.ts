import { describe, expect, it } from 'vitest';
import { BLEND_MODES } from '../src/core/Layer';
import { blendFromPsd, blendToPsd, maskToLayer, maskToPsd } from '../src/io/psd';

describe('PSD – převody', () => {
  it('režimy prolnutí tam a zpět beze ztráty', () => {
    for (const { value } of BLEND_MODES) expect(blendFromPsd(blendToPsd(value), () => {})).toBe(value);
    expect(blendToPsd('source-over')).toBe('normal');
  });

  it('nepodporovaný režim se nahradí a ohlásí', () => {
    const notes: string[] = [];
    expect(blendFromPsd('linear burn', (n) => notes.push(n))).toBe('color-burn');
    expect(blendFromPsd('pass through', (n) => notes.push(n))).toBe('source-over');
    expect(notes).toEqual(['režim „linear burn“ nahrazen podobným']);
  });

  it('maska PSD s vlastním obdélníkem → maska vrstvy (mimo obdélník výchozí barva)', () => {
    // maska 1×1 na (11, 20) s hodnotou 100, vrstva 2×1 na (10, 20), výchozí barva 0
    const out = maskToLayer({ data: [100, 100, 100, 255], width: 1, height: 1, left: 11, top: 20, defaultColor: 0 }, { x: 10, y: 20, width: 2, height: 1 });
    expect(Array.from(out)).toEqual([255, 255, 255, 0, 255, 255, 255, 100]);
  });

  it('maska vrstvy → šedá PSD', () => {
    expect(Array.from(maskToPsd(new Uint8ClampedArray([255, 255, 255, 40])))).toEqual([40, 40, 40, 255]);
  });
});
