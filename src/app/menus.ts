import { LAYER_KINDS } from './adjustments';
import { FILTER_MENU } from './filters';
import { placeholderAction, type ActionRegistry } from '../core/actions';
import type { MenuDef } from '../ui/MenuBar';
import type { MenuItem } from '../ui/Menu';

export interface AppMenus {
  menuBar: MenuDef[];
  /** Pravé tlačítko na vrstvě. */
  layerContext: MenuItem[];
  /** Pravé tlačítko na náhledu masky. */
  maskContext: MenuItem[];
  /** Nabídky ≡ jednotlivých panelů. */
  panels: Record<'history' | 'swatches' | 'layers' | 'channels' | 'paths', MenuItem[]>;
}

/**
 * Struktura menu podle Photopea. Funkční položky odkazují na registrované akce (id),
 * ostatní jsou připravené (zašedlé) přes `todo()`.
 */
export function buildMenus(actions: ActionRegistry): AppMenus {
  let n = 0;
  /** Připravená, zatím nefunkční položka. */
  const todo = (label: string, ...shortcuts: string[]): string => {
    const id = `todo.${++n}`;
    actions.register(placeholderAction(id, label, ...shortcuts));
    return id;
  };
  const sub = (label: string, items: MenuItem[]): MenuItem => ({ label, items });
  const todoSub = (label: string, labels: string[]): MenuItem => sub(label, labels.map((l) => (l === '-' ? l : todo(l))));

  const adjustmentIds = [
    'adjust.brightnessContrast',
    'adjust.levels',
    'adjust.curves',
    'adjust.exposure',
    'adjust.vibrance',
    'adjust.hueSaturation',
    'adjust.colorBalance',
    'adjust.blackWhite',
    'adjust.photoFilter',
    '-',
    'adjust.invert',
    'adjust.posterize',
    'adjust.threshold',
    'adjust.gradientMap',
    '-',
    'adjust.desaturate',
  ];

  const file: MenuItem[] = [
    'file.new',
    'file.open',
    'file.place',
    todoSub('Otevřít další', ['Otevřít z URL…', 'Nedávné soubory']),
    '-',
    'file.save',
    'file.savePsd',
    sub('Exportovat jako', ['file.exportPng', 'file.exportJpeg', 'file.exportWebp', todo('PDF'), todo('SVG'), todo('GIF')]),
    todo('Tisk…', 'Ctrl+P'),
    '-',
    todo('Exportovat vrstvy…'),
    todo('Informace o souboru…'),
    '-',
    'file.close',
    '-',
    todo('Skript…'),
  ];

  const edit: MenuItem[] = [
    'edit.redo',
    'edit.undo',
    'edit.fade',
    '-',
    'edit.cut',
    'edit.copy',
    'edit.copyMerged',
    'edit.paste',
    'edit.clear',
    '-',
    'edit.fillFg',
    'edit.fillBg',
    'edit.fillPattern',
    'edit.stroke',
    '-',
    'edit.definePattern',
    '-',
    'edit.freeTransform',
    sub('Transformovat', [
      todo('Zkosit'),
      todo('Zkreslit'),
      todo('Perspektiva'),
      todo('Deformace'),
      '-',
      'transform.cw',
      'transform.ccw',
      'transform.180',
      'transform.flipH',
      'transform.flipV',
    ]),
    '-',
    sub('Definovat', ['edit.definePattern', todo('Štětec'), todo('Vlastní tvar')]),
    '-',
    'edit.preferences',
  ];

  const image: MenuItem[] = [
    todoSub('Režim', ['RGB', '-', '8 bitů/kanál', '16 bitů/kanál', '32 bitů/kanál']),
    sub('Úpravy', adjustmentIds),
    '-',
    'adjust.autoTone',
    'adjust.autoContrast',
    'adjust.autoColor',
    '-',
    'image.canvasSize',
    'image.size',
    sub('Transformovat', ['image.rotateCW', 'image.rotateCCW', 'image.rotate180', '-', 'image.flipH', 'image.flipV']),
    'image.crop',
    'image.trim',
    'image.revealAll',
    '-',
    todo('Duplikovat'),
  ];

  const layer: MenuItem[] = [
    sub('Nová', ['layer.new', 'layer.newGroup', '-', 'layer.viaCopy', 'layer.viaCut']),
    'layer.duplicate',
    'layer.delete',
    '-',
    sub('Styl vrstvy', [
      'layer.style',
      '-',
      'layer.style.bevel',
      'layer.style.stroke',
      'layer.style.innerShadow',
      'layer.style.innerGlow',
      'layer.style.satin',
      'layer.style.colorOverlay',
      'layer.style.gradientOverlay',
      'layer.style.patternOverlay',
      'layer.style.outerGlow',
      'layer.style.dropShadow',
      '-',
      'layer.clearStyle',
    ]),
    sub('Nová výplňová vrstva', ['layer.newFill.color', 'layer.newFill.gradient', 'layer.newFill.pattern']),
    sub('Nová vrstva úprav', [
      ...LAYER_KINDS.slice(0, 9).map((k) => `layer.newAdjustment.${k}`),
      '-',
      ...LAYER_KINDS.slice(9).map((k) => `layer.newAdjustment.${k}`),
    ]),
    'layer.editContent',
    '-',
    sub('Rastrová maska', [
      'mask.revealAll',
      'mask.hideAll',
      'mask.revealSelection',
      'mask.hideSelection',
      'mask.fromTransparency',
      '-',
      'mask.delete',
      'mask.apply',
      'mask.toggle',
      '-',
      'mask.edit',
      'mask.toSelection',
    ]),
    todoSub('Vektorová maska', ['Přidat (odkrýt vše)', 'Přidat (skrýt vše)', 'Aktuální cesta', '-', 'Smazat', 'Zapnout/vypnout']),
    'layer.clippingMask',
    '-',
    todoSub('Inteligentní objekt', ['Převést na inteligentní objekt', 'Upravit obsah…', 'Nahradit obsah…', 'Převést na vrstvy']),
    'layer.rasterize',
    'text.edit',
    '-',
    'layer.group',
    'layer.ungroup',
    sub('Uspořádat', ['layer.front', 'layer.up', 'layer.down', 'layer.back']),
    sub('Zarovnat', ['layer.alignLeft', 'layer.alignHCenter', 'layer.alignRight', '-', 'layer.alignTop', 'layer.alignVCenter', 'layer.alignBottom']),
    sub('Rozmístit', ['layer.distributeH', 'layer.distributeV']),
    'layer.toggleVisible',
    '-',
    'layer.mergeDown',
    'layer.mergeVisible',
    'layer.flatten',
  ];

  const select: MenuItem[] = [
    'select.all',
    'select.deselect',
    'select.reselect',
    'select.inverse',
    'select.allLayers',
    '-',
    todo('Rozsah barev…'),
    todo('Předmět'),
    'select.refineEdge',
    sub('Upravit', ['select.border', 'select.smooth', 'select.expand', 'select.contract', 'select.feather']),
    'select.grow',
    'select.similar',
    'select.transform',
    '-',
    todo('Režim rychlé masky', 'Q'),
    '-',
    'layer.selectPixels',
    todo('Načíst výběr'),
    todo('Uložit výběr'),
  ];

  const filter: MenuItem[] = ['filter.last', '-', ...FILTER_MENU.map(([label, kinds]) => sub(label, kinds.map((k) => `filter.${k}`)))];

  const view: MenuItem[] = [
    'view.zoomIn',
    'view.zoomOut',
    'view.fit',
    'view.actual',
    '-',
    sub('Režim', ['view.fullscreen', todo('Standardní'), todo('Lišta menu a plátno')]),
    'view.extras',
    sub('Zobrazit', ['view.guides', 'view.selectionEdges', todo('Mřížka'), todo('Řezy')]),
    'view.rulers',
    '-',
    'view.snap',
    sub('Přichytit k', ['view.snapGuides', 'view.snapLayers', 'view.snapDocument', todo('Mřížka')]),
    '-',
    'view.lockGuides',
    'view.clearGuides',
    'view.addGuide',
  ];

  const windowMenu: MenuItem[] = [
    todo('Štětec'),
    'window.channels',
    todo('Znak'),
    todo('Histogram'),
    'window.history',
    'window.info',
    'window.layers',
    todo('Navigátor'),
    todo('Odstavec'),
    'window.paths',
    todo('Vlastnosti'),
    'window.swatches',
  ];

  const more: MenuItem[] = [
    todoSub('Jazyk', ['Čeština', 'English']),
    todoSub('Motiv', ['Tmavě šedý', 'Světle šedý', 'Modrý', 'Černý']),
    '-',
    todo('Klávesové zkratky'),
    todo('Použít WebGL'),
    '-',
    todo('O aplikaci'),
  ];

  const layerContext: MenuItem[] = [
    todo('Možnosti prolnutí…'),
    'layer.selectPixels',
    '-',
    'layer.duplicate',
    'layer.delete',
    'layer.viaCopy',
    '-',
    todo('Převést na inteligentní objekt'),
    'layer.rasterize',
    '-',
    'layer.clippingMask',
    'layer.style',
    'layer.clearStyle',
    '-',
    sub('Rastrová maska', ['mask.revealAll', 'mask.hideAll', 'mask.revealSelection', 'mask.hideSelection', '-', 'mask.delete', 'mask.apply']),
    '-',
    'layer.group',
    'layer.ungroup',
    '-',
    'layer.mergeDown',
    'layer.mergeVisible',
    'layer.flatten',
    '-',
    todoSub('Barva', ['Žádná', 'Červená', 'Oranžová', 'Žlutá', 'Zelená', 'Modrá', 'Fialová', 'Šedá']),
  ];

  return {
    menuBar: [
      { label: 'Soubor', items: file },
      { label: 'Úpravy', items: edit },
      { label: 'Obraz', items: image },
      { label: 'Vrstva', items: layer },
      { label: 'Výběr', items: select },
      { label: 'Filtr', items: filter },
      { label: 'Zobrazení', items: view },
      { label: 'Okno', items: windowMenu },
      { label: 'Další', items: more },
    ],
    layerContext,
    maskContext: ['mask.toggle', 'mask.delete', 'mask.apply', '-', 'mask.toSelection'],
    panels: {
      history: ['history.clear', todo('Nový snímek')],
      swatches: [todo('Přidat barvu popředí'), todo('Načíst vzorník…'), todo('Obnovit výchozí')],
      layers: [
        todo('Filtr'),
        todo('Možnosti prolnutí'),
        todo('Zámek'),
        '-',
        todo('Zmenšit náhledy'),
        todo('Zvětšit náhledy'),
        todo('Náhledy podle vrstvy'),
        todo('Náhledy podle dokumentu'),
      ],
      channels: [todo('Nový kanál'), todo('Duplikovat kanál'), todo('Smazat kanál')],
      paths: [todo('Nová cesta'), todo('Smazat cestu'), todo('Vytvořit výběr')],
    },
  };
}
