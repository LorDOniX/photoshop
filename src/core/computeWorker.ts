import { runJob, type Job } from './jobs';

/* Web Worker pro výpočet úprav a filtrů (aby rozhraní během výpočtu nezamrzalo). */

interface WorkerRequest {
  id: number;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  job: Job;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, data, width, height, job } = e.data;
  try {
    const out = runJob({ data, width, height }, job);
    (self as unknown as Worker).postMessage({ id, data: out }, [out.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
