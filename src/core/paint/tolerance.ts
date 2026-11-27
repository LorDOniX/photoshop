/*
 * Tolerance barev pro nástroje, které působí jen na barvu podobnou vzorku (Guma pozadí, Nahrazení barvy).
 */

/** Rozdíl barev = největší rozdíl kanálů (0..255). */
export function colorDiff(d: ArrayLike<number>, p: number, color: readonly [number, number, number]): number {
  return Math.max(Math.abs(d[p] - color[0]), Math.abs(d[p + 1] - color[1]), Math.abs(d[p + 2] - color[2]));
}

/**
 * Síla podle rozdílu barvy a tolerance (0..255): s vyhlazením do poloviny tolerance plně a dál lineárně k nule
 * (měkký okraj), bez vyhlazení plně pod tolerancí.
 */
export function toleranceWeight(diff: number, tol: number, antialias = true): number {
  if (diff >= tol) return 0;
  if (!antialias || diff <= tol / 2) return 1;
  return 1 - (diff - tol / 2) / (tol / 2);
}

/** Souvislé: ponechá jen pixely spojené (4-sousedstvím) se středem otisku, ostatní vynuluje. */
export function keepConnected(strength: Float32Array, width: number, height: number, sx: number, sy: number): void {
  const seen = new Uint8Array(strength.length);
  const cx = Math.min(width - 1, Math.max(0, sx));
  const cy = Math.min(height - 1, Math.max(0, sy));
  const start = cy * width + cx;
  if (strength[start] > 0) {
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      const visit = (j: number) => {
        if (!seen[j] && strength[j] > 0) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (y > 0) visit(i - width);
      if (y < height - 1) visit(i + width);
    }
  }
  for (let i = 0; i < strength.length; i++) if (!seen[i]) strength[i] = 0;
}
