import { computing } from '../core/compute';
import { h } from './dom';

/*
 * Indikátor práce na pozadí: dokud výpočet (filtr, úprava ve Web Workeru) neskončí, překryje okno
 * průhlednou vrstvou s kolečkem (po krátké prodlevě, rychlé výpočty nic neukážou) a pohltí vstup z myši
 * i klávesnice – dokument se mezitím nesmí měnit.
 */

let pending = 0;
let overlay: HTMLElement | null = null;
let timer = 0;
const EVENTS = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu'] as const;

const swallow = (e: Event) => {
  e.preventDefault();
  e.stopImmediatePropagation();
};

/** Je rozpracovaný výpočet, na který rozhraní čeká? */
export function isBusy(): boolean {
  return pending > 0;
}

/** Počká na `work` s indikátorem; vrací jeho výsledek. */
export async function withBusy<T>(work: Promise<T>, label = 'Počítám…'): Promise<T> {
  if (pending++ === 0) {
    for (const t of EVENTS) window.addEventListener(t, swallow, { capture: true, passive: false });
    timer = window.setTimeout(() => {
      overlay = h('div', { class: 'busy-overlay' }, h('div', { class: 'busy-box' }, h('span', { class: 'busy-spinner' }), label));
      document.body.append(overlay);
    }, 120);
  }
  try {
    return await work;
  } finally {
    if (--pending === 0) {
      for (const t of EVENTS) window.removeEventListener(t, swallow, { capture: true });
      window.clearTimeout(timer);
      overlay?.remove();
      overlay = null;
    }
  }
}

/** Splní se, až nic nepočítá na pozadí ani na výsledek nečeká rozhraní (testy, automatizace). */
export async function idle(): Promise<void> {
  while (isBusy() || computing()) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
}
