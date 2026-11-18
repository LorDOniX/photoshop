import { describe, expect, it } from 'vitest';
import { floodSelect, growSelection } from '../src/core/selection/floodFill';
import { findLiveWire } from '../src/core/selection/livewire';
import { SelectionMask } from '../src/core/selection/SelectionMask';

const W = 20;
const H = 20;
const rect = (x: number, y: number, width: number, height: number) => SelectionMask.rect(W, H, { x, y, width, height });
const count = (m: SelectionMask) => m.data.reduce((n, v) => n + (v >= 128 ? 1 : 0), 0);

describe('SelectionMask', () => {
  it('kombinuje výběry podle režimu', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 10, 10);
    expect(count(a.combine(b, 'add'))).toBe(100 + 100 - 25);
    expect(count(a.combine(b, 'subtract'))).toBe(75);
    expect(a.combine(b, 'intersect').bounds()).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(a.combine(b, 'replace')).toBe(b);
  });

  it('inverze a hranice', () => {
    expect(new SelectionMask(W, H).bounds()).toBeNull();
    expect(rect(2, 3, 4, 5).invert().get(2, 3)).toBe(0);
    expect(rect(2, 3, 4, 5).invert().get(0, 0)).toBe(255);
  });

  it('rozšíření a zúžení; okraje plátna se nezužují', () => {
    expect(rect(5, 5, 4, 4).expand(2).bounds()).toEqual({ x: 3, y: 3, width: 8, height: 8 });
    expect(rect(5, 5, 6, 6).contract(2).bounds()).toEqual({ x: 7, y: 7, width: 2, height: 2 });
    expect(rect(5, 5, 4, 4).contract(2).isEmpty()).toBe(true);
    expect(SelectionMask.all(W, H).contract(3).bounds()).toEqual({ x: 0, y: 0, width: W, height: H });
  });

  it('prolnutí změkčí okraj, ale vnitřek zůstane vybraný', () => {
    const f = rect(5, 5, 10, 10).feather(2);
    expect(f.get(10, 10)).toBe(255);
    expect(f.get(5, 10)).toBeGreaterThan(0);
    expect(f.get(5, 10)).toBeLessThan(255);
  });

  it('posun výběru; co vyjede z plátna, se ztratí', () => {
    expect(rect(2, 3, 4, 5).translate(3, -1).bounds()).toEqual({ x: 5, y: 2, width: 4, height: 5 });
    expect(rect(16, 0, 4, 4).translate(2, 0).bounds()).toEqual({ x: 18, y: 0, width: 2, height: 4 });
    expect(rect(0, 0, 4, 4).translate(-10, 0).isEmpty()).toBe(true);
  });

  it('obrys obdélníku = 4 sloučené úsečky', () => {
    const segs = Array.from(rect(2, 3, 4, 5).outline());
    expect(segs).toEqual([2, 3, 6, 3, 2, 8, 6, 8, 2, 3, 2, 8, 6, 3, 6, 8]);
  });
});

describe('floodSelect (kouzelná hůlka)', () => {
  // Bílý obraz se svislou černou čárou ve sloupci 10.
  const img = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) img.fill(0, (y * W + 10) * 4, (y * W + 10) * 4 + 3);

  it('souvislá oblast končí na hraně', () => {
    expect(floodSelect(img, W, H, 2, 2, 10, true).bounds()).toEqual({ x: 0, y: 0, width: 10, height: H });
  });

  it('nesouvislý režim vybere všechny podobné pixely', () => {
    expect(count(floodSelect(img, W, H, 2, 2, 10, false))).toBe(W * H - H);
  });

  it('tolerance zahrne i podobnou barvu', () => {
    expect(count(floodSelect(img, W, H, 2, 2, 255, true))).toBe(W * H);
  });
});

describe('growSelection (Zvětšit / Podobné)', () => {
  // Levá polovina šedá 100, pravá šedá 200, uprostřed v pravé polovině ostrůvek 100.
  const img = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const x = p % W;
    const y = Math.floor(p / W);
    const v = x < 10 || (x >= 14 && x < 16 && y >= 8 && y < 10) ? 100 : 200;
    img.set([v, v, v, 255], p * 4);
  }

  it('Zvětšit přidá jen souvisle navazující podobné pixely', () => {
    const grown = growSelection(img, W, H, rect(2, 2, 2, 2), 10, true);
    expect(grown.bounds()).toEqual({ x: 0, y: 0, width: 10, height: H });
  });

  it('Podobné přidá podobné pixely v celém obraze', () => {
    const similar = growSelection(img, W, H, rect(2, 2, 2, 2), 10, false);
    expect(count(similar)).toBe(10 * H + 4);
  });
});

describe('findLiveWire (magnetické laso)', () => {
  it('cesta vede po silné hraně místo přímé úhlopříčky', () => {
    // Hrana ve tvaru „L“: řádek 2 (x 2..17) a sloupec 17 (y 2..17).
    const edges = new Uint8Array(W * H);
    for (let x = 2; x <= 17; x++) edges[2 * W + x] = 255;
    for (let y = 2; y <= 17; y++) edges[y * W + 17] = 255;
    const path = findLiveWire(edges, W, H, 2, 2, 17, 17, { margin: 2, minEdge: 10 });
    expect(path.slice(0, 2)).toEqual([2, 2]);
    expect(path.slice(-2)).toEqual([17, 17]);
    for (let i = 0; i < path.length; i += 2) expect(path[i + 1] === 2 || path[i] === 17).toBe(true);
  });
});
