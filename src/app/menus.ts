import { placeholderAction, type ActionRegistry } from '../core/actions';
import type { MenuDef } from '../ui/MenuBar';
import type { MenuItem } from '../ui/Menu';

export interface AppMenus {
  menuBar: MenuDef[];
  /** Pravé tlačítko na vrstvě. */
  layerContext: MenuItem[];
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

  const transformItems = ['Otočit o 90° ↻', 'Otočit o 90° ↺', 'Otočit o 180°', 'Převrátit vodorovně', 'Převrátit svisle'];
  const adjustments = [
    'Jas/kontrast…', 'Úrovně…', 'Křivky…', 'Expozice…', 'Živost…', 'Odstín/sytost…', 'Vyvážení barev…',
    'Černobílý…', 'Fotofiltr…', '-', 'Invertovat', 'Posterizace…', 'Práh…', 'Mapa přechodu…', '-', 'Odbarvit',
  ];

  const file: MenuItem[] = [
    'file.new',
    'file.open',
    'file.place',
    todoSub('Otevřít další', ['Otevřít z URL…', 'Nedávné soubory']),
    '-',
    'file.save',
    todo('Uložit jako PSD'),
    sub('Exportovat jako', ['file.exportPng', 'file.exportJpeg', todo('WEBP'), todo('PDF'), todo('SVG'), todo('GIF')]),
    todo('Tisk…', 'Ctrl+P'),
    '-',
    todo('Exportovat vrstvy…'),
    todo('Informace o souboru…'),
    '-',
    todo('Skript…'),
  ];

  const edit: MenuItem[] = [
    'edit.redo',
    'edit.undo',
    todo('Zeslabit…', 'Ctrl+Shift+F'),
    '-',
    'edit.cut',
    'edit.copy',
    'edit.copyMerged',
    'edit.paste',
    'edit.clear',
    '-',
    'edit.fillFg',
    'edit.fillBg',
    todo('Obrys…'),
    '-',
    todo('Volná transformace', 'Ctrl+Alt+T'),
    todoSub('Transformovat', ['Znovu', '-', 'Změnit velikost', 'Otočit', 'Zkosit', 'Zkreslit', 'Perspektiva', 'Deformace', '-', ...transformItems]),
    '-',
    todoSub('Definovat', ['Vzorek', 'Štětec', 'Vlastní tvar']),
    '-',
    todo('Předvolby…', 'Ctrl+K'),
  ];

  const image: MenuItem[] = [
    todoSub('Režim', ['RGB', '-', '8 bitů/kanál', '16 bitů/kanál', '32 bitů/kanál']),
    todoSub('Úpravy', adjustments),
    '-',
    todo('Automatický tón'),
    todo('Automatický kontrast'),
    todo('Automatické barvy'),
    '-',
    todo('Velikost plátna…', 'Ctrl+Alt+C'),
    todo('Velikost obrazu…', 'Ctrl+Alt+I'),
    todoSub('Transformovat', transformItems),
    'image.crop',
    todo('Ořezat…', 'Ctrl+.'),
    todo('Odkrýt vše'),
    '-',
    todo('Duplikovat'),
  ];

  const layer: MenuItem[] = [
    sub('Nová', ['layer.new', todo('Složka'), '-', 'layer.viaCopy', 'layer.viaCut']),
    'layer.duplicate',
    'layer.delete',
    '-',
    todoSub('Styl vrstvy', ['Možnosti prolnutí…', '-', 'Vržený stín…', 'Vnitřní stín…', 'Vnější záře…', 'Vnitřní záře…', 'Úkos a reliéf…', 'Překrytí barvou…', 'Překrytí přechodem…', 'Obrys…', '-', 'Vymazat styl vrstvy']),
    todoSub('Nová výplňová vrstva', ['Barva…', 'Přechod…', 'Vzorek…']),
    todoSub('Nová vrstva úprav', adjustments.filter((a) => a !== 'Odbarvit')),
    '-',
    todoSub('Rastrová maska', ['Přidat (odkrýt vše)', 'Přidat (skrýt vše)', 'Odkrýt výběr', 'Skrýt výběr', 'Z průhlednosti', '-', 'Smazat', 'Použít', 'Zapnout/vypnout']),
    todoSub('Vektorová maska', ['Přidat (odkrýt vše)', 'Přidat (skrýt vše)', 'Aktuální cesta', '-', 'Smazat', 'Zapnout/vypnout']),
    todo('Ořezová maska', 'Ctrl+Alt+G'),
    '-',
    todoSub('Inteligentní objekt', ['Převést na inteligentní objekt', 'Upravit obsah…', 'Nahradit obsah…', 'Převést na vrstvy']),
    todo('Rastrovat'),
    '-',
    todo('Seskupit vrstvy', 'Ctrl+G'),
    sub('Uspořádat', ['layer.front', 'layer.up', 'layer.down', 'layer.back']),
    '-',
    todo('Sloučit dolů', 'Ctrl+E'),
    todo('Sloučit viditelné', 'Ctrl+Shift+E'),
    todo('Zploštit obraz'),
  ];

  const select: MenuItem[] = [
    'select.all',
    'select.deselect',
    'select.reselect',
    'select.inverse',
    '-',
    todo('Rozsah barev…'),
    todo('Předmět'),
    todo('Upřesnit okraj…'),
    sub('Upravit', ['select.border', 'select.smooth', 'select.expand', 'select.contract', 'select.feather']),
    todo('Zvětšit'),
    todo('Podobné'),
    todo('Transformovat výběr'),
    '-',
    todo('Režim rychlé masky', 'Q'),
    '-',
    'layer.selectPixels',
    todo('Načíst výběr'),
    todo('Uložit výběr'),
  ];

  // Filtry nejsou v plánu – menu je jen kvůli rozložení jako ve Photopea.
  const filter: MenuItem[] = [
    todo('Poslední filtr', 'Ctrl+Alt+F'),
    '-',
    todoSub('Rozostření', ['Průměr', 'Gaussovské rozostření…', 'Rozostření pohybem…', 'Radiální rozostření…']),
    todoSub('Šum', ['Přidat šum…', 'Odstranit skvrny', 'Medián…']),
    todoSub('Zostření', ['Zostřit', 'Doostřit…', 'Maska rozostření…']),
    todoSub('Jiné', ['Horní propust…', 'Posun…', 'Barva na alfu…']),
  ];

  const view: MenuItem[] = [
    'view.zoomIn',
    'view.zoomOut',
    'view.fit',
    'view.actual',
    '-',
    sub('Režim', ['view.fullscreen', todo('Standardní'), todo('Lišta menu a plátno')]),
    todo('Pomocné prvky', 'Ctrl+H'),
    todoSub('Zobrazit', ['Mřížka', 'Vodítka', 'Řezy', 'Okraje výběru']),
    'view.rulers',
    '-',
    todo('Přichytávání'),
    todoSub('Přichytit k', ['Vodítka', 'Mřížka', 'Vrstvy', 'Hranice dokumentu']),
    '-',
    todo('Zamknout vodítka'),
    todo('Smazat vodítka'),
    todo('Přidat vodítka…'),
  ];

  const windowMenu: MenuItem[] = [
    todo('Štětec'),
    'window.channels',
    todo('Znak'),
    todo('Histogram'),
    'window.history',
    todo('Info'),
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
    todo('Rastrovat'),
    '-',
    todo('Ořezová maska'),
    todo('Styl vrstvy'),
    '-',
    todo('Sloučit dolů'),
    todo('Zploštit obraz'),
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
    panels: {
      history: [todo('Vymazat historii'), todo('Nový snímek')],
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
