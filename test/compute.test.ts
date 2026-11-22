import { describe, expect, it } from 'vitest';
import { applyAdjustment } from '../src/core/adjust';
import { computeJob, computing } from '../src/core/compute';
import { applyFilter } from '../src/core/filters';
import { runJob } from '../src/core/jobs';

const image = () => {
  const width = 16;
  const height = 12;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = (i * 37) % 256;
    data[i * 4 + 1] = (i * 91) % 256;
    data[i * 4 + 2] = (i * 13) % 256;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
};

describe('výpočet na pozadí', () => {
  it('úkol úpravy = applyAdjustment', () => {
    const a = image();
    const expected = new Uint8ClampedArray(a.data);
    applyAdjustment(expected, { kind: 'invert' });
    expect(Array.from(runJob(a, { type: 'adjust', adjustment: { kind: 'invert' } }))).toEqual(Array.from(expected));
  });

  it('úkol filtru = applyFilter (oblast i váhy)', () => {
    const area = { x: 2, y: 2, width: 10, height: 8 };
    const weights = new Uint8Array(80).fill(128);
    const filter = { kind: 'gaussianBlur', radius: 2 } as const;
    const expected = applyFilter(image(), filter, area, weights).data;
    expect(Array.from(runJob(image(), { type: 'filter', filter, area, weights }))).toEqual(Array.from(expected));
  });

  it('bez Web Workeru se počítá na hlavním vlákně', async () => {
    const img = image();
    const expected = new Uint8ClampedArray(img.data);
    applyAdjustment(expected, { kind: 'desaturate' });
    const out = await computeJob(img, { type: 'adjust', adjustment: { kind: 'desaturate' } });
    expect(Array.from(out)).toEqual(Array.from(expected));
    expect(computing()).toBe(false);
  });
});
