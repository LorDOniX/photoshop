import type { BlendMode } from './Layer';
import { bevelReachesOutside, type BevelStyle, type BevelTechnique } from './paint/bevel';
import { twoColorGradient, type GradientDef, type GradientType } from './paint/gradient';
import type { StrokePosition } from './paint/stroke';

/*
 * Styly vrstvy (efekty) – model a výpočty bez DOM. Vykreslení je v render/effects.ts.
 * Pořadí vykreslení jako ve Photoshopu (zdola): vržený stín, vnější záře, (vnější část úkosu), obsah vrstvy,
 * překrytí vzorkem, překrytí přechodem, překrytí barvou, satén, vnitřní záře, vnitřní stín, úkos a reliéf, tah.
 *
 * `blendMode` chybí u stylů uložených verzí 0.11 → Normální (tak se tehdy kreslily).
 */

export interface DropShadowEffect {
  enabled: boolean;
  color: string;
  /** 0..1 */
  opacity: number;
  /** Úhel světla ve stupních (120° = světlo zleva shora, stín vpravo dole). */
  angle: number;
  /** Vzdálenost stínu v px. */
  distance: number;
  /** Rozostření (velikost) v px. */
  size: number;
  blendMode?: BlendMode;
}

/** Vnitřní stín: stín okraje dovnitř tvaru (stejné parametry jako vržený stín). */
export type InnerShadowEffect = DropShadowEffect;

export interface OuterGlowEffect {
  enabled: boolean;
  color: string;
  opacity: number;
  size: number;
  blendMode?: BlendMode;
}

export interface InnerGlowEffect {
  enabled: boolean;
  color: string;
  opacity: number;
  size: number;
  /** Záře od okraje dovnitř, nebo ze středu ven. */
  source: 'edge' | 'center';
  blendMode?: BlendMode;
}

export interface StrokeEffect {
  enabled: boolean;
  color: string;
  opacity: number;
  size: number;
  position: StrokePosition;
}

export interface ColorOverlayEffect {
  enabled: boolean;
  color: string;
  opacity: number;
  blendMode?: BlendMode;
}

export interface GradientOverlayEffect {
  enabled: boolean;
  /** Přechod (začátek je při úhlu 90° dole). Chybí u stylů z verze 0.12 – ty mají `from` / `to`. */
  gradient?: GradientDef;
  /** Dvoubarevný přechod verze 0.12 (jen pro čtení starších projektů). */
  from?: string;
  to?: string;
  opacity: number;
  /** Směr ve stupních (90° = zdola nahoru). */
  angle: number;
  style: GradientType;
  reverse: boolean;
  /** Měřítko přechodu (1 = 100 %). */
  scale?: number;
  blendMode?: BlendMode;
}

/** Přechod překrytí (i pro styly z verze 0.12 s `from` / `to`). */
export function overlayGradient(e: GradientOverlayEffect): GradientDef {
  return e.gradient ?? twoColorGradient(e.from ?? '#000000', e.to ?? '#ffffff');
}

/**
 * Začátek a konec přechodu překrytí přes obsah vrstvy (`rect`) podle stylu, úhlu a měřítka – body pro
 * `renderGradient` (lineární přes celý obsah, ostatní ze středu).
 */
export function overlayPoints(
  rect: { x: number; y: number; width: number; height: number },
  e: Pick<GradientOverlayEffect, 'angle' | 'style' | 'scale'>,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const scale = e.scale ?? 1;
  const a = (e.angle * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = -Math.sin(a);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const half = (Math.abs((rect.width / 2) * ux) + Math.abs((rect.height / 2) * uy)) * scale;
  const radius = (Math.max(rect.width, rect.height) / 2) * scale;
  const center = { x: cx, y: cy };
  switch (e.style) {
    case 'linear':
      return { start: { x: cx - ux * half, y: cy - uy * half }, end: { x: cx + ux * half, y: cy + uy * half } };
    case 'reflected':
      return { start: center, end: { x: cx + ux * half, y: cy + uy * half } };
    case 'angle':
      return { start: center, end: { x: cx + ux, y: cy + uy } };
    default:
      return { start: center, end: { x: cx + ux * radius, y: cy + uy * radius } };
  }
}

export interface BevelEffect {
  enabled: boolean;
  style: BevelStyle;
  technique: BevelTechnique;
  /** Hloubka v % (1–1000). */
  depth: number;
  direction: 'up' | 'down';
  size: number;
  soften: number;
  angle: number;
  /** Výška světla 0–90°. */
  altitude: number;
  highlightColor: string;
  highlightOpacity: number;
  highlightBlend: BlendMode;
  shadowColor: string;
  shadowOpacity: number;
  shadowBlend: BlendMode;
}

/** Satén: lesk uvnitř tvaru z rozdílu dvou posunutých kopií tvaru. */
export interface SatinEffect {
  enabled: boolean;
  color: string;
  opacity: number;
  angle: number;
  distance: number;
  size: number;
  invert: boolean;
  blendMode?: BlendMode;
}

export interface PatternOverlayEffect {
  enabled: boolean;
  /** Id vzorku v registru (core/patterns.ts). */
  patternId: string;
  opacity: number;
  /** Měřítko (1 = 100 %). Vzorek začíná v levém horním rohu vrstvy a posouvá se s ní. */
  scale: number;
  blendMode?: BlendMode;
}

export interface LayerEffects {
  bevel?: BevelEffect;
  satin?: SatinEffect;
  patternOverlay?: PatternOverlayEffect;
  dropShadow?: DropShadowEffect;
  outerGlow?: OuterGlowEffect;
  innerShadow?: InnerShadowEffect;
  innerGlow?: InnerGlowEffect;
  stroke?: StrokeEffect;
  colorOverlay?: ColorOverlayEffect;
  gradientOverlay?: GradientOverlayEffect;
}

export type EffectKind = keyof LayerEffects;

/** Výchozí hodnoty efektů (jako ve Photoshopu). */
export const EFFECT_DEFAULTS: Required<LayerEffects> = {
  bevel: {
    enabled: true,
    style: 'inner',
    technique: 'smooth',
    depth: 100,
    direction: 'up',
    size: 5,
    soften: 0,
    angle: 120,
    altitude: 30,
    highlightColor: '#ffffff',
    highlightOpacity: 0.75,
    highlightBlend: 'screen',
    shadowColor: '#000000',
    shadowOpacity: 0.75,
    shadowBlend: 'multiply',
  },
  dropShadow: { enabled: true, color: '#000000', opacity: 0.75, angle: 120, distance: 5, size: 5, blendMode: 'multiply' },
  outerGlow: { enabled: true, color: '#ffffbe', opacity: 0.75, size: 10, blendMode: 'screen' },
  innerShadow: { enabled: true, color: '#000000', opacity: 0.75, angle: 120, distance: 5, size: 5, blendMode: 'multiply' },
  innerGlow: { enabled: true, color: '#ffffbe', opacity: 0.75, size: 5, source: 'edge', blendMode: 'screen' },
  stroke: { enabled: true, color: '#000000', opacity: 1, size: 3, position: 'outside' },
  colorOverlay: { enabled: true, color: '#ff0000', opacity: 1, blendMode: 'source-over' },
  satin: { enabled: true, color: '#000000', opacity: 0.5, angle: 19, distance: 11, size: 14, invert: true, blendMode: 'multiply' },
  patternOverlay: { enabled: true, patternId: 'builtin:checker', opacity: 1, scale: 1, blendMode: 'source-over' },
  gradientOverlay: { enabled: true, gradient: twoColorGradient('#000000', '#ffffff'), opacity: 1, angle: 90, style: 'linear', reverse: false, scale: 1, blendMode: 'source-over' },
};

/** Názvy v pořadí, v jakém je ukazuje dialog (jako ve Photoshopu). */
export const EFFECT_NAMES: Record<EffectKind, string> = {
  bevel: 'Úkos a reliéf',
  stroke: 'Tah',
  innerShadow: 'Vnitřní stín',
  innerGlow: 'Vnitřní záře',
  satin: 'Satén',
  colorOverlay: 'Překrytí barvou',
  gradientOverlay: 'Překrytí přechodem',
  patternOverlay: 'Překrytí vzorkem',
  outerGlow: 'Vnější záře',
  dropShadow: 'Vržený stín',
};

export const EFFECT_KINDS = Object.keys(EFFECT_NAMES) as EffectKind[];

/** Má vrstva aspoň jeden zapnutý efekt? */
export function hasActiveEffects(e: LayerEffects | null | undefined): e is LayerEffects {
  return !!e && (Object.keys(e) as EffectKind[]).some((k) => e[k]?.enabled);
}

/** Režim prolnutí efektu (chybí = Normální, viz výše). */
export function effectBlend(e: { blendMode?: BlendMode }): BlendMode {
  return e.blendMode ?? 'source-over';
}

/** Posun stínu z úhlu světla a vzdálenosti (osa y míří dolů). */
export function shadowOffset(angle: number, distance: number): { dx: number; dy: number } {
  const a = (angle * Math.PI) / 180;
  // `|| 0` převede −0 na 0.
  return { dx: Math.round(-Math.cos(a) * distance) || 0, dy: Math.round(Math.sin(a) * distance) || 0 };
}

/** O kolik px přesahují efekty plátno vrstvy (rozostření sahá zhruba do 1,5× velikosti). Vnitřní efekty nepřesahují. */
export function effectPadding(e: LayerEffects | null | undefined): number {
  if (!hasActiveEffects(e)) return 0;
  let pad = 0;
  const s = e.dropShadow;
  if (s?.enabled) {
    const { dx, dy } = shadowOffset(s.angle, s.distance);
    pad = Math.max(pad, Math.max(Math.abs(dx), Math.abs(dy)) + s.size * 1.5);
  }
  if (e.outerGlow?.enabled) pad = Math.max(pad, e.outerGlow.size * 1.5);
  if (e.stroke?.enabled && e.stroke.position !== 'inside') pad = Math.max(pad, e.stroke.size);
  const b = e.bevel;
  if (b?.enabled && bevelReachesOutside(b.style)) pad = Math.max(pad, b.size + b.soften + 2);
  return Math.ceil(pad) + 2;
}

/**
 * Body přechodu přes obdélník: úsečka středem obdélníku ve směru úhlu, dlouhá tak, aby přechod pokryl
 * celý obdélník (jako „Zarovnat s vrstvou“ ve Photoshopu). Úhel 90° = začátek dole, konec nahoře.
 */
export function gradientLine(
  rect: { x: number; y: number; width: number; height: number },
  angle: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const a = (angle * Math.PI) / 180;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const ux = Math.cos(a);
  const uy = -Math.sin(a);
  const half = Math.abs((rect.width / 2) * ux) + Math.abs((rect.height / 2) * uy);
  return { x0: cx - ux * half, y0: cy - uy * half, x1: cx + ux * half, y1: cy + uy * half };
}

/** Id vzorků, které styly používají (k uložení do souboru). */
export function usedPatternIds(e: LayerEffects | null | undefined): string[] {
  return e?.patternOverlay?.enabled ? [e.patternOverlay.patternId] : [];
}

/** Klíč pro porovnání / cache efektů. */
export function effectsKey(e: LayerEffects | null | undefined): string {
  return hasActiveEffects(e) ? JSON.stringify(e) : '';
}
