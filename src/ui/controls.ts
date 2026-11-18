import { ChevronDown } from 'lucide';
import { h } from './dom';
import { icon, type IconNode } from './icons';

/*
 * Malé ovládací prvky ve stylu Photopea (lišta voleb, panely).
 * Bez callbacku fungují jen „vizuálně“ – slouží i jako připravené (zatím nefunkční) prvky UI.
 */

export function separator(): HTMLElement {
  return h('span', { class: 'opt-sep' });
}

export function checkbox(label: string, checked = false, onChange?: (value: boolean) => void): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', checked });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'opt-check' }, input, label);
}

export type SelectOption = string | { value: string; label: string };

/** Výběrové pole; položka '-' vloží neaktivní oddělovač. */
export function selectField(
  label: string | null,
  options: SelectOption[],
  value?: string,
  onChange?: (value: string) => void,
): HTMLElement {
  const select = h(
    'select',
    { class: 'opt-select' },
    ...options.map((o) =>
      o === '-'
        ? h('option', { disabled: true }, '──────────')
        : typeof o === 'string'
          ? h('option', { value: o }, o)
          : h('option', { value: o.value }, o.label),
    ),
  );
  if (value !== undefined) select.value = value;
  if (onChange) select.addEventListener('change', () => onChange(select.value));
  return label ? h('label', { class: 'opt-field' }, label, select) : select;
}

export function textField(label: string | null, value: string, width = 48): HTMLElement {
  const input = h('input', { type: 'text', class: 'opt-input', value, style: { width: `${width}px` } });
  return label ? h('label', { class: 'opt-field' }, label, input) : input;
}

export function iconButton(
  node: IconNode,
  title: string,
  onClick?: (e: MouseEvent) => void,
  extraClass = '',
): HTMLButtonElement {
  const btn = h('button', { class: `icon-btn ${extraClass}`.trim(), title, type: 'button' }, icon(node));
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

export function textButton(label: string, onClick?: () => void, title?: string): HTMLButtonElement {
  return h('button', { class: 'text-btn', type: 'button', title, onClick }, label);
}

/** Skupina přepínacích ikon, z nichž je aktivní právě jedna. */
export function segmented(
  items: Array<{ icon: IconNode; title: string }>,
  active = 0,
  onChange?: (index: number) => void,
): HTMLElement {
  const buttons = items.map((item, i) =>
    iconButton(item.icon, item.title, () => {
      buttons.forEach((b, j) => b.classList.toggle('active', j === i));
      onChange?.(i);
    }),
  );
  buttons[active]?.classList.add('active');
  return h('span', { class: 'segmented' }, ...buttons);
}

/** Ikony, které se dají nezávisle zapínat/vypínat (např. zámky vrstvy). */
export function toggleButton(node: IconNode, title: string, active = false, onChange?: (v: boolean) => void): HTMLButtonElement {
  const btn = iconButton(node, title, () => {
    btn.classList.toggle('active');
    onChange?.(btn.classList.contains('active'));
  });
  btn.classList.toggle('active', active);
  return btn;
}

export interface SliderFieldOptions {
  label?: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  /** Průběžná změna (tažení posuvníkem). */
  onInput?(value: number): void;
  /** Potvrzená hodnota (puštění posuvníku, Enter, opuštění pole). */
  onCommit?(value: number): void;
}

let openPopup: { popup: HTMLElement; owner: HTMLElement } | null = null;

document.addEventListener('pointerdown', (e) => {
  if (openPopup && !openPopup.popup.contains(e.target as Node) && !openPopup.owner.contains(e.target as Node)) {
    openPopup.popup.remove();
    openPopup = null;
  }
});

/** Číselné pole s rozbalovacím posuvníkem – „Krytí: [100%] ▾“ jako ve Photopea. */
export class SliderField {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly range: HTMLInputElement;
  private readonly popup: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private value: number;

  constructor(private readonly o: SliderFieldOptions) {
    this.value = o.value;
    this.input = h('input', { type: 'text', class: 'opt-input slider-input' });
    this.range = h('input', { type: 'range', min: String(o.min), max: String(o.max) });
    this.popup = h('div', { class: 'slider-popup' }, this.range);
    this.toggle = h('button', { class: 'slider-toggle', type: 'button', tabIndex: -1 }, icon(ChevronDown, 12, 2.5));

    this.toggle.addEventListener('click', () => this.togglePopup());
    this.range.addEventListener('input', () => {
      this.value = this.range.valueAsNumber;
      this.input.value = this.format(this.value);
      o.onInput?.(this.value);
    });
    this.range.addEventListener('change', () => o.onCommit?.(this.value));

    const commitText = () => {
      const parsed = Number.parseFloat(this.input.value.replace(',', '.'));
      if (!Number.isFinite(parsed)) {
        this.input.value = this.format(this.value);
        return;
      }
      const v = Math.max(o.min, Math.min(o.max, Math.round(parsed)));
      if (v === this.value) {
        this.input.value = this.format(v);
        return;
      }
      this.value = v;
      this.input.value = this.format(v);
      this.range.value = String(v);
      o.onInput?.(v);
      o.onCommit?.(v);
    };
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.input.blur();
      if (e.key === 'Escape') {
        this.input.value = this.format(this.value);
        this.input.blur();
      }
    });
    this.input.addEventListener('blur', commitText);

    this.element = h('span', { class: 'opt-field slider-field' }, o.label ?? null, h('span', { class: 'slider-box' }, this.input, this.toggle));
    this.setValue(o.value);
  }

  private format(v: number): string {
    return `${v}${this.o.unit ?? ''}`;
  }

  private togglePopup(): void {
    if (openPopup?.popup === this.popup) {
      this.popup.remove();
      openPopup = null;
      return;
    }
    openPopup?.popup.remove();
    const r = this.toggle.getBoundingClientRect();
    Object.assign(this.popup.style, { left: `${Math.max(4, r.right - 160)}px`, top: `${r.bottom + 2}px` });
    document.body.append(this.popup);
    openPopup = { popup: this.popup, owner: this.element };
  }

  setValue(v: number): void {
    this.value = v;
    if (document.activeElement !== this.input) this.input.value = this.format(v);
    this.range.value = String(v);
  }

  set disabled(d: boolean) {
    this.input.disabled = d;
    this.toggle.disabled = d;
  }
}
