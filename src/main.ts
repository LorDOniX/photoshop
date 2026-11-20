import './styles.css';
import { Image as ImageIcon, Info, Paintbrush, Pilcrow, SlidersHorizontal } from 'lucide';
import { registerActions } from './app/actions';
import { loadPreferences } from './app/preferences';
import { buildMenus } from './app/menus';
import { Editor } from './core/Editor';
import { ImageDocument } from './core/ImageDocument';
import { Layer } from './core/Layer';
import { baseName } from './io/files';
import { PROJECT_EXTENSION, loadProject } from './io/project';
import { AutoSaver, deleteAutosave, listAutosaves } from './io/autosave';
import { BrushTool } from './tools/BrushTool';
import { CropTool } from './tools/CropTool';
import { EyedropperTool } from './tools/EyedropperTool';
import { FillTool } from './tools/FillTool';
import { MagicEraserTool } from './tools/MagicEraserTool';
import { GradientTool } from './tools/GradientTool';
import { TextTool } from './tools/TextTool';
import { TransformTool } from './tools/TransformTool';
import { MoveTool } from './tools/MoveTool';
import { HandTool, ZoomTool } from './tools/NavigationTools';
import { createPlaceholderTools } from './tools/PlaceholderTools';
import { LassoTool } from './tools/selection/LassoTool';
import { MagicWandTool } from './tools/selection/MagicWandTool';
import { MagneticLassoTool } from './tools/selection/MagneticLassoTool';
import { MarqueeTool } from './tools/selection/MarqueeTool';
import { QuickSelectTool } from './tools/selection/QuickSelectTool';
import { CanvasView } from './ui/CanvasView';
import { Dock, TabbedPanel } from './ui/Dock';
import { DocumentTabs, StatusBar } from './ui/DocumentTabs';
import { HistoryPanel } from './ui/HistoryPanel';
import { LayersPanel } from './ui/LayersPanel';
import { MenuBar } from './ui/MenuBar';
import { createChannelsPanel, createPathsPanel, createSwatchesPanel } from './ui/MiscPanels';
import { OptionsBar } from './ui/OptionsBar';
import { Toolbar } from './ui/Toolbar';
import { confirmDialog } from './ui/dialogs';
import { h } from './ui/dom';

const editor = new Editor();
// Uložené předvolby (limit paměti historie).
const prefs = loadPreferences();
if (prefs.historyMemoryLimit) editor.setHistoryMemoryLimit(prefs.historyMemoryLimit);
// Jen ve vývojovém režimu – pro ladění v konzoli prohlížeče.
if (import.meta.env.DEV) Object.assign(window, { editor });

// ---- nástroje ----
editor.tools.register(
  new MoveTool(editor),
  new MarqueeTool(editor, 'rect'),
  new MarqueeTool(editor, 'ellipse'),
  new LassoTool(editor, 'free'),
  new LassoTool(editor, 'polygon'),
  new MagneticLassoTool(editor),
  new MagicWandTool(editor),
  new QuickSelectTool(editor),
  new BrushTool(editor, 'brush'),
  new BrushTool(editor, 'eraser'),
  new BrushTool(editor, 'pencil'),
  new MagicEraserTool(editor),
  new EyedropperTool(editor),
  new GradientTool(editor),
  new FillTool(editor),
  new TextTool(editor),
  new HandTool(editor),
  new CropTool(editor),
  new TransformTool(editor),
  new ZoomTool(editor),
  ...createPlaceholderTools(),
);

/** Skupiny nástrojů v levé liště (pořadí jako ve Photopea). */
const TOOLBAR_GROUPS = [
  ['move', 'artboard'],
  ['marquee-rect', 'marquee-ellipse'],
  ['lasso', 'lasso-polygon', 'lasso-magnetic'],
  ['magic-wand', 'quick-select', 'object-select'],
  ['crop', 'crop-perspective', 'slice', 'slice-select'],
  ['eyedropper', 'color-sampler', 'ruler'],
  ['spot-healing', 'healing', 'patch', 'red-eye'],
  ['brush', 'pencil', 'color-replace'],
  ['stamp'],
  ['eraser', 'bg-eraser', 'magic-eraser'],
  ['gradient', 'fill'],
  ['blur', 'sharpen', 'smudge'],
  ['dodge', 'burn', 'sponge'],
  ['text', 'text-vertical'],
  ['pen', 'pen-free', 'pen-curvature', 'anchor-add', 'anchor-delete', 'anchor-convert'],
  ['path-select', 'direct-select'],
  ['shape-rect', 'shape-ellipse', 'shape-line', 'shape-polygon', 'shape-custom'],
  ['hand', 'rotate-view'],
  ['zoom'],
];

// ---- práce se soubory ----
function isProjectFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(PROJECT_EXTENSION);
}

async function openFile(file: File): Promise<void> {
  if (isProjectFile(file)) {
    editor.openDocument(await loadProject(await file.arrayBuffer()), baseName(file.name));
    return;
  }
  const bitmap = await createImageBitmap(file);
  const doc = new ImageDocument(bitmap.width, bitmap.height);
  const layer = new Layer(bitmap.width, bitmap.height, { name: 'Pozadí' });
  layer.ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  doc.insertLayer(layer);
  editor.openDocument(doc, baseName(file.name));
}

async function placeImage(file: Blob, name: string): Promise<void> {
  const bitmap = await createImageBitmap(file);
  editor.addImageLayer(bitmap, name);
  bitmap.close();
}

/** Zavře záložku; s neuloženými změnami se nejdřív zeptá. */
async function closeDocument(id: string): Promise<void> {
  const session = editor.sessions.find((s) => s.id === id);
  if (!session) return;
  if (editor.isDirty(session) && !(await confirmDialog('Zavřít dokument', `„${session.fileName}“ má neuložené změny. Zavřít bez uložení?`))) return;
  editor.closeDocument(id);
}

async function openFiles(files: File[]): Promise<void> {
  for (const file of files) {
    if (isProjectFile(file) || file.type.startsWith('image/')) await openFile(file);
  }
}

function fitView(allowUpscale: boolean): void {
  editor.viewport.fit(editor.doc.width, editor.doc.height, allowUpscale);
  editor.notifyView();
}

// ---- rozvržení ----
const canvasView = new CanvasView(editor);
// Jen ve vývojovém režimu – ladění a testy (porovnání cache složení s výpočtem od nuly).
if (import.meta.env.DEV) Object.assign(window, { canvasView });
let dock: Dock | null = null;

registerActions(editor, {
  openFile,
  placeImage,
  fitView,
  rulers: {
    get visible() {
      return canvasView.showRulers;
    },
    set visible(v: boolean) {
      canvasView.showRulers = v;
    },
  },
  showPanel: (id) => dock?.showPanel(id),
  closeDocument,
});
const menus = buildMenus(editor.actions);

const historyGroup = new TabbedPanel(editor.actions, [
  { id: 'history', title: 'Historie', element: new HistoryPanel(editor).element, menu: menus.panels.history },
  { id: 'swatches', title: 'Vzorník', element: createSwatchesPanel(editor), menu: menus.panels.swatches },
]);
const layersGroup = new TabbedPanel(editor.actions, [
  { id: 'layers', title: 'Vrstvy', element: new LayersPanel(editor, { row: menus.layerContext, mask: menus.maskContext }).element, menu: menus.panels.layers },
  { id: 'channels', title: 'Kanály', element: createChannelsPanel(), menu: menus.panels.channels },
  { id: 'paths', title: 'Cesty', element: createPathsPanel(), menu: menus.panels.paths },
]);
dock = new Dock(
  [
    [
      { icon: Info, title: 'Info' },
      { icon: SlidersHorizontal, title: 'Vlastnosti' },
    ],
    [{ icon: Paintbrush, title: 'Štětec' }],
    [
      { icon: 'Tt', title: 'Znak' },
      { icon: Pilcrow, title: 'Odstavec' },
    ],
    [
      { icon: 'CSS', title: 'CSS' },
      { icon: ImageIcon, title: 'Galerie' },
    ],
  ],
  [historyGroup, layersGroup],
);

document.querySelector('#app')!.append(
  new MenuBar(editor, menus.menuBar).element,
  new OptionsBar(editor).element,
  h(
    'div',
    { class: 'workspace' },
    new Toolbar(editor, TOOLBAR_GROUPS).element,
    h('div', { class: 'center' }, new DocumentTabs(editor, { close: (id) => void closeDocument(id), openFiles: (files) => void openFiles(files).catch(reportError) }).element, canvasView.element, new StatusBar(editor).element),
    dock.element,
  ),
);

editor.setTool('brush');

// ---- klávesnice ----
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
  if (document.querySelector('dialog[open]')) return;
  if (editor.activeTool?.keyDown?.(e)) {
    e.preventDefault();
    return;
  }
  const action = editor.actions.match(e);
  if (action) {
    e.preventDefault();
    editor.actions.run(action.id);
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
    const tool = editor.tools.byShortcut(e.key) ?? (e.code.startsWith('Key') ? editor.tools.byShortcut(e.code.slice(3)) : undefined);
    if (tool) {
      e.preventDefault();
      editor.setTool(tool.id);
    }
  }
});

function reportError(err: unknown): void {
  alert(`Soubor nejde otevřít: ${err instanceof Error ? err.message : err}`);
}

// ---- automatické ukládání a obnova po pádu / zavření bez uložení ----
async function offerRestore(): Promise<void> {
  const entries = await listAutosaves();
  if (!entries.length) return;
  const names = entries.map((e) => `„${e.fileName}“`).join(', ');
  const restore = await confirmDialog(
    'Obnovit rozpracované dokumenty',
    `Z minulé práce zůstaly neuložené změny: ${names}. Obnovit je? (Zrušit je zahodí.)`,
  );
  const first = editor.sessions[0];
  const untouched = editor.sessions.length === 1 && first.history.entries.length === 0 ? first : null;
  for (const entry of entries) {
    if (restore) {
      try {
        editor.markRestored(editor.openDocument(await loadProject(await entry.blob.arrayBuffer()), entry.fileName));
      } catch (err) {
        console.warn('Obnova dokumentu selhala:', err);
      }
    }
    await deleteAutosave(entry.id);
  }
  // Prázdný výchozí dokument po obnově nepotřebujeme.
  if (untouched && editor.sessions.length > 1) editor.closeDocument(untouched.id);
}

if (typeof indexedDB !== 'undefined') {
  const saver = new AutoSaver(editor);
  void offerRestore()
    .catch((err) => console.warn('Automatické ukládání není dostupné:', err))
    .finally(() => void saver.flush());
}

// Neuložené změny v některé záložce – prohlížeč se před zavřením stránky zeptá.
window.addEventListener('beforeunload', (e) => {
  if (editor.sessions.some((s) => editor.isDirty(s))) e.preventDefault();
});

// Gesta mimo plátno nesmí přibližovat celou stránku (Ctrl + kolečko, sevření prstů v Safari).
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault());

// ---- drag & drop souborů a vkládání ze schránky ----
const area = canvasView.element;
area.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
    area.classList.add('drop-target');
  }
});
area.addEventListener('dragleave', () => area.classList.remove('drop-target'));
area.addEventListener('drop', (e) => {
  area.classList.remove('drop-target');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  e.preventDefault();
  void (async () => {
    for (const file of files) {
      if (isProjectFile(file)) await openFile(file);
      else if (file.type.startsWith('image/')) await placeImage(file, baseName(file.name));
    }
  })().catch((err) => alert(`Soubor nejde otevřít: ${err instanceof Error ? err.message : err}`));
});

/**
 * Ctrl+V: obsah schránky aplikace se vloží na původní místo (jako ve Photoshopu). Obrázek ze systémové
 * schránky, který s ní nesouvisí (jiné rozměry), se vloží doprostřed jako nová vrstva.
 */
window.addEventListener('paste', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const file = item?.getAsFile() ?? null;
  const clip = editor.clipboard;
  if (!file && !clip) return;
  e.preventDefault();
  void (async () => {
    if (file) {
      const bitmap = await createImageBitmap(file);
      const fromApp = clip && bitmap.width === clip.canvas.width && bitmap.height === clip.canvas.height;
      if (!fromApp) {
        editor.addImageLayer(bitmap, 'Vložený obrázek');
        bitmap.close();
        return;
      }
      bitmap.close();
    }
    editor.pasteClipboard();
  })().catch((err) => alert(String(err)));
});
