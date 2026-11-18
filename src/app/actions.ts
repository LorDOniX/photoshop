import type { Action } from '../core/actions';
import type { Editor } from '../core/Editor';
import { createBlankDocument } from '../core/ImageDocument';
import type { SelectionMask } from '../core/selection/SelectionMask';
import { exportImage, type ExportFormat } from '../io/export';
import { baseName, canvasToBlob, downloadBlob, pickFile } from '../io/files';
import { PROJECT_EXTENSION, saveProject } from '../io/project';
import { promptNumber, showForm, showNewDocumentDialog } from '../ui/dialogs';
import type { TransformTool } from '../tools/TransformTool';

/** Kopie do systémové schránky (aby šlo vkládat i do jiných aplikací); selhání se ignoruje. */
async function writeSystemClipboard(canvas: HTMLCanvasElement | undefined): Promise<void> {
  if (!canvas || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return;
  try {
    const blob = await canvasToBlob(canvas, 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch {
    // Bez oprávnění funguje aspoň schránka aplikace.
  }
}

/** Závislosti akcí na zbytku aplikace (vytvářejí se v main.ts). */
export interface AppContext {
  openFile(file: File): Promise<void>;
  placeImage(file: Blob, name: string): Promise<void>;
  fitView(allowUpscale: boolean): void;
  rulers: { visible: boolean };
  showPanel(id: string): void;
}

/** Funkční akce aplikace (menu + klávesové zkratky). */
export function registerActions(editor: Editor, app: AppContext): void {
  const hasLayer = () => editor.doc.activeLayer !== null;
  const hasSelection = () => editor.doc.selection !== null;
  const hasMask = () => !!editor.doc.activeLayer?.mask;
  const transformTool = () => editor.tools.get('transform') as TransformTool | undefined;
  let refine = { smooth: 0, feather: 0, shift: 0 };
  /** Výběr → Upravit → … (dialog s jedním číslem). */
  const modifyAction = (
    id: string,
    label: string,
    field: string,
    initial: number,
    fn: (mask: SelectionMask, value: number) => SelectionMask,
    historyLabel: string,
  ): Action => {
    let last = initial;
    return {
      id,
      label,
      isEnabled: hasSelection,
      run: async () => {
        const v = await promptNumber(label.replace('…', ''), field, last);
        if (v === null) return;
        last = v;
        editor.modifySelection((m) => fn(m, v), historyLabel);
      },
    };
  };
  const activeIndex = () => (editor.doc.activeLayerId ? editor.doc.indexOf(editor.doc.activeLayerId) : -1);
  const exportAs = async (format: ExportFormat) => {
    const blob = await exportImage(editor.doc, format);
    downloadBlob(blob, `${editor.fileName}.${format === 'png' ? 'png' : 'jpg'}`);
  };
  const view = (fn: () => void) => () => {
    fn();
    editor.notifyView();
  };

  editor.actions.register(
    // ---- Soubor ----
    {
      id: 'file.new',
      label: 'Nový…',
      shortcuts: ['Ctrl+Alt+N'],
      run: async () => {
        const opts = await showNewDocumentDialog({ width: editor.doc.width, height: editor.doc.height });
        if (opts) editor.setDocument(createBlankDocument(opts.width, opts.height, opts.background));
      },
    },
    {
      id: 'file.open',
      label: 'Otevřít…',
      shortcuts: ['Ctrl+O'],
      run: async () => {
        const file = await pickFile(`image/*,${PROJECT_EXTENSION}`);
        if (file) await app.openFile(file);
      },
    },
    {
      id: 'file.place',
      label: 'Otevřít a vložit…',
      shortcuts: ['Ctrl+Shift+O'],
      run: async () => {
        const file = await pickFile('image/*');
        if (file) await app.placeImage(file, baseName(file.name));
      },
    },
    {
      id: 'file.save',
      label: `Uložit projekt (${PROJECT_EXTENSION})`,
      shortcuts: ['Ctrl+S'],
      run: async () => downloadBlob(await saveProject(editor.doc), `${editor.fileName}${PROJECT_EXTENSION}`),
    },
    { id: 'file.exportPng', label: 'PNG', shortcuts: ['Ctrl+Alt+S'], run: () => exportAs('png') },
    { id: 'file.exportJpeg', label: 'JPG', run: () => exportAs('jpeg') },

    // ---- Úpravy ----
    {
      id: 'edit.undo',
      label: 'Krok zpět',
      shortcuts: ['Ctrl+Z'],
      run: () => void editor.history.undo(),
      isEnabled: () => editor.history.canUndo,
    },
    {
      id: 'edit.redo',
      label: 'Krok vpřed',
      shortcuts: ['Ctrl+Shift+Z', 'Ctrl+Y'],
      run: () => void editor.history.redo(),
      isEnabled: () => editor.history.canRedo,
    },
    {
      id: 'edit.cut',
      label: 'Vyjmout',
      shortcuts: ['Ctrl+X'],
      run: () => {
        editor.cutSelection();
        void writeSystemClipboard(editor.clipboard?.canvas);
      },
      isEnabled: hasLayer,
    },
    {
      id: 'edit.copy',
      label: 'Kopírovat',
      shortcuts: ['Ctrl+C'],
      run: () => {
        if (editor.copySelection()) void writeSystemClipboard(editor.clipboard?.canvas);
      },
      isEnabled: hasLayer,
    },
    {
      id: 'edit.copyMerged',
      label: 'Kopírovat sloučené',
      shortcuts: ['Ctrl+Shift+C'],
      run: () => {
        if (editor.copySelection(true)) void writeSystemClipboard(editor.clipboard?.canvas);
      },
    },
    {
      id: 'edit.paste',
      label: 'Vložit',
      shortcutHint: 'Ctrl+V',
      run: () => void editor.pasteClipboard(),
      isEnabled: () => editor.clipboard !== null,
    },
    {
      id: 'edit.clear',
      label: 'Vymazat',
      shortcuts: ['Delete', 'Backspace'],
      run: () => editor.clearSelection(),
      isEnabled: hasLayer,
    },
    {
      id: 'edit.fillFg',
      label: 'Vyplnit barvou popředí',
      shortcuts: ['Alt+Backspace', 'Alt+Delete'],
      run: () => editor.fillSelection(editor.settings.color, 'Vyplnit barvou popředí'),
      isEnabled: hasLayer,
    },
    {
      id: 'edit.fillBg',
      label: 'Vyplnit barvou pozadí',
      shortcuts: ['Ctrl+Backspace', 'Ctrl+Delete'],
      run: () => editor.fillSelection(editor.settings.secondaryColor, 'Vyplnit barvou pozadí'),
      isEnabled: hasLayer,
    },

    // ---- Obraz ----
    { id: 'image.crop', label: 'Oříznout na výběr', run: () => editor.cropToSelection(), isEnabled: hasSelection },
    {
      id: 'image.size',
      label: 'Velikost obrazu…',
      shortcuts: ['Ctrl+Alt+I'],
      run: async () => {
        const W = editor.doc.width;
        const H = editor.doc.height;
        const v = await showForm(
          'Velikost obrazu',
          [
            { kind: 'number', key: 'width', label: 'Šířka', value: W, min: 1, max: 30000, step: 1, unit: 'px' },
            { kind: 'number', key: 'height', label: 'Výška', value: H, min: 1, max: 30000, step: 1, unit: 'px' },
            { kind: 'number', key: 'percent', label: 'Měřítko', value: 100, min: 1, max: 1000, unit: '%' },
            { kind: 'checkbox', key: 'keep', label: 'Zachovat poměr stran', value: true },
            {
              kind: 'select',
              key: 'resample',
              label: 'Převzorkování',
              value: 'smooth',
              options: [
                { value: 'smooth', label: 'Hladké (bikubické)' },
                { value: 'nearest', label: 'Nejbližší soused (ostré hrany)' },
              ],
            },
            { kind: 'note', key: 'info', label: `Původní velikost: ${W} × ${H} px` },
          ],
          (key, f) => {
            const keep = Boolean(f.get('keep'));
            if (key === 'width' || (key === 'keep' && keep)) {
              const w = Number(f.get('width'));
              f.set('percent', (w / W) * 100);
              if (keep) f.set('height', Math.max(1, Math.round((w * H) / W)));
            } else if (key === 'height') {
              const hh = Number(f.get('height'));
              if (keep) {
                f.set('width', Math.max(1, Math.round((hh * W) / H)));
                f.set('percent', (hh / H) * 100);
              }
            } else if (key === 'percent') {
              const p = Number(f.get('percent')) / 100;
              f.set('width', Math.max(1, Math.round(W * p)));
              f.set('height', Math.max(1, Math.round(H * p)));
            }
          },
        );
        if (v) editor.resizeImage(Math.round(Number(v.width)), Math.round(Number(v.height)), v.resample === 'smooth');
      },
    },
    {
      id: 'image.canvasSize',
      label: 'Velikost plátna…',
      shortcuts: ['Ctrl+Alt+C'],
      run: async () => {
        const W = editor.doc.width;
        const H = editor.doc.height;
        const v = await showForm('Velikost plátna', [
          { kind: 'number', key: 'width', label: 'Šířka', value: W, min: 1, max: 30000, step: 1, unit: 'px' },
          { kind: 'number', key: 'height', label: 'Výška', value: H, min: 1, max: 30000, step: 1, unit: 'px' },
          { kind: 'anchor', key: 'anchor', label: 'Ukotvení', value: 4 },
          {
            kind: 'select',
            key: 'fill',
            label: 'Barva rozšíření',
            value: 'background',
            options: [
              { value: 'background', label: 'Barva pozadí' },
              { value: '#ffffff', label: 'Bílá' },
              { value: '#000000', label: 'Černá' },
              { value: 'transparent', label: 'Průhledná' },
            ],
          },
          { kind: 'note', key: 'info', label: `Původní velikost: ${W} × ${H} px. Rozšíří se jen spodní vrstva pozadí.` },
        ]);
        if (!v) return;
        const fill = v.fill === 'transparent' ? null : v.fill === 'background' ? editor.settings.secondaryColor : String(v.fill);
        editor.resizeCanvas(Math.round(Number(v.width)), Math.round(Number(v.height)), Number(v.anchor), fill);
      },
    },
    { id: 'image.rotateCW', label: 'Otočit o 90° ↻', run: () => editor.rotateDocument(1) },
    { id: 'image.rotateCCW', label: 'Otočit o 90° ↺', run: () => editor.rotateDocument(3) },
    { id: 'image.rotate180', label: 'Otočit o 180°', run: () => editor.rotateDocument(2) },
    { id: 'image.flipH', label: 'Převrátit vodorovně', run: () => editor.flipDocument('h') },
    { id: 'image.flipV', label: 'Převrátit svisle', run: () => editor.flipDocument('v') },
    {
      id: 'image.trim',
      label: 'Ořezat…',
      shortcuts: ['Ctrl+.'],
      run: async () => {
        const v = await showForm('Ořezat', [
          {
            kind: 'select',
            key: 'basis',
            label: 'Podle',
            value: 'transparent',
            options: [
              { value: 'transparent', label: 'Průhledných pixelů' },
              { value: 'topLeft', label: 'Barvy levého horního pixelu' },
              { value: 'bottomRight', label: 'Barvy pravého dolního pixelu' },
            ],
          },
        ]);
        if (v && !editor.trim(v.basis as 'transparent' | 'topLeft' | 'bottomRight')) alert('Není co ořezat.');
      },
    },
    { id: 'image.revealAll', label: 'Odkrýt vše', run: () => editor.revealAll() },

    // ---- Transformace ----
    {
      id: 'edit.freeTransform',
      label: 'Volná transformace',
      shortcuts: ['Ctrl+Alt+T'],
      run: () => void transformTool()?.begin(false),
      isEnabled: hasLayer,
    },
    {
      id: 'select.transform',
      label: 'Transformovat výběr',
      run: () => void transformTool()?.begin(true),
      isEnabled: hasSelection,
    },
    { id: 'transform.cw', label: 'Otočit o 90° ↻', run: () => editor.transformQuick('cw'), isEnabled: hasLayer },
    { id: 'transform.ccw', label: 'Otočit o 90° ↺', run: () => editor.transformQuick('ccw'), isEnabled: hasLayer },
    { id: 'transform.180', label: 'Otočit o 180°', run: () => editor.transformQuick('180'), isEnabled: hasLayer },
    { id: 'transform.flipH', label: 'Převrátit vodorovně', run: () => editor.transformQuick('flipH'), isEnabled: hasLayer },
    { id: 'transform.flipV', label: 'Převrátit svisle', run: () => editor.transformQuick('flipV'), isEnabled: hasLayer },

    // ---- Výběr ----
    { id: 'select.all', label: 'Vše', shortcuts: ['Ctrl+A'], run: () => editor.selectAll() },
    { id: 'select.deselect', label: 'Odznačit', shortcuts: ['Ctrl+D'], run: () => editor.deselect(), isEnabled: hasSelection },
    { id: 'select.reselect', label: 'Znovu vybrat', shortcuts: ['Ctrl+Shift+D'], run: () => editor.reselect() },
    { id: 'select.inverse', label: 'Inverze', shortcuts: ['Ctrl+Shift+I'], run: () => editor.invertSelection() },
    modifyAction('select.border', 'Ohraničení…', 'Šířka', 10, (m, v) => m.border(v), 'Ohraničení výběru'),
    modifyAction('select.smooth', 'Vyhladit…', 'Poloměr', 4, (m, v) => m.smooth(v), 'Vyhladit výběr'),
    modifyAction('select.expand', 'Rozšířit…', 'Rozšířit o', 4, (m, v) => m.expand(v), 'Rozšířit výběr'),
    modifyAction('select.contract', 'Zúžit…', 'Zúžit o', 4, (m, v) => m.contract(v), 'Zúžit výběr'),
    { ...modifyAction('select.feather', 'Prolnout…', 'Poloměr prolnutí', 8, (m, v) => m.feather(v), 'Prolnout výběr'), shortcuts: ['Shift+F6'] },
    { id: 'select.grow', label: 'Zvětšit', run: () => editor.growSelection(true), isEnabled: hasSelection },
    { id: 'select.similar', label: 'Podobné', run: () => editor.growSelection(false), isEnabled: hasSelection },
    {
      id: 'select.refineEdge',
      label: 'Upřesnit okraj…',
      shortcuts: ['Ctrl+Alt+R'],
      isEnabled: hasSelection,
      run: async () => {
        const v = await showForm('Upřesnit okraj', [
          { kind: 'number', key: 'smooth', label: 'Vyhladit', value: refine.smooth, min: 0, max: 100, unit: 'px' },
          { kind: 'number', key: 'feather', label: 'Prolnutí', value: refine.feather, min: 0, max: 250, unit: 'px' },
          { kind: 'number', key: 'shift', label: 'Posunout okraj', value: refine.shift, min: -100, max: 100, unit: 'px' },
          { kind: 'note', key: 'n', label: 'Kladný posun okraj rozšíří, záporný zúží.' },
        ]);
        if (!v) return;
        refine = { smooth: Number(v.smooth), feather: Number(v.feather), shift: Math.round(Number(v.shift)) };
        editor.refineEdge(refine);
      },
    },

    // ---- Vrstva ----
    { id: 'layer.new', label: 'Vrstva', shortcuts: ['Alt+Shift+N'], run: () => editor.addLayer() },
    {
      id: 'layer.duplicate',
      label: 'Duplikovat vrstvu',
      run: () => editor.duplicateActiveLayer(),
      isEnabled: hasLayer,
    },
    {
      id: 'layer.viaCopy',
      label: 'Vrstva kopírováním',
      shortcuts: ['Ctrl+J'],
      run: () => editor.layerViaCopy(),
      isEnabled: hasLayer,
    },
    {
      id: 'layer.viaCut',
      label: 'Vrstva vyjmutím',
      shortcuts: ['Ctrl+Shift+J'],
      run: () => editor.layerViaCut(),
      isEnabled: () => hasLayer() && hasSelection(),
    },
    {
      id: 'layer.selectPixels',
      label: 'Vybrat pixely',
      run: () => {
        if (editor.doc.activeLayerId) editor.selectLayerPixels(editor.doc.activeLayerId);
      },
      isEnabled: hasLayer,
    },

    // ---- Rastrová maska ----
    ...(
      [
        ['mask.revealAll', 'Přidat (odkrýt vše)', 'revealAll', false],
        ['mask.hideAll', 'Přidat (skrýt vše)', 'hideAll', false],
        ['mask.revealSelection', 'Odkrýt výběr', 'revealSelection', true],
        ['mask.hideSelection', 'Skrýt výběr', 'hideSelection', true],
        ['mask.fromTransparency', 'Z průhlednosti', 'fromTransparency', false],
      ] as const
    ).map(
      ([id, label, kind, needsSelection]): Action => ({
        id,
        label,
        run: () => editor.addMask(kind),
        isEnabled: () => hasLayer() && !hasMask() && (!needsSelection || hasSelection()),
      }),
    ),
    { id: 'mask.delete', label: 'Smazat masku', run: () => editor.deleteMask(), isEnabled: hasMask },
    { id: 'mask.apply', label: 'Použít masku', run: () => editor.applyMask(), isEnabled: hasMask },
    {
      id: 'mask.toggle',
      label: 'Maska zapnutá',
      run: () => editor.toggleMask(),
      isEnabled: hasMask,
      isChecked: () => !!editor.doc.activeLayer?.mask && editor.doc.activeLayer.maskEnabled,
    },
    {
      id: 'mask.edit',
      label: 'Upravovat masku',
      shortcuts: ['Ctrl+\\'],
      run: () => editor.setMaskTarget(!editor.maskTarget),
      isEnabled: hasMask,
      isChecked: () => editor.maskTarget,
    },
    { id: 'mask.toSelection', label: 'Výběr z masky', run: () => editor.selectionFromMask(), isEnabled: hasMask },
    {
      id: 'layer.delete',
      label: 'Smazat vrstvu',
      run: () => editor.deleteActiveLayer(),
      isEnabled: () => hasLayer() && editor.doc.layers.length > 1,
    },
    {
      id: 'layer.front',
      label: 'Zcela dopředu',
      shortcuts: ['Ctrl+Shift+]'],
      run: () => editor.moveActiveLayer(editor.doc.layers.length),
      isEnabled: () => hasLayer() && activeIndex() < editor.doc.layers.length - 1,
    },
    {
      id: 'layer.up',
      label: 'Posunout dopředu',
      shortcuts: ['Ctrl+]'],
      run: () => editor.moveActiveLayer(1),
      isEnabled: () => hasLayer() && activeIndex() < editor.doc.layers.length - 1,
    },
    {
      id: 'layer.down',
      label: 'Posunout dozadu',
      shortcuts: ['Ctrl+['],
      run: () => editor.moveActiveLayer(-1),
      isEnabled: () => hasLayer() && activeIndex() > 0,
    },
    {
      id: 'layer.back',
      label: 'Zcela dozadu',
      shortcuts: ['Ctrl+Shift+['],
      run: () => editor.moveActiveLayer(-editor.doc.layers.length),
      isEnabled: () => hasLayer() && activeIndex() > 0,
    },

    // ---- Zobrazení ----
    {
      id: 'view.zoomIn',
      label: 'Přiblížit',
      shortcuts: ['Ctrl++', 'Ctrl+=', 'Ctrl+Shift+=', 'Ctrl+Shift++'],
      run: view(() => editor.viewport.stepZoom(1)),
    },
    { id: 'view.zoomOut', label: 'Oddálit', shortcuts: ['Ctrl+-'], run: view(() => editor.viewport.stepZoom(-1)) },
    { id: 'view.fit', label: 'Přizpůsobit oknu', shortcuts: ['Ctrl+0'], run: () => app.fitView(true) },
    {
      id: 'view.actual',
      label: 'Pixel na pixel',
      shortcuts: ['Ctrl+1'],
      run: view(() => {
        editor.viewport.zoom = 1;
        editor.viewport.center(editor.doc.width, editor.doc.height);
      }),
    },
    {
      id: 'view.rulers',
      label: 'Pravítka',
      shortcuts: ['Ctrl+R'],
      run: () => {
        app.rulers.visible = !app.rulers.visible;
      },
      isChecked: () => app.rulers.visible,
    },
    {
      id: 'view.fullscreen',
      label: 'Celá obrazovka',
      run: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      },
      isChecked: () => !!document.fullscreenElement,
    },

    // ---- Barvy a štětec ----
    {
      id: 'color.swap',
      label: 'Prohodit barvy',
      shortcuts: ['X'],
      run: () => editor.updateSettings({ color: editor.settings.secondaryColor, secondaryColor: editor.settings.color }),
    },
    {
      id: 'color.reset',
      label: 'Výchozí barvy',
      shortcuts: ['D'],
      run: () => editor.updateSettings({ color: '#000000', secondaryColor: '#ffffff' }),
    },
    {
      id: 'brush.smaller',
      label: 'Zmenšit štětec',
      shortcuts: ['['],
      run: () => editor.updateSettings({ brushSize: Math.max(1, Math.round(editor.settings.brushSize / 1.2)) }),
    },
    {
      id: 'brush.bigger',
      label: 'Zvětšit štětec',
      shortcuts: [']'],
      run: () => editor.updateSettings({ brushSize: Math.min(500, Math.round(editor.settings.brushSize * 1.2) + 1) }),
    },
  );

  // ---- Okno: panely v doku ----
  const panels: Array<[string, string]> = [
    ['channels', 'Kanály'],
    ['history', 'Historie'],
    ['layers', 'Vrstvy'],
    ['paths', 'Cesty'],
    ['swatches', 'Vzorník'],
  ];
  for (const [id, label] of panels) editor.actions.register({ id: `window.${id}`, label, run: () => app.showPanel(id) });
}
