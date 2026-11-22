/*
 * Retušování (healing): do oblasti se přenese textura zdroje, ale barva a jas se plynule napojí na okolí cíle.
 * Výsledek = zdroj + d, kde rozdíl d = cíl − zdroj je na okraji oblasti známý a uvnitř se dopočítá jako nejhladší
 * možná (harmonická) funkce – řešení Laplaceovy rovnice s okrajovou podmínkou (membrána). Řeší se multigridem:
 * hrubší úroveň dá počáteční odhad, na každé úrovni pak pár iterací Gauss–Seidel (červeno-černé).
 */

/**
 * Doplní neznámé hodnoty (`known[i] = 0`) harmonickou interpolací známých. `values` má `channels` hodnot na pixel
 * a mění se na místě. Bez známých hodnot se nic nemění.
 */
export function membrane(values: Float32Array, known: Uint8Array, width: number, height: number, channels: number): void {
  let any = false;
  let all = true;
  for (let i = 0; i < known.length; i++) {
    if (known[i]) any = true;
    else all = false;
  }
  if (!any || all) return;
  solve(values, known, width, height, channels);
  refine(values, known, width, height, channels);
}

/**
 * Doladění na plném rozlišení metodou sdružených gradientů (multigrid dá dobrý odhad, ale nejhrubší úrovně posouvají
 * okraje o půl pixelu – zbylá chyba je hladká, kterou Gauss–Seidel odstraňuje pomalu).
 * Rovnice pro neznámý pixel: n·x_i − Σ x_j (neznámí sousedé) = Σ v_j (známí sousedé), n = počet sousedů v obrázku.
 */
function refine(v: Float32Array, known: Uint8Array, w: number, h: number, c: number, maxIterations = 50): void {
  const index = new Int32Array(w * h).fill(-1);
  const cells: number[] = [];
  for (let i = 0; i < w * h; i++) if (!known[i]) index[i] = cells.push(i) - 1;
  const m = cells.length;
  // Sousedé v číslování neznámých (−1 = není / známý), počet sousedů, pravá strana ze známých sousedů.
  const nb = new Int32Array(m * 4).fill(-1);
  const deg = new Float32Array(m);
  const x = new Float32Array(m * c);
  const b = new Float32Array(m * c);
  for (let u = 0; u < m; u++) {
    const i = cells[u];
    const px = i % w;
    const py = (i - px) / w;
    const ns = [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1];
    for (let k = 0; k < 4; k++) {
      const j = ns[k];
      if (j < 0) continue;
      deg[u]++;
      if (index[j] >= 0) nb[u * 4 + k] = index[j];
      else for (let ch = 0; ch < c; ch++) b[u * c + ch] += v[j * c + ch];
    }
    for (let ch = 0; ch < c; ch++) x[u * c + ch] = v[i * c + ch];
  }
  const n = m * c;
  const r = new Float32Array(n);
  const p = new Float32Array(n);
  const ap = new Float32Array(n);
  // Všechny kanály najednou (stejná matice), skaláry CG zvlášť pro každý kanál.
  const apply = (src: Float32Array, out: Float32Array) => {
    for (let u = 0; u < m; u++) {
      const d = deg[u];
      const o = u * c;
      for (let ch = 0; ch < c; ch++) out[o + ch] = d * src[o + ch];
      for (let k = 0; k < 4; k++) {
        const j = nb[u * 4 + k];
        if (j < 0) continue;
        const q = j * c;
        for (let ch = 0; ch < c; ch++) out[o + ch] -= src[q + ch];
      }
    }
  };
  apply(x, ap);
  const rr = new Float64Array(c);
  const tol = new Float64Array(c);
  for (let o = 0; o < n; o += c) {
    for (let ch = 0; ch < c; ch++) {
      const t = o + ch;
      r[t] = b[t] - ap[t];
      p[t] = r[t];
      rr[ch] += r[t] * r[t];
      tol[ch] += b[t] * b[t];
    }
  }
  for (let ch = 0; ch < c; ch++) tol[ch] = 1e-10 * Math.max(1, tol[ch]);
  const pap = new Float64Array(c);
  const rr2 = new Float64Array(c);
  const alpha = new Float64Array(c);
  const beta = new Float64Array(c);
  for (let it = 0; it < maxIterations; it++) {
    let active = false;
    for (let ch = 0; ch < c; ch++) if (rr[ch] > tol[ch]) active = true;
    if (!active) break;
    apply(p, ap);
    pap.fill(0);
    for (let o = 0; o < n; o += c) for (let ch = 0; ch < c; ch++) pap[ch] += p[o + ch] * ap[o + ch];
    for (let ch = 0; ch < c; ch++) alpha[ch] = pap[ch] > 0 && rr[ch] > tol[ch] ? rr[ch] / pap[ch] : 0;
    rr2.fill(0);
    for (let o = 0; o < n; o += c) {
      for (let ch = 0; ch < c; ch++) {
        const t = o + ch;
        const a = alpha[ch];
        x[t] += a * p[t];
        r[t] -= a * ap[t];
        rr2[ch] += r[t] * r[t];
      }
    }
    for (let ch = 0; ch < c; ch++) {
      beta[ch] = rr[ch] > 0 ? rr2[ch] / rr[ch] : 0;
      rr[ch] = rr2[ch];
    }
    for (let o = 0; o < n; o += c) for (let ch = 0; ch < c; ch++) p[o + ch] = r[o + ch] + beta[ch] * p[o + ch];
  }
  for (let u = 0; u < m; u++) for (let ch = 0; ch < c; ch++) v[cells[u] * c + ch] = x[u * c + ch];
}

function solve(v: Float32Array, known: Uint8Array, w: number, h: number, c: number): void {
  if (w <= 2 && h <= 2) {
    // Nejhrubší úroveň: neznámé = průměr známých.
    const sum = new Float64Array(c);
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (!known[i]) continue;
      n++;
      for (let k = 0; k < c; k++) sum[k] += v[i * c + k];
    }
    if (!n) return;
    for (let i = 0; i < w * h; i++) if (!known[i]) for (let k = 0; k < c; k++) v[i * c + k] = sum[k] / n;
    return;
  }
  // Hrubší úroveň: průměr známých z bloku 2 × 2 (neznámé jen tam, kde v bloku nic známého není).
  const cw = Math.ceil(w / 2);
  const ch = Math.ceil(h / 2);
  const cv = new Float32Array(cw * ch * c);
  const ck = new Uint8Array(cw * ch);
  const cnt = new Uint16Array(cw * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!known[i]) continue;
      const j = (y >> 1) * cw + (x >> 1);
      cnt[j]++;
      for (let k = 0; k < c; k++) cv[j * c + k] += v[i * c + k];
    }
  }
  let anyUnknown = false;
  for (let j = 0; j < cw * ch; j++) {
    if (cnt[j]) {
      ck[j] = 1;
      for (let k = 0; k < c; k++) cv[j * c + k] /= cnt[j];
    } else anyUnknown = true;
  }
  if (anyUnknown) solve(cv, ck, cw, ch, c);
  // Počáteční odhad neznámých z hrubší úrovně (bilineárně).
  for (let y = 0; y < h; y++) {
    const fy = Math.min(ch - 1, Math.max(0, (y - 0.5) / 2));
    const y0 = Math.floor(fy);
    const y1 = Math.min(ch - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      const fx = Math.min(cw - 1, Math.max(0, (x - 0.5) / 2));
      const x0 = Math.floor(fx);
      const x1 = Math.min(cw - 1, x0 + 1);
      const tx = fx - x0;
      for (let k = 0; k < c; k++) {
        const a = cv[(y0 * cw + x0) * c + k] * (1 - tx) + cv[(y0 * cw + x1) * c + k] * tx;
        const b = cv[(y1 * cw + x0) * c + k] * (1 - tx) + cv[(y1 * cw + x1) * c + k] * tx;
        v[i * c + k] = a * (1 - ty) + b * ty;
      }
    }
  }
  // Vyhlazení: Gauss–Seidel (červeno-černě) jen na neznámých.
  const unknown: number[] = [];
  for (let i = 0; i < w * h; i++) if (!known[i]) unknown.push(i);
  const iterations = 12;
  for (let it = 0; it < iterations; it++) {
    for (let parity = 0; parity < 2; parity++) {
      for (const i of unknown) {
        const x = i % w;
        const y = (i - x) / w;
        if (((x + y) & 1) !== parity) continue;
        let n = 0;
        for (let k = 0; k < c; k++) tmp[k] = 0;
        if (x > 0) add(v, i - 1, c), n++;
        if (x < w - 1) add(v, i + 1, c), n++;
        if (y > 0) add(v, i - w, c), n++;
        if (y < h - 1) add(v, i + w, c), n++;
        for (let k = 0; k < c; k++) v[i * c + k] = tmp[k] / n;
      }
    }
  }
}

const tmp = new Float64Array(8);
function add(v: Float32Array, j: number, c: number): void {
  for (let k = 0; k < c; k++) tmp[k] += v[j * c + k];
}

/**
 * Retušuje oblast `inside` (1 = retušovat): textura ze `src`, barvy napojené na `dst` mimo oblast. Oba obrázky RGBA
 * stejné velikosti; vrací nový obrázek (mimo oblast = `dst`).
 */
export function healRegion(dst: Uint8ClampedArray, src: Uint8ClampedArray, inside: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const n = width * height;
  const diff = new Float32Array(n * 4);
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (inside[i]) continue;
    known[i] = 1;
    for (let k = 0; k < 4; k++) diff[i * 4 + k] = dst[i * 4 + k] - src[i * 4 + k];
  }
  membrane(diff, known, width, height, 4);
  const out = new Uint8ClampedArray(dst);
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue;
    for (let k = 0; k < 4; k++) out[i * 4 + k] = src[i * 4 + k] + diff[i * 4 + k];
  }
  return out;
}

/** Pixely do vzdálenosti `r` (čtvercově) od oblasti, které v ní nejsou – okraj pro porovnání zdrojů. */
export function ring(inside: Uint8Array, width: number, height: number, r: number): Uint8Array {
  let cur = inside;
  for (let step = 0; step < r; step++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1]) || (x < width - 1 && cur[i + 1]) || (y > 0 && cur[i - width]) || (y < height - 1 && cur[i + width])) next[i] = 1;
      }
    }
    cur = next;
  }
  const out = new Uint8Array(inside.length);
  for (let i = 0; i < out.length; i++) out[i] = cur[i] && !inside[i] ? 1 : 0;
  return out;
}

/**
 * Bodové retušování: najde posun (ox, oy), odkud vzít náhradní texturu pro oblast `inside` z téhož obrázku –
 * okolí oblasti má sedět s okolím posunutého místa a posunutá oblast nesmí zasahovat do vady ani mimo obrázek.
 * `size` = velikost štětce (zkoušené vzdálenosti jsou jejími násobky).
 */
export function findPatchOffset(img: Uint8ClampedArray, inside: Uint8Array, width: number, height: number, size: number): { x: number; y: number } | null {
  const edge = ring(inside, width, height, 3);
  const edgeIdx: number[] = [];
  const inIdx: number[] = [];
  for (let i = 0; i < inside.length; i++) {
    if (edge[i]) edgeIdx.push(i);
    else if (inside[i]) inIdx.push(i);
  }
  if (!inIdx.length) return null;
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (const k of [1.1, 1.6, 2.3, 3.2]) {
    const d = Math.max(3, size * k);
    for (let a = 0; a < 16; a++) {
      const ox = Math.round(Math.cos((a / 16) * Math.PI * 2) * d);
      const oy = Math.round(Math.sin((a / 16) * Math.PI * 2) * d);
      // Posunutá oblast musí být celá v obrázku a mimo vadu.
      let bad = false;
      for (const i of inIdx) {
        const x = (i % width) + ox;
        const y = Math.floor(i / width) + oy;
        if (x < 0 || y < 0 || x >= width || y >= height || inside[y * width + x]) {
          bad = true;
          break;
        }
      }
      if (bad) continue;
      let score = 0;
      let n = 0;
      for (const i of edgeIdx) {
        const x = (i % width) + ox;
        const y = Math.floor(i / width) + oy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const j = y * width + x;
        if (inside[j]) {
          score += 4 * 255 * 255;
          n++;
          continue;
        }
        for (let c = 0; c < 4; c++) {
          const e = img[i * 4 + c] - img[j * 4 + c];
          score += e * e;
        }
        n++;
      }
      if (!n) continue;
      score /= n;
      // Mírná přednost bližším místům.
      score *= 1 + k * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = { x: ox, y: oy };
      }
    }
  }
  return best;
}
