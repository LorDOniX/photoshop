import { ArrowLeftRight, CircleDot, Monitor } from 'lucide';
import type { Editor } from '../core/Editor';
import type { Tool } from '../tools/Tool';
import { iconButton } from './controls';
import { h } from './dom';
import { icon } from './icons';

interface Slot {
  tools: Tool[];
  current: Tool;
  button: HTMLButtonElement;
}

const LONG_PRESS_MS = 350;

/**
 * Levý panel nástrojů. Nástroje jsou ve skupinách (jako ve Photopea) – tlačítko ukazuje
 * naposledy použitý nástroj skupiny, pravé tlačítko / podržení rozbalí celou skupinu.
 */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly slots: Slot[] = [];
  private flyout: HTMLElement | null = null;

  constructor(
    private readonly editor: Editor,
    groups: string[][],
  ) {
    for (const ids of groups) {
      const tools = ids.map((id) => editor.tools.get(id)).filter((t): t is Tool => !!t);
      if (!tools.length) continue;
      const button = h('button', { class: `tool-btn${tools.length > 1 ? ' has-group' : ''}`, type: 'button' });
      const slot: Slot = { tools, current: tools[0], button };
      this.slots.push(slot);
      this.renderSlot(slot);

      let timer = 0;
      let longPressed = false;
      button.addEventListener('pointerdown', (e) => {
        longPressed = false;
        if (e.button !== 0 || tools.length < 2) return;
        timer = window.setTimeout(() => {
          longPressed = true;
          this.openFlyout(slot);
        }, LONG_PRESS_MS);
      });
      const cancel = () => clearTimeout(timer);
      button.addEventListener('pointerup', cancel);
      button.addEventListener('pointerleave', cancel);
      button.addEventListener('click', () => {
        if (!longPressed) editor.setTool(slot.current.id);
      });
      button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (tools.length > 1) this.openFlyout(slot);
      });
    }

    document.addEventListener('pointerdown', (e) => {
      if (this.flyout && !this.flyout.contains(e.target as Node)) this.closeFlyout();
    });

    this.element = h(
      'aside',
      { class: 'toolbar' },
      ...this.slots.map((s) => s.button),
      h('div', { class: 'toolbar-sep' }),
      this.createColorWell(),
      iconButton(CircleDot, 'Rychlá maska (Q) – připravujeme', undefined, 'tool-btn'),
      iconButton(Monitor, 'Režim zobrazení (F) – připravujeme', undefined, 'tool-btn'),
    );

    editor.on('tool', (tool) => {
      for (const slot of this.slots) {
        if (slot.tools.includes(tool)) slot.current = tool;
        this.renderSlot(slot);
      }
    });
  }

  private renderSlot(slot: Slot): void {
    const t = slot.current;
    slot.button.replaceChildren(icon(t.icon, 18));
    slot.button.title = `${t.name}${t.shortcut ? ` (${t.shortcut})` : ''}${t.placeholder ? ' – připravujeme' : ''}`;
    slot.button.classList.toggle('active', this.editor.activeTool === t);
  }

  private openFlyout(slot: Slot): void {
    this.closeFlyout();
    const r = slot.button.getBoundingClientRect();
    this.flyout = h(
      'div',
      { class: 'flyout', style: { left: `${r.right + 2}px`, top: `${r.top}px` } },
      ...slot.tools.map((tool) =>
        h(
          'button',
          {
            class: `flyout-item${tool === slot.current ? ' current' : ''}`,
            type: 'button',
            onClick: () => {
              this.closeFlyout();
              this.editor.setTool(tool.id);
            },
          },
          icon(tool.icon, 16),
          h('span', { class: 'flyout-name' }, tool.name),
          h('span', { class: 'shortcut' }, tool.shortcut ?? ''),
        ),
      ),
    );
    document.body.append(this.flyout);
  }

  private closeFlyout(): void {
    this.flyout?.remove();
    this.flyout = null;
  }

  /** Barva popředí / pozadí, prohození (X) a výchozí barvy (D). */
  private createColorWell(): HTMLElement {
    const { editor } = this;
    const pickFg = h('input', { type: 'color', class: 'hidden-input', tabIndex: -1 });
    const pickBg = h('input', { type: 'color', class: 'hidden-input', tabIndex: -1 });
    pickFg.addEventListener('input', () => editor.updateSettings({ color: pickFg.value }));
    pickBg.addEventListener('input', () => editor.updateSettings({ secondaryColor: pickBg.value }));

    const fg = h('button', { class: 'swatch fg', type: 'button', title: 'Barva popředí', onClick: () => pickFg.click() });
    const bg = h('button', { class: 'swatch bg', type: 'button', title: 'Barva pozadí', onClick: () => pickBg.click() });
    const swap = h(
      'button',
      { class: 'swap', type: 'button', title: 'Prohodit barvy (X)', onClick: () => editor.actions.run('color.swap') },
      icon(ArrowLeftRight, 9, 2.5),
    );
    const reset = h('button', {
      class: 'reset',
      type: 'button',
      title: 'Výchozí barvy (D)',
      onClick: () => editor.actions.run('color.reset'),
    });

    const sync = () => {
      fg.style.background = pickFg.value = editor.settings.color;
      bg.style.background = pickBg.value = editor.settings.secondaryColor;
    };
    editor.on('settings', sync);
    sync();
    return h('div', { class: 'color-well' }, bg, fg, swap, reset, pickFg, pickBg);
  }
}
