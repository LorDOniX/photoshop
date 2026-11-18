import { Eye } from 'lucide';
import type { Editor } from '../core/Editor';
import { h } from './dom';
import { icon } from './icons';

const SWATCHES = [
  '#000000', '#1f1f1f', '#3f3f3f', '#5f5f5f', '#7f7f7f', '#9f9f9f', '#bfbfbf', '#dfdfdf', '#ffffff',
  '#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80', '#00ffff', '#0080ff', '#0000ff',
  '#8000ff', '#ff00ff', '#ff0080', '#800000', '#804000', '#808000', '#408000', '#008000', '#008040',
  '#008080', '#004080', '#000080', '#400080', '#800080', '#800040', '#f2c6a0', '#c68e5a', '#8c5a2b',
  '#ffc0c0', '#ffe0c0', '#ffffc0', '#c0ffc0', '#c0ffff', '#c0c0ff', '#ffc0ff', '#e6d2b4', '#b4a078',
];

/** Vzorník – klik nastaví barvu popředí, Alt+klik barvu pozadí. */
export function createSwatchesPanel(editor: Editor): HTMLElement {
  return h(
    'div',
    { class: 'swatches' },
    ...SWATCHES.map((color) =>
      h('button', {
        class: 'swatch-cell',
        type: 'button',
        title: color,
        style: { background: color },
        onClick: (e: MouseEvent) => editor.updateSettings(e.altKey ? { secondaryColor: color } : { color }),
      }),
    ),
  );
}

/** Kanály – zatím jen připravené zobrazení. */
export function createChannelsPanel(): HTMLElement {
  const row = (name: string, shortcut: string) =>
    h(
      'div',
      { class: 'list-row' },
      h('span', { class: 'eye' }, icon(Eye, 14)),
      h('span', { class: 'channel-thumb' }),
      h('span', { class: 'list-name' }, name),
      h('span', { class: 'shortcut' }, shortcut),
    );
  return h(
    'div',
    { class: 'placeholder-panel' },
    row('RGB', 'Ctrl+2'),
    row('Červený', 'Ctrl+3'),
    row('Zelený', 'Ctrl+4'),
    row('Modrý', 'Ctrl+5'),
    h('p', { class: 'muted note' }, 'Kanály – připravujeme'),
  );
}

export function createPathsPanel(): HTMLElement {
  return h('div', { class: 'placeholder-panel' }, h('p', { class: 'muted note' }, 'Žádné cesty – připravujeme'));
}
