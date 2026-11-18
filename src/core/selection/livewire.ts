/*
 * Magnetické laso („intelligent scissors / livewire“):
 *  1. mapa hran = velikost gradientu (Sobel) jasu obrazu,
 *  2. cena průchodu pixelem je nízká na silných hranách,
 *  3. nejlevnější cesta mezi kotvou a kurzorem (Dijkstra v omezeném okně).
 */

/** Velikost gradientu 0..255 pro každý pixel. */
export function computeEdgeMap(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const lum = new Float32Array(width * height);
  for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
    lum[p] = ((0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * rgba[i + 3]) / 255;
  }
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const tl = lum[p - width - 1];
      const t = lum[p - width];
      const tr = lum[p - width + 1];
      const l = lum[p - 1];
      const r = lum[p + 1];
      const bl = lum[p + width - 1];
      const b = lum[p + width];
      const br = lum[p + width + 1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      edges[p] = Math.min(255, Math.sqrt(gx * gx + gy * gy) / 4);
    }
  }
  return edges;
}

/** Přichycení bodu k nejsilnější hraně v okolí `radius` px (je-li dost silná). */
export function snapToEdge(
  edges: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  minEdge: number,
): { x: number; y: number } {
  const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
  let best = -1;
  let bx = cx;
  let by = cy;
  const r = Math.max(0, Math.round(radius));
  for (let yy = Math.max(0, cy - r); yy <= Math.min(height - 1, cy + r); yy++) {
    for (let xx = Math.max(0, cx - r); xx <= Math.min(width - 1, cx + r); xx++) {
      const d2 = (xx - cx) ** 2 + (yy - cy) ** 2;
      if (d2 > r * r) continue;
      // Při stejné síle hrany vyhrává bližší bod.
      const score = edges[yy * width + xx] * 1000 - d2;
      if (score > best) {
        best = score;
        bx = xx;
        by = yy;
      }
    }
  }
  return edges[by * width + bx] >= minEdge ? { x: bx, y: by } : { x: cx, y: cy };
}

export interface LiveWireOptions {
  /** Okraj okna hledání kolem úsečky kotva–cíl. */
  margin: number;
  /** Hrany slabší než tato hodnota se berou jako „žádná hrana“. */
  minEdge: number;
  /** Maximální počet pixelů okna (jinak rovná čára). */
  maxArea?: number;
}

/**
 * Nejlevnější cesta z (fx, fy) do (tx, ty) – vrací body [x0, y0, x1, y1, ...] (celé pixely, včetně začátku i konce).
 */
export function findLiveWire(
  edges: Uint8Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  o: LiveWireOptions,
): number[] {
  const sx = Math.round(fx);
  const sy = Math.round(fy);
  const ex = Math.round(tx);
  const ey = Math.round(ty);
  if (sx === ex && sy === ey) return [sx, sy];

  const x0 = Math.max(0, Math.min(sx, ex) - o.margin);
  const y0 = Math.max(0, Math.min(sy, ey) - o.margin);
  const x1 = Math.min(width - 1, Math.max(sx, ex) + o.margin);
  const y1 = Math.min(height - 1, Math.max(sy, ey) + o.margin);
  const rw = x1 - x0 + 1;
  const rh = y1 - y0 + 1;
  const inRegion = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (rw * rh > (o.maxArea ?? 250_000) || !inRegion(sx, sy) || !inRegion(ex, ey)) return [sx, sy, ex, ey];

  const cost = (x: number, y: number) => {
    const e = edges[y * width + x];
    return e >= o.minEdge ? 1.02 - e / 255 : 1.02;
  };
  const n = rw * rh;
  const dist = new Float32Array(n).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  const start = (sy - y0) * rw + (sx - x0);
  const goal = (ey - y0) * rw + (ex - x0);
  dist[start] = 0;
  heap.push(start, 0);

  while (heap.size) {
    const cur = heap.pop();
    if (done[cur]) continue;
    done[cur] = 1;
    if (cur === goal) break;
    const cx = cur % rw;
    const cy = (cur - cx) / rw;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
        const nb = ny * rw + nx;
        if (done[nb]) continue;
        const d = dist[cur] + cost(nx + x0, ny + y0) * (dx && dy ? Math.SQRT2 : 1);
        if (d < dist[nb]) {
          dist[nb] = d;
          prev[nb] = cur;
          heap.push(nb, d);
        }
      }
    }
  }

  if (prev[goal] < 0) return [sx, sy, ex, ey];
  const path: number[] = [];
  for (let p = goal; p >= 0; p = prev[p]) {
    const px = p % rw;
    path.push(px + x0, (p - px) / rw + y0);
    if (p === start) break;
  }
  // Cesta je od cíle ke startu – otočíme po dvojicích.
  const out: number[] = [];
  for (let i = path.length - 2; i >= 0; i -= 2) out.push(path[i], path[i + 1]);
  return out;
}

/** Délka lomené čáry [x0, y0, x1, y1, ...]. */
export function polylineLength(points: readonly number[]): number {
  let len = 0;
  for (let i = 2; i < points.length; i += 2) len += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  return len;
}

/** Binární halda (min) s „líným“ mazáním – duplicity řeší `done` v Dijkstrovi. */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      ids[i] = ids[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    ids[i] = id;
    keys[i] = key;
  }

  pop(): number {
    const { ids, keys } = this;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}
