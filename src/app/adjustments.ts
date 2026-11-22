import type { Action } from '../core/actions';
import {
  ADJUSTMENT_NAMES,
  autoLevels,
  CHANNEL_NAMES,
  CHANNELS,
  curveLut,
  defaultAdjustment,
  histogram,
  LAYER_ADJUSTMENT_KINDS,
  type Adjustment,
  type AdjustmentKind,
  type AdjustmentOf,
  type BalanceTriple,
  type Channel,
  type CurvePoint,
  type LevelsChannel,
} from '../core/adjust';
import { AdjustmentSession, applyAdjustmentNow } from '../core/adjustSession';
import { createCanvas, get2d } from '../core/canvas';
import type { Editor } from '../core/Editor';
import type { Layer } from '../core/Layer';
import type { GradientDef } from '../core/paint/gradient';
import { compositeLayers } from '../render/composite';
import { withBusy } from '../ui/busy';
import { showForm, showMessage, type FormAccess, type FormField } from '../ui/dialogs';
import { h } from '../ui/dom';

/*
 * Obraz → Úpravy a vrstvy úprav: dialogy s náhledem naživo. Cíl úpravy je buď vrstva (trvalá změna pixelů,
 * AdjustmentSession), nebo vrstva úprav (mění se jen její nastavení). Přepočet nejvýš jednou za snímek,
 * OK = jeden krok historie, Zrušit vrátí původní stav.
 */

type Values = Pick<FormAccess, 'get'>;

/** Na co dialog úpravu aplikuje. */
interface AdjustTarget {
  /** Barvy, ze kterých se počítá histogram a automatické úrovně. */
  readonly pixels: Uint8ClampedArray;
  readonly weights: Uint8Array | null;
  histogram(channel: Channel): Uint32Array;
  /** Je oblast tak velká, že se během úprav vyplatí zmenšený náhled? */
  readonly large: boolean;
  /** Náhled; null = bez úpravy (vypnutý Náhled), `draft` = zmenšený náhled. */
  preview(a: Adjustment | null, draft: boolean): void;
  /** Konec dialogu: úprava = potvrdit, null = zrušit. */
  finish(a: Adjustment | null): void | Promise<unknown>;
}

/** Trvalá úprava pixelů aktivní vrstvy (Obraz → Úpravy). */
function sessionTarget(session: AdjustmentSession, label: string): AdjustTarget {
  return {
    pixels: session.pixels,
    weights: session.weights,
    histogram: (c) => session.histogram(c),
    large: session.large,
    preview: (a, draft) => void session.update(a, draft),
    finish: (a) => (a ? withBusy(session.commitWith(a, label)) : session.cancel()),
  };
}

/** Složený obraz pod vrstvou (histogram vrstvy úprav). */
function compositeBelow(editor: Editor, layer: Layer): Uint8ClampedArray {
  const { doc } = editor;
  const c = createCanvas(doc.width, doc.height);
  compositeLayers(get2d(c), doc.layers.slice(0, doc.indexOf(layer.id)));
  return get2d(c).getImageData(0, 0, c.width, c.height).data;
}

/** Nastavení vrstvy úprav (náhled změnou vlastnosti, `onFinish` rozhodne o historii). */
function layerTarget(editor: Editor, layer: Layer, onFinish: (a: Adjustment | null) => void): AdjustTarget {
  const before = layer.adjustment;
  const visible = layer.visible;
  const pixels = compositeBelow(editor, layer);
  return {
    pixels,
    weights: null,
    histogram: (c) => histogram(pixels, c),
    large: false,
    preview: (a) => editor.doc.updateLayer(layer.id, a ? { adjustment: a, visible } : { visible: false }),
    finish: (a) => {
      editor.doc.updateLayer(layer.id, { adjustment: before, visible });
      onFinish(a);
    },
  };
}

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

/** Popis dialogu jedné úpravy: pole z počátečních hodnot a úprava z hodnot formuláře. */
interface DialogSpec<K extends AdjustmentKind> {
  fields(d: AdjustmentOf<K>, target: AdjustTarget, editor: Editor): FormField[];
  build(f: Values, d: AdjustmentOf<K>): Adjustment;
  onChange?(key: string, form: FormAccess, refresh: () => void): void;
}

/** Společný průběh dialogu: náhled naživo, Náhled (zap./vyp.), potvrzení. */
async function runDialog<K extends AdjustmentKind>(editor: Editor, kind: K, spec: DialogSpec<K>, target: AdjustTarget, initial: AdjustmentOf<K>, title = ADJUSTMENT_NAMES[kind]): Promise<void> {
  let scheduled = false;
  let fullTimer = 0;
  let form: FormAccess | null = null;
  // Náhled: hned (u velké oblasti zmenšený), plné rozlišení po krátké pauze ve změnách.
  const preview = (draft: boolean) => {
    if (form) target.preview(form.get('preview') ? spec.build(form, initial) : null, draft);
  };
  const refresh = () => {
    window.clearTimeout(fullTimer);
    if (target.large) fullTimer = window.setTimeout(() => preview(false), 250);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      preview(target.large);
    });
  };
  const v = await showForm(title, [...spec.fields(initial, target, editor), { kind: 'checkbox', key: 'preview', label: 'Náhled', value: true }], (key, f) => {
    form = f;
    spec.onChange?.(key, f, refresh);
    refresh();
  });
  // Náhled naplánovaný po zavření dialogu už nic nezmění.
  window.clearTimeout(fullTimer);
  form = null;
  await target.finish(v ? spec.build({ get: (k) => v[k] }, initial) : null);
}

function cannotAdjust(editor: Editor): Promise<void> {
  const layer = editor.doc.activeLayer;
  const why = !layer
    ? 'Není vybraná žádná vrstva.'
    : layer.isGroup
      ? 'Skupinu nejde upravit – vyberte vrstvu.'
      : layer.adjustment
        ? 'Vrstva úprav nemá pixely – upravte vrstvu pod ní, nebo nastavení vrstvy úprav (dvojklik v panelu Vrstvy).'
        : 'Pixely vrstvy jsou zamčené.';
  return showMessage('Úpravy', [why]);
}

// ---- jednoduché úpravy s posuvníky ----

const TONES = [
  ['shadows', 'Stíny'],
  ['midtones', 'Střední tóny'],
  ['highlights', 'Světla'],
] as const;
const AXES = ['Azurová – Červená', 'Purpurová – Zelená', 'Žlutá – Modrá'];
const BW_KEYS = [
  ['reds', 'Červené'],
  ['yellows', 'Žluté'],
  ['greens', 'Zelené'],
  ['cyans', 'Azurové'],
  ['blues', 'Modré'],
  ['magentas', 'Purpurové'],
] as const;

const SPECS: { [K in AdjustmentKind]?: DialogSpec<K> } = {
  brightnessContrast: {
    fields: (d) => [slider('brightness', 'Jas', d.brightness, -150, 150), slider('contrast', 'Kontrast', d.contrast, -50, 100)],
    build: (f) => ({ kind: 'brightnessContrast', brightness: num(f, 'brightness'), contrast: num(f, 'contrast') }),
  },
  exposure: {
    fields: (d) => [slider('exposure', 'Expozice', d.exposure, -5, 5, 0.01), slider('offset', 'Posun', d.offset, -0.5, 0.5, 0.001), slider('gamma', 'Korekce gama', d.gamma, 0.01, 9.99, 0.01)],
    build: (f) => ({ kind: 'exposure', exposure: num(f, 'exposure'), offset: num(f, 'offset'), gamma: num(f, 'gamma') || 1 }),
  },
  vibrance: {
    fields: (d) => [slider('vibrance', 'Živost', d.vibrance, -100, 100), slider('saturation', 'Sytost', d.saturation, -100, 100)],
    build: (f) => ({ kind: 'vibrance', vibrance: num(f, 'vibrance'), saturation: num(f, 'saturation') }),
  },
  hueSaturation: {
    fields: (d) => [
      slider('hue', 'Odstín', d.hue, -180, 180, 1, '°'),
      slider('saturation', 'Sytost', d.saturation, -100, 100),
      slider('lightness', 'Světlost', d.lightness, -100, 100),
      { kind: 'checkbox', key: 'colorize', label: 'Kolorovat', value: d.colorize },
    ],
    build: (f) => ({ kind: 'hueSaturation', hue: num(f, 'hue'), saturation: num(f, 'saturation'), lightness: num(f, 'lightness'), colorize: !!f.get('colorize') }),
    onChange: (key, form) => {
      // Kolorovat začne modrošedou (odstín 210, sytost −50 = 25 %).
      if (key === 'colorize' && form.get('colorize') && num(form, 'hue') === 0 && num(form, 'saturation') === 0) {
        form.set('hue', 210);
        form.set('saturation', -50);
      }
    },
  },
  colorBalance: {
    fields: (d) => [
      ...TONES.flatMap(([tone, name]) => [
        { kind: 'element', key: `h-${tone}`, element: h('div', { class: 'dialog-heading' }, name) } as FormField,
        ...AXES.map((axis, i) => slider(`${tone}${i}`, axis, d[tone][i], -100, 100)),
      ]),
      { kind: 'checkbox', key: 'preserve', label: 'Zachovat světlost', value: d.preserveLuminosity },
    ],
    build: (f) => {
      const triple = (tone: string): BalanceTriple => [num(f, `${tone}0`), num(f, `${tone}1`), num(f, `${tone}2`)];
      return { kind: 'colorBalance', shadows: triple('shadows'), midtones: triple('midtones'), highlights: triple('highlights'), preserveLuminosity: !!f.get('preserve') };
    },
  },
  blackWhite: {
    fields: (d) => [
      ...BW_KEYS.map(([k, label]) => slider(k, label, d[k], -200, 300, 1, '%')),
      { kind: 'checkbox', key: 'tint', label: 'Tónovat', value: d.tint },
      { kind: 'color', key: 'tintColor', label: 'Barva tónu', value: d.tintColor },
    ],
    build: (f) => ({
      kind: 'blackWhite',
      reds: num(f, 'reds'),
      yellows: num(f, 'yellows'),
      greens: num(f, 'greens'),
      cyans: num(f, 'cyans'),
      blues: num(f, 'blues'),
      magentas: num(f, 'magentas'),
      tint: !!f.get('tint'),
      tintColor: String(f.get('tintColor')),
    }),
    onChange: (key, form) => {
      if (key === 'tintColor') form.set('tint', true);
    },
  },
  photoFilter: {
    fields: (d) => [
      { kind: 'color', key: 'color', label: 'Barva filtru', value: d.color },
      slider('density', 'Hustota', d.density, 1, 100, 1, '%'),
      { kind: 'checkbox', key: 'preserve', label: 'Zachovat světlost', value: d.preserveLuminosity },
    ],
    build: (f) => ({ kind: 'photoFilter', color: String(f.get('color')), density: num(f, 'density'), preserveLuminosity: !!f.get('preserve') }),
  },
  posterize: {
    fields: (d) => [slider('levels', 'Úrovně', d.levels, 2, 255)],
    build: (f) => ({ kind: 'posterize', levels: num(f, 'levels') || 4 }),
  },
  threshold: {
    fields: (d, t) => [histogramElement(t.histogram('rgb')), slider('level', 'Úroveň prahu', d.level, 1, 255)],
    build: (f) => ({ kind: 'threshold', level: num(f, 'level') || 128 }),
  },
  gradientMap: {
    fields: (d, _t, editor) => [
      { kind: 'gradient', key: 'gradient', label: 'Přechod', value: d.gradient, fg: editor.settings.color, bg: editor.settings.secondaryColor },
      { kind: 'checkbox', key: 'reverse', label: 'Obrátit', value: d.reverse },
    ],
    build: (f) => ({ kind: 'gradientMap', gradient: JSON.parse(String(f.get('gradient'))) as GradientDef, reverse: !!f.get('reverse') }),
  },
};

// ---- histogram ----

/** Plátno s histogramem (nejvyšší sloupec bez extrémů – čistě černé / bílé plochy by ho zploštily). */
function drawHistogram(canvas: HTMLCanvasElement, hist: Uint32Array, color = '#cfcfcf'): void {
  const ctx = get2d(canvas);
  const { width: w, height: hgt } = canvas;
  ctx.clearRect(0, 0, w, hgt);
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, w, hgt);
  const sorted = [...hist].sort((a, b) => b - a);
  const top = Math.max(1, sorted[2] ?? sorted[0]);
  ctx.fillStyle = color;
  for (let i = 0; i < 256; i++) {
    const bar = Math.round(Math.min(1, hist[i] / top) * (hgt - 2));
    ctx.fillRect(Math.floor((i / 256) * w), hgt - bar, Math.ceil(w / 256), bar);
  }
}

function histogramElement(hist: Uint32Array): FormField {
  const canvas = h('canvas', { class: 'adjust-histogram', width: 256, height: 90 });
  drawHistogram(canvas, hist);
  return { kind: 'element', key: 'histogram', element: canvas };
}

const CHANNEL_COLORS: Record<Channel, string> = { rgb: '#cfcfcf', r: '#e05555', g: '#55c055', b: '#5580e0' };

const channelSelect = (value: Channel): FormField => ({
  kind: 'select',
  key: 'channel',
  label: 'Kanál',
  value,
  options: CHANNELS.map((c) => ({ value: c, label: CHANNEL_NAMES[c] })),
});

// ---- úrovně ----

const LEVEL_FIELDS: Array<[keyof LevelsChannel, string, number, number, number]> = [
  ['inBlack', 'Vstup – černá', 0, 253, 1],
  ['gamma', 'Vstup – gama', 0.1, 9.99, 0.01],
  ['inWhite', 'Vstup – bílá', 2, 255, 1],
  ['outBlack', 'Výstup – černá', 0, 255, 1],
  ['outWhite', 'Výstup – bílá', 0, 255, 1],
];

function levelsSpec(): DialogSpec<'levels'> {
  let adj = defaultAdjustment('levels');
  let channel: Channel = 'rgb';
  let target: AdjustTarget | null = null;
  let access: FormAccess | null = null;
  let refreshFn: () => void = () => {};
  const canvas = h('canvas', { class: 'adjust-histogram', width: 256, height: 110 });
  const showChannel = () => {
    if (!target || !access) return;
    drawHistogram(canvas, target.histogram(channel), CHANNEL_COLORS[channel]);
    for (const [k] of LEVEL_FIELDS) access.set(k, adj.channels[channel][k]);
  };
  const auto = (mode: 'tone' | 'contrast') => {
    if (!target) return;
    adj = autoLevels(target.pixels, mode, target.weights ?? undefined);
    showChannel();
    refreshFn();
  };
  const buttons = h(
    'div',
    { class: 'adjust-buttons' },
    h('button', { type: 'button', onClick: () => auto('tone'), title: 'Automatický tón – každý kanál zvlášť' }, 'Automaticky'),
    h('button', { type: 'button', onClick: () => auto('contrast'), title: 'Automatický kontrast – barvy zůstanou' }, 'Kontrast'),
    h(
      'button',
      {
        type: 'button',
        onClick: () => {
          adj = defaultAdjustment('levels');
          showChannel();
          refreshFn();
        },
      },
      'Obnovit',
    ),
  );
  return {
    fields: (d, t) => {
      adj = structuredClone(d);
      target = t;
      return [
        channelSelect('rgb'),
        { kind: 'element', key: 'histogram', element: canvas },
        ...LEVEL_FIELDS.map(([k, label, min, max, step]) => slider(k, label, d.channels.rgb[k], min, max, step)),
        { kind: 'element', key: 'buttons', element: buttons },
      ];
    },
    build: () => structuredClone(adj),
    onChange: (key, form, refresh) => {
      access = form;
      refreshFn = refresh;
      if (key === '') return showChannel();
      if (key === 'channel') {
        channel = String(form.get('channel')) as Channel;
        return showChannel();
      }
      const field = LEVEL_FIELDS.find((f) => f[0] === key);
      if (!field) return;
      const c = adj.channels[channel];
      c[field[0]] = num(form, key);
      // Černá vstupu musí zůstat pod bílou.
      if (c.inBlack >= c.inWhite - 1) {
        if (key === 'inBlack') c.inBlack = c.inWhite - 2;
        else c.inWhite = c.inBlack + 2;
        form.set('inBlack', c.inBlack);
        form.set('inWhite', c.inWhite);
      }
    },
  };
}

// ---- křivky ----

/** Editor křivky: plátno 256 × 256, body jde přidat klikem, táhnout a odtažením mimo graf smazat. */
class CurveEditor {
  readonly element: HTMLCanvasElement;
  points: CurvePoint[] = [];
  selected = -1;
  private hist: Uint32Array | null = null;
  private color = CHANNEL_COLORS.rgb;
  onChange: () => void = () => {};
  onSelect: () => void = () => {};

  constructor() {
    this.element = h('canvas', { class: 'curve-editor', width: 256, height: 256 });
    this.element.addEventListener('pointerdown', (e) => this.down(e));
  }

  set(points: CurvePoint[], hist: Uint32Array, color: string): void {
    this.points = points;
    this.hist = hist;
    this.color = color;
    this.selected = -1;
    this.draw();
  }

  private toValue(e: PointerEvent | MouseEvent): CurvePoint {
    const r = this.element.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 255, y: 255 - ((e.clientY - r.top) / r.height) * 255 };
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    const v = this.toValue(e);
    const scale = 255 / this.element.getBoundingClientRect().width;
    let index = this.points.findIndex((p) => Math.hypot(p.x - v.x, p.y - v.y) < 8 * scale);
    if (index < 0) {
      const point = { x: Math.round(Math.max(0, Math.min(255, v.x))), y: Math.round(Math.max(0, Math.min(255, v.y))) };
      if (this.points.some((p) => p.x === point.x)) return;
      this.points.push(point);
      this.points.sort((a, b) => a.x - b.x);
      index = this.points.indexOf(point);
      this.onChange();
    }
    this.selected = index;
    this.onSelect();
    this.draw();
    const point = this.points[index];
    let removed = false;
    const move = (ev: PointerEvent) => {
      const p = this.toValue(ev);
      const i = this.points.indexOf(point);
      removed = (p.x < -20 || p.x > 275 || p.y < -20 || p.y > 275) && this.points.length > 2;
      const lo = i > 0 ? this.points[i - 1].x + 1 : 0;
      const hi = i < this.points.length - 1 ? this.points[i + 1].x - 1 : 255;
      point.x = Math.round(Math.max(lo, Math.min(hi, p.x)));
      point.y = Math.round(Math.max(0, Math.min(255, p.y)));
      this.element.classList.toggle('removing', removed);
      this.draw(removed ? point : null);
      this.onSelect();
      this.onChange();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.element.classList.remove('removing');
      if (removed) {
        this.points.splice(this.points.indexOf(point), 1);
        this.selected = -1;
        this.onSelect();
        this.onChange();
      }
      this.draw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  draw(hidden: CurvePoint | null = null): void {
    const ctx = get2d(this.element);
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, 256, 256);
    if (this.hist) {
      const sorted = [...this.hist].sort((a, b) => b - a);
      const top = Math.max(1, sorted[2] ?? 1);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < 256; i++) {
        const bar = Math.min(1, this.hist[i] / top) * 255;
        ctx.fillRect(i, 256 - bar, 1, bar);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo(i * 64 + 0.5, 0);
      ctx.lineTo(i * 64 + 0.5, 256);
      ctx.moveTo(0, i * 64 + 0.5);
      ctx.lineTo(256, i * 64 + 0.5);
    }
    ctx.moveTo(0, 256);
    ctx.lineTo(256, 0);
    ctx.stroke();
    const lut = curveLut(hidden ? this.points.filter((p) => p !== hidden) : this.points);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) {
      if (x === 0) ctx.moveTo(x + 0.5, 255.5 - lut[x]);
      else ctx.lineTo(x + 0.5, 255.5 - lut[x]);
    }
    ctx.stroke();
    this.points.forEach((p, i) => {
      ctx.fillStyle = p === hidden ? 'rgba(255,255,255,0.25)' : i === this.selected ? '#fff' : '#1e1e1e';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.fillRect(p.x - 3.5, 255 - p.y - 3.5, 7, 7);
      ctx.strokeRect(p.x - 3.5, 255 - p.y - 3.5, 7, 7);
    });
  }
}

function curvesSpec(): DialogSpec<'curves'> {
  let adj = defaultAdjustment('curves');
  let channel: Channel = 'rgb';
  const curve = new CurveEditor();
  let target: AdjustTarget | null = null;
  let access: FormAccess | null = null;
  let refreshFn: () => void = () => {};
  let syncing = false;
  const showPoint = () => {
    if (!access) return;
    const p = curve.points[curve.selected];
    syncing = true;
    access.set('in', p ? p.x : 0);
    access.set('out', p ? p.y : 0);
    syncing = false;
  };
  const showChannel = () => {
    if (!target) return;
    curve.set(adj.channels[channel], target.histogram(channel), CHANNEL_COLORS[channel]);
    showPoint();
  };
  curve.onChange = () => refreshFn();
  curve.onSelect = showPoint;
  const reset = h(
    'button',
    {
      type: 'button',
      onClick: () => {
        adj.channels[channel] = defaultAdjustment('curves').channels[channel];
        showChannel();
        refreshFn();
      },
    },
    'Obnovit kanál',
  );
  return {
    fields: (d, t) => {
      adj = structuredClone(d);
      target = t;
      return [
        channelSelect('rgb'),
        { kind: 'element', key: 'curve', element: h('div', { class: 'curve-wrap' }, curve.element) },
        { kind: 'note', key: 'hint', label: 'Klik přidá bod, tažením se posouvá, odtažením mimo graf se smaže.' },
        { kind: 'number', key: 'in', label: 'Vstup', value: 0, min: 0, max: 255, step: 1 },
        { kind: 'number', key: 'out', label: 'Výstup', value: 0, min: 0, max: 255, step: 1 },
        { kind: 'element', key: 'buttons', element: h('div', { class: 'adjust-buttons' }, reset) },
      ];
    },
    build: () => structuredClone(adj),
    onChange: (key, form, refresh) => {
      access = form;
      refreshFn = refresh;
      if (key === '') return showChannel();
      if (key === 'channel') {
        channel = String(form.get('channel')) as Channel;
        return showChannel();
      }
      if ((key === 'in' || key === 'out') && !syncing) {
        const i = curve.selected;
        const p = curve.points[i];
        if (!p) return;
        const lo = i > 0 ? curve.points[i - 1].x + 1 : 0;
        const hi = i < curve.points.length - 1 ? curve.points[i + 1].x - 1 : 255;
        if (key === 'in') p.x = Math.max(lo, Math.min(hi, Math.round(num(form, 'in'))));
        else p.y = Math.max(0, Math.min(255, Math.round(num(form, 'out'))));
        curve.draw();
      }
    },
  };
}

/** Dialog úpravy daného druhu (Úrovně a Křivky mají stav, proto se tvoří znovu). */
function specFor<K extends AdjustmentKind>(kind: K): DialogSpec<K> | null {
  if (kind === 'levels') return levelsSpec() as unknown as DialogSpec<K>;
  if (kind === 'curves') return curvesSpec() as unknown as DialogSpec<K>;
  return (SPECS[kind] as DialogSpec<K> | undefined) ?? null;
}

/** Úpravy, které mají dialog (Invertovat a Odbarvit ne). */
export const DIALOG_KINDS: AdjustmentKind[] = [
  'brightnessContrast',
  'levels',
  'curves',
  'exposure',
  'vibrance',
  'hueSaturation',
  'colorBalance',
  'blackWhite',
  'photoFilter',
  'posterize',
  'threshold',
  'gradientMap',
];

/** Počáteční hodnoty nové úpravy (mapa přechodu začíná přechodem popředí → pozadí jako Photoshop). */
function initialFor<K extends AdjustmentKind>(kind: K, editor: Editor): AdjustmentOf<K> {
  const a: Adjustment = defaultAdjustment(kind);
  if (a.kind === 'gradientMap') {
    a.gradient.colors[0].color = editor.settings.color;
    a.gradient.colors[1].color = editor.settings.secondaryColor;
  }
  return a as AdjustmentOf<K>;
}

/** Obraz → Úpravy → …: dialog s trvalou úpravou pixelů aktivní vrstvy. */
async function adjustPixels(editor: Editor, kind: AdjustmentKind): Promise<void> {
  const spec = specFor(kind);
  const session = AdjustmentSession.start(editor);
  if (!spec || !session) return cannotAdjust(editor);
  await runDialog(editor, kind, spec, sessionTarget(session, ADJUSTMENT_NAMES[kind]), initialFor(kind, editor));
}

// ---- vrstvy úprav ----

/** Vrstva → Nová vrstva úprav → …: vrstva nad aktivní, s maskou z výběru; dialog s náhledem. */
export async function newAdjustmentLayer(editor: Editor, kind: AdjustmentKind): Promise<void> {
  const name = ADJUSTMENT_NAMES[kind];
  const label = `Nová vrstva úprav: ${name}`;
  const initial = initialFor(kind, editor);
  const layer = editor.createAdjustmentLayer(initial, name);
  const spec = specFor(kind);
  if (!spec) {
    editor.addSpecialLayer(layer, label);
    return;
  }
  const preview = editor.previewNewLayer(layer, label);
  const target = layerTarget(editor, layer, (a) => {
    if (!a) return preview.cancel();
    layer.adjustment = a;
    preview.commit();
  });
  await runDialog(editor, kind, spec, target, initial);
}

/** Upraví nastavení vrstvy úprav (dvojklik v panelu Vrstvy, Vrstva → Upravit obsah vrstvy). */
export async function editAdjustmentLayer(editor: Editor, layer: Layer): Promise<void> {
  const a = layer.adjustment;
  if (!a) return;
  const spec = specFor(a.kind);
  if (!spec) {
    await showMessage(ADJUSTMENT_NAMES[a.kind], ['Tato úprava nemá žádné nastavení.']);
    return;
  }
  const target = layerTarget(editor, layer, (next) => {
    if (next && JSON.stringify(next) !== JSON.stringify(a)) editor.setLayerProps(layer.id, { adjustment: next }, `Upravit: ${ADJUSTMENT_NAMES[a.kind]}`);
  });
  await runDialog(editor, a.kind, spec as DialogSpec<typeof a.kind>, target, structuredClone(a) as never, `${ADJUSTMENT_NAMES[a.kind]} – ${layer.name}`);
}

// ---- akce ----

/** Úprava bez dialogu (s indikátorem, dokud se počítá). */
async function now(editor: Editor, make: Parameters<typeof applyAdjustmentNow>[1], label: string): Promise<void> {
  const work = applyAdjustmentNow(editor, make, label);
  if (!work) return cannotAdjust(editor);
  await withBusy(work);
}

const auto = (editor: Editor, mode: 'tone' | 'contrast' | 'color', label: string) => now(editor, (s) => autoLevels(s.pixels, mode, s.weights ?? undefined), label);

const instant = (editor: Editor, kind: 'invert' | 'desaturate') => now(editor, () => defaultAdjustment(kind), ADJUSTMENT_NAMES[kind]);

const SHORTCUTS: { [K in AdjustmentKind]?: string[] } = {
  levels: ['Ctrl+L'],
  curves: ['Ctrl+M'],
  hueSaturation: ['Ctrl+U'],
  colorBalance: ['Ctrl+B'],
  blackWhite: ['Ctrl+Alt+Shift+B'],
};

export const LAYER_KINDS = LAYER_ADJUSTMENT_KINDS;

export function adjustmentActions(editor: Editor, canAdjust: () => boolean, canAddLayer: () => boolean): Action[] {
  return [
    ...DIALOG_KINDS.map(
      (kind): Action => ({
        id: `adjust.${kind}`,
        label: `${ADJUSTMENT_NAMES[kind]}…`,
        shortcuts: SHORTCUTS[kind],
        run: () => void adjustPixels(editor, kind),
        isEnabled: canAdjust,
      }),
    ),
    { id: 'adjust.invert', label: 'Invertovat', shortcuts: ['Ctrl+I'], run: () => instant(editor, 'invert'), isEnabled: canAdjust },
    { id: 'adjust.desaturate', label: 'Odbarvit', shortcuts: ['Ctrl+Shift+U'], run: () => instant(editor, 'desaturate'), isEnabled: canAdjust },
    { id: 'adjust.autoTone', label: 'Automatický tón', shortcuts: ['Ctrl+Shift+L'], run: () => auto(editor, 'tone', 'Automatický tón'), isEnabled: canAdjust },
    { id: 'adjust.autoContrast', label: 'Automatický kontrast', shortcuts: ['Ctrl+Alt+Shift+L'], run: () => auto(editor, 'contrast', 'Automatický kontrast'), isEnabled: canAdjust },
    { id: 'adjust.autoColor', label: 'Automatické barvy', shortcuts: ['Ctrl+Shift+B'], run: () => auto(editor, 'color', 'Automatické barvy'), isEnabled: canAdjust },
    ...LAYER_KINDS.map(
      (kind): Action => ({
        id: `layer.newAdjustment.${kind}`,
        label: `${ADJUSTMENT_NAMES[kind]}${kind === 'invert' ? '' : '…'}`,
        run: () => void newAdjustmentLayer(editor, kind),
        isEnabled: canAddLayer,
      }),
    ),
  ];
}
