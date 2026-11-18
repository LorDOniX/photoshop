import { SelectionMask } from './SelectionMask';

/**
 * Výběr → Zvětšit (`contiguous`) / Podobné: přidá pixely, jejichž barva leží v rozsahu barev
 * aktuálně vybraných pixelů rozšířeném o toleranci. „Zvětšit“ jen souvisle navazující, „Podobné“ v celém obraze.
 */
export function growSelection(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  selection: SelectionMask,
  tolerance: number,
  contiguous: boolean,
): SelectionMask {
  const n = width * height;
  const lo = [255, 255, 255, 255];
  const hi = [0, 0, 0, 0];
  const sel = selection.data;
  let any = false;
  for (let p = 0; p < n; p++) {
    if (sel[p] < 128) continue;
    any = true;
    for (let c = 0; c < 4; c++) {
      const v = rgba[p * 4 + c];
      if (v < lo[c]) lo[c] = v;
      if (v > hi[c]) hi[c] = v;
    }
  }
  const out = new SelectionMask(width, height, new Uint8ClampedArray(sel));
  if (!any) return out;
  const inRange = (p: number) => {
    for (let c = 0; c < 4; c++) {
      const v = rgba[p * 4 + c];
      if (v < lo[c] - tolerance || v > hi[c] + tolerance) return false;
    }
    return true;
  };
  const res = out.data;
  if (!contiguous) {
    for (let p = 0; p < n; p++) if (res[p] < 255 && inRange(p)) res[p] = 255;
    return out;
  }
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let p = 0; p < n; p++) if (sel[p] >= 128) queue[tail++] = p;
  const visit = (q: number) => {
    if (res[q] < 128 && inRange(q)) {
      res[q] = 255;
      queue[tail++] = q;
    }
  };
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < n - width) visit(p + width);
  }
  return out;
}

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
  /** Volitelně omezí výběr na kruh o tomto poloměru kolem (sx, sy) – rychlý výběr. */
  radius = Number.POSITIVE_INFINITY,
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
  const r2 = radius * radius;
  const match = (p: number) => {
    const i = p * 4;
    if (r2 !== Number.POSITIVE_INFINITY) {
      const x = p % width;
      const y = (p - x) / width;
      if ((x - sx) ** 2 + (y - sy) ** 2 > r2) return false;
    }
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
