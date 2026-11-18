import { Check, ChevronRight } from 'lucide';
import type { ActionRegistry } from '../core/actions';
import { h } from './dom';
import { icon } from './icons';

/** Položka menu: id akce, '-' (oddělovač) nebo podnabídka. */
export type MenuItem = string | { label: string; items: MenuItem[] };

/** Vykreslí rozbalovací seznam (vč. podnabídek, které se otevírají najetím myší). */
export function renderMenu(actions: ActionRegistry, items: MenuItem[], onDone: () => void): HTMLElement {
  return h(
    'div',
    { class: 'dropdown' },
    ...items.map((item) => {
      if (item === '-') return h('div', { class: 'separator' });
      if (typeof item !== 'string') {
        return h(
          'div',
          { class: 'menu-item submenu' },
          h('span', { class: 'menu-check' }),
          h('span', { class: 'menu-label' }, item.label),
          h('span', { class: 'shortcut' }, icon(ChevronRight, 12, 2)),
          renderMenu(actions, item.items, onDone),
        );
      }
      const action = actions.get(item);
      if (!action) return null;
      return h(
        'button',
        {
          class: 'menu-item',
          type: 'button',
          disabled: !actions.isEnabled(item),
          title: action.placeholder ? 'Připravujeme' : undefined,
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            onDone();
            actions.run(item);
          },
        },
        h('span', { class: 'menu-check' }, action.isChecked?.() ? icon(Check, 12, 2.5) : null),
        h('span', { class: 'menu-label' }, action.label),
        h('span', { class: 'shortcut' }, action.shortcuts?.[0] ?? action.shortcutHint ?? ''),
      );
    }),
  );
}

let openContext: HTMLElement | null = null;

function closeContextMenu(): void {
  openContext?.remove();
  openContext = null;
}

document.addEventListener('pointerdown', (e) => {
  if (openContext && !openContext.contains(e.target as Node)) closeContextMenu();
});
window.addEventListener('blur', closeContextMenu);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeContextMenu();
});

/** Plovoucí menu (pravé tlačítko, nabídka ≡ panelu). */
export function showContextMenu(actions: ActionRegistry, items: MenuItem[], x: number, y: number): void {
  closeContextMenu();
  const menu = renderMenu(actions, items, closeContextMenu);
  menu.classList.add('context-menu');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.append(menu);
  // Nevejde-li se menu do okna, posuneme ho dovnitř.
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
  openContext = menu;
}
