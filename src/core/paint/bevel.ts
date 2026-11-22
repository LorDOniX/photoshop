import { squaredDistance } from './stroke';

/*
 * Úkos a reliéf – výpočet bez DOM. Z alfy vrstvy se spočítá znaménková vzdálenost od okraje
 * (kladná uvnitř), z ní výškový profil podle stylu a z jeho sklonu osvětlení: kde plocha míří
 * ke světlu, vznikne světlo, kde od něj, stín (jako ve Photoshopu, obojí 0..1 na pixel).
 */

export type BevelStyle = 'inner' | 'outer' | 'emboss' | 'pillow';
export type BevelTechnique = 'smooth' | 'chisel';

export interface BevelParams {
  style: BevelStyle;
  technique: BevelTechnique;
  /** Hloubka v % (100 = výška profilu rovná velikosti). */
  depth: number;
  direction: 'up' | 'down';
  /** Šířka úkosu v px. */
  size: number;
  /** Změkčení stínování v px. */
  soften: number;
  /** Úhel světla ve stupních (120° = zleva shora). */
  angle: number;
  /** Výška světla nad rovinou ve stupních (90° = kolmo shora). */
  altitude: number;
}

export interface BevelShading {
  /** Síla světla 0..1 na pixel. */
  light: Float32Array;
  /** Síla stínu 0..1 na pixel. */
  dark: Float32Array;
}

/** Znaménková vzdálenost od okraje tvaru (alfa ≥ 128 = uvnitř), kladná uvnitř, v px. */
export function signedDistance(alpha: ArrayLike<number>, width: number, height: number): Float32Array {
  const inside = (i: number) => alpha[i] >= 128;
  const toOutside = squaredDistance((i) => !inside(i), width, height);
  const toInside = squaredDistance(inside, width, height);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    // Okraj leží mezi středy pixelů – proto −0,5; poloprůhledná alfa ho posune o zlomek pixelu.
    const sub = (alpha[i] - 127.5) / 255;
    out[i] = inside(i) ? Math.sqrt(toOutside[i]) - 0.5 + Math.min(0, sub) : -(Math.sqrt(toInside[i]) - 0.5) + Math.max(0, sub);
  }
  return out;
}

/** Profil 0..1 podle polohy t 0..1 na úkosu (hladký = zaoblený, dláto = rovný). */
function profile(t: number, technique: BevelTechnique): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return technique === 'smooth' ? Math.sin((c * Math.PI) / 2) : c;
}

/** Výška povrchu v px pro znaménkovou vzdálenost `s` (polštář = okraj zapuštěný, obě strany stoupají). */
export function bevelHeight(s: number, p: Pick<BevelParams, 'style' | 'technique' | 'size' | 'depth' | 'direction'>): number {
  const size = Math.max(1, p.size);
  let t: number;
  switch (p.style) {
    case 'inner':
      t = profile(s / size, p.technique);
      break;
    case 'outer':
      t = profile((s + size) / size, p.technique);
      break;
    case 'emboss':
      t = profile((s + size / 2) / size, p.technique);
      break;
    case 'pillow':
      t = profile(Math.abs(s) / (size / 2), p.technique) * (s >= 0 ? 1 : -1);
      break;
  }
  return t * size * (p.depth / 100) * (p.direction === 'down' ? -1 : 1);
}

/** Rozostření rámečkem (2 průchody ≈ Gauss) na místě. */
export function boxBlur(data: Float32Array, width: number, height: number, radius: number): void {
  const r = Math.round(radius);
  if (r < 1) return;
  const tmp = new Float32Array(data.length);
  const pass = (src: Float32Array, dst: Float32Array, len: number, lines: number, step: number, lineStep: number) => {
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[base + Math.min(len - 1, Math.max(0, k)) * step];
      for (let i = 0; i < len; i++) {
        dst[base + i * step] = sum / (2 * r + 1);
        sum += src[base + Math.min(len - 1, i + r + 1) * step] - src[base + Math.max(0, i - r) * step];
      }
    }
  };
  for (let n = 0; n < 2; n++) {
    pass(data, tmp, width, height, 1, width);
    pass(tmp, data, height, width, width, 1);
  }
}

/** Světla a stíny úkosu pro alfu tvaru (`width` × `height`). */
export function bevelShading(alpha: ArrayLike<number>, width: number, height: number, p: BevelParams): BevelShading {
  const sd = signedDistance(alpha, width, height);
  const hm = new Float32Array(width * height);
  for (let i = 0; i < hm.length; i++) hm[i] = bevelHeight(sd[i], p);
  // Vyhlazení výšek: vzdálenost se měří ke středům pixelů, takže by v zaoblených rozích vznikly paprsky;
  // hladký úkos navíc nemá mít ostrý hřbet na ose tvaru.
  boxBlur(hm, width, height, p.technique === 'smooth' ? Math.max(1, p.size / 8) : 1);

  const a = (p.angle * Math.PI) / 180;
  const b = (Math.max(0, Math.min(90, p.altitude)) * Math.PI) / 180;
  const lx = Math.cos(b) * Math.cos(a);
  const ly = -Math.cos(b) * Math.sin(a);
  const lz = Math.sin(b);
  const flat = lz;
  const light = new Float32Array(width * height);
  const dark = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const gx = (hm[i + (x < width - 1 ? 1 : 0)] - hm[i - (x > 0 ? 1 : 0)]) / (x > 0 && x < width - 1 ? 2 : 1);
      const gy = (hm[i + (y < height - 1 ? width : 0)] - hm[i - (y > 0 ? width : 0)]) / (y > 0 && y < height - 1 ? 2 : 1);
      if (gx === 0 && gy === 0) continue;
      const len = Math.hypot(gx, gy, 1);
      const shade = (-gx * lx - gy * ly + lz) / len;
      // Plocha natočená přímo ke světlu = plné světlo, přímo od světla (svisle) = skoro plný stín.
      if (shade > flat) light[i] = Math.min(1, (shade - flat) / Math.max(1e-3, 1 - flat));
      else dark[i] = Math.min(1, (flat - shade) / (1 + flat));
    }
  }
  if (p.soften > 0) {
    boxBlur(light, width, height, p.soften / 2);
    boxBlur(dark, width, height, p.soften / 2);
  }
  return { light, dark };
}

/** Sahá úkos ven z tvaru (vnější úkos, reliéf, polštář)? */
export function bevelReachesOutside(style: BevelStyle): boolean {
  return style !== 'inner';
}
