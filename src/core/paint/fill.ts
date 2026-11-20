import { SelectionMask } from '../selection/SelectionMask';

/**
 * Vyhlazení okraje oblasti plechovky: k oblasti přidá jednopixelový poloprůhledný lem
 * (průměr okolí 3 × 3), takže výplň navazuje na vyhlazené čáry bez bílé mezery.
 * Vnitřek oblasti zůstává plně vyplněný.
 */
export function softenEdge(mask: SelectionMask): SelectionMask {
  const { width: w, height: h, data: src } = mask;
  const out = new Uint8ClampedArray(src);
  const b = mask.bounds();
  if (!b) return mask;
  // Lem může vzniknout jen o pixel kolem oblasti.
  const x0 = Math.max(0, b.x - 1);
  const y0 = Math.max(0, b.y - 1);
  const x1 = Math.min(w, b.x + b.width + 1);
  const y1 = Math.min(h, b.y + b.height + 1);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * w + x;
      if (src[p] === 255) continue;
      let sum = 0;
      for (let yy = y - 1; yy <= y + 1; yy++) {
        if (yy < 0 || yy >= h) continue;
        for (let xx = x - 1; xx <= x + 1; xx++) if (xx >= 0 && xx < w) sum += src[yy * w + xx];
      }
      // Dělí se vždy 9, aby lem u okraje plátna nebyl silnější.
      const v = Math.round(sum / 9);
      if (v > out[p]) out[p] = v;
    }
  }
  return new SelectionMask(w, h, out);
}

/** Násobení dvou masek (oblast výplně × výběr). */
export function multiplyMasks(a: SelectionMask, b: SelectionMask | null): SelectionMask {
  if (!b) return a;
  const out = new Uint8ClampedArray(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = (a.data[i] * b.data[i] + 127) / 255;
  return new SelectionMask(a.width, a.height, out);
}
