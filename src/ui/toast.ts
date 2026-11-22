import { h } from './dom';

/** Krátké upozornění dole uprostřed okna; zmizí samo (nové nahradí staré). */
let current: HTMLElement | null = null;
let timer = 0;

export function showToast(message: string, ms = 2500): void {
  current?.remove();
  window.clearTimeout(timer);
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  current = el;
  timer = window.setTimeout(() => {
    el.remove();
    if (current === el) current = null;
  }, ms);
}
