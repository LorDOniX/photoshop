import type { Editor } from '../core/Editor';
import { h, rafThrottle } from './dom';

export class HistoryPanel {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;

  constructor(private readonly editor: Editor) {
    this.list = h('div', { class: 'history-list' });
    this.element = this.list;
    const render = rafThrottle(() => this.render());
    editor.on('history', render);
    this.render();
  }

  private render(): void {
    const { history } = this.editor;
    const labels = ['Výchozí stav', ...history.entries.map((c) => c.label)];
    const rows = labels.map((label, i) =>
      h(
        'div',
        {
          class: `history-row${i === history.position ? ' current' : ''}${i > history.position ? ' future' : ''}`,
          onClick: () => history.goTo(i),
        },
        label,
      ),
    );
    this.list.replaceChildren(...rows);
    rows[history.position]?.scrollIntoView({ block: 'nearest' });
  }
}
