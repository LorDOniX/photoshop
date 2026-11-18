import { ArrowLeftRight, Gauge, PenLine, Square, SquaresIntersect, SquaresSubtract, SquaresUnite } from 'lucide';
import { iconButton, segmented, selectField, SliderField, textField, toggleButton } from '../ui/controls';

/*
 * Sdílené (zatím převážně nefunkční) prvky lišty voleb nástrojů – podle Photopea.
 */

export const PAINT_BLEND_MODES = [
  'Normální', 'Rozpustit', '-',
  'Ztmavit', 'Násobit', 'Ztmavit barvy', 'Lineárně ztmavit', 'Tmavší barva', '-',
  'Zesvětlit', 'Závoj', 'Zesvětlit barvy', 'Lineárně zesvětlit', 'Světlejší barva', '-',
  'Překrýt', 'Měkké světlo', 'Tvrdé světlo', 'Jasné světlo', 'Lineární světlo', 'Bodové světlo', 'Tvrdé míchání', '-',
  'Rozdíl', 'Vyloučit', 'Odečíst', 'Dělit', '-',
  'Odstín', 'Sytost', 'Barva', 'Světlost',
];

export const RATIOS = ['Volný', 'Pevný poměr', 'Pevná velikost', 'Původní poměr', '1 : 1', '4 : 3', '3 : 2', '16 : 9'];

export const SAMPLE_SOURCES = ['Aktuální vrstva', 'Aktuální a nižší', 'Všechny vrstvy'];

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
