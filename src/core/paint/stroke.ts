import { SelectionMask } from '../selection/SelectionMask';

/*
 * Úpravy → Obrys: pás kolem okraje výběru. Vzdálenost od okraje se počítá přesnou euklidovskou
 * vzdálenostní transformací (Felzenszwalb & Huttenlocher), takže rohy obrysu jsou kulaté.
 */

export type StrokePosition = 'inside' | 'center' | 'outside';

const INF = 1e20;

/** 1D transformace: d[i] = min_j (i − j)² + f[j]. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Druhá mocnina vzdálenosti každého pixelu k nejbližšímu pixelu, pro který platí `target`. */
export function squaredDistance(target: (p: number) => boolean, width: number, height: number): Float64Array {
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(width * height);
  for (let p = 0; p < grid.length; p++) grid[p] = target(p) ? 0 : INF;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
  }
  return grid;
}

/** Maska obrysu šířky `width` px uvnitř / na středu / vně okraje výběru (s vyhlazeným okrajem). */
export function strokeMask(selection: SelectionMask, width: number, position: StrokePosition): SelectionMask {
  const { width: w, height: h, data } = selection;
  const inside = (p: number) => data[p] >= 128;
  const out = new SelectionMask(w, h);
  if (width <= 0) return out;
  const toInside = position === 'inside' ? null : squaredDistance(inside, w, h);
  const toOutside = position === 'outside' ? null : squaredDistance((p) => !inside(p), w, h);
  const outer = position === 'outside' ? width : position === 'center' ? width / 2 : 0;
  const inner = position === 'inside' ? width : position === 'center' ? width / 2 : 0;
  // Pixel ve vzdálenosti d (střed → střed nejbližšího pixelu na druhé straně) zabírá pás (d − 1, d].
  const coverage = (dist: number, band: number) => Math.max(0, Math.min(1, band + 1 - dist));
  for (let p = 0; p < out.data.length; p++) {
    const a = inside(p)
      ? toOutside && inner > 0
        ? coverage(Math.sqrt(toOutside[p]), inner)
        : 0
      : toInside && outer > 0
        ? coverage(Math.sqrt(toInside[p]), outer)
        : 0;
    out.data[p] = Math.round(a * 255);
  }
  return out;
}
