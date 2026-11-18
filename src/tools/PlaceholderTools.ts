import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bandage,
  Blend,
  Circle,
  Contrast,
  Crop,
  Crosshair,
  Droplet,
  Eraser,
  Eye,
  Frame,
  Highlighter,
  Minus,
  MousePointer2,
  PaintBucket,
  PenLine,
  PenTool,
  Pencil,
  Pentagon,
  Pipette,
  Plus,
  Pointer,
  Replace,
  RotateCw,
  Ruler,
  Scissors,
  ScanEye,
  Shapes,
  Slash,
  Sparkles,
  Spline,
  SprayCan,
  Square,
  SquareDashedMousePointer,
  Stamp,
  Sun,
  Moon,
  Triangle,
  Type,
  WandSparkles,
  Waves,
  X,
  Check,
} from 'lucide';
import { checkbox, iconButton, segmented, selectField, separator, SliderField, textButton, textField } from '../ui/controls';
import { h } from '../ui/dom';
import type { IconNode } from '../ui/icons';
import { PAINT_BLEND_MODES, pressureToggles, ratioFields, SAMPLE_SOURCES, selectionModes, sizeFields, slider } from './optionParts';
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

const cropOptions = () => [
  ...ratioFields(),
  separator(),
  textButton('Narovnat'),
  checkbox('Smazat oříznuté pixely', true),
  checkbox('Obsahově závislé'),
  separator(),
  iconButton(X, 'Zrušit'),
  iconButton(Check, 'Potvrdit'),
];

const sliceOptions = () => [selectField('Styl:', ['Normální', 'Pevný poměr', 'Pevná velikost']), textButton('Řezy z vodítek')];

const eyedropperOptions = () => [
  selectField('Velikost vzorku:', ['1 × 1', '3 × 3', '5 × 5', '11 × 11', '31 × 31']),
  selectField('Zdroj:', SAMPLE_SOURCES),
  checkbox('Vzorkovací kroužek', true),
];

const brushPreset = () => slider('Štětec:', 20, 500, ' px', 1);

const healingOptions = () => [brushPreset(), selectField('Zdroj:', SAMPLE_SOURCES), ...pressureToggles(), checkbox('Retušovat výběr')];

const patchOptions = () => [selectionModes(), separator(), selectField('Záplata:', ['Zdroj', 'Cíl']), checkbox('Průhledné')];

const pencilOptions = () => [
  brushPreset(),
  selectField('Režim prolnutí:', PAINT_BLEND_MODES),
  slider('Krytí:', 100),
  checkbox('Automatické mazání'),
  ...pressureToggles(),
];

const colorReplaceOptions = () => [
  brushPreset(),
  selectField('Režim:', ['Odstín', 'Sytost', 'Barva', 'Světlost']),
  selectField('Omezení:', ['Souvislé', 'Nesouvislé']),
  slider('Tolerance:', 30),
  checkbox('Vyhlazování', true),
];

const cloneOptions = () => [
  brushPreset(),
  selectField('Režim prolnutí:', PAINT_BLEND_MODES),
  slider('Krytí:', 100),
  checkbox('Zarovnané', true),
  selectField('Zdroj:', SAMPLE_SOURCES),
  textButton('Vybrat zdroj'),
  ...pressureToggles(),
];

const bgEraserOptions = () => [brushPreset(), slider('Tolerance:', 50), selectField('Omezení:', ['Souvislé', 'Nesouvislé']), checkbox('Chránit barvu popředí')];

const magicEraserOptions = () => [slider('Tolerance:', 32, 255, ''), checkbox('Vyhlazování', true), checkbox('Souvislé', true), checkbox('Ze všech vrstev'), slider('Krytí:', 100)];

const gradientOptions = () => [
  h('span', { class: 'gradient-preview', title: 'Přechod – připravujeme' }),
  selectField(null, ['Lineární', 'Kruhový', 'Úhlový', 'Zrcadlený', 'Kosočtverečný']),
  selectField('Režim prolnutí:', PAINT_BLEND_MODES),
  slider('Krytí:', 100),
  checkbox('Obrátit'),
  checkbox('Rozptýlení', true),
  checkbox('Nová výplňová vrstva'),
];

const fillOptions = () => [
  selectField('Výplň:', ['Popředí', 'Vzorek']),
  selectField('Režim prolnutí:', PAINT_BLEND_MODES),
  slider('Krytí:', 100),
  slider('Tolerance:', 32, 255, ''),
  checkbox('Vyhlazování', true),
  checkbox('Souvislé', true),
  checkbox('Ze všech vrstev'),
];

const strengthOptions = () => [brushPreset(), slider('Síla:', 50), checkbox('Ze všech vrstev'), ...pressureToggles()];

const toningOptions = () => [brushPreset(), selectField('Rozsah:', ['Stíny', 'Střední tóny', 'Světla'], 'Střední tóny'), slider('Expozice:', 50), ...pressureToggles()];

const spongeOptions = () => [brushPreset(), selectField('Režim:', ['Odbarvit', 'Sytost']), slider('Tok:', 50), ...pressureToggles()];

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
    t('quick-select', 'Rychlý výběr', WandSparkles, 'W', () => [selectionModes(), separator(), brushPreset(), checkbox('Ze všech vrstev')]),
    t('object-select', 'Výběr objektu', SquareDashedMousePointer, 'W', () => [selectionModes(), separator(), selectField('Režim:', ['Obdélník', 'Laso'])]),
    t('crop', 'Oříznutí', Crop, 'C', cropOptions),
    t('crop-perspective', 'Perspektivní oříznutí', Triangle, 'C', () => [...sizeFields(), iconButton(X, 'Zrušit'), iconButton(Check, 'Potvrdit')]),
    t('slice', 'Řez', Scissors, 'C', sliceOptions),
    t('slice-select', 'Výběr řezu', Pointer, 'C', () => [textButton('Rozdělit…')]),
    t('eyedropper', 'Kapátko', Pipette, 'I', eyedropperOptions),
    t('color-sampler', 'Vzorkovač barev', Crosshair, 'I', () => [selectField('Velikost vzorku:', ['1 × 1', '3 × 3', '5 × 5']), textButton('Vymazat vše')]),
    t('ruler', 'Pravítko', Ruler, 'I', () => [textField('X:', '0', 40), textField('Y:', '0', 40), textField('Š:', '0', 40), textField('V:', '0', 40), textField('Ú:', '0°', 40), textButton('Narovnat vrstvu'), textButton('Vymazat')]),
    t('spot-healing', 'Bodový retušovací štětec', Bandage, 'J', healingOptions),
    t('healing', 'Retušovací štětec', Highlighter, 'J', healingOptions),
    t('patch', 'Záplata', Shapes, 'J', patchOptions),
    t('red-eye', 'Červené oči', ScanEye, 'J', () => [slider('Velikost zornice:', 50), slider('Ztmavení:', 50)]),
    t('pencil', 'Tužka', Pencil, 'B', pencilOptions),
    t('color-replace', 'Nahrazení barvy', Replace, 'B', colorReplaceOptions),
    t('stamp', 'Razítko', Stamp, 'S', cloneOptions),
    t('bg-eraser', 'Guma pozadí', Eraser, 'E', bgEraserOptions),
    t('magic-eraser', 'Kouzelná guma', Sparkles, 'E', magicEraserOptions),
    t('gradient', 'Přechod', Blend, 'G', gradientOptions),
    t('fill', 'Plechovka', PaintBucket, 'G', fillOptions),
    t('blur', 'Rozostření', Droplet, undefined, strengthOptions),
    t('sharpen', 'Zostření', Triangle, undefined, strengthOptions),
    t('smudge', 'Rozmazání', Waves, undefined, strengthOptions),
    t('dodge', 'Zesvětlení', Sun, 'O', toningOptions),
    t('burn', 'Ztmavení', Moon, 'O', toningOptions),
    t('sponge', 'Houba', SprayCan, 'O', spongeOptions),
    t('text', 'Vodorovný text', Type, 'T', textOptions),
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
