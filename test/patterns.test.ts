import { describe, expect, it } from 'vitest';
import { usedPatternIds } from '../src/core/effects';
import { allPatterns, builtinPatterns, getPattern, isBuiltinPattern, isUserPattern, onPatternsChange, patternFromImage, patternsVersion, registerPattern, unregisterPattern } from '../src/core/patterns';

describe('vzorky', () => {
  it('vestavěné vzorky: jedinečná id, správná velikost dat, stejné při každém generování', () => {
    const a = builtinPatterns();
    const b = builtinPatterns();
    expect(new Set(a.map((p) => p.id)).size).toBe(a.length);
    for (const p of a) {
      expect(isBuiltinPattern(p.id)).toBe(true);
      expect(p.data.length).toBe(p.width * p.height * 4);
    }
    expect(a.map((p) => Array.from(p.data.slice(0, 64)).join())).toEqual(b.map((p) => Array.from(p.data.slice(0, 64)).join()));
  });

  it('šachovnice a puntíky', () => {
    const checker = getPattern('builtin:checker')!;
    const px = (x: number, y: number) => Array.from(checker.data.slice((y * checker.width + x) * 4, (y * checker.width + x) * 4 + 4));
    expect(px(0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(8, 0)).toEqual([96, 96, 96, 255]);
    const dots = getPattern('builtin:dots')!;
    expect(dots.data[(8 * 16 + 8) * 4 + 3]).toBe(255);
    expect(dots.data[3]).toBe(0);
  });

  it('registr: uživatelský vzorek, posluchači, verze, pořadí', () => {
    const image = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 128]) } as ImageData;
    const p = patternFromImage('Můj', image);
    expect(isUserPattern(p.id)).toBe(true);
    let calls = 0;
    const off = onPatternsChange(() => calls++);
    const v = patternsVersion();
    registerPattern(p);
    expect(getPattern(p.id)?.name).toBe('Můj');
    expect(allPatterns().at(-1)?.id).toBe(p.id);
    expect(allPatterns()[0].id).toBe('builtin:checker');
    unregisterPattern(p.id);
    expect(getPattern(p.id)).toBeUndefined();
    expect(calls).toBe(2);
    expect(patternsVersion()).toBe(v + 2);
    off();
    image.data[0] = 99;
    expect(p.data[0]).toBe(1);
  });

  it('použité vzorky ve stylech', () => {
    expect(usedPatternIds(null)).toEqual([]);
    expect(usedPatternIds({ patternOverlay: { enabled: true, patternId: 'x', opacity: 1, scale: 1 } })).toEqual(['x']);
    expect(usedPatternIds({ patternOverlay: { enabled: false, patternId: 'x', opacity: 1, scale: 1 } })).toEqual([]);
  });
});
