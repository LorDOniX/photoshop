import type { Action } from '../core/actions';
import { type FillContent, FILL_NAMES, renderFill } from '../core/fillLayer';
import type { Editor } from '../core/Editor';
import type { Layer } from '../core/Layer';
import { GRADIENT_TYPES, type GradientDef, type GradientType } from '../core/paint/gradient';
import { showForm, type FormAccess, type FormField } from '../ui/dialogs';

/*
 * Vrstva → Nová výplňová vrstva → Barva / Přechod / Vzorek a úprava výplně (dvojklik v panelu Vrstvy).
 * Náhled naživo: plátno vrstvy se při každé změně vykreslí znovu; OK = jeden krok historie.
 */

type Values = Pick<FormAccess, 'get'>;

function defaultFill(kind: FillContent['kind'], editor: Editor): FillContent {
  const fg = editor.settings.color;
  const bg = editor.settings.secondaryColor;
  if (kind === 'color') return { kind, color: fg };
  if (kind === 'gradient') {
    const gradient: GradientDef = {
      colors: [
        { pos: 0, color: fg },
        { pos: 1, color: bg },
      ],
      alphas: [
        { pos: 0, opacity: 1 },
        { pos: 1, opacity: 1 },
      ],
    };
    return { kind, gradient, style: 'linear', angle: 90, scale: 1, reverse: false };
  }
  return { kind, patternId: 'builtin:checker', scale: 1 };
}

function fieldsFor(f: FillContent, editor: Editor): FormField[] {
  if (f.kind === 'color') return [{ kind: 'color', key: 'color', label: 'Barva', value: f.color }];
  if (f.kind === 'gradient') {
    return [
      { kind: 'gradient', key: 'gradient', label: 'Přechod', value: f.gradient, fg: editor.settings.color, bg: editor.settings.secondaryColor },
      { kind: 'select', key: 'style', label: 'Styl', value: f.style, options: GRADIENT_TYPES.map((t) => ({ value: t.value, label: t.label })) },
      { kind: 'number', key: 'angle', label: 'Úhel', value: f.angle, min: -180, max: 360, step: 1, unit: '°' },
      { kind: 'number', key: 'scale', label: 'Měřítko', value: Math.round(f.scale * 100), min: 10, max: 150, step: 1, unit: '%' },
      { kind: 'checkbox', key: 'reverse', label: 'Obrátit', value: f.reverse },
    ];
  }
  return [
    { kind: 'pattern', key: 'patternId', label: 'Vzorek', value: f.patternId },
    { kind: 'number', key: 'scale', label: 'Měřítko', value: Math.round(f.scale * 100), min: 1, max: 1000, step: 1, unit: '%' },
  ];
}

function fillFromForm(kind: FillContent['kind'], v: Values): FillContent {
  const num = (k: string) => Number(v.get(k)) || 0;
  if (kind === 'color') return { kind, color: String(v.get('color')) };
  if (kind === 'gradient') {
    return {
      kind,
      gradient: JSON.parse(String(v.get('gradient'))) as GradientDef,
      style: String(v.get('style')) as GradientType,
      angle: num('angle'),
      scale: (num('scale') || 100) / 100,
      reverse: !!v.get('reverse'),
    };
  }
  return { kind, patternId: String(v.get('patternId')), scale: (num('scale') || 100) / 100 };
}

/** Dialog výplně s náhledem přímo ve vrstvě; vrací výslednou výplň nebo null (původní plátno se vrátí vždy). */
async function fillDialog(editor: Editor, layer: Layer, initial: FillContent, title: string): Promise<FillContent | null> {
  const original = layer.canvas;
  let scheduled = false;
  let form: Values | null = null;
  const show = (canvas: HTMLCanvasElement) => {
    layer.setCanvas(canvas);
    editor.doc.notifyPixels(layer.id);
  };
  const v = await showForm(title, fieldsFor(initial, editor), (_key, f) => {
    form = f;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (form) show(renderFill(fillFromForm(initial.kind, form), original.width, original.height));
    });
  });
  form = null;
  show(original);
  return v ? fillFromForm(initial.kind, { get: (k) => v[k] }) : null;
}

/** Vrstva → Nová výplňová vrstva → … */
export async function newFillLayer(editor: Editor, kind: FillContent['kind']): Promise<void> {
  const fill = defaultFill(kind, editor);
  const name = FILL_NAMES[kind];
  const label = `Nová výplňová vrstva: ${name}`;
  const layer = editor.createFillLayer(fill, name);
  const preview = editor.previewNewLayer(layer, label);
  const result = await fillDialog(editor, layer, fill, name);
  if (!result) return preview.cancel();
  layer.setCanvas(renderFill(result, layer.width, layer.height));
  preview.commit();
}

/** Upraví výplň existující výplňové vrstvy. */
export async function editFillLayer(editor: Editor, layer: Layer): Promise<void> {
  const fill = layer.fill;
  if (!fill) return;
  const result = await fillDialog(editor, layer, fill, `${FILL_NAMES[fill.kind]} – ${layer.name}`);
  if (result && JSON.stringify(result) !== JSON.stringify(fill)) editor.setFillContent(layer, result);
}

export function fillLayerActions(editor: Editor, canAddLayer: () => boolean): Action[] {
  return (['color', 'gradient', 'pattern'] as const).map((kind) => ({
    id: `layer.newFill.${kind}`,
    label: `${{ color: 'Barva', gradient: 'Přechod', pattern: 'Vzorek' }[kind]}…`,
    run: () => void newFillLayer(editor, kind),
    isEnabled: canAddLayer,
  }));
}
