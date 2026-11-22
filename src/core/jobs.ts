import { applyAdjustment, type Adjustment } from './adjust';
import type { Rect } from './canvas';
import { applyFilter, type Filter, type Img } from './filters';

/*
 * Výpočet úpravy / filtru nad obrázkem – stejná funkce běží ve Web Workeru (core/computeWorker.ts)
 * i na hlavním vlákně, když worker není k dispozici.
 */

export type Job = { type: 'filter'; filter: Filter; area: Rect; weights?: Uint8Array } | { type: 'adjust'; adjustment: Adjustment };

/** Výsledek úkolu (stejný rozměr jako vstup). Vstupní data se smí změnit. */
export function runJob(img: Img, job: Job): Uint8ClampedArray {
  if (job.type === 'adjust') {
    applyAdjustment(img.data, job.adjustment);
    return img.data;
  }
  return applyFilter(img, job.filter, job.area, job.weights).data;
}
