import { luma } from '../adjust';
import { gaussianBlur, unsharpMask, type Img } from '../filters';

/*
 * Retušovací tahy (Rozostření, Zostření, Rozmazání, Zesvětlení, Ztmavení, Houba) – čisté funkce nad RGBA bez DOM.
 * Nástroj (tools/RetouchTool.ts) spočítá efekt z obrazu na začátku tahu a míchá ho podle stopy štětce;
 * rozmazání je postupné (nese barvu podél tahu), proto má vlastní otisk `smudgeDab`.
 */

export type ToneRange = 'shadows' | 'midtones' | 'highlights';

/**
 * Měkký okraj štětce: 1 uvnitř tvrdého jádra (poloměr · tvrdost), k okraji plynulý pokles (smoothstep).
 * Tvrdost 1 = ostrý kruh s vyhlazeným okrajem 1 px.
 */
export function brushWeight(d: number, r: number, hardness: number): number {
  if (hardness >= 1) return Math.min(1, Math.max(0, r - d + 0.5));
  if (d >= r) return 0;
  const inner = r * hardness;
  if (d <= inner) return 1;
  const t = (d - inner) / (r - inner);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Tónová křivka zesvětlení / ztmavení pro hodnotu 0..1, expozice 0..1.
 * Střední tóny = gama (v^(1/(1+e)) / v^(1+e)). Stíny mění hlavně tmavé hodnoty (zesvětlení zvedne černou až na e/2,
 * ztmavení s vahou (1 − v)²), světla hlavně světlé (zrcadlově). Křivky jsou rostoucí i při e = 1 (pořadí tónů zůstane).
 */
export function toneCurve(v: number, mode: 'dodge' | 'burn', range: ToneRange, exposure: number): number {
  const e = Math.min(1, Math.max(0, exposure));
  if (range === 'midtones') return mode === 'dodge' ? Math.pow(v, 1 / (1 + e)) : Math.pow(v, 1 + e);
  if (range === 'shadows') return mode === 'dodge' ? v + 0.5 * e * (1 - v) * (1 - v) : v - e * v * (1 - v) * (1 - v);
  return mode === 'dodge' ? v + e * v * v * (1 - v) : v - 0.5 * e * v * v;
}

/**
 * Zesvětlení / ztmavení obrázku. Chránit tóny: křivka se počítá z jasu a barvy se škálují k bílé / černé,
 * takže odstín a sytost zůstanou; bez ochrany se křivka použije na každý kanál zvlášť (barvy se mohou posunout).
 */
export function toneImage(src: Img, mode: 'dodge' | 'burn', range: ToneRange, exposure: number, protectTones: boolean): Img {
  const d = src.data;
  const out = new Uint8ClampedArray(d);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = toneCurve(i / 255, mode, range, exposure) * 255;
  for (let p = 0; p < d.length; p += 4) {
    if (!d[p + 3]) continue;
    if (!protectTones) {
      out[p] = lut[d[p]];
      out[p + 1] = lut[d[p + 1]];
      out[p + 2] = lut[d[p + 2]];
      continue;
    }
    const l = luma(d[p], d[p + 1], d[p + 2]);
    const i = Math.min(255, Math.max(0, Math.floor(l)));
    // Lineární interpolace LUT podle neceločíselného jasu.
    const l2 = lut[i] + (lut[Math.min(255, i + 1)] - lut[i]) * (l - i);
    for (let c = 0; c < 3; c++) {
      const v = d[p + c];
      out[p + c] = l2 <= l ? (l > 0 ? (v * l2) / l : 0) : l < 255 ? 255 - ((255 - v) * (255 - l2)) / (255 - l) : 255;
    }
  }
  return { data: out, width: src.width, height: src.height };
}

/**
 * Houba: sytost se mění posunem barev od / k šedé stejného jasu. Tok 0..1 (1 = odbarvit úplně / zdvojnásobit sytost).
 * Živost: u syticí houby omezí přesycení (méně u už sytých barev, bez ořezu kanálů), u odbarvení šetří málo syté barvy.
 */
export function spongeImage(src: Img, mode: 'desaturate' | 'saturate', flow: number, vibrance: boolean): Img {
  const d = src.data;
  const out = new Uint8ClampedArray(d);
  const f = Math.min(1, Math.max(0, flow));
  for (let p = 0; p < d.length; p += 4) {
    if (!d[p + 3]) continue;
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    const l = luma(r, g, b);
    const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    let k: number;
    if (mode === 'desaturate') k = 1 - f * (vibrance ? sat : 1);
    else {
      k = 1 + f * (vibrance ? 1 - sat : 1);
      if (vibrance) {
        // Bez ořezu: žádný kanál nesmí přetéct 0..255.
        for (const v of [r, g, b]) {
          if (v > l) k = Math.min(k, (255 - l) / (v - l));
          else if (v < l) k = Math.min(k, l / (l - v));
        }
      }
    }
    out[p] = l + (r - l) * k;
    out[p + 1] = l + (g - l) * k;
    out[p + 2] = l + (b - l) * k;
  }
  return { data: out, width: src.width, height: src.height };
}

/** Poloměr Gaussova rozostření nástroje Rozostření pro sílu 0..1. */
export const blurSigma = (strength: number) => 0.5 + 3 * strength;

export const blurImage = (src: Img, strength: number): Img => gaussianBlur(src, blurSigma(strength));

/** Zostření = maska rozostření s poloměrem 1 px, síla 0..1 → 0–200 %. */
export const sharpenImage = (src: Img, strength: number): Img => unsharpMask(src, 200 * strength, 1, 0);

/**
 * Jeden otisk rozmazání (jako GIMP): nesená barva se smíchá s obrazem pod otiskem (nesená = nesená · síla +
 * obraz · (1 − síla)) a přenese se na obraz s vahou otisku. Vše s předem vynásobenou alfou, aby se průhledné
 * okolí nerozmazávalo do černé.
 * - `px`: pixely výřezu otisku (RGBA, upraví se na místě), `carry`: nesená barva stejné velikosti (předem vynásobená),
 *   `weights`: váha otisku pro každý pixel (stopa · výběr; 0 = mimo, záporná = mimo vrstvu – nesená barva se nemění).
 */
export function smudgeDab(px: Uint8ClampedArray, carry: Float32Array, weights: Float32Array, strength: number): void {
  const rate = Math.min(1, Math.max(0, strength));
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w < 0) continue;
    const p = i * 4;
    const a = px[p + 3] / 255;
    const r = px[p] * a;
    const g = px[p + 1] * a;
    const b = px[p + 2] * a;
    const al = px[p + 3];
    carry[p] = carry[p] * rate + r * (1 - rate);
    carry[p + 1] = carry[p + 1] * rate + g * (1 - rate);
    carry[p + 2] = carry[p + 2] * rate + b * (1 - rate);
    carry[p + 3] = carry[p + 3] * rate + al * (1 - rate);
    if (w <= 0) continue;
    const na = al + (carry[p + 3] - al) * w;
    if (na <= 0.001) {
      px[p + 3] = 0;
      continue;
    }
    const k = 255 / na;
    px[p] = (r + (carry[p] - r) * w) * k;
    px[p + 1] = (g + (carry[p + 1] - g) * w) * k;
    px[p + 2] = (b + (carry[p + 2] - b) * w) * k;
    px[p + 3] = na;
  }
}

/** Nesená barva rozmazání na začátku tahu: obraz pod otiskem (předem vynásobený), nebo barva (malování prstem). */
export function smudgeCarry(px: Uint8ClampedArray, color?: [number, number, number]): Float32Array {
  const carry = new Float32Array(px.length);
  for (let p = 0; p < px.length; p += 4) {
    if (color) {
      carry.set([color[0], color[1], color[2], 255], p);
      continue;
    }
    const a = px[p + 3] / 255;
    carry[p] = px[p] * a;
    carry[p + 1] = px[p + 1] * a;
    carry[p + 2] = px[p + 2] * a;
    carry[p + 3] = px[p + 3];
  }
  return carry;
}

/**
 * Smíchá efekt s originálem podle váhy (0..1 na pixel) s předem vynásobenou alfou:
 * výsledek = originál + (efekt − originál) · váha. `keepAlpha` = zamčená průhlednost (alfa zůstane z originálu).
 */
export function mixByWeight(before: Uint8ClampedArray, effect: Uint8ClampedArray, weights: Float32Array, keepAlpha: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(before);
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w <= 0) continue;
    const p = i * 4;
    const a0 = before[p + 3];
    const a1 = effect[p + 3];
    if (keepAlpha || a0 === a1) {
      if (!a0 && !keepAlpha) continue;
      out[p] = before[p] + (effect[p] - before[p]) * w;
      out[p + 1] = before[p + 1] + (effect[p + 1] - before[p + 1]) * w;
      out[p + 2] = before[p + 2] + (effect[p + 2] - before[p + 2]) * w;
      continue;
    }
    const na = a0 + (a1 - a0) * w;
    out[p + 3] = na;
    if (na <= 0.001) continue;
    const k = 1 / na;
    for (let c = 0; c < 3; c++) out[p + c] = (before[p + c] * a0 + (effect[p + c] * a1 - before[p + c] * a0) * w) * k;
  }
  return out;
}
