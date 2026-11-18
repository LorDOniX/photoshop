import { SelectionMask } from './SelectionMask';

/**
 * Kouzelná hůlka: vybere pixely podobné barvě v bodě (sx, sy).
 * Podobnost = maximální rozdíl v kanálech R, G, B, A ≤ tolerance.
 */
export function floodSelect(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  tolerance: number,
  contiguous: boolean,
): SelectionMask {
  const mask = new SelectionMask(width, height);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mask;
  const out = mask.data;
  const i0 = (sy * width + sx) * 4;
  const r0 = rgba[i0];
  const g0 = rgba[i0 + 1];
  const b0 = rgba[i0 + 2];
  const a0 = rgba[i0 + 3];
  const t = tolerance;
  const match = (p: number) => {
    const i = p * 4;
    return (
      Math.abs(rgba[i] - r0) <= t &&
      Math.abs(rgba[i + 1] - g0) <= t &&
      Math.abs(rgba[i + 2] - b0) <= t &&
      Math.abs(rgba[i + 3] - a0) <= t
    );
  };

  if (!contiguous) {
    for (let p = 0; p < width * height; p++) if (match(p)) out[p] = 255;
    return mask;
  }

  // Řádkové (scanline) vyplňování se zásobníkem.
  const ok = (x: number, y: number) => {
    const p = y * width + x;
    return out[p] === 0 && match(p);
  };
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    if (!ok(x, y)) continue;
    while (x > 0 && ok(x - 1, y)) x--;
    let above = false;
    let below = false;
    while (x < width && ok(x, y)) {
      out[y * width + x] = 255;
      if (y > 0) {
        const m = ok(x, y - 1);
        if (m && !above) stack.push(x, y - 1);
        above = m;
      }
      if (y < height - 1) {
        const m = ok(x, y + 1);
        if (m && !below) stack.push(x, y + 1);
        below = m;
      }
      x++;
    }
  }
  return mask;
}
