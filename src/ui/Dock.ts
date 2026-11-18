import { Menu } from 'lucide';
import type { ActionRegistry } from '../core/actions';
import { iconButton } from './controls';
import { h } from './dom';
import { icon, type IconNode } from './icons';
import { showContextMenu, type MenuItem } from './Menu';

export interface PanelTab {
  id: string;
  title: string;
  element: HTMLElement;
  /** Položky nabídky ≡ pro tuto záložku. */
  menu?: MenuItem[];
}

/** Skupina panelů se záložkami (např. Vrstvy | Kanály | Cesty). */
export class TabbedPanel {
  readonly element: HTMLElement;
  private readonly tabs: Array<PanelTab & { button: HTMLButtonElement }>;
  private readonly body: HTMLElement;
  private active: PanelTab;

  constructor(actions: ActionRegistry, tabs: PanelTab[]) {
    this.body = h('div', { class: 'panel-body' });
    this.tabs = tabs.map((t) => ({
      ...t,
      button: h('button', { class: 'panel-tab', type: 'button', onClick: () => this.show(t.id) }, t.title),
    }));
    this.active = tabs[0];
    const menuButton = iconButton(Menu, 'Nabídka panelu', () => {
      const r = menuButton.getBoundingClientRect();
      if (this.active.menu?.length) showContextMenu(actions, this.active.menu, r.left, r.bottom + 2);
    }, 'panel-menu');
    this.element = h(
      'section',
      { class: 'panel' },
      h(
        'header',
        { class: 'panel-header' },
        ...this.tabs.map((t) => t.button),
        h('span', { class: 'panel-header-spacer' }),
        menuButton,
      ),
      this.body,
    );
    this.show(tabs[0].id);
  }

  has(id: string): boolean {
    return this.tabs.some((t) => t.id === id);
  }

  show(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.active = tab;
    for (const t of this.tabs) t.button.classList.toggle('active', t === tab);
    this.body.replaceChildren(tab.element);
  }
}

export interface DockIcon {
  icon: IconNode | string;
  title: string;
}

/** Pravý dok: sloupec ikon sbalených panelů + sloupec panelů se záložkami. */
export class Dock {
  readonly element: HTMLElement;

  constructor(
    iconGroups: DockIcon[][],
    private readonly panels: TabbedPanel[],
  ) {
    const iconColumn = h(
      'div',
      { class: 'dock-icons' },
      ...iconGroups.map((group) =>
        h(
          'div',
          { class: 'dock-icon-group' },
          ...group.map((item) =>
            h(
              'button',
              { class: 'dock-icon', type: 'button', title: `${item.title} – připravujeme` },
              typeof item.icon === 'string' ? h('span', { class: 'dock-icon-text' }, item.icon) : icon(item.icon, 18),
            ),
          ),
        ),
      ),
    );
    this.element = h('div', { class: 'dock' }, iconColumn, h('div', { class: 'dock-panels' }, ...panels.map((p) => p.element)));
  }

  /** Zobrazí panel podle id (např. z menu Okno). */
  showPanel(id: string): void {
    this.panels.find((p) => p.has(id))?.show(id);
  }
}
