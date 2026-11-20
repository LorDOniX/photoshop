import { h } from './dom';

interface DialogControl {
  ok(): void;
  cancel(): void;
}

/**
 * Zobrazí modální dialog s formulářem. Potvrzení (OK / Enter) i zrušení (Zrušit / Esc) se dokončí přímo –
 * nespoléháme na odeslání formuláře ani na asynchronní událost `close`, které některé vložené prohlížeče
 * (sandbox, stránka na pozadí) nedoručí.
 */
function mountDialog(form: HTMLFormElement, onFinish: (ok: boolean) => void): DialogControl {
  const dialog = h('dialog', { class: 'dialog' }, form);
  let done = false;
  const finish = (ok: boolean) => {
    if (done || (ok && !form.reportValidity())) return;
    done = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    onFinish(ok);
  };
  dialog.addEventListener('close', () => finish(false));
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      finish(true);
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  return { ok: () => finish(true), cancel: () => finish(false) };
}

function dialogButtons(control: () => DialogControl, okLabel = 'OK'): HTMLElement {
  return h(
    'div',
    { class: 'dialog-buttons' },
    h('button', { type: 'button', onClick: () => control().cancel() }, 'Zrušit'),
    h('button', { type: 'button', class: 'primary', onClick: () => control().ok() }, okLabel),
  );
}

export type FormValue = number | string | boolean;

export type FormField =
  | { kind: 'number'; key: string; label: string; value: number; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'select'; key: string; label: string; value: string; options: Array<{ value: string; label: string }> }
  | { kind: 'checkbox'; key: string; label: string; value: boolean }
  /** Kotva 3 × 3 (0 = vlevo nahoře … 8 = vpravo dole). */
  | { kind: 'anchor'; key: string; label: string; value: number }
  | { kind: 'note'; key: string; label: string };

export interface FormAccess {
  get(key: string): FormValue;
  set(key: string, value: FormValue): void;
}

/**
 * Obecný formulářový dialog. `onChange` dostane klíč změněného pole a přístup k ostatním polím
 * (propojení šířky a výšky apod.). Vrací hodnoty nebo null při zrušení.
 */
export function showForm(
  title: string,
  fields: FormField[],
  onChange?: (key: string, form: FormAccess) => void,
): Promise<Record<string, FormValue> | null> {
  return new Promise((resolve) => {
    const values: Record<string, FormValue> = {};
    const setters: Record<string, (v: FormValue) => void> = {};
    const access: FormAccess = {
      get: (k) => values[k],
      set: (k, v) => {
        values[k] = v;
        setters[k]?.(v);
      },
    };
    const changed = (key: string) => onChange?.(key, access);

    const rows = fields.map((f) => {
      if (f.kind === 'note') return h('div', { class: 'dialog-note' }, h('span', { class: 'muted' }, f.label));
      values[f.key] = f.value;
      if (f.kind === 'number') {
        const input = h('input', { type: 'number', value: String(f.value), min: f.min ?? '', max: f.max ?? '', step: f.step ?? 'any' });
        input.addEventListener('input', () => {
          if (Number.isFinite(input.valueAsNumber)) {
            values[f.key] = input.valueAsNumber;
            changed(f.key);
          }
        });
        setters[f.key] = (v) => (input.value = String(Math.round(Number(v) * 100) / 100));
        return h('label', {}, f.label, h('span', { class: 'dialog-input' }, input, f.unit ? h('span', { class: 'muted' }, f.unit) : null));
      }
      if (f.kind === 'select') {
        const select = h('select', {}, ...f.options.map((o) => h('option', { value: o.value }, o.label)));
        select.value = f.value;
        select.addEventListener('change', () => {
          values[f.key] = select.value;
          changed(f.key);
        });
        setters[f.key] = (v) => (select.value = String(v));
        return h('label', {}, f.label, select);
      }
      if (f.kind === 'checkbox') {
        const input = h('input', { type: 'checkbox', checked: f.value });
        input.addEventListener('change', () => {
          values[f.key] = input.checked;
          changed(f.key);
        });
        setters[f.key] = (v) => (input.checked = Boolean(v));
        return h('label', { class: 'dialog-check' }, input, f.label);
      }
      const cells = Array.from({ length: 9 }, (_, i) =>
        h('button', {
          type: 'button',
          class: `anchor-cell${i === f.value ? ' active' : ''}`,
          onClick: () => {
            values[f.key] = i;
            cells.forEach((c, j) => c.classList.toggle('active', j === i));
            changed(f.key);
          },
        }),
      );
      return h('div', { class: 'dialog-row' }, h('span', {}, f.label), h('span', { class: 'anchor-grid' }, ...cells));
    });

    let control: DialogControl | null = null;
    const form = h('form', {}, h('h2', {}, title), ...rows, dialogButtons(() => control!));
    control = mountDialog(form, (ok) => resolve(ok ? values : null));
    onChange?.('', access);
    form.querySelector('input')?.select();
  });
}

/** Jednoduchý dialog pro jedno číslo (např. Výběr → Upravit → Rozšířit). Vrací null při zrušení. */
export function promptNumber(title: string, label: string, value: number, min = 1, max = 500, unit = 'px'): Promise<number | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'number', min: String(min), max: String(max), value: String(value), required: true });
    let control: DialogControl | null = null;
    const form = h('form', {}, h('h2', {}, title), h('label', {}, `${label} (${unit})`, input), dialogButtons(() => control!));
    control = mountDialog(form, (ok) => resolve(ok ? Math.max(min, Math.min(max, input.valueAsNumber)) : null));
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
    let control: DialogControl | null = null;
    const form = h(
      'form',
      {},
      h('h2', {}, 'Nový dokument'),
      h('label', {}, 'Šířka (px)', width),
      h('label', {}, 'Výška (px)', height),
      h('label', {}, 'Pozadí', background),
      dialogButtons(() => control!, 'Vytvořit'),
    );
    control = mountDialog(form, (ok) =>
      resolve(
        ok
          ? { width: Math.round(width.valueAsNumber), height: Math.round(height.valueAsNumber), background: background.value || null }
          : null,
      ),
    );
    width.select();
  });
}

/** Potvrzovací dialog (OK / Zrušit) ve stylu aplikace. */
export async function confirmDialog(title: string, message: string): Promise<boolean> {
  return (await showForm(title, [{ kind: 'note', key: 'message', label: message }])) !== null;
}
