import { h } from './dom';

/** Jednoduchý dialog pro jedno číslo (např. Výběr → Upravit → Rozšířit). Vrací null při zrušení. */
export function promptNumber(title: string, label: string, value: number, min = 1, max = 500, unit = 'px'): Promise<number | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'number', min: String(min), max: String(max), value: String(value), required: true });
    const form = h(
      'form',
      { method: 'dialog' },
      h('h2', {}, title),
      h('label', {}, `${label} (${unit})`, input),
      h(
        'div',
        { class: 'dialog-buttons' },
        h('button', { type: 'button', onClick: () => dialog.close('cancel') }, 'Zrušit'),
        h('button', { type: 'submit', class: 'primary' }, 'OK'),
      ),
    );
    const dialog = h('dialog', { class: 'dialog' }, form);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'ok' ? Math.max(min, Math.min(max, input.valueAsNumber)) : null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (form.reportValidity()) dialog.close('ok');
    });
    document.body.append(dialog);
    dialog.showModal();
    input.select();
  });
}

export interface NewDocumentOptions {
  width: number;
  height: number;
  background: string | null;
}

/** Dialog „Nový dokument“. Vrací null při zrušení. */
export function showNewDocumentDialog(defaults: { width: number; height: number }): Promise<NewDocumentOptions | null> {
  return new Promise((resolve) => {
    const width = h('input', { type: 'number', min: '1', max: '16384', value: String(defaults.width), required: true });
    const height = h('input', { type: 'number', min: '1', max: '16384', value: String(defaults.height), required: true });
    const background = h(
      'select',
      {},
      h('option', { value: '#ffffff' }, 'Bílé'),
      h('option', { value: '#000000' }, 'Černé'),
      h('option', { value: '' }, 'Průhledné'),
    );
    const form = h(
      'form',
      { method: 'dialog' },
      h('h2', {}, 'Nový dokument'),
      h('label', {}, 'Šířka (px)', width),
      h('label', {}, 'Výška (px)', height),
      h('label', {}, 'Pozadí', background),
      h(
        'div',
        { class: 'dialog-buttons' },
        h('button', { type: 'button', value: 'cancel', onClick: () => dialog.close('cancel') }, 'Zrušit'),
        h('button', { type: 'submit', value: 'ok', class: 'primary' }, 'Vytvořit'),
      ),
    );
    const dialog = h('dialog', { class: 'dialog' }, form);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (dialog.returnValue !== 'ok') return resolve(null);
      resolve({
        width: Math.round(width.valueAsNumber),
        height: Math.round(height.valueAsNumber),
        background: background.value || null,
      });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (form.reportValidity()) dialog.close('ok');
    });
    document.body.append(dialog);
    dialog.showModal();
    width.select();
  });
}
