import type { Editor } from '../core/Editor';
import { h, rafThrottle } from './dom';

/** Paměť v MB pro zobrazení. */
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

export class HistoryPanel {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  /** Paměť, kterou historie drží, a limit (Úpravy → Předvolby). */
  private readonly footer: HTMLElement;

  constructor(private readonly editor: Editor) {
    this.list = h('div', { class: 'history-list' });
    this.footer = h('div', { class: 'history-footer', title: 'Kroky historie drží kopie pixelů. Nad limitem se zahazují nejstarší (Úpravy → Předvolby).' });
    this.element = h('div', { class: 'history-panel' }, this.list, this.footer);
    const render = rafThrottle(() => this.render());
    editor.on('history', render);
    this.render();
  }

  private render(): void {
    const { history } = this.editor;
    const n = history.dropped;
    const dropped = n === 1 ? '1 starší krok zahozen' : n < 5 ? `${n} starší kroky zahozeny` : `${n} starších kroků zahozeno`;
    const first = n ? `Nejstarší uložený stav (${dropped})` : 'Výchozí stav';
    const labels = [first, ...history.entries.map((c) => c.label)];
    const limit = Number.isFinite(history.memoryLimit) ? ` z ${mb(history.memoryLimit)}` : '';
    this.footer.textContent = `Paměť historie: ${mb(history.memory)}${limit}`;
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
