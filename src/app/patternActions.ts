import type { Editor } from '../core/Editor';
import { MAX_PATTERN_SIZE, patternFromImage, registerPattern } from '../core/patterns';
import { addUserPattern } from '../io/library';
import { showForm, showMessage } from '../ui/dialogs';
import { showPatternPicker } from '../ui/patternPicker';

/** Naposledy použitý vzorek (Vyplnit vzorkem nabídne ten). */
let lastPatternId = 'builtin:checker';
let counter = 1;

/** Úpravy → Definovat vzorek…: sloučený obraz ve výběru se uloží do knihovny vzorků. */
export async function definePattern(editor: Editor): Promise<void> {
  const image = editor.patternSource();
  if (!image) {
    await showMessage('Definovat vzorek', ['Ve výběru nejsou žádné pixely.']);
    return;
  }
  if (image.width > MAX_PATTERN_SIZE || image.height > MAX_PATTERN_SIZE) {
    await showMessage('Definovat vzorek', [
      `Vzorek může mít nejvýš ${MAX_PATTERN_SIZE} × ${MAX_PATTERN_SIZE} px, výběr má ${image.width} × ${image.height} px.`,
      'Vyberte menší oblast (obdélníkový výběr).',
    ]);
    return;
  }
  const v = await showForm('Definovat vzorek', [
    { kind: 'note', key: 'size', label: `Vzorek ${image.width} × ${image.height} px ze sloučeného obrazu ve výběru.` },
    { kind: 'text', key: 'name', label: 'Název', value: `Vzorek ${counter}`, required: true },
  ]);
  if (!v) return;
  counter++;
  const pattern = patternFromImage(String(v.name).trim() || 'Vzorek', image);
  lastPatternId = pattern.id;
  try {
    addUserPattern(pattern);
  } catch (e) {
    registerPattern(pattern);
    await showMessage('Definovat vzorek', [(e as Error).message, 'Vzorek půjde použít do zavření stránky.']);
  }
}

/** Úpravy → Vyplnit vzorkem…: výběr vzorku a výplň výběru (bez výběru celé vrstvy). */
export async function fillWithPattern(editor: Editor): Promise<void> {
  const id = await showPatternPicker(lastPatternId);
  if (id === null) return;
  lastPatternId = id;
  if (!editor.fillPattern(id) && editor.paintTarget()?.kind === 'mask') {
    await showMessage('Vyplnit vzorkem', ['Do masky vrstvy vzorkem vyplňovat nejde – přepněte na pixely vrstvy.']);
  }
}
