import { Maximize, Search } from 'lucide';
import type { Editor } from '../core/Editor';
import { iconButton } from './controls';
import { h } from './dom';
import { renderMenu, type MenuItem } from './Menu';

export interface MenuDef {
  label: string;
  items: MenuItem[];
}

export class MenuBar {
  readonly element: HTMLElement;
  private open: { button: HTMLElement; dropdown: HTMLElement } | null = null;

  constructor(
    private readonly editor: Editor,
    menus: MenuDef[],
  ) {
    this.element = h('nav', { class: 'menubar' });
    for (const menu of menus) {
      const button = h('button', { class: 'menu-btn', type: 'button' }, menu.label);
      const wrapper = h('div', { class: 'menu' }, button);
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.open?.button === button) this.close();
        else this.show(button, wrapper, menu);
      });
      button.addEventListener('mouseenter', () => {
        if (this.open && this.open.button !== button) this.show(button, wrapper, menu);
      });
      this.element.append(wrapper);
    }

    this.element.append(
      iconButton(Search, 'Hledat – připravujeme', undefined, 'menu-icon'),
      iconButton(Maximize, 'Celá obrazovka', () => editor.actions.run('view.fullscreen'), 'menu-icon'),
      h('span', { class: 'menubar-spacer' }),
      h('span', { class: 'brand' }, 'PhotoshopTS'),
    );

    document.addEventListener('click', () => this.close());
    window.addEventListener('blur', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  private show(button: HTMLElement, wrapper: HTMLElement, menu: MenuDef): void {
    this.close();
    const dropdown = renderMenu(this.editor.actions, menu.items, () => this.close());
    dropdown.addEventListener('click', (e) => e.stopPropagation());
    wrapper.append(dropdown);
    button.classList.add('open');
    this.open = { button, dropdown };
  }

  private close(): void {
    if (!this.open) return;
    this.open.dropdown.remove();
    this.open.button.classList.remove('open');
    this.open = null;
  }
}
