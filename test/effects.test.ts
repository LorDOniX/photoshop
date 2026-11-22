import { describe, expect, it } from 'vitest';
import { bevelHeight, bevelShading, boxBlur, signedDistance } from '../src/core/paint/bevel';
import { EFFECT_DEFAULTS, effectPadding, gradientLine, hasActiveEffects, shadowOffset, type LayerEffects } from '../src/core/effects';
import { positionForClick, textOrigin, type TextData } from '../src/core/text';
import { colorFromPsd, effectsFromPsd, effectsToPsd, fontFromPsd, fontToPsd, textFromPsd, textToPsd } from '../src/io/psd';

describe('styly vrstvy', () => {
  it('posun stínu podle úhlu světla', () => {
    expect(shadowOffset(120, 10)).toEqual({ dx: 5, dy: 9 });
    expect(shadowOffset(90, 10)).toEqual({ dx: 0, dy: 10 });
    expect(shadowOffset(180, 4)).toEqual({ dx: 4, dy: 0 });
  });

  it('přesah efektů a zapnutí', () => {
    expect(effectPadding(null)).toBe(0);
    expect(hasActiveEffects({ stroke: { ...EFFECT_DEFAULTS.stroke, enabled: false } })).toBe(false);
    expect(effectPadding({ stroke: { ...EFFECT_DEFAULTS.stroke, size: 6 } })).toBe(8);
    expect(effectPadding({ stroke: { ...EFFECT_DEFAULTS.stroke, size: 6, position: 'inside' } })).toBe(2);
    // stín 10 px + rozostření 4 → 10 + 6 + 2
    expect(effectPadding({ dropShadow: { ...EFFECT_DEFAULTS.dropShadow, angle: 90, distance: 10, size: 4 } })).toBe(18);
  });
});

describe('přechod a účaří', () => {
  it('úsečka přechodu pokryje obdélník', () => {
    const r = { x: 0, y: 0, width: 100, height: 50 };
    const pts = (a: number) => Object.values(gradientLine(r, a)).map((v) => Math.round(v) || 0);
    expect(pts(90)).toEqual([50, 50, 50, 0]);
    expect(pts(0)).toEqual([0, 25, 100, 25]);
    // úhlopříčka: průmět rohů na směr
    const d = gradientLine(r, 45);
    expect(Math.hypot(d.x1 - d.x0, d.y1 - d.y0)).toBeCloseTo((100 + 50) / Math.SQRT2, 5);
  });

  it('textOrigin je opakem positionForClick', () => {
    for (const align of ['left', 'center', 'right'] as const) {
      const d: TextData = { content: 'x', family: 'Arial', style: 'italic', size: 40, color: '#000000', align, lineHeight: 1.3 };
      const p = positionForClick(200, 300, d, 120);
      const o = textOrigin({ ...p, width: 120 }, d);
      expect(Math.abs(o.x - 200)).toBeLessThanOrEqual(1);
      expect(Math.abs(o.y - 300)).toBeLessThanOrEqual(1);
    }
  });
});

describe('PSD – efekty a text', () => {
  it('barvy RGB i FRGB', () => {
    expect(colorFromPsd({ r: 255, g: 128, b: 0 })).toBe('#ff8000');
    expect(colorFromPsd({ fr: 1, fg: 0, fb: 0.5 })).toBe('#ff0080');
    expect(colorFromPsd(undefined, '#123456')).toBe('#123456');
  });

  it('efekty tam a zpět', () => {
    const e: LayerEffects = {
      dropShadow: { enabled: true, color: '#102030', opacity: 0.5, angle: 45, distance: 7, size: 3, blendMode: 'multiply' },
      outerGlow: { enabled: true, color: '#ffff00', opacity: 0.6, size: 12, blendMode: 'screen' },
      innerShadow: { enabled: true, color: '#200000', opacity: 0.4, angle: -30, distance: 2, size: 6, blendMode: 'overlay' },
      innerGlow: { enabled: true, color: '#00ffff', opacity: 0.9, size: 8, source: 'center', blendMode: 'source-over' },
      stroke: { enabled: true, color: '#ff0000', opacity: 1, size: 4, position: 'inside' },
      bevel: {
        enabled: true,
        style: 'pillow',
        technique: 'chisel',
        depth: 250,
        direction: 'down',
        size: 12,
        soften: 3,
        angle: 60,
        altitude: 45,
        highlightColor: '#ffeecc',
        highlightOpacity: 0.5,
        highlightBlend: 'color-dodge',
        shadowColor: '#001122',
        shadowOpacity: 0.6,
        shadowBlend: 'overlay',
      },
      colorOverlay: { enabled: true, color: '#00ff00', opacity: 0.8, blendMode: 'color' },
      satin: { enabled: true, color: '#334455', opacity: 0.3, angle: -40, distance: 6, size: 9, invert: false, blendMode: 'overlay' },
      patternOverlay: { enabled: true, patternId: 'builtin:bricks', opacity: 0.6, scale: 2.5, blendMode: 'multiply' },
      gradientOverlay: {
        enabled: true,
        gradient: {
          colors: [
            { pos: 0, color: '#ff0000' },
            { pos: 0.4, color: '#00ff00' },
            { pos: 1, color: '#0000ff' },
          ],
          alphas: [
            { pos: 0, opacity: 1 },
            { pos: 0.7, opacity: 0.25 },
            { pos: 1, opacity: 0 },
          ],
        },
        opacity: 0.7,
        angle: 30,
        style: 'diamond',
        reverse: true,
        scale: 1.5,
        blendMode: 'soft-light',
      },
    };
    expect(effectsFromPsd(effectsToPsd(e), 120, () => {})).toEqual(e);
    expect(effectsToPsd(null)).toBeUndefined();
  });

  it('globální světlo, výchozí režimy a nepodporované efekty', () => {
    const notes: string[] = [];
    const e = effectsFromPsd(
      { dropShadow: [{ enabled: true, useGlobalLight: true, angle: 10 }], patternOverlay: { enabled: true, pattern: { name: 'Ztracený', id: 'nikde' } }, innerShadow: [{ enabled: false }], outerGlow: { enabled: true } },
      77,
      (n) => notes.push(n),
    );
    expect(e?.dropShadow?.angle).toBe(77);
    expect(e?.dropShadow?.blendMode).toBe('multiply');
    expect(e?.outerGlow?.blendMode).toBe('screen');
    expect(e?.innerShadow).toBeUndefined();
    expect(notes).toEqual(['vzorek „Ztracený“ v souboru chybí – překrytí vzorkem se nepoužije']);
    expect(e?.patternOverlay).toBeUndefined();
    expect(effectsFromPsd({ disabled: true, dropShadow: [{ enabled: true }] }, 120, () => {})).toBeNull();
  });

  it('přechod: zastávky seřazené, středy a šum se ohlásí', () => {
    const notes: string[] = [];
    const e = effectsFromPsd(
      {
        gradientOverlay: [
          {
            enabled: true,
            type: 'angle',
            gradient: {
              name: 'x',
              type: 'solid',
              colorStops: [
                { color: { r: 0, g: 0, b: 255 }, location: 1, midpoint: 0.5 },
                { color: { r: 255, g: 0, b: 0 }, location: 0, midpoint: 0.5 },
                { color: { r: 0, g: 255, b: 0 }, location: 0.5, midpoint: 0.3 },
              ],
              opacityStops: [],
            },
          },
        ],
      },
      120,
      (n) => notes.push(n),
    );
    expect(e?.gradientOverlay?.gradient?.colors.map((c) => c.color)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(e?.gradientOverlay).toMatchObject({ style: 'angle', angle: 90, blendMode: 'source-over' });
    expect(notes).toEqual(['středy mezi zastávkami přechodu se nepoužijí']);
    expect(effectsFromPsd({ gradientOverlay: [{ enabled: true, gradient: { name: 'n', type: 'noise', min: [], max: [] } }] }, 120, (n) => notes.push(n))?.gradientOverlay?.gradient?.colors.length).toBe(2);
    expect(notes.at(-1)).toBe('šumový přechod nahrazen černobílým');
  });

  it('písma podle PostScriptového názvu', () => {
    expect(fontFromPsd('ArialMT')).toEqual({ family: 'Arial', bold: false, italic: false });
    expect(fontFromPsd('Arial-BoldItalicMT')).toEqual({ family: 'Arial', bold: true, italic: true });
    expect(fontFromPsd('TimesNewRomanPSMT')).toEqual({ family: 'Times New Roman', bold: false, italic: false });
    expect(fontFromPsd('MyriadPro-Regular').family).toBe('Myriad Pro');
  });

  it('písma do PSD a zpět', () => {
    expect(fontToPsd('Arial', 'normal')).toBe('ArialMT');
    expect(fontToPsd('Arial', 'bold italic')).toBe('Arial-BoldItalicMT');
    expect(fontToPsd('Times New Roman', 'bold')).toBe('TimesNewRomanPS-BoldMT');
    expect(fontToPsd('Trebuchet MS', 'italic')).toBe('TrebuchetMS-Italic');
    for (const family of ['Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'Trebuchet MS', 'Comic Sans MS', 'Impact']) {
      for (const style of ['normal', 'bold', 'italic', 'bold italic'] as const) {
        const f = fontFromPsd(fontToPsd(family, style));
        expect([f.family, f.bold, f.italic]).toEqual([family, style.includes('bold'), style.includes('italic')]);
      }
    }
  });

  it('text do PSD a zpět', () => {
    const d: TextData = { content: 'Dva\nřádky', family: 'Georgia', style: 'italic', size: 30, color: '#123456', align: 'right', lineHeight: 1.5, origin: { x: 10, y: 20 } };
    expect(textFromPsd(textToPsd(d, { x: 10, y: 20 }), () => {})).toEqual(d);
    expect(textFromPsd(textToPsd({ ...d, lineHeight: 1.2 }, { x: 10, y: 20 }), () => {})?.lineHeight).toBe(1.2);
  });

  it('textová vrstva: velikost ze zvětšení, zarovnání, účaří, řádky', () => {
    const t = textFromPsd(
      {
        text: 'Ahoj\rsvěte',
        transform: [2, 0, 0, 2, 40, 90],
        style: { font: { name: 'Arial-BoldMT' }, fontSize: 12, fillColor: { r: 255, g: 0, b: 0 } },
        paragraphStyle: { justification: 'center' },
      },
      () => {},
    );
    expect(t).toEqual({ content: 'Ahoj\nsvěte', family: 'Arial', style: 'bold', size: 24, color: '#ff0000', align: 'center', lineHeight: 1.2, origin: { x: 40, y: 90 } });
  });

  it('otočený text zůstane obrázkem', () => {
    const notes: string[] = [];
    expect(textFromPsd({ text: 'x', transform: [0.7, 0.7, -0.7, 0.7, 0, 0] }, (n) => notes.push(n))).toBeNull();
    expect(notes.length).toBe(1);
  });
});

describe('úkos a reliéf', () => {
  // čtverec 10..29 v plátně 40 × 40
  const W = 40;
  const alpha = new Uint8Array(W * W);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) alpha[y * W + x] = 255;
  const at = (a: ArrayLike<number>, x: number, y: number) => a[y * W + x];

  it('znaménková vzdálenost od okraje', () => {
    const sd = signedDistance(alpha, W, W);
    expect(at(sd, 10, 20)).toBeCloseTo(0.5, 5);
    expect(at(sd, 14, 20)).toBeCloseTo(4.5, 5);
    expect(at(sd, 9, 20)).toBeCloseTo(-0.5, 5);
    expect(at(sd, 5, 20)).toBeCloseTo(-4.5, 5);
  });

  it('výškový profil podle stylu a směru', () => {
    const p = { style: 'inner' as const, technique: 'chisel' as const, size: 10, depth: 100, direction: 'up' as const };
    expect(bevelHeight(-3, p)).toBe(0);
    expect(bevelHeight(5, p)).toBe(5);
    expect(bevelHeight(20, p)).toBe(10);
    expect(bevelHeight(5, { ...p, direction: 'down' })).toBe(-5);
    expect(bevelHeight(5, { ...p, depth: 200 })).toBe(10);
    expect(bevelHeight(-5, { ...p, style: 'outer' })).toBe(5);
    expect(bevelHeight(0, { ...p, style: 'emboss' })).toBe(5);
    expect(bevelHeight(-5, { ...p, style: 'pillow' })).toBe(-10);
    expect(bevelHeight(2.5, { ...p, technique: 'smooth' })).toBeCloseTo(10 * Math.sin(Math.PI / 8), 5);
  });

  it('světlo zleva shora: horní a levý okraj světlý, dolní a pravý tmavý', () => {
    const { light, dark } = bevelShading(alpha, W, W, { style: 'inner', technique: 'chisel', depth: 100, direction: 'up', size: 4, soften: 0, angle: 120, altitude: 30 });
    expect(at(light, 20, 11)).toBeGreaterThan(0.3);
    expect(at(light, 11, 20)).toBeGreaterThan(0.1);
    expect(at(dark, 20, 28)).toBeGreaterThan(0.3);
    expect(at(dark, 28, 20)).toBeGreaterThan(0.1);
    // plochý střed a okolí beze změny
    expect(at(light, 20, 20) + at(dark, 20, 20)).toBe(0);
    expect(at(light, 3, 3) + at(dark, 3, 3)).toBe(0);
    // směr dolů prohodí světla a stíny
    const down = bevelShading(alpha, W, W, { style: 'inner', technique: 'chisel', depth: 100, direction: 'down', size: 4, soften: 0, angle: 120, altitude: 30 });
    expect(at(down.dark, 20, 11)).toBeGreaterThan(0.3);
    expect(at(down.light, 20, 28)).toBeGreaterThan(0.3);
  });

  it('rozostření zachová součet', () => {
    const d = new Float32Array(100);
    d[55] = 1;
    boxBlur(d, 10, 10, 2);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(d[55]).toBeLessThan(1);
  });
});
