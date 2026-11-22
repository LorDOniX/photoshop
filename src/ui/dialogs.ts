import { gradientCss, type GradientDef } from '../core/paint/gradient';
import { getPattern } from '../core/patterns';
import { h } from './dom';
import { showGradientEditor } from './gradientEditor';
import { patternCss, showPatternPicker } from './patternPicker';

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

/**
 * Dialog s vlastním obsahem a tlačítky Zrušit / OK. `result` se zavolá při potvrzení; vrací výsledek nebo null
 * při zrušení.
 */
export function showCustomDialog<T>(title: string, body: HTMLElement[], result: () => T, className = ''): Promise<T | null> {
  return new Promise((resolve) => {
    let control: DialogControl | null = null;
    const form = h('form', { class: className }, h('h2', {}, title), ...body, dialogButtons(() => control!));
    control = mountDialog(form, (ok) => resolve(ok ? result() : null));
  });
}

export type FormValue = number | string | boolean;

export type FormField =
  /** `slider` = pod polem posuvník (vyžaduje min a max). */
  | { kind: 'number'; key: string; label: string; value: number; min?: number; max?: number; step?: number; unit?: string; slider?: boolean }
  | { kind: 'select'; key: string; label: string; value: string; options: Array<{ value: string; label: string }> }
  /** `strong` = zaškrtávací nadpis sekce (např. zapnutí efektu). */
  | { kind: 'checkbox'; key: string; label: string; value: boolean; strong?: boolean }
  | { kind: 'color'; key: string; label: string; value: string }
  | { kind: 'text'; key: string; label: string; value: string; required?: boolean }
  /** Vzorek – hodnota je id vzorku (core/patterns.ts), klik otevře výběr vzorků. */
  | { kind: 'pattern'; key: string; label: string; value: string }
  /** Přechod – hodnota ve formuláři je JSON `GradientDef`, klik otevře editor přechodů. */
  | { kind: 'gradient'; key: string; label: string; value: GradientDef; fg: string; bg: string }
  /** Kotva 3 × 3 (0 = vlevo nahoře … 8 = vpravo dole). */
  | { kind: 'anchor'; key: string; label: string; value: number }
  | { kind: 'note'; key: string; label: string }
  /** Vlastní prvek (histogram, editor křivky…) – nemá hodnotu. */
  | { kind: 'element'; key: string; element: HTMLElement };

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
    const state = formState(onChange);
    const rows = fields.map((f) => fieldRow(f, state));
    let control: DialogControl | null = null;
    const form = h('form', {}, h('h2', {}, title), ...rows, dialogButtons(() => control!));
    control = mountDialog(form, (ok) => resolve(ok ? state.values : null));
    onChange?.('', state.access);
    form.querySelector('input')?.select();
  });
}

/** Sekce formuláře se zapínáním (např. jeden efekt ve Stylu vrstvy). Zaškrtávátko má klíč `key`. */
export interface FormSection {
  key: string;
  label: string;
  enabled: boolean;
  fields: FormField[];
}

/**
 * Formulář se sekcemi: vlevo seznam sekcí se zaškrtávátky, vpravo pole vybrané sekce (jako Styl vrstvy
 * ve Photoshopu). Hodnoty a `onChange` stejně jako u `showForm`.
 */
export function showSectionedForm(
  title: string,
  sections: FormSection[],
  onChange?: (key: string, form: FormAccess) => void,
  initial = sections.find((s) => s.enabled)?.key ?? sections[0]?.key,
): Promise<Record<string, FormValue> | null> {
  return new Promise((resolve) => {
    const state = formState(onChange);
    const items: HTMLElement[] = [];
    const panes: HTMLElement[] = [];
    const select = (key: string) => {
      sections.forEach((sec, i) => {
        items[i].classList.toggle('active', sec.key === key);
        panes[i].hidden = sec.key !== key;
      });
    };
    for (const sec of sections) {
      const check = fieldRow({ kind: 'checkbox', key: sec.key, label: '', value: sec.enabled }, state) as HTMLLabelElement;
      const item = h('div', { class: 'section-item', 'data-section': sec.key, onClick: () => select(sec.key) }, check, h('span', {}, sec.label));
      items.push(item);
      panes.push(h('div', { class: 'section-pane', 'data-section': sec.key }, h('h3', {}, sec.label), ...sec.fields.map((f) => fieldRow(f, state))));
    }
    let control: DialogControl | null = null;
    const form = h(
      'form',
      { class: 'sectioned' },
      h('h2', {}, title),
      h('div', { class: 'section-layout' }, h('div', { class: 'section-list' }, ...items), h('div', { class: 'section-panes' }, ...panes)),
      dialogButtons(() => control!),
    );
    if (initial) select(initial);
    control = mountDialog(form, (ok) => resolve(ok ? state.values : null));
    onChange?.('', state.access);
  });
}

interface FormState {
  values: Record<string, FormValue>;
  setters: Record<string, (v: FormValue) => void>;
  access: FormAccess;
  changed(key: string): void;
}

function formState(onChange?: (key: string, form: FormAccess) => void): FormState {
  const values: Record<string, FormValue> = {};
  const setters: Record<string, (v: FormValue) => void> = {};
  const access: FormAccess = {
    get: (k) => values[k],
    set: (k, v) => {
      values[k] = v;
      setters[k]?.(v);
    },
  };
  return { values, setters, access, changed: (key) => onChange?.(key, access) };
}

/** Jeden řádek formuláře (pole + popisek). */
function fieldRow(f: FormField, { values, setters, changed }: FormState): HTMLElement {
  if (f.kind === 'note') return h('div', { class: 'dialog-note' }, h('span', { class: 'muted' }, f.label));
  if (f.kind === 'element') return f.element;
  values[f.key] = f.kind === 'gradient' ? JSON.stringify(f.value) : f.value;
  if (f.kind === 'number') {
    const input = h('input', { type: 'number', value: String(f.value), min: f.min ?? '', max: f.max ?? '', step: f.step ?? 'any' });
    input.addEventListener('input', () => {
      if (Number.isFinite(input.valueAsNumber)) {
        values[f.key] = input.valueAsNumber;
        changed(f.key);
      }
    });
    setters[f.key] = (v) => (input.value = String(Math.round(Number(v) * 100) / 100));
    const field = h('label', {}, f.label, h('span', { class: 'dialog-input' }, input, f.unit ? h('span', { class: 'muted' }, f.unit) : null));
    if (!f.slider) return field;
    const range = h('input', { type: 'range', class: 'dialog-range', value: String(f.value), min: f.min ?? 0, max: f.max ?? 100, step: f.step ?? 1, tabIndex: -1 });
    range.addEventListener('input', () => {
      input.value = range.value;
      values[f.key] = range.valueAsNumber;
      changed(f.key);
    });
    input.addEventListener('input', () => (range.value = input.value));
    const setNumber = setters[f.key];
    setters[f.key] = (v) => {
      setNumber(v);
      range.value = String(v);
    };
    // Dvojklik na posuvník vrátí výchozí hodnotu pole.
    range.addEventListener('dblclick', () => {
      setters[f.key](f.value);
      values[f.key] = f.value;
      changed(f.key);
    });
    return h('div', { class: 'dialog-slider' }, field, range);
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
    return h('label', { class: `dialog-check${f.strong ? ' dialog-section' : ''}` }, input, f.label);
  }
  if (f.kind === 'text') {
    const input = h('input', { type: 'text', value: f.value, class: 'opt-input dialog-text', required: !!f.required });
    input.addEventListener('input', () => {
      values[f.key] = input.value;
      changed(f.key);
    });
    setters[f.key] = (v) => (input.value = String(v));
    return h('label', {}, f.label, input);
  }
  if (f.kind === 'pattern') {
    const swatch = h('span', { class: 'gradient-swatch-fill' });
    const paint = () => {
      swatch.style.background = patternCss(getPattern(String(values[f.key])));
      button.title = `${getPattern(String(values[f.key]))?.name ?? 'Vzorek chybí'} – vybrat vzorek…`;
    };
    const button = h(
      'button',
      {
        type: 'button',
        class: 'gradient-swatch pattern-swatch',
        onClick: async () => {
          const id = await showPatternPicker(String(values[f.key]));
          if (id === null) return;
          values[f.key] = id;
          paint();
          changed(f.key);
        },
      },
      swatch,
    );
    paint();
    setters[f.key] = (v) => {
      values[f.key] = v;
      paint();
    };
    return h('label', {}, f.label, button);
  }
  if (f.kind === 'gradient') {
    const swatch = h('span', { class: 'gradient-swatch-fill' });
    const paint = () => (swatch.style.background = gradientCss(JSON.parse(String(values[f.key])) as GradientDef));
    paint();
    const button = h(
      'button',
      {
        type: 'button',
        class: 'gradient-swatch',
        title: 'Upravit přechod…',
        onClick: async () => {
          const def = await showGradientEditor(JSON.parse(String(values[f.key])) as GradientDef, f.fg, f.bg);
          if (!def) return;
          values[f.key] = JSON.stringify(def);
          paint();
          changed(f.key);
        },
      },
      swatch,
    );
    setters[f.key] = (v) => {
      values[f.key] = v;
      paint();
    };
    return h('label', {}, f.label, button);
  }
  if (f.kind === 'color') {
    const input = h('input', { type: 'color', value: f.value, class: 'color-input' });
    input.addEventListener('input', () => {
      values[f.key] = input.value;
      changed(f.key);
    });
    setters[f.key] = (v) => (input.value = String(v));
    return h('label', {}, f.label, input);
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

/** Informační okno se seznamem řádků (např. upozornění po otevření souboru). */
export async function showMessage(title: string, lines: readonly string[]): Promise<void> {
  const shown = lines.slice(0, 12);
  if (lines.length > shown.length) shown.push(`… a dalších ${lines.length - shown.length}`);
  const closed = showForm(title, shown.map((label, i) => ({ kind: 'note' as const, key: `l${i}`, label })));
  // Jen informace – tlačítko Zrušit nemá smysl (Esc dialog zavře stejně).
  document.querySelector('dialog[open] .dialog-buttons button:not(.primary)')?.remove();
  await closed;
}
