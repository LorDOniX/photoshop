import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Circle,
  Contrast,
  Eye,
  Frame,
  Minus,
  MousePointer2,
  PenLine,
  PenTool,
  Pentagon,
  Plus,
  Pointer,
  RotateCw,
  Scissors,
  Shapes,
  Slash,
  Spline,
  Square,
  SquareDashedMousePointer,
  Triangle,
  Type,
  X,
  Check,
} from 'lucide';
import { checkbox, iconButton, segmented, selectField, separator, SliderField, textButton, textField } from '../ui/controls';
import { h } from '../ui/dom';
import type { IconNode } from '../ui/icons';
import { ratioFields, selectionModes, sizeFields, slider } from './optionParts';
import type { Tool, ToolOptionsUI } from './Tool';

/** Nástroj, který je zatím jen připravený v UI – dá se vybrat a zobrazí volby, ale nic nedělá. */
export class PlaceholderTool implements Tool {
  readonly placeholder = true;
  readonly cursor = 'default';

  constructor(
    readonly id: string,
    readonly name: string,
    readonly icon: IconNode,
    readonly shortcut: string | undefined,
    private readonly options: () => Node[] = () => [],
  ) {}

  createOptions(): ToolOptionsUI {
    return {
      element: h('div', { class: 'tool-options' }, ...this.options(), h('span', { class: 'todo-badge' }, 'Připravujeme')),
    };
  }
}

// ---- volby podle lišt Photopea ----

const sliceOptions = () => [selectField('Styl:', ['Normální', 'Pevný poměr', 'Pevná velikost']), textButton('Řezy z vodítek')];







const textOptions = () => [
  selectField(null, ['DejaVu Sans', 'Arial', 'Roboto', 'Open Sans', 'Times New Roman', 'Courier New']),
  selectField(null, ['Book', 'Bold', 'Italic', 'Bold Italic']),
  new SliderField({ label: 'Velikost:', value: 24, min: 1, max: 999, unit: ' px' }).element,
  h('span', { class: 'color-chip', title: 'Barva textu' }),
  textButton('…', undefined, 'Další volby textu'),
  segmented([
    { icon: AlignLeft, title: 'Zarovnat vlevo' },
    { icon: AlignCenter, title: 'Zarovnat na střed' },
    { icon: AlignRight, title: 'Zarovnat vpravo' },
  ]),
  selectField('Aa:', ['Žádné', 'Ostré', 'Výrazné', 'Silné', 'Hladké'], 'Ostré'),
  textButton('Deformace'),
  separator(),
  iconButton(X, 'Zrušit'),
  iconButton(Check, 'Potvrdit'),
];

const shapeOps = () => selectField(null, ['Nová vrstva', 'Sjednotit', 'Odečíst', 'Průnik', 'Vyloučit', 'Sloučit']);

const penOptions = () => [
  selectField(null, ['Tvar', 'Cesta', 'Pixely'], 'Cesta'),
  h('span', { class: 'muted' }, 'Vytvořit:'),
  textButton('Výběr'),
  textButton('Tvar'),
  shapeOps(),
  checkbox('Automaticky přidat / odebrat', true),
];

const pathSelectOptions = () => [
  h('span', { class: 'muted' }, 'Výplň:'),
  h('span', { class: 'color-chip' }),
  h('span', { class: 'muted' }, 'Obrys:'),
  h('span', { class: 'color-chip empty' }),
  textField(null, '1 px', 44),
  textButton('Zjednodušit'),
  shapeOps(),
];

const shapeOptions = (extra: () => Node[] = () => []) => () => [
  selectField(null, ['Tvar', 'Cesta', 'Pixely']),
  h('span', { class: 'muted' }, 'Výplň:'),
  h('span', { class: 'color-chip' }),
  h('span', { class: 'muted' }, 'Obrys:'),
  h('span', { class: 'color-chip empty' }),
  textField(null, '1 px', 44),
  shapeOps(),
  ...ratioFields(),
  ...extra(),
];

const rotateViewOptions = () => [slider('Úhel otočení:', 0, 180, '°', -180), textButton('Obnovit zobrazení')];

/**
 * Připravené nástroje (zatím bez funkce). Názvy a skupiny odpovídají Photopea,
 * pořadí skupin v liště určuje `TOOLBAR_GROUPS` v main.ts.
 */
export function createPlaceholderTools(): Tool[] {
  const t = (id: string, name: string, icon: IconNode, shortcut: string | undefined, options?: () => Node[]) =>
    new PlaceholderTool(id, name, icon, shortcut, options);
  return [
    t('artboard', 'Kreslicí plátno', Frame, 'V', () => [textButton('Přidat plátno')]),
    t('object-select', 'Výběr objektu', SquareDashedMousePointer, 'W', () => [selectionModes(), separator(), selectField('Režim:', ['Obdélník', 'Laso'])]),
    t('crop-perspective', 'Perspektivní oříznutí', Triangle, 'C', () => [...sizeFields(), iconButton(X, 'Zrušit'), iconButton(Check, 'Potvrdit')]),
    t('slice', 'Řez', Scissors, 'C', sliceOptions),
    t('slice-select', 'Výběr řezu', Pointer, 'C', () => [textButton('Rozdělit…')]),
    t('text-vertical', 'Svislý text', Type, 'T', textOptions),
    t('pen', 'Pero', PenTool, 'P', penOptions),
    t('pen-free', 'Volné pero', PenLine, 'P', penOptions),
    t('pen-curvature', 'Křivkové pero', Spline, 'P', penOptions),
    t('anchor-add', 'Přidat kotevní bod', Plus, 'P'),
    t('anchor-delete', 'Odstranit kotevní bod', Minus, 'P'),
    t('anchor-convert', 'Převést bod', Contrast, 'P'),
    t('path-select', 'Výběr cesty', MousePointer2, 'A', pathSelectOptions),
    t('direct-select', 'Přímý výběr', Eye, 'A', pathSelectOptions),
    t('shape-rect', 'Obdélník', Square, 'U', shapeOptions(() => [textField('Poloměr rohu:', '0 px', 48)])),
    t('shape-ellipse', 'Elipsa', Circle, 'U', shapeOptions()),
    t('shape-line', 'Čára', Slash, 'U', shapeOptions(() => [textField('Tloušťka:', '1 px', 48)])),
    t('shape-polygon', 'Parametrický tvar', Pentagon, 'U', shapeOptions(() => [textField('Strany:', '5', 36)])),
    t('shape-custom', 'Vlastní tvar', Shapes, 'U', shapeOptions(() => [selectField('Tvar:', ['Šipka', 'Srdce', 'Hvězda'])])),
    t('rotate-view', 'Otočení zobrazení', RotateCw, 'R', rotateViewOptions),
  ];
}
