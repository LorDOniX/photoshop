import type { Img } from './filters';
import { runJob, type Job } from './jobs';

/*
 * Výpočet na pozadí v jednom Web Workeru. Platí jen nejnovější požadavek: čekající starší se zahodí,
 * a když rozpracovaný výpočet běží déle než chvilku, worker se ukončí a spustí znovu (krátké výpočty se
 * nechají doběhnout – nový worker by se jen zbytečně načítal). Bez workeru (testy, zakázané workery) se
 * počítá na hlavním vlákně.
 */

/** Úkol byl nahrazen novějším – výsledek už nikoho nezajímá. */
export class Cancelled extends Error {
  constructor() {
    super('zrušeno');
  }
}

/** Po jaké době (ms) se rozpracovaný výpočet kvůli novějšímu požadavku přeruší. */
const INTERRUPT_AFTER = 100;

interface Task {
  id: number;
  img: Img;
  job: Job;
  started: number;
  resolve: (data: Uint8ClampedArray) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let failed = false;
let seq = 0;
let current: Task | null = null;
let queued: Task | null = null;

function getWorker(): Worker | null {
  if (worker || failed || typeof Worker === 'undefined') return worker;
  try {
    // Vite tento zápis pozná a worker sestaví jako samostatný soubor.
    const w = new Worker(new URL('./computeWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; data?: Uint8ClampedArray; error?: string }>) => {
      const task = current;
      if (!task || e.data.id !== task.id) return;
      current = null;
      if (e.data.data) task.resolve(e.data.data);
      else task.reject(new Error(e.data.error ?? 'výpočet selhal'));
      next();
    };
    w.onerror = (e) => {
      // Worker nejde spustit (např. zakázaný) – dál se počítá na hlavním vlákně.
      e.preventDefault();
      failed = true;
      worker = null;
      const task = current;
      current = null;
      if (task) runHere(task);
      next();
    };
    worker = w;
  } catch {
    failed = true;
  }
  return worker;
}

function runHere(task: Task): void {
  try {
    task.resolve(runJob(task.img, task.job));
  } catch (err) {
    task.reject(err as Error);
  }
}

function start(task: Task): void {
  const w = getWorker();
  if (!w) return runHere(task);
  current = task;
  task.started = performance.now();
  const { img } = task;
  w.postMessage({ id: task.id, data: img.data, width: img.width, height: img.height, job: task.job }, [img.data.buffer]);
}

function next(): void {
  const task = queued;
  queued = null;
  if (task) start(task);
}

/** Spočítá úkol (vstupní data se předají workeru a dál je nejde použít). Starší čekající úkol skončí `Cancelled`. */
export function computeJob(img: Img, job: Job): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const task: Task = { id: ++seq, img, job, started: 0, resolve, reject };
    queued?.reject(new Cancelled());
    queued = null;
    if (current && performance.now() - current.started > INTERRUPT_AFTER) {
      worker?.terminate();
      worker = null;
      current.reject(new Cancelled());
      current = null;
    }
    if (current) queued = task;
    else start(task);
  });
}

/** Běží (nebo čeká) výpočet na pozadí? */
export function computing(): boolean {
  return current !== null || queued !== null;
}
