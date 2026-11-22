import type { Editor } from '../core/Editor';
import { EFFECT_DEFAULTS, EFFECT_KINDS, EFFECT_NAMES, hasActiveEffects, overlayGradient, type EffectKind, type LayerEffects } from '../core/effects';
import type { BevelStyle } from '../core/paint/bevel';
import { GRADIENT_TYPES, type GradientDef, type GradientType } from '../core/paint/gradient';
import { BLEND_MODES, type BlendMode } from '../core/Layer';
import type { StrokePosition } from '../core/paint/stroke';
import { showSectionedForm, type FormAccess, type FormField, type FormSection } from '../ui/dialogs';

/*
 * Dialog Styl vrstvy: vlevo efekty se zaškrtávátky, vpravo nastavení vybraného. Pole mají klíče
 * `efekt.vlastnost`; krytí je ve formuláři v %, ostatní v px a stupních.
 */

const pct = (v: number) => Math.round(v * 100);

/** Hodnoty efektu pro formulář: uložený efekt (bez režimu = Normální, viz core/effects), jinak výchozí. */
function current<K extends EffectKind>(e: LayerEffects | null, k: K): Required<LayerEffects>[K] {
  const saved = e?.[k];
  if (!saved) return structuredClone(EFFECT_DEFAULTS[k]);
  return { ...(k === 'stroke' || k === 'bevel' ? {} : { blendMode: 'source-over' }), ...structuredClone(saved) } as Required<LayerEffects>[K];
}

const blendField = (key: string, value: BlendMode | undefined): FormField => ({
  kind: 'select',
  key,
  label: 'Režim',
  value: value ?? 'source-over',
  options: BLEND_MODES.map((m) => ({ value: m.value, label: m.label })),
});
const colorField = (key: string, value: string, label = 'Barva'): FormField => ({ kind: 'color', key, label, value });
const opacityField = (key: string, value: number): FormField => ({ kind: 'number', key, label: 'Krytí', value: pct(value), min: 0, max: 100, step: 1, unit: '%' });
const pxField = (key: string, label: string, value: number, min = 0, max = 250): FormField => ({ kind: 'number', key, label, value, min, max, step: 1, unit: 'px' });
const angleField = (key: string, value: number): FormField => ({ kind: 'number', key, label: 'Úhel', value, min: -180, max: 360, step: 1, unit: '°' });

function fieldsOf(k: EffectKind, e: LayerEffects | null, colors: Colors): FormField[] {
  switch (k) {
    case 'bevel': {
      const d = current(e, k);
      const sel = (key: string, label: string, value: string, options: Array<[string, string]>): FormField => ({
        kind: 'select',
        key: `${k}.${key}`,
        label,
        value,
        options: options.map(([v, l]) => ({ value: v, label: l })),
      });
      return [
        sel('style', 'Styl', d.style, [
          ['inner', 'Vnitřní úkos'],
          ['outer', 'Vnější úkos'],
          ['emboss', 'Reliéf'],
          ['pillow', 'Polštářový reliéf'],
        ]),
        sel('technique', 'Technika', d.technique, [
          ['smooth', 'Hladký'],
          ['chisel', 'Tvrdé dláto'],
        ]),
        { kind: 'number', key: `${k}.depth`, label: 'Hloubka', value: d.depth, min: 1, max: 1000, step: 1, unit: '%' },
        sel('direction', 'Směr', d.direction, [
          ['up', 'Nahoru'],
          ['down', 'Dolů'],
        ]),
        pxField(`${k}.size`, 'Velikost', d.size),
        pxField(`${k}.soften`, 'Změkčit', d.soften, 0, 16),
        angleField(`${k}.angle`, d.angle),
        { kind: 'number', key: `${k}.altitude`, label: 'Výška světla', value: d.altitude, min: 0, max: 90, step: 1, unit: '°' },
        { ...blendField(`${k}.highlightBlend`, d.highlightBlend), label: 'Světla' },
        colorField(`${k}.highlightColor`, d.highlightColor, 'Barva světel'),
        { ...opacityField(`${k}.highlightOpacity`, d.highlightOpacity), label: 'Krytí světel' },
        { ...blendField(`${k}.shadowBlend`, d.shadowBlend), label: 'Stíny' },
        colorField(`${k}.shadowColor`, d.shadowColor, 'Barva stínů'),
        { ...opacityField(`${k}.shadowOpacity`, d.shadowOpacity), label: 'Krytí stínů' },
      ] as FormField[];
    }
    case 'dropShadow':
    case 'innerShadow': {
      const d = current(e, k);
      return [
        blendField(`${k}.blendMode`, d.blendMode),
        colorField(`${k}.color`, d.color),
        opacityField(`${k}.opacity`, d.opacity),
        angleField(`${k}.angle`, d.angle),
        pxField(`${k}.distance`, 'Vzdálenost', d.distance, 0, 500),
        pxField(`${k}.size`, 'Velikost', d.size),
      ];
    }
    case 'outerGlow': {
      const d = current(e, k);
      return [blendField(`${k}.blendMode`, d.blendMode), colorField(`${k}.color`, d.color), opacityField(`${k}.opacity`, d.opacity), pxField(`${k}.size`, 'Velikost', d.size)];
    }
    case 'innerGlow': {
      const d = current(e, k);
      return [
        blendField(`${k}.blendMode`, d.blendMode),
        colorField(`${k}.color`, d.color),
        opacityField(`${k}.opacity`, d.opacity),
        {
          kind: 'select',
          key: `${k}.source`,
          label: 'Zdroj',
          value: d.source,
          options: [
            { value: 'edge', label: 'Okraj' },
            { value: 'center', label: 'Střed' },
          ],
        },
        pxField(`${k}.size`, 'Velikost', d.size),
      ];
    }
    case 'stroke': {
      const d = current(e, k);
      return [
        colorField(`${k}.color`, d.color),
        opacityField(`${k}.opacity`, d.opacity),
        pxField(`${k}.size`, 'Velikost', d.size, 1),
        {
          kind: 'select',
          key: `${k}.position`,
          label: 'Umístění',
          value: d.position,
          options: [
            { value: 'outside', label: 'Vně' },
            { value: 'center', label: 'Na střed' },
            { value: 'inside', label: 'Uvnitř' },
          ],
        },
      ];
    }
    case 'satin': {
      const d = current(e, k);
      return [
        blendField(`${k}.blendMode`, d.blendMode),
        colorField(`${k}.color`, d.color),
        opacityField(`${k}.opacity`, d.opacity),
        angleField(`${k}.angle`, d.angle),
        pxField(`${k}.distance`, 'Vzdálenost', d.distance, 1, 250),
        pxField(`${k}.size`, 'Velikost', d.size),
        { kind: 'checkbox', key: `${k}.invert`, label: 'Obrátit', value: d.invert },
      ];
    }
    case 'patternOverlay': {
      const d = current(e, k);
      return [
        blendField(`${k}.blendMode`, d.blendMode),
        opacityField(`${k}.opacity`, d.opacity),
        { kind: 'pattern', key: `${k}.patternId`, label: 'Vzorek', value: d.patternId },
        { kind: 'number', key: `${k}.scale`, label: 'Měřítko', value: pct(d.scale), min: 1, max: 1000, step: 1, unit: '%' },
      ];
    }
    case 'colorOverlay': {
      const d = current(e, k);
      return [blendField(`${k}.blendMode`, d.blendMode), colorField(`${k}.color`, d.color), opacityField(`${k}.opacity`, d.opacity)];
    }
    case 'gradientOverlay': {
      const d = current(e, k);
      return [
        blendField(`${k}.blendMode`, d.blendMode),
        opacityField(`${k}.opacity`, d.opacity),
        { kind: 'gradient', key: `${k}.gradient`, label: 'Přechod', value: overlayGradient(d), fg: colors.fg, bg: colors.bg },
        { kind: 'select', key: `${k}.style`, label: 'Styl', value: d.style, options: GRADIENT_TYPES.map((t) => ({ value: t.value, label: t.label })) },
        angleField(`${k}.angle`, d.angle),
        { kind: 'number', key: `${k}.scale`, label: 'Měřítko', value: pct(d.scale ?? 1), min: 10, max: 150, step: 1, unit: '%' },
        { kind: 'checkbox', key: `${k}.reverse`, label: 'Obrátit', value: d.reverse },
      ];
    }
  }
}

/** Barvy popředí / pozadí pro knihovnu v editoru přechodů. */
interface Colors {
  fg: string;
  bg: string;
}

function sectionsFor(e: LayerEffects | null, colors: Colors = { fg: '#000000', bg: '#ffffff' }): FormSection[] {
  return EFFECT_KINDS.map((k) => ({ key: k, label: EFFECT_NAMES[k], enabled: !!e?.[k]?.enabled, fields: fieldsOf(k, e, colors) }));
}

/** Styly vrstvy z hodnot formuláře; žádný zapnutý efekt = null. */
export function effectsFromForm(form: Pick<FormAccess, 'get'>): LayerEffects | null {
  const num = (k: string) => Number(form.get(k)) || 0;
  const str = (k: string) => String(form.get(k));
  const on = (k: string) => !!form.get(k);
  const blend = (k: string) => str(`${k}.blendMode`) as BlendMode;
  const shadow = (k: 'dropShadow' | 'innerShadow') => ({
    enabled: on(k),
    color: str(`${k}.color`),
    opacity: num(`${k}.opacity`) / 100,
    angle: num(`${k}.angle`),
    distance: num(`${k}.distance`),
    size: num(`${k}.size`),
    blendMode: blend(k),
  });
  const e: LayerEffects = {
    bevel: {
      enabled: on('bevel'),
      style: str('bevel.style') as BevelStyle,
      technique: str('bevel.technique') === 'chisel' ? 'chisel' : 'smooth',
      depth: num('bevel.depth'),
      direction: str('bevel.direction') === 'down' ? 'down' : 'up',
      size: num('bevel.size'),
      soften: num('bevel.soften'),
      angle: num('bevel.angle'),
      altitude: num('bevel.altitude'),
      highlightColor: str('bevel.highlightColor'),
      highlightOpacity: num('bevel.highlightOpacity') / 100,
      highlightBlend: str('bevel.highlightBlend') as BlendMode,
      shadowColor: str('bevel.shadowColor'),
      shadowOpacity: num('bevel.shadowOpacity') / 100,
      shadowBlend: str('bevel.shadowBlend') as BlendMode,
    },
    dropShadow: shadow('dropShadow'),
    outerGlow: { enabled: on('outerGlow'), color: str('outerGlow.color'), opacity: num('outerGlow.opacity') / 100, size: num('outerGlow.size'), blendMode: blend('outerGlow') },
    innerShadow: shadow('innerShadow'),
    innerGlow: {
      enabled: on('innerGlow'),
      color: str('innerGlow.color'),
      opacity: num('innerGlow.opacity') / 100,
      size: num('innerGlow.size'),
      source: str('innerGlow.source') === 'center' ? 'center' : 'edge',
      blendMode: blend('innerGlow'),
    },
    stroke: {
      enabled: on('stroke'),
      color: str('stroke.color'),
      opacity: num('stroke.opacity') / 100,
      size: num('stroke.size'),
      position: str('stroke.position') as StrokePosition,
    },
    satin: {
      enabled: on('satin'),
      color: str('satin.color'),
      opacity: num('satin.opacity') / 100,
      angle: num('satin.angle'),
      distance: num('satin.distance'),
      size: num('satin.size'),
      invert: on('satin.invert'),
      blendMode: blend('satin'),
    },
    patternOverlay: {
      enabled: on('patternOverlay'),
      patternId: str('patternOverlay.patternId'),
      opacity: num('patternOverlay.opacity') / 100,
      scale: num('patternOverlay.scale') / 100,
      blendMode: blend('patternOverlay'),
    },
    colorOverlay: { enabled: on('colorOverlay'), color: str('colorOverlay.color'), opacity: num('colorOverlay.opacity') / 100, blendMode: blend('colorOverlay') },
    gradientOverlay: {
      enabled: on('gradientOverlay'),
      gradient: JSON.parse(str('gradientOverlay.gradient')) as GradientDef,
      opacity: num('gradientOverlay.opacity') / 100,
      angle: num('gradientOverlay.angle'),
      style: str('gradientOverlay.style') as GradientType,
      reverse: on('gradientOverlay.reverse'),
      scale: num('gradientOverlay.scale') / 100,
      blendMode: blend('gradientOverlay'),
    },
  };
  if (!hasActiveEffects(e)) return null;
  // Ukládají se jen zapnuté efekty (menší projekt, čitelný klíč cache).
  for (const k of EFFECT_KINDS) if (!e[k]?.enabled) delete e[k];
  return e;
}

/** Hodnota pole formuláře pro uložený styl (pro porovnání beze změny). */
function formValueOf(e: LayerEffects | null, key: string): string | number | boolean {
  for (const sec of sectionsFor(e)) {
    if (sec.key === key) return sec.enabled;
    const f = sec.fields.find((x) => 'key' in x && x.key === key);
    if (f && 'value' in f) return f.kind === 'gradient' ? JSON.stringify(f.value) : f.value;
  }
  return '';
}

/**
 * Vrstva → Styl vrstvy: dialog se všemi efekty, změny se ukazují naživo. OK = jeden krok historie,
 * Zrušit vrátí původní styl. `focus` = efekt, který se má ukázat (jinak první zapnutý).
 */
export async function editLayerStyle(editor: Editor, focus?: EffectKind): Promise<void> {
  const layer = editor.doc.activeLayer;
  if (!layer || layer.isGroup) return;
  const before = layer.effects;
  const doc = editor.doc;
  const v = await showSectionedForm(
    `Styl vrstvy – ${layer.name}`,
    sectionsFor(before, { fg: editor.settings.color, bg: editor.settings.secondaryColor }),
    (key, form) => {
      if (!key) return;
      // Změna parametru vypnutého efektu ho zapne (jako ve Photoshopu).
      const effect = key.split('.')[0];
      if (key.includes('.') && !form.get(effect)) form.set(effect, true);
      doc.updateLayer(layer.id, { effects: effectsFromForm(form) });
    },
    focus,
  );
  if (!v) {
    doc.updateLayer(layer.id, { effects: before });
    return;
  }
  const after = effectsFromForm({ get: (k) => v[k] });
  doc.updateLayer(layer.id, { effects: before });
  // Styly z verze 0.11 mohly obsahovat i vypnuté efekty – ty se nepočítají jako změna.
  const same = JSON.stringify(after) === JSON.stringify(effectsFromForm({ get: (k) => formValueOf(before, k) }));
  if (!same) editor.setLayerProps(layer.id, { effects: after }, 'Styl vrstvy');
}
