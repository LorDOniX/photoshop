import { ChevronDown } from 'lucide';
import type { Editor } from '../core/Editor';
import type { ToolOptionsUI } from '../tools/Tool';
import { h } from './dom';
import { icon } from './icons';

/** Horní lišta s volbami aktivního nástroje (vlevo ikona nástroje jako ve Photopea). */
export class OptionsBar {
  readonly element: HTMLElement;
  private current: ToolOptionsUI | null = null;

  constructor(editor: Editor) {
    const toolIcon = h('button', { class: 'options-tool', type: 'button', title: 'Předvolby nástroje – připravujeme' });
    const slot = h('div', { class: 'options-slot' });
    this.element = h('div', { class: 'options-bar' }, toolIcon, h('span', { class: 'opt-sep' }), slot);

    const update = () => {
      const tool = editor.activeTool;
      this.current?.dispose?.();
      this.current = tool?.createOptions?.() ?? null;
      toolIcon.replaceChildren(...(tool ? [icon(tool.icon, 18), icon(ChevronDown, 10, 2.5)] : []));
      slot.replaceChildren(...(this.current ? [this.current.element] : []));
    };
    editor.on('tool', update);
    update();
  }
}
