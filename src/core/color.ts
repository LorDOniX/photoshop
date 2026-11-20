/*
 * Práce s barvami – čisté funkce bez DOM (testovatelné v Node).
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  /** 0..255 */
  a: number;
}

/** "#rrggbb" (nebo "#rgb") → RGBA; neplatný vstup = černá. */
export function parseHex(hex: string): RGBA {
  let m = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1];
  const short = /^#?([0-9a-f]{3})$/i.exec(hex)?.[1];
  if (!m && short) m = [...short].map((c) => c + c).join('');
  if (!m) return { r: 0, g: 0, b: 0, a: 255 };
  const n = Number.parseInt(m, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
}

export function toHex(c: { r: number; g: number; b: number }): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}

/**
 * Průměrná barva čtverce `size` × `size` kolem pixelu (x, y) – kapátko.
 * Průhledné pixely se do průměru barvy započítávají podle alfy (jako ve Photoshopu);
 * pokud je celá oblast průhledná, vrací null.
 */
export function averageColor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  size: number,
): RGBA | null {
  const half = Math.floor(Math.max(1, size) / 2);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;
  for (let yy = y - half; yy <= y + half; yy++) {
    if (yy < 0 || yy >= height) continue;
    for (let xx = x - half; xx <= x + half; xx++) {
      if (xx < 0 || xx >= width) continue;
      const i = (yy * width + xx) * 4;
      const alpha = rgba[i + 3];
      r += rgba[i] * alpha;
      g += rgba[i + 1] * alpha;
      b += rgba[i + 2] * alpha;
      a += alpha;
      count++;
    }
  }
  if (!count || a === 0) return null;
  return { r: Math.round(r / a), g: Math.round(g / a), b: Math.round(b / a), a: Math.round(a / count) };
}
