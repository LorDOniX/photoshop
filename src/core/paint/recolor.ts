/*
 * Přebarvení (Nahrazení barvy) a odstranění červených očí – čisté funkce nad RGBA bez DOM.
 */

export type RecolorMode = 'hue' | 'saturation' | 'color' | 'luminosity';

type RGB = [number, number, number];

// Neoddělitelné režimy prolnutí podle W3C Compositing (stejné jako režimy Odstín / Sytost / Barva / Světlost vrstev).
const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColor(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB;
  if (x > 255) out = out.map((v) => l + ((v - l) * (255 - l)) / (x - l)) as RGB;
  return out;
}

function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

const sat = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function setSat(c: RGB, s: number): RGB {
  const max = Math.max(c[0], c[1], c[2]);
  const min = Math.min(c[0], c[1], c[2]);
  if (max === min) return [0, 0, 0];
  return c.map((v) => ((v - min) * s) / (max - min)) as RGB;
}

/**
 * Barva pixelu `base` přebarvená barvou `paint` v režimu:
 * odstín (odstín z barvy, sytost a jas z pixelu), sytost, barva (odstín a sytost, jas z pixelu – výchozí), světlost.
 */
export function recolor(base: RGB, paint: RGB, mode: RecolorMode): RGB {
  switch (mode) {
    case 'hue':
      return setLum(setSat(paint, sat(base)), lum(base));
    case 'saturation':
      return setLum(setSat(base, sat(paint)), lum(base));
    case 'color':
      return setLum(paint, lum(base));
    case 'luminosity':
      return setLum(base, lum(paint));
  }
}

// ---- červené oči ----

/**
 * Červenost pixelu 0..1 pro velikost zornice 1..100 (větší = citlivější, zachytí i méně červené okraje zornice).
 * Měří se poměr červené k průměru zelené a modré; tmavé pixely (r < 40) se neberou.
 */
export function redness(r: number, g: number, b: number, pupilSize = 50): number {
  if (r < 40) return 0;
  const ratio = r / ((g + b) / 2 + 8);
  const t = 2.3 - pupilSize / 100;
  return Math.min(1, Math.max(0, (ratio - t) / 0.6));
}

/**
 * Váhy oprav (0..1) ve výřezu: červené pixely; se `seed` jen oblast spojená s nejčervenějším pixelem do 12 px
 * od bodu (klik do oka), bez něj všechny (tažený obdélník). Okraj se změkčí rozmazáním 3 × 3.
 */
export function redEyeMask(data: Uint8ClampedArray, width: number, height: number, pupilSize: number, seed?: { x: number; y: number }): Float32Array {
  const w = new Float32Array(width * height);
  for (let i = 0; i < w.length; i++) {
    const p = i * 4;
    if (data[p + 3]) w[i] = redness(data[p], data[p + 1], data[p + 2], pupilSize);
  }
  if (seed) {
    let best = -1;
    let bestW = 0;
    const R = 12;
    for (let y = Math.max(0, seed.y - R); y <= Math.min(height - 1, seed.y + R); y++) {
      for (let x = Math.max(0, seed.x - R); x <= Math.min(width - 1, seed.x + R); x++) {
        if ((x - seed.x) ** 2 + (y - seed.y) ** 2 > R * R) continue;
        const v = w[y * width + x];
        if (v > bestW) {
          bestW = v;
          best = y * width + x;
        }
      }
    }
    if (best < 0) return new Float32Array(width * height);
    const seen = new Uint8Array(w.length);
    const stack = [best];
    seen[best] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (j >= 0 && !seen[j] && w[j] > 0) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    for (let i = 0; i < w.length; i++) if (!seen[i]) w[i] = 0;
  }
  // Změkčení: maximum z vlastní váhy a průměru okolí 3 × 3 (okraj zornice se napojí, vnitřek zůstane plný).
  const out = new Float32Array(w.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) s += w[yy * width + Math.min(width - 1, Math.max(0, x + dx))];
      }
      out[y * width + x] = Math.max(w[y * width + x], s / 9);
    }
  }
  return out;
}

/**
 * Oprava červených očí na místě: červená = průměr zelené a modré (zornice zešedne), pak ztmavení o `darken` (0..100 %,
 * nejvýš na 20 % jasu). Míchá se podle vah (alfa zůstává). Vrací, zda se něco změnilo.
 */
export function removeRedEye(data: Uint8ClampedArray, weights: Float32Array, darken: number): boolean {
  const k = 1 - 0.8 * Math.min(1, Math.max(0, darken / 100));
  let changed = false;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w <= 0) continue;
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const nr = ((g + b) / 2) * k;
    data[p] = r + (nr - r) * w;
    data[p + 1] = g + (g * k - g) * w;
    data[p + 2] = b + (b * k - b) * w;
    changed = true;
  }
  return changed;
}
