import { ArrowLeftRight, Gauge, PenLine, Square, SquaresIntersect, SquaresSubtract, SquaresUnite } from 'lucide';
import { BLEND_MODES, type BlendMode } from '../core/Layer';
import { iconButton, segmented, selectField, SliderField, textField, toggleButton, type SelectOption } from '../ui/controls';

/*
 * Sdílené (zatím převážně nefunkční) prvky lišty voleb nástrojů – podle Photopea.
 */

export const RATIOS = ['Volný', 'Pevný poměr', 'Pevná velikost', 'Původní poměr', '1 : 1', '4 : 3', '3 : 2', '16 : 9'];

export const selectionModes = () =>
  segmented([
    { icon: Square, title: 'Nahradit výběr' },
    { icon: SquaresUnite, title: 'Sjednotit (Shift)' },
    { icon: SquaresSubtract, title: 'Odečíst (Alt)' },
    { icon: SquaresIntersect, title: 'Průnik' },
  ]);

export const slider = (label: string, value: number, max = 100, unit = '%', min = 0) =>
  new SliderField({ label, value, min, max, unit }).element;

export const pressureToggles = () => [
  toggleButton(Gauge, 'Tlak pera ovládá krytí'),
  toggleButton(PenLine, 'Tlak pera ovládá velikost'),
];

/** „Š: [ ] ⇄ V: [ ]“ */
export const sizeFields = () => [textField('Š:', '0', 44), iconButton(ArrowLeftRight, 'Prohodit šířku a výšku'), textField('V:', '0', 44)];

export const ratioFields = () => [selectField(null, RATIOS), ...sizeFields()];

/** Výběr režimu prolnutí pro funkční nástroje (jen režimy, které umí Canvas 2D – stejné jako u vrstev). */
export function blendModeSelect(value: BlendMode, onChange: (mode: BlendMode) => void): HTMLElement {
  const options: SelectOption[] = [];
  let group = 0;
  for (const m of BLEND_MODES) {
    if (m.group !== group) {
      options.push('-');
      group = m.group;
    }
    options.push({ value: m.value, label: m.label });
  }
  return selectField('Režim prolnutí:', options, value, (v) => onChange(v as BlendMode));
}

/** Posuvník krytí 1..100 % pro funkční nástroje (hodnota 0..1). */
export function opacitySlider(value: number, onChange: (opacity: number) => void): HTMLElement {
  return new SliderField({ label: 'Krytí:', value: Math.round(value * 100), min: 1, max: 100, unit: '%', onInput: (v) => onChange(v / 100) }).element;
}
