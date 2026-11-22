import { allPatterns, getPattern, isUserPattern, onPatternsChange, patternCanvas, type PatternDef } from '../core/patterns';
import { removeUserPattern } from '../io/library';
import { confirmDialog, showCustomDialog, showMessage } from './dialogs';
import { h } from './dom';

/*
 * Výběr vzorku: mřížka náhledů (vestavěné, z knihovny a z otevřených souborů). Dvojklik = vybrat a potvrdit.
 * Vzorky z knihovny jde smazat křížkem.
 */

/** CSS pozadí s dlaždicemi vzorku na šachovnici (náhledy). */
export function patternCss(p: PatternDef | undefined): string {
  const checker = 'repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0 / 8px 8px';
  if (!p) return checker;
  const tile = Math.max(p.width, p.height) > 48 ? 'auto 48px' : 'auto';
  return `url(${patternCanvas(p).toDataURL()}) 0 0 / ${tile} repeat, ${checker}`;
}

export function showPatternPicker(current: string): Promise<string | null> {
  let selected = current;
  const grid = h('div', { class: 'pattern-grid' });
  const label = h('div', { class: 'muted pattern-name' });

  const render = () => {
    grid.replaceChildren(
      ...allPatterns().map((p) => {
        const cell = h('button', {
          type: 'button',
          class: `pattern-cell${p.id === selected ? ' selected' : ''}`,
          title: p.name,
          'data-id': p.id,
          onClick: () => {
            selected = p.id;
            render();
          },
        });
        cell.style.background = patternCss(p);
        cell.addEventListener('dblclick', () => (cell.closest('form')?.querySelector('button.primary') as HTMLButtonElement | null)?.click());
        if (isUserPattern(p.id)) {
          const remove = h('span', { class: 'pattern-remove', title: 'Smazat z knihovny' }, '×');
          remove.addEventListener('click', (e) => {
            e.stopPropagation();
            void confirmDialog('Smazat vzorek', `Smazat vzorek „${p.name}“ z knihovny?`).then((ok) => {
              if (!ok) return;
              try {
                removeUserPattern(p.id);
              } catch (err) {
                void showMessage('Knihovna', [(err as Error).message]);
              }
            });
          });
          cell.append(remove);
        }
        return cell;
      }),
    );
    label.textContent = getPattern(selected)?.name ?? 'Vzorek chybí';
  };
  render();
  const unsubscribe = onPatternsChange(render);
  return showCustomDialog('Vzorek', [grid, label], () => selected, 'pattern-picker-form').finally(unsubscribe);
}
