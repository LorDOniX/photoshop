import type {
  BlendMode as PsdBlendMode,
  AdjustmentLayer,
  Color as PsdColor,
  ColorBalanceValues,
  EffectNoiseGradient,
  EffectSolidGradient,
  Layer as PsdLayer,
  LayerEffectBevel,
  LayerEffectGradientOverlay,
  LayerEffectPatternOverlay,
  LayerEffectSatin,
  LayerEffectShadow,
  LayerEffectsInfo,
  LayerTextData,
  Psd,
  UnitsValue,
  VectorContent,
} from 'ag-psd';
import { defaultAdjustment, type Adjustment, type BalanceTriple, type Channel } from '../core/adjust';
import { toHex } from '../core/color';
import { layerPatternIds, renderFill, setFillData, type FillContent } from '../core/fillLayer';
import { effectBlend, hasActiveEffects, overlayGradient, type BevelEffect, type DropShadowEffect, type GradientOverlayEffect, type LayerEffects, type PatternOverlayEffect, type SatinEffect } from '../core/effects';
import { getPattern, registerPattern } from '../core/patterns';
import type { BevelStyle } from '../core/paint/bevel';
import { twoColorGradient, type GradientDef } from '../core/paint/gradient';
import { setTextData, textOrigin, type FontStyle, type TextAlign, type TextData } from '../core/text';
import { createCanvas, get2d } from '../core/canvas';
import { buildTree, type TreeNode } from '../core/groups';
import { ImageDocument } from '../core/ImageDocument';
import { Layer, type BlendMode } from '../core/Layer';
import { flattenDocument } from '../render/composite';

/*
 * Otevírání a ukládání PSD přes knihovnu ag-psd (načítá se až při použití – velký modul).
 * Převádí se: vrstvy a jejich pořadí, skupiny (i sbalení), názvy, viditelnost, krytí, režimy prolnutí,
 * poloha, masky vrstev (i vypnuté), ořezové masky a zámky. Co editor neumí (efekty vrstev, úpravové vrstvy,
 * nepodporované režimy), se při otevření ohlásí v seznamu upozornění.
 */

export const PSD_EXTENSION = '.psd';

export function isPsdFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(PSD_EXTENSION) || file.type === 'image/vnd.adobe.photoshop';
}

/** PSD režim → režim editoru (Canvas 2D). Režimy, které canvas nemá, se nahradí nejbližším. */
const FROM_PSD: Partial<Record<PsdBlendMode, BlendMode>> = {
  normal: 'source-over',
  'pass through': 'source-over',
  darken: 'darken',
  multiply: 'multiply',
  'color burn': 'color-burn',
  lighten: 'lighten',
  screen: 'screen',
  'color dodge': 'color-dodge',
  overlay: 'overlay',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

/** Náhrady za režimy, které Canvas 2D neumí (vzhled se trochu liší). */
const APPROXIMATE: Partial<Record<PsdBlendMode, BlendMode>> = {
  'linear burn': 'color-burn',
  'darker color': 'darken',
  'linear dodge': 'color-dodge',
  'lighter color': 'lighten',
  'vivid light': 'hard-light',
  'linear light': 'hard-light',
  'pin light': 'hard-light',
  'hard mix': 'hard-light',
  subtract: 'difference',
  divide: 'color-dodge',
  dissolve: 'source-over',
};

const TO_PSD: Record<BlendMode, PsdBlendMode> = {
  'source-over': 'normal',
  darken: 'darken',
  multiply: 'multiply',
  'color-burn': 'color burn',
  lighten: 'lighten',
  screen: 'screen',
  'color-dodge': 'color dodge',
  overlay: 'overlay',
  'soft-light': 'soft light',
  'hard-light': 'hard light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

/** Režim prolnutí z PSD; `note` dostane popis náhrady nebo nepodporovaného režimu. */
export function blendFromPsd(mode: PsdBlendMode | undefined, note: (text: string) => void): BlendMode {
  if (!mode) return 'source-over';
  const exact = FROM_PSD[mode];
  if (exact) return exact;
  const approx = APPROXIMATE[mode];
  note(`režim „${mode}“ nahrazen podobným`);
  return approx ?? 'source-over';
}

export function blendToPsd(mode: BlendMode): PsdBlendMode {
  return TO_PSD[mode] ?? 'normal';
}

// ---- barvy, efekty, text ----

/** Barva z PSD (RGB 0–255 nebo FRGB 0–1) → #rrggbb. */
export function colorFromPsd(c: PsdColor | undefined, fallback = '#000000'): string {
  if (!c) return fallback;
  if ('r' in c) return toHex({ r: c.r, g: c.g, b: c.b });
  if ('fr' in c) return toHex({ r: c.fr * 255, g: c.fg * 255, b: c.fb * 255 });
  return fallback;
}

function colorToPsd(hex: string): PsdColor {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const px = (v: UnitsValue | undefined, fallback = 0) => (v && (v.units === 'Pixels' || v.units === 'Points') ? v.value : fallback);
const pxValue = (value: number): UnitsValue => ({ units: 'Pixels', value });

function satinFromPsd(sa: LayerEffectSatin, note: (text: string) => void): SatinEffect {
  if (sa.contour && sa.contour.name !== 'Linear' && sa.contour.name !== 'Gaussian') note('obrys (kontura) saténu se nepoužije');
  return {
    enabled: true,
    color: colorFromPsd(sa.color),
    opacity: sa.opacity ?? 0.5,
    angle: sa.angle ?? 19,
    distance: px(sa.distance, 11),
    size: px(sa.size, 14),
    invert: !!sa.invert,
    blendMode: effectBlendFromPsd(sa.blendMode, 'multiply', note),
  };
}

function satinToPsd(sa: SatinEffect): LayerEffectSatin {
  return {
    enabled: true,
    color: colorToPsd(sa.color),
    opacity: sa.opacity,
    angle: sa.angle,
    distance: pxValue(sa.distance),
    size: pxValue(sa.size),
    invert: sa.invert,
    antialiased: true,
    blendMode: blendToPsd(effectBlend(sa)),
  };
}

/** Překrytí vzorkem z PSD – vzorek musí být v registru (vzorky souboru se registrují při otevření). */
function patternOverlayFromPsd(po: LayerEffectPatternOverlay, note: (text: string) => void): PatternOverlayEffect | null {
  const id = po.pattern?.id;
  if (!id || !getPattern(id)) {
    note(`vzorek „${po.pattern?.name ?? '?'}“ v souboru chybí – překrytí vzorkem se nepoužije`);
    return null;
  }
  if (po.angle) note('otočení vzorku se nepoužije');
  return { enabled: true, patternId: id, opacity: po.opacity ?? 1, scale: po.scale ?? 1, blendMode: effectBlendFromPsd(po.blendMode, 'source-over', note) };
}

function patternOverlayToPsd(po: PatternOverlayEffect): LayerEffectPatternOverlay {
  return {
    enabled: true,
    pattern: { name: getPattern(po.patternId)?.name ?? 'Vzorek', id: po.patternId },
    opacity: po.opacity,
    scale: po.scale,
    align: true,
    blendMode: blendToPsd(effectBlend(po)),
  };
}

/** Režim prolnutí efektu z PSD (chybí = výchozí režim efektu ve Photoshopu). */
function effectBlendFromPsd(mode: string | undefined, fallback: BlendMode, note: (text: string) => void): BlendMode {
  return mode ? blendFromPsd(mode as PsdBlendMode, note) : fallback;
}

/** Stín (vržený i vnitřní) z PSD. */
function shadowFromPsd(s: LayerEffectShadow, globalAngle: number, fallbackBlend: BlendMode, note: (text: string) => void): DropShadowEffect {
  if (px(s.choke) > 0) note('„stažení“ stínu se nepoužije');
  return {
    enabled: true,
    color: colorFromPsd(s.color),
    opacity: s.opacity ?? 0.75,
    angle: s.useGlobalLight ? globalAngle : (s.angle ?? globalAngle),
    distance: px(s.distance, 5),
    size: px(s.size, 5),
    blendMode: effectBlendFromPsd(s.blendMode, fallbackBlend, note),
  };
}

function shadowToPsd(s: DropShadowEffect): LayerEffectShadow {
  return {
    enabled: true,
    color: colorToPsd(s.color),
    opacity: s.opacity,
    angle: s.angle,
    useGlobalLight: false,
    distance: pxValue(s.distance),
    size: pxValue(s.size),
    blendMode: blendToPsd(effectBlend(s)),
  };
}

/** Přechod z PSD (barevné zastávky a zastávky krytí; středy mezi zastávkami se nepoužijí). */
export function gradientDefFromPsd(g: EffectSolidGradient | EffectNoiseGradient | undefined, note: (text: string) => void): GradientDef {
  if (!g || g.type !== 'solid') {
    if (g?.type === 'noise') note('šumový přechod nahrazen černobílým');
    return twoColorGradient('#000000', '#ffffff');
  }
  if ([...g.colorStops, ...g.opacityStops].some((s) => Math.abs(s.midpoint - 0.5) > 0.01)) note('středy mezi zastávkami přechodu se nepoužijí');
  const colors = g.colorStops.map((s) => ({ pos: s.location, color: colorFromPsd(s.color) })).sort((a, b) => a.pos - b.pos);
  const alphas = g.opacityStops.map((s) => ({ pos: s.location, opacity: s.opacity })).sort((a, b) => a.pos - b.pos);
  return {
    colors: colors.length ? colors : twoColorGradient('#000000', '#ffffff').colors,
    alphas: alphas.length ? alphas : twoColorGradient('#000000', '#ffffff').alphas,
  };
}

export function gradientDefToPsd(def: GradientDef): EffectSolidGradient {
  return {
    name: 'Vlastní',
    type: 'solid',
    smoothness: 1,
    colorStops: def.colors.map((c) => ({ color: colorToPsd(c.color), location: c.pos, midpoint: 0.5 })),
    opacityStops: def.alphas.map((a) => ({ opacity: a.opacity, location: a.pos, midpoint: 0.5 })),
  };
}

function gradientFromPsd(g: LayerEffectGradientOverlay, note: (text: string) => void): GradientOverlayEffect {
  return {
    enabled: true,
    gradient: gradientDefFromPsd(g.gradient, note),
    opacity: g.opacity ?? 1,
    angle: g.angle ?? 90,
    style: g.type ?? 'linear',
    reverse: !!g.reverse,
    scale: g.scale ?? 1,
    blendMode: effectBlendFromPsd(g.blendMode, 'source-over', note),
  };
}

function gradientToPsd(g: GradientOverlayEffect): LayerEffectGradientOverlay {
  return {
    enabled: true,
    blendMode: blendToPsd(effectBlend(g)),
    opacity: g.opacity,
    align: true,
    scale: g.scale ?? 1,
    reverse: g.reverse,
    type: g.style,
    angle: g.angle,
    offset: { x: 0, y: 0 },
    gradient: gradientDefToPsd(overlayGradient(g)),
  };
}

const BEVEL_STYLES: Record<string, BevelStyle> = { 'inner bevel': 'inner', 'outer bevel': 'outer', emboss: 'emboss', 'pillow emboss': 'pillow' };

/** Úkos a reliéf z PSD (reliéf tahu → vnitřní úkos, měkké dláto → tvrdé, obrysy se nepoužijí). */
function bevelFromPsd(b: LayerEffectBevel, globalAngle: number, note: (text: string) => void): BevelEffect {
  if (b.style === 'stroke emboss') note('reliéf tahu nahrazen vnitřním úkosem');
  if (b.technique === 'chisel soft') note('měkké dláto nahrazeno tvrdým');
  if (b.useTexture) note('textura úkosu se nepoužije');
  return {
    enabled: true,
    style: BEVEL_STYLES[b.style ?? 'inner bevel'] ?? 'inner',
    technique: b.technique && b.technique !== 'smooth' ? 'chisel' : 'smooth',
    depth: Math.round((b.strength ?? 1) * 100),
    direction: b.direction === 'down' ? 'down' : 'up',
    size: px(b.size, 5),
    soften: px(b.soften, 0),
    angle: b.useGlobalLight ? globalAngle : (b.angle ?? globalAngle),
    altitude: b.altitude ?? 30,
    highlightColor: colorFromPsd(b.highlightColor, '#ffffff'),
    highlightOpacity: b.highlightOpacity ?? 0.75,
    highlightBlend: effectBlendFromPsd(b.highlightBlendMode, 'screen', note),
    shadowColor: colorFromPsd(b.shadowColor, '#000000'),
    shadowOpacity: b.shadowOpacity ?? 0.75,
    shadowBlend: effectBlendFromPsd(b.shadowBlendMode, 'multiply', note),
  };
}

function bevelToPsd(b: BevelEffect): LayerEffectBevel {
  const style = (Object.keys(BEVEL_STYLES) as Array<NonNullable<LayerEffectBevel['style']>>).find((k) => BEVEL_STYLES[k] === b.style);
  return {
    enabled: true,
    style,
    technique: b.technique === 'chisel' ? 'chisel hard' : 'smooth',
    strength: b.depth / 100,
    direction: b.direction,
    size: pxValue(b.size),
    soften: pxValue(b.soften),
    angle: b.angle,
    useGlobalLight: false,
    altitude: b.altitude,
    highlightColor: colorToPsd(b.highlightColor),
    highlightOpacity: b.highlightOpacity,
    highlightBlendMode: blendToPsd(b.highlightBlend),
    shadowColor: colorToPsd(b.shadowColor),
    shadowOpacity: b.shadowOpacity,
    shadowBlendMode: blendToPsd(b.shadowBlend),
  };
}

const firstEnabled = <T extends { enabled?: boolean }>(v: T | T[] | undefined): T | undefined =>
  (Array.isArray(v) ? v : v ? [v] : []).find((x) => x.enabled !== false);

/** Efekty vrstvy z PSD → styly vrstvy editoru. */
export function effectsFromPsd(fx: LayerEffectsInfo | undefined, globalAngle: number, note: (text: string) => void): LayerEffects | null {
  if (!fx || fx.disabled) return null;
  const e: LayerEffects = {};
  const bevel = firstEnabled(fx.bevel);
  if (bevel) e.bevel = bevelFromPsd(bevel, globalAngle, note);
  const shadow = firstEnabled(fx.dropShadow);
  if (shadow) e.dropShadow = shadowFromPsd(shadow, globalAngle, 'multiply', note);
  const inner = firstEnabled(fx.innerShadow);
  if (inner) e.innerShadow = shadowFromPsd(inner, globalAngle, 'multiply', note);
  const glow = firstEnabled(fx.outerGlow);
  if (glow) {
    e.outerGlow = {
      enabled: true,
      color: colorFromPsd(glow.color, '#ffffbe'),
      opacity: glow.opacity ?? 0.75,
      size: px(glow.size, 10),
      blendMode: effectBlendFromPsd(glow.blendMode, 'screen', note),
    };
  }
  const ig = firstEnabled(fx.innerGlow);
  if (ig) {
    e.innerGlow = {
      enabled: true,
      color: colorFromPsd(ig.color, '#ffffbe'),
      opacity: ig.opacity ?? 0.75,
      size: px(ig.size, 5),
      source: ig.source === 'center' ? 'center' : 'edge',
      blendMode: effectBlendFromPsd(ig.blendMode, 'screen', note),
    };
  }
  const go = firstEnabled(fx.gradientOverlay);
  if (go) e.gradientOverlay = gradientFromPsd(go, note);
  const stroke = firstEnabled(fx.stroke);
  if (stroke) {
    if (stroke.fillType && stroke.fillType !== 'color') note('tah přechodem / vzorkem převeden na barvu');
    e.stroke = { enabled: true, color: colorFromPsd(stroke.color), opacity: stroke.opacity ?? 1, size: px(stroke.size, 3), position: stroke.position ?? 'outside' };
  }
  const fill = firstEnabled(fx.solidFill);
  if (fill) e.colorOverlay = { enabled: true, color: colorFromPsd(fill.color, '#ff0000'), opacity: fill.opacity ?? 1, blendMode: effectBlendFromPsd(fill.blendMode, 'source-over', note) };
  const sa = firstEnabled(fx.satin);
  if (sa) e.satin = satinFromPsd(sa, note);
  const po = firstEnabled(fx.patternOverlay);
  const pattern = po ? patternOverlayFromPsd(po, note) : null;
  if (pattern) e.patternOverlay = pattern;
  return hasActiveEffects(e) ? e : null;
}

/** Styly vrstvy editoru → efekty PSD. */
export function effectsToPsd(e: LayerEffects | null): LayerEffectsInfo | undefined {
  if (!hasActiveEffects(e)) return undefined;
  const fx: LayerEffectsInfo = {};
  if (e.bevel?.enabled) fx.bevel = bevelToPsd(e.bevel);
  if (e.satin?.enabled) fx.satin = satinToPsd(e.satin);
  if (e.patternOverlay?.enabled && getPattern(e.patternOverlay.patternId)) fx.patternOverlay = patternOverlayToPsd(e.patternOverlay);
  if (e.dropShadow?.enabled) fx.dropShadow = [shadowToPsd(e.dropShadow)];
  if (e.innerShadow?.enabled) fx.innerShadow = [shadowToPsd(e.innerShadow)];
  const g = e.outerGlow;
  if (g?.enabled) fx.outerGlow = { enabled: true, color: colorToPsd(g.color), opacity: g.opacity, size: pxValue(g.size), blendMode: blendToPsd(effectBlend(g)) };
  const ig = e.innerGlow;
  if (ig?.enabled) {
    fx.innerGlow = { enabled: true, color: colorToPsd(ig.color), opacity: ig.opacity, size: pxValue(ig.size), source: ig.source, blendMode: blendToPsd(effectBlend(ig)) };
  }
  if (e.gradientOverlay?.enabled) fx.gradientOverlay = [gradientToPsd(e.gradientOverlay)];
  const st = e.stroke;
  if (st?.enabled) fx.stroke = [{ enabled: true, fillType: 'color', color: colorToPsd(st.color), opacity: st.opacity, size: pxValue(st.size), position: st.position, blendMode: 'normal' }];
  const o = e.colorOverlay;
  if (o?.enabled) fx.solidFill = [{ enabled: true, color: colorToPsd(o.color), opacity: o.opacity, blendMode: blendToPsd(effectBlend(o)) }];
  return fx;
}

/** Známé PostScriptové názvy písem → rodina. */
const FONT_NAMES: Record<string, string> = {
  ArialMT: 'Arial',
  Arial: 'Arial',
  Helvetica: 'Helvetica',
  TimesNewRomanPSMT: 'Times New Roman',
  TimesNewRomanPS: 'Times New Roman',
  TimesNewRoman: 'Times New Roman',
  CourierNewPSMT: 'Courier New',
  CourierNewPS: 'Courier New',
  CourierNew: 'Courier New',
  Verdana: 'Verdana',
  Georgia: 'Georgia',
  Impact: 'Impact',
  ComicSansMS: 'Comic Sans MS',
  TrebuchetMS: 'Trebuchet MS',
};

/** PostScriptový název písma z PSD (např. „Arial-BoldItalicMT“) → rodina a řez. */
export function fontFromPsd(name: string | undefined): { family: string; bold: boolean; italic: boolean } {
  const [base = 'Arial', variant = ''] = (name ?? 'ArialMT').split('-');
  const family = FONT_NAMES[base] ?? base.replace(/(PS)?MT$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return { family, bold: /bold|black|heavy/i.test(variant), italic: /italic|oblique/i.test(variant) };
}

/** Rodina a řez → PostScriptový název písma pro PSD (např. Arial tučné → „Arial-BoldMT“). */
export function fontToPsd(family: string, style: FontStyle): string {
  const bold = style.includes('bold');
  const italic = style.includes('italic');
  const variant = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : '';
  // Písma Monotype mají příponu MT (Arial, Times New Roman, Courier New).
  const mt: Record<string, string> = { Arial: 'Arial', 'Times New Roman': 'TimesNewRomanPS', 'Courier New': 'CourierNewPS' };
  const base = mt[family];
  if (base) return variant ? `${base}-${variant}MT` : `${base}MT`;
  const name = family.replace(/\s+/g, '');
  return variant ? `${name}-${variant}` : name;
}

/** Upravitelný text editoru → textová data PSD (Photoshop text zobrazí z přiložených pixelů a vykreslí při úpravě). */
export function textToPsd(d: TextData, origin: { x: number; y: number }): LayerTextData {
  return {
    text: d.content,
    transform: [1, 0, 0, 1, origin.x, origin.y],
    antiAlias: 'smooth',
    style: {
      font: { name: fontToPsd(d.family, d.style) },
      fontSize: d.size,
      fillColor: colorToPsd(d.color),
      autoLeading: d.lineHeight === 1.2,
      leading: Math.round(d.size * d.lineHeight * 100) / 100,
    },
    paragraphStyle: { justification: d.align },
  };
}

/**
 * Textová vrstva z PSD → upravitelný text editoru. Null = text nejde převést (otočený, deformovaný,
 * svislý) – zůstane obrázkem.
 */
export function textFromPsd(t: LayerTextData, note: (text: string) => void): TextData | null {
  const m = t.transform ?? [1, 0, 0, 1, 0, 0];
  if (Math.abs(m[1]) > 1e-3 || Math.abs(m[2]) > 1e-3 || t.orientation === 'vertical' || (t.warp && t.warp.style && t.warp.style !== 'none')) {
    note('otočený / deformovaný / svislý text zůstal obrázkem');
    return null;
  }
  const style = t.style ?? {};
  const scale = Math.abs(m[3]) || 1;
  const font = fontFromPsd(style.font?.name);
  const bold = font.bold || !!style.fauxBold;
  const italic = font.italic || !!style.fauxItalic;
  const size = Math.max(1, Math.round((style.fontSize ?? 12) * scale * 10) / 10);
  const j = t.paragraphStyle?.justification;
  const align: TextAlign = j === 'center' || j === 'right' ? j : 'left';
  if ((t.styleRuns?.length ?? 0) > 1) note('text s více styly – použije se první');
  if (t.shapeType === 'box') note('odstavcový text bez zalamování do rámečku');
  return {
    content: t.text.replace(/\r\n?/g, '\n'),
    family: font.family,
    style: (bold && italic ? 'bold italic' : bold ? 'bold' : italic ? 'italic' : 'normal') as FontStyle,
    size,
    color: colorFromPsd(style.fillColor),
    align,
    lineHeight: style.autoLeading === false && style.leading ? Math.round((style.leading / (style.fontSize ?? 12)) * 100) / 100 : 1.2,
    origin: { x: m[4], y: m[5] },
  };
}

// ---- vrstvy úprav a výplňové vrstvy ----

const ADJ_CHANNELS: Channel[] = ['rgb', 'r', 'g', 'b'];
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Vrstva úprav z PSD → úprava editoru (null = druh, který editor nemá). */
export function adjustmentFromPsd(a: AdjustmentLayer, note: (text: string) => void): Adjustment | null {
  switch (a.type) {
    case 'brightness/contrast':
      if (a.useLegacy) note('starší (legacy) jas/kontrast se počítá novým způsobem');
      return { kind: 'brightnessContrast', brightness: a.brightness ?? 0, contrast: a.contrast ?? 0 };
    case 'levels': {
      const r = defaultAdjustment('levels');
      (a.channels ?? []).slice(0, 4).forEach((c, i) => {
        r.channels[ADJ_CHANNELS[i]] = { inBlack: c.shadowInput, inWhite: c.highlightInput, gamma: c.midtoneInput || 1, outBlack: c.shadowOutput, outWhite: c.highlightOutput };
      });
      return r;
    }
    case 'curves': {
      const r = defaultAdjustment('curves');
      (a.channels ?? []).slice(0, 4).forEach((c, i) => {
        if (c?.length >= 2) r.channels[ADJ_CHANNELS[i]] = c.map((p) => ({ x: p.input, y: p.output }));
      });
      return r;
    }
    case 'exposure':
      // PSD ukládá 32bitová čísla (0,9 → 0,8999999…) – zaokrouhlit.
      return { kind: 'exposure', exposure: round4(a.exposure ?? 0), offset: round4(a.offset ?? 0), gamma: round4(a.gamma ?? 1) };
    case 'vibrance':
      return { kind: 'vibrance', vibrance: a.vibrance ?? 0, saturation: a.saturation ?? 0 };
    case 'hue/saturation': {
      const ranges = [a.reds, a.yellows, a.greens, a.cyans, a.blues, a.magentas];
      if (ranges.some((c) => c && (c.hue || c.saturation || c.lightness))) note('úpravy jednotlivých barev v odstínu/sytosti se nepoužijí');
      if (a.colorize) {
        const c = a.colorization ?? { hue: 0, saturation: 25, lightness: 0 };
        return { kind: 'hueSaturation', hue: c.hue, saturation: c.saturation * 2 - 100, lightness: c.lightness, colorize: true };
      }
      const m = a.master ?? { hue: 0, saturation: 0, lightness: 0 };
      return { kind: 'hueSaturation', hue: m.hue, saturation: m.saturation, lightness: m.lightness, colorize: false };
    }
    case 'color balance': {
      const t = (v: ColorBalanceValues | undefined): BalanceTriple => [v?.cyanRed ?? 0, v?.magentaGreen ?? 0, v?.yellowBlue ?? 0];
      return { kind: 'colorBalance', shadows: t(a.shadows), midtones: t(a.midtones), highlights: t(a.highlights), preserveLuminosity: a.preserveLuminosity ?? true };
    }
    case 'black & white': {
      const d = defaultAdjustment('blackWhite');
      return {
        kind: 'blackWhite',
        reds: a.reds ?? d.reds,
        yellows: a.yellows ?? d.yellows,
        greens: a.greens ?? d.greens,
        cyans: a.cyans ?? d.cyans,
        blues: a.blues ?? d.blues,
        magentas: a.magentas ?? d.magentas,
        tint: !!a.useTint,
        tintColor: colorFromPsd(a.tintColor, d.tintColor),
      };
    }
    case 'photo filter':
      return { kind: 'photoFilter', color: colorFromPsd(a.color, '#ec8a00'), density: a.density ?? 25, preserveLuminosity: a.preserveLuminosity ?? true };
    case 'invert':
      return { kind: 'invert' };
    case 'posterize':
      return { kind: 'posterize', levels: a.levels ?? 4 };
    case 'threshold':
      return { kind: 'threshold', level: a.level ?? 128 };
    case 'gradient map':
      return {
        kind: 'gradientMap',
        gradient: gradientDefFromPsd(
          a.gradientType === 'solid' ? { name: a.name ?? '', type: 'solid', colorStops: a.colorStops ?? [], opacityStops: a.opacityStops ?? [] } : { name: '', type: 'noise', min: [], max: [] },
          note,
        ),
        reverse: !!a.reverse,
      };
    default:
      return null;
  }
}

/** Úprava editoru → vrstva úprav PSD. */
export function adjustmentToPsd(a: Adjustment): AdjustmentLayer | null {
  switch (a.kind) {
    case 'brightnessContrast':
      return { type: 'brightness/contrast', brightness: a.brightness, contrast: a.contrast, useLegacy: false };
    case 'levels':
      return {
        type: 'levels',
        channels: ADJ_CHANNELS.map((c) => {
          const l = a.channels[c];
          return { shadowInput: l.inBlack, highlightInput: l.inWhite, midtoneInput: l.gamma, shadowOutput: l.outBlack, highlightOutput: l.outWhite };
        }),
      };
    case 'curves':
      return { type: 'curves', channels: ADJ_CHANNELS.map((c) => a.channels[c].map((p) => ({ input: p.x, output: p.y }))) };
    case 'exposure':
      return { type: 'exposure', exposure: a.exposure, offset: a.offset, gamma: a.gamma };
    case 'vibrance':
      return { type: 'vibrance', vibrance: a.vibrance, saturation: a.saturation };
    case 'hueSaturation':
      return a.colorize
        ? { type: 'hue/saturation', colorize: true, colorization: { hue: a.hue, saturation: Math.round((a.saturation + 100) / 2), lightness: a.lightness }, master: { hue: 0, saturation: 0, lightness: 0 } }
        : { type: 'hue/saturation', colorize: false, master: { hue: a.hue, saturation: a.saturation, lightness: a.lightness } };
    case 'colorBalance': {
      const t = ([cyanRed, magentaGreen, yellowBlue]: BalanceTriple): ColorBalanceValues => ({ cyanRed, magentaGreen, yellowBlue });
      return { type: 'color balance', shadows: t(a.shadows), midtones: t(a.midtones), highlights: t(a.highlights), preserveLuminosity: a.preserveLuminosity };
    }
    case 'blackWhite':
      return { type: 'black & white', reds: a.reds, yellows: a.yellows, greens: a.greens, cyans: a.cyans, blues: a.blues, magentas: a.magentas, useTint: a.tint, tintColor: colorToPsd(a.tintColor) };
    case 'photoFilter':
      return { type: 'photo filter', color: colorToPsd(a.color), density: a.density, preserveLuminosity: a.preserveLuminosity };
    case 'invert':
      return { type: 'invert' };
    case 'posterize':
      return { type: 'posterize', levels: a.levels };
    case 'threshold':
      return { type: 'threshold', level: a.level };
    case 'gradientMap': {
      const g = gradientDefToPsd(a.gradient);
      return { type: 'gradient map', gradientType: 'solid', name: g.name, colorStops: g.colorStops, opacityStops: g.opacityStops, reverse: a.reverse, smoothness: 1 };
    }
    case 'desaturate':
      return null;
  }
}

/** Výplňová vrstva PSD (barva / přechod / vzorek) → výplň editoru (null = nejde). */
export function fillFromPsd(v: VectorContent, note: (text: string) => void): FillContent | null {
  if (v.type === 'color') return { kind: 'color', color: colorFromPsd(v.color) };
  if (v.type === 'solid' || v.type === 'noise') {
    return { kind: 'gradient', gradient: gradientDefFromPsd(v, note), style: v.style ?? 'linear', angle: v.angle ?? 90, scale: v.scale ?? 1, reverse: !!v.reverse };
  }
  if (v.type === 'pattern') {
    if (!getPattern(v.id)) {
      note(`vzorek „${v.name}“ v souboru chybí – výplň zůstane obrázkem`);
      return null;
    }
    return { kind: 'pattern', patternId: v.id, scale: v.scale ?? 1 };
  }
  return null;
}

export function fillToPsd(f: FillContent): VectorContent {
  if (f.kind === 'color') return { type: 'color', color: colorToPsd(f.color) };
  if (f.kind === 'gradient') return { ...gradientDefToPsd(f.gradient), style: f.style, angle: f.angle, scale: f.scale, reverse: f.reverse, align: true };
  return { type: 'pattern', name: getPattern(f.patternId)?.name ?? 'Vzorek', id: f.patternId, scale: f.scale, linked: true };
}

export interface PsdImport {
  doc: ImageDocument;
  /** Co se nepřevedlo přesně (vrstva: popis). */
  warnings: string[];
}

interface PixelData {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array;
}

/** Bitmapa vrstvy z PSD do plátna. */
function pixelsToCanvas(img: PixelData): HTMLCanvasElement {
  const canvas = createCanvas(img.width, img.height);
  const data = new ImageData(img.width, img.height);
  data.data.set(img.data as Uint8ClampedArray);
  get2d(canvas).putImageData(data, 0, 0);
  return canvas;
}

/**
 * Maska z PSD (stupně šedi v kanálu R, s vlastním obdélníkem a barvou mimo něj) → maska editoru
 * (hodnota v alfa kanálu, stejný rozměr a poloha jako vrstva).
 */
export function maskToLayer(
  mask: { data: ArrayLike<number>; width: number; height: number; left: number; top: number; defaultColor: number },
  layer: { x: number; y: number; width: number; height: number },
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(layer.width * layer.height * 4);
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      const mx = x + layer.x - mask.left;
      const my = y + layer.y - mask.top;
      const inside = mx >= 0 && my >= 0 && mx < mask.width && my < mask.height;
      const v = inside ? mask.data[(my * mask.width + mx) * 4] : mask.defaultColor;
      const i = (y * layer.width + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = 255;
      out[i + 3] = v;
    }
  }
  return out;
}

/** Maska editoru (alfa) → PSD (šedá v RGB, neprůhledná). */
export function maskToPsd(alpha: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < alpha.length; i += 4) {
    const v = alpha[i + 3];
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

/** Otevře PSD jako dokument editoru. */
export async function loadPsd(buffer: ArrayBuffer): Promise<PsdImport> {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(buffer, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
  const doc = new ImageDocument(psd.width, psd.height);
  const globalAngle = psd.imageResources?.globalAngle ?? 120;
  // Vzorky souboru (pro překrytí vzorkem) do registru.
  for (const p of psd.patterns ?? []) {
    if (getPattern(p.id)) continue;
    registerPattern({ id: p.id, name: p.name, width: p.bounds.w, height: p.bounds.h, data: new Uint8ClampedArray(p.data) });
  }
  const warnings = new Set<string>();
  const warn = (name: string | undefined, text: string) => warnings.add(`${name || 'bez názvu'}: ${text}`);

  const add = (nodes: PsdLayer[], parentId: string | null) => {
    for (const p of nodes) {
      const note = (text: string) => warn(p.name, text);
      const common = {
        name: p.name ?? '',
        visible: !p.hidden,
        opacity: p.opacity ?? 1,
        blendMode: blendFromPsd(p.blendMode, note),
        parentId,
        lockPosition: !!p.protected?.position,
        lockPixels: !!p.protected?.composite,
        lockTransparency: !!(p.protected?.transparency || p.transparencyProtected),
        clipped: !!p.clipping,
        effects: p.children ? null : effectsFromPsd(p.effects, globalAngle, note),
        fillOpacity: p.children ? 1 : (p.fillOpacity ?? 1),
      };
      if (p.children && p.effects && !p.effects.disabled) note('efekty skupiny se nezobrazí');
      if (p.children) {
        // Záhlaví skupiny leží v seznamu NAD svými vrstvami – vloží se až po nich.
        const group = new Layer(1, 1, { ...common, group: true });
        group.collapsed = p.opened === false;
        add(p.children, group.id);
        doc.insertLayer(group);
        continue;
      }
      if (p.adjustment) {
        const adjustment = adjustmentFromPsd(p.adjustment, note);
        if (!adjustment) {
          note(`vrstva úprav „${p.adjustment.type}“ vynechána`);
          continue;
        }
        // Vrstva úprav přes celé plátno; maska PSD (s vlastním obdélníkem) se převede na její velikost.
        const layer = new Layer(psd.width, psd.height, { ...common, adjustment, maskEnabled: !p.mask?.disabled, effects: null });
        const m = p.mask;
        const mImg = m?.imageData as PixelData | undefined;
        if (m && (mImg || m.defaultColor !== undefined) && !m.fromVectorData) {
          const data = maskToLayer(
            { data: mImg?.data ?? [], width: mImg?.width ?? 0, height: mImg?.height ?? 0, left: m.left ?? 0, top: m.top ?? 0, defaultColor: m.defaultColor ?? 255 },
            { x: 0, y: 0, width: psd.width, height: psd.height },
          );
          const mask = createCanvas(psd.width, psd.height);
          get2d(mask).putImageData(new ImageData(data, psd.width, psd.height), 0, 0);
          layer.mask = mask;
        }
        doc.insertLayer(layer);
        continue;
      }
      const text = p.text ? textFromPsd(p.text, note) : null;
      if (p.placedLayer) note('inteligentní objekt převeden na obrázek');
      const img = p.imageData as PixelData | undefined;
      const x = p.left ?? 0;
      const y = p.top ?? 0;
      const w = img?.width || 1;
      const h = img?.height || 1;
      const layer = new Layer(w, h, { ...common, x, y, maskEnabled: !p.mask?.disabled });
      if (img?.width && img.height) layer.ctx.drawImage(pixelsToCanvas(img), 0, 0);
      const m = p.mask;
      const mImg = m?.imageData as PixelData | undefined;
      if (m && (mImg || m.defaultColor !== undefined) && !m.fromVectorData) {
        const data = maskToLayer(
          { data: mImg?.data ?? [], width: mImg?.width ?? 0, height: mImg?.height ?? 0, left: m.left ?? 0, top: m.top ?? 0, defaultColor: m.defaultColor ?? 255 },
          { x, y, width: w, height: h },
        );
        const mask = createCanvas(w, h);
        get2d(mask).putImageData(new ImageData(data, w, h), 0, 0);
        layer.mask = mask;
      }
      // Výplňová vrstva (bez vektorové masky – s ní jde o tvar, ten zůstane obrázkem).
      const fill = p.vectorFill && !p.vectorMask ? fillFromPsd(p.vectorFill, note) : null;
      if (fill) {
        if (!img?.width || !img.height) layer.setCanvas(renderFill(fill, w, h));
        setFillData(layer.canvas, fill);
      }
      if (p.vectorMask) note(p.vectorFill ? 'tvar převeden na obrázek' : 'vektorová maska se nepoužije');
      // Text si ponechá pixely z Photoshopu, upravit jde jako text (vykreslí se znovu až při úpravě).
      if (text) setTextData(layer.canvas, text);
      doc.insertLayer(layer);
    }
  };
  add(psd.children ?? [], null);

  // PSD bez vrstev (jen sloučený obraz).
  if (!doc.layers.some((l) => !l.isGroup)) {
    const img = psd.imageData as PixelData | undefined;
    const layer = new Layer(psd.width, psd.height, { name: 'Pozadí' });
    if (img) layer.ctx.drawImage(pixelsToCanvas(img), 0, 0);
    doc.insertLayer(layer);
  }
  doc.setActive(doc.layers.filter((l) => !l.isGroup).at(-1)?.id ?? null);
  return { doc, warnings: [...warnings] };
}

/** Uloží dokument jako PSD (vrstvy, skupiny, masky, ořezové masky, zámky + sloučený náhled). */
export async function savePsd(doc: ImageDocument): Promise<Blob> {
  const { writePsdUint8Array } = await import('ag-psd');
  const toPsd = (node: TreeNode<Layer>): PsdLayer => {
    const l = node.item;
    const base: PsdLayer = {
      name: l.name,
      hidden: !l.visible,
      opacity: l.opacity,
      protected: { position: l.lockPosition, composite: l.lockPixels, transparency: l.lockTransparency },
    };
    if (l.isGroup) {
      // Skupina 100 % a Normální se u nás skládá průchozí – jako „pass through“ ve Photoshopu.
      const passThrough = l.opacity >= 1 && l.blendMode === 'source-over';
      return { ...base, blendMode: passThrough ? 'pass through' : blendToPsd(l.blendMode), opened: !l.collapsed, children: node.children.map(toPsd) };
    }
    if (l.adjustment) {
      const adjustment = adjustmentToPsd(l.adjustment);
      const adj: PsdLayer = { ...base, blendMode: blendToPsd(l.blendMode), clipping: l.clipped, ...(adjustment ? { adjustment } : {}) };
      if (l.mask) {
        const alpha = get2d(l.mask).getImageData(0, 0, l.width, l.height).data;
        adj.mask = { left: l.x, top: l.y, defaultColor: 255, disabled: !l.maskEnabled, imageData: new ImageData(maskToPsd(alpha), l.width, l.height) };
      }
      return adj;
    }
    const fill = l.fill;
    const layer: PsdLayer = {
      ...base,
      blendMode: blendToPsd(l.blendMode),
      clipping: l.clipped,
      vectorFill: fill ? fillToPsd(fill) : undefined,
      effects: effectsToPsd(l.effects),
      text: l.text ? textToPsd(l.text, l.text.origin ?? textOrigin(l, l.text)) : undefined,
      fillOpacity: l.fillOpacity < 1 ? l.fillOpacity : undefined,
      left: l.x,
      top: l.y,
      imageData: l.ctx.getImageData(0, 0, l.width, l.height),
    };
    if (l.mask) {
      const alpha = get2d(l.mask).getImageData(0, 0, l.width, l.height).data;
      layer.mask = {
        left: l.x,
        top: l.y,
        defaultColor: 255,
        disabled: !l.maskEnabled,
        imageData: new ImageData(maskToPsd(alpha), l.width, l.height),
      };
    }
    return layer;
  };
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    children: buildTree(doc.layers).map(toPsd),
    // Sloučený obraz – náhledy v jiných programech a otevření bez podpory vrstev.
    canvas: flattenDocument(doc),
  };
  // Vzorky použité ve stylech (i vestavěné – Photoshop je nezná).
  const used = [...new Set(doc.layers.flatMap(layerPatternIds))].map(getPattern).filter((p) => !!p);
  if (used.length) {
    psd.patterns = used.map((p) => ({ id: p.id, name: p.name, x: 0, y: 0, bounds: { x: 0, y: 0, w: p.width, h: p.height }, data: new Uint8Array(p.data) }));
  }
  const bytes = writePsdUint8Array(psd, { generateThumbnail: true, noBackground: true });
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/vnd.adobe.photoshop' });
}
