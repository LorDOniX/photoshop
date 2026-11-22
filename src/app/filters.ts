import type { Action } from '../core/actions';
import type { Editor } from '../core/Editor';
import { FadeSession, FilterSession } from '../core/filterSession';
import { defaultFilter, FILTER_NAMES, type Filter, type FilterKind, type FilterOf } from '../core/filters';
import { BLEND_MODES, type BlendMode } from '../core/Layer';
import { withBusy } from '../ui/busy';
import { showForm, showMessage, type FormAccess, type FormField } from '../ui/dialogs';

/*
 * Menu Filtr: dialogy s náhledem naživo nad FilterSession (přepočet nejvýš jednou za snímek), filtry bez
 * nastavení se použijí hned. Poslední filtr (Ctrl+Alt+F) zopakuje poslední použitý filtr se stejným
 * nastavením, Úpravy → Zeslabit (Ctrl+Shift+F) ho prolne s původním stavem.
 */

type Values = Pick<FormAccess, 'get'>;

const slider = (key: string, label: string, value: number, min: number, max: number, step = 1, unit?: string): FormField => ({
  kind: 'number',
  key,
  label,
  value,
  min,
  max,
  step,
  unit,
  slider: true,
});
const num = (f: Values, k: string) => Number(f.get(k)) || 0;

interface FilterSpec<K extends FilterKind> {
  fields(d: FilterOf<K>, editor: Editor): FormField[];
  build(f: Values, d: FilterOf<K>): Filter;
}

const SPECS: { [K in FilterKind]?: FilterSpec<K> } = {
  gaussianBlur: {
    fields: (d) => [slider('radius', 'Poloměr', d.radius, 0.1, 250, 0.1, 'px')],
    build: (f) => ({ kind: 'gaussianBlur', radius: num(f, 'radius') }),
  },
  boxBlur: {
    fields: (d) => [slider('radius', 'Poloměr', d.radius, 1, 200, 1, 'px')],
    build: (f) => ({ kind: 'boxBlur', radius: num(f, 'radius') }),
  },
  motionBlur: {
    fields: (d) => [slider('angle', 'Úhel', d.angle, -90, 90, 1, '°'), slider('distance', 'Vzdálenost', d.distance, 1, 200, 1, 'px')],
    build: (f) => ({ kind: 'motionBlur', angle: num(f, 'angle'), distance: num(f, 'distance') || 1 }),
  },
  addNoise: {
    fields: (d) => [
      slider('amount', 'Míra', d.amount, 0.1, 400, 0.1, '%'),
      {
        kind: 'select',
        key: 'distribution',
        label: 'Rozložení',
        value: d.gaussian ? 'gaussian' : 'uniform',
        options: [
          { value: 'uniform', label: 'Rovnoměrné' },
          { value: 'gaussian', label: 'Gaussovo' },
        ],
      },
      { kind: 'checkbox', key: 'mono', label: 'Monochromatický', value: d.monochromatic },
    ],
    build: (f, d) => ({ kind: 'addNoise', amount: num(f, 'amount'), gaussian: f.get('distribution') === 'gaussian', monochromatic: !!f.get('mono'), seed: d.seed }),
  },
  median: {
    fields: (d) => [slider('radius', 'Poloměr', d.radius, 1, 50, 1, 'px')],
    build: (f) => ({ kind: 'median', radius: num(f, 'radius') || 1 }),
  },
  unsharpMask: {
    fields: (d) => [slider('amount', 'Míra', d.amount, 1, 500, 1, '%'), slider('radius', 'Poloměr', d.radius, 0.1, 250, 0.1, 'px'), slider('threshold', 'Práh', d.threshold, 0, 255, 1, 'úrovní')],
    build: (f) => ({ kind: 'unsharpMask', amount: num(f, 'amount'), radius: num(f, 'radius') || 0.1, threshold: num(f, 'threshold') }),
  },
  highPass: {
    fields: (d) => [slider('radius', 'Poloměr', d.radius, 0.1, 250, 0.1, 'px')],
    build: (f) => ({ kind: 'highPass', radius: num(f, 'radius') || 0.1 }),
  },
  offset: {
    fields: (d, editor) => [
      slider('dx', 'Vodorovně', d.dx, -editor.doc.width, editor.doc.width, 1, 'px'),
      slider('dy', 'Svisle', d.dy, -editor.doc.height, editor.doc.height, 1, 'px'),
      {
        kind: 'select',
        key: 'mode',
        label: 'Uvolněné místo',
        value: d.mode,
        options: [
          { value: 'wrap', label: 'Zalomit' },
          { value: 'repeat', label: 'Opakovat okrajové pixely' },
          { value: 'transparent', label: 'Průhledné' },
        ],
      },
    ],
    build: (f) => ({ kind: 'offset', dx: num(f, 'dx'), dy: num(f, 'dy'), mode: String(f.get('mode')) as 'wrap' | 'repeat' | 'transparent' }),
  },
  mosaic: {
    fields: (d) => [slider('size', 'Velikost buňky', d.size, 2, 200, 1, 'px')],
    build: (f) => ({ kind: 'mosaic', size: num(f, 'size') || 2 }),
  },
  colorToAlpha: {
    fields: (d) => [{ kind: 'color', key: 'color', label: 'Barva', value: d.color }],
    build: (f) => ({ kind: 'colorToAlpha', color: String(f.get('color')) }),
  },
  radialBlur: {
    fields: (d) => [
      slider('amount', 'Míra', d.amount, 1, 100),
      {
        kind: 'select',
        key: 'mode',
        label: 'Metoda',
        value: d.mode,
        options: [
          { value: 'spin', label: 'Otočením' },
          { value: 'zoom', label: 'Přiblížením' },
        ],
      },
    ],
    build: (f) => ({ kind: 'radialBlur', amount: num(f, 'amount') || 1, mode: f.get('mode') === 'zoom' ? 'zoom' : 'spin' }),
  },
  twirl: {
    fields: (d) => [slider('angle', 'Úhel', d.angle, -999, 999, 1, '°')],
    build: (f) => ({ kind: 'twirl', angle: num(f, 'angle') }),
  },
  pinch: {
    fields: (d) => [slider('amount', 'Míra', d.amount, -100, 100, 1, '%')],
    build: (f) => ({ kind: 'pinch', amount: num(f, 'amount') }),
  },
  spherize: {
    fields: (d) => [slider('amount', 'Míra', d.amount, -100, 100, 1, '%')],
    build: (f) => ({ kind: 'spherize', amount: num(f, 'amount') }),
  },
  ripple: {
    fields: (d) => [
      slider('amount', 'Míra', d.amount, -999, 999, 1, '%'),
      {
        kind: 'select',
        key: 'size',
        label: 'Velikost',
        value: String(d.size),
        options: [
          { value: '8', label: 'Malá' },
          { value: '16', label: 'Střední' },
          { value: '32', label: 'Velká' },
        ],
      },
    ],
    build: (f) => ({ kind: 'ripple', amount: num(f, 'amount'), size: num(f, 'size') || 16 }),
  },
  polar: {
    fields: (d) => [
      {
        kind: 'select',
        key: 'direction',
        label: 'Převod',
        value: d.toPolar ? 'to' : 'from',
        options: [
          { value: 'to', label: 'Obdélníkové → polární' },
          { value: 'from', label: 'Polární → obdélníkové' },
        ],
      },
    ],
    build: (f) => ({ kind: 'polar', toPolar: f.get('direction') !== 'from' }),
  },
  emboss: {
    fields: (d) => [slider('angle', 'Úhel', d.angle, -180, 180, 1, '°'), slider('height', 'Výška', d.height, 1, 20, 1, 'px'), slider('amount', 'Míra', d.amount, 1, 500, 1, '%')],
    build: (f) => ({ kind: 'emboss', angle: num(f, 'angle'), height: num(f, 'height') || 1, amount: num(f, 'amount') || 1 }),
  },
};

/** Poslední použitý filtr (Ctrl+Alt+F) a nastavení posledního dialogu každého filtru. */
let lastFilter: Filter | null = null;
const remembered = new Map<FilterKind, Filter>();

function cannotFilter(editor: Editor): Promise<void> {
  const layer = editor.doc.activeLayer;
  const why = !layer
    ? 'Není vybraná žádná vrstva.'
    : layer.isGroup
      ? 'Skupinu nejde filtrovat – vyberte vrstvu.'
      : layer.adjustment && !layer.mask
        ? 'Vrstva úprav nemá masku.'
        : 'Pixely vrstvy jsou zamčené.';
  return showMessage('Filtr', [why]);
}

/** Použije filtr bez dialogu. */
async function applyNow(editor: Editor, f: Filter): Promise<void> {
  const session = FilterSession.start(editor);
  if (!session) return cannotFilter(editor);
  if (await withBusy(session.commitWith(f, FILTER_NAMES[f.kind]))) lastFilter = f;
}

async function filterDialog<K extends FilterKind>(editor: Editor, kind: K): Promise<void> {
  const spec = SPECS[kind] as FilterSpec<K> | undefined;
  // Mraky: barvy popředí a pozadí, pokaždé jiný šum (Poslední filtr zopakuje stejný).
  if (kind === 'clouds') {
    return applyNow(editor, { kind: 'clouds', fg: editor.settings.color, bg: editor.settings.secondaryColor, scale: Math.max(32, Math.min(editor.doc.width, editor.doc.height) / 4), seed: Math.floor(Math.random() * 1e9) });
  }
  if (!spec) return applyNow(editor, defaultFilter(kind));
  const session = FilterSession.start(editor);
  if (!session) return cannotFilter(editor);
  const initial = structuredClone((remembered.get(kind) as FilterOf<K> | undefined) ?? defaultFilter(kind));
  // Šum: nové semínko při každém otevření (v náhledu i po OK stejné).
  const f0: Filter = initial;
  if (f0.kind === 'addNoise') f0.seed = Math.floor(Math.random() * 1e9);
  let scheduled = false;
  let fullTimer = 0;
  let form: Values | null = null;
  const title = FILTER_NAMES[kind];
  // Náhled: hned (u velké oblasti zmenšený), plné rozlišení po krátké pauze ve změnách.
  const preview = (draft: boolean) => {
    if (form) void session.update(form.get('preview') ? spec.build(form, initial) : null, draft);
  };
  const v = await showForm(title, [...spec.fields(initial, editor), { kind: 'checkbox', key: 'preview', label: 'Náhled', value: true }], (_key, f) => {
    form = f;
    window.clearTimeout(fullTimer);
    if (session.large) fullTimer = window.setTimeout(() => preview(false), 250);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      preview(session.large);
    });
  });
  window.clearTimeout(fullTimer);
  form = null;
  if (!v) return session.cancel();
  const f = spec.build({ get: (k) => v[k] }, initial);
  if (await withBusy(session.commitWith(f, title))) {
    lastFilter = f;
    remembered.set(kind, f);
  }
}

async function fade(editor: Editor): Promise<void> {
  const session = FadeSession.start(editor);
  if (!session) return;
  let form: Values | null = null;
  let scheduled = false;
  const v = await showForm(
    `Zeslabit: ${session.label}`,
    [
      slider('opacity', 'Krytí', 100, 0, 100, 1, '%'),
      { kind: 'select', key: 'blend', label: 'Režim', value: 'source-over', options: BLEND_MODES.map((m) => ({ value: m.value, label: m.label })) },
      { kind: 'checkbox', key: 'preview', label: 'Náhled', value: true },
    ],
    (_key, f) => {
      form = f;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (form) session.update(form.get('preview') ? num(form, 'opacity') / 100 : 1, form.get('preview') ? (String(form.get('blend')) as BlendMode) : 'source-over');
      });
    },
  );
  form = null;
  if (!v) return session.cancel();
  session.update(num({ get: (k) => v[k] }, 'opacity') / 100, String(v.blend) as BlendMode);
  session.commit();
}

/** Filtry v pořadí menu. */
export const FILTER_MENU: Array<[string, FilterKind[]]> = [
  ['Rozostření', ['average', 'gaussianBlur', 'boxBlur', 'motionBlur', 'radialBlur']],
  ['Zkreslení', ['pinch', 'polar', 'ripple', 'spherize', 'twirl']],
  ['Šum', ['addNoise', 'despeckle', 'median']],
  ['Pixelizace', ['mosaic']],
  ['Vykreslit', ['clouds']],
  ['Zostření', ['sharpen', 'sharpenMore', 'unsharpMask']],
  ['Stylizace', ['emboss', 'findEdges', 'solarize']],
  ['Jiné', ['highPass', 'offset', 'colorToAlpha']],
];

export function filterActions(editor: Editor): Action[] {
  const canFilter = () => {
    const l = editor.doc.activeLayer;
    return !!l && !l.isGroup && (!l.adjustment || !!l.mask);
  };
  const kinds = FILTER_MENU.flatMap(([, k]) => k);
  return [
    ...kinds.map(
      (kind): Action => ({
        id: `filter.${kind}`,
        label: `${FILTER_NAMES[kind]}${SPECS[kind] ? '…' : ''}`,
        run: () => void filterDialog(editor, kind),
        isEnabled: canFilter,
      }),
    ),
    {
      id: 'filter.last',
      label: 'Poslední filtr',
      shortcuts: ['Ctrl+Alt+F'],
      run: () => {
        if (lastFilter) void applyNow(editor, lastFilter);
      },
      isEnabled: () => canFilter() && lastFilter !== null,
    },
    {
      id: 'edit.fade',
      label: 'Zeslabit…',
      shortcuts: ['Ctrl+Shift+F'],
      run: () => void fade(editor),
      isEnabled: () => editor.lastFadeable() !== null,
    },
  ];
}
