import { toHex } from '../core/color';
import { GRADIENT_LIBRARY, gradientCss, libraryGradient, sampleGradient, type GradientDef } from '../core/paint/gradient';
import { addUserGradient, removeUserGradient, userGradients } from '../io/library';
import { confirmDialog, showCustomDialog, showMessage } from './dialogs';
import { h } from './dom';

/*
 * Editor přechodů (jako ve Photoshopu): nahoře knihovna přechodů, pod ní pruh s náhledem. Zastávky krytí
 * jsou nad pruhem, barevné zastávky pod ním. Klik do prázdného místa nad / pod pruhem přidá zastávku,
 * tažením se posouvá, odtažením od pruhu se smaže (každého druhu musí zůstat aspoň dvě).
 */

type Kind = 'colors' | 'alphas';

interface Selected {
  kind: Kind;
  index: number;
}

const CHECKER = 'repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0 / 10px 10px';
const pct = (v: number) => Math.round(v * 1000) / 10;
/** Značka zastávky krytí: plné krytí = černá, průhledná = bílá. */
const gray = (opacity: number) => {
  const g = Math.round(255 * (1 - opacity));
  return `rgb(${g},${g},${g})`;
};
/** Jak daleko od pruhu (px) se zastávka při tažení smaže. */
const REMOVE_DISTANCE = 36;

/** Otevře editor; vrací nový přechod nebo null při zrušení. */
export function showGradientEditor(initial: GradientDef, fg: string, bg: string): Promise<GradientDef | null> {
  let def: GradientDef = structuredClone(initial);
  let selected: Selected | null = null;

  const bar = h('div', { class: 'gradient-bar' });
  const alphaTrack = h('div', { class: 'gradient-track alphas', title: 'Klik přidá zastávku krytí' });
  const colorTrack = h('div', { class: 'gradient-track colors', title: 'Klik přidá barevnou zastávku' });
  const stopFields = h('div', { class: 'gradient-stop-fields' });

  const render = () => {
    bar.style.background = `${gradientCss(def)}, ${CHECKER}`;
    for (const [track, kind] of [
      [alphaTrack, 'alphas'],
      [colorTrack, 'colors'],
    ] as const) {
      track.replaceChildren(
        ...def[kind].map((stop, index) => {
          const fill = 'color' in stop ? stop.color : gray(stop.opacity);
          const marker = h('div', {
            class: `gradient-stop${selected?.kind === kind && selected.index === index ? ' selected' : ''}`,
            'data-kind': kind,
            'data-index': String(index),
            title: 'color' in stop ? 'Barevná zastávka – táhnout, odtáhnout = smazat' : 'Zastávka krytí – táhnout, odtáhnout = smazat',
          });
          marker.style.left = `${stop.pos * 100}%`;
          marker.style.setProperty('--stop-fill', fill);
          marker.addEventListener('pointerdown', (e) => startDrag(e, kind, index, track));
          return marker;
        }),
      );
    }
    renderFields();
  };

  const renderFields = () => {
    if (!selected) {
      stopFields.replaceChildren(h('span', { class: 'muted' }, 'Klikněte na zastávku nad nebo pod pruhem, nebo do prázdného místa pro novou.'));
      return;
    }
    const { kind, index } = selected;
    const stop = def[kind][index];
    const position = h('input', { type: 'number', min: 0, max: 100, step: 0.1, value: String(pct(stop.pos)), class: 'stop-pos' });
    position.addEventListener('input', () => {
      if (!Number.isFinite(position.valueAsNumber)) return;
      stop.pos = Math.max(0, Math.min(1, position.valueAsNumber / 100));
      renderPreview();
    });
    const remove = h('button', { type: 'button', disabled: def[kind].length <= 2, onClick: () => removeStop(kind, index) }, 'Smazat');
    let value: HTMLElement;
    if ('color' in stop) {
      const input = h('input', { type: 'color', value: stop.color, class: 'color-input stop-color' });
      input.addEventListener('input', () => {
        stop.color = input.value;
        renderPreview();
      });
      value = h('label', {}, 'Barva', input);
    } else {
      const input = h('input', { type: 'number', min: 0, max: 100, step: 1, value: String(Math.round(stop.opacity * 100)), class: 'stop-opacity' });
      input.addEventListener('input', () => {
        if (!Number.isFinite(input.valueAsNumber)) return;
        stop.opacity = Math.max(0, Math.min(1, input.valueAsNumber / 100));
        renderPreview();
      });
      value = h('label', {}, 'Krytí', h('span', { class: 'dialog-input' }, input, h('span', { class: 'muted' }, '%')));
    }
    stopFields.replaceChildren(value, h('label', {}, 'Poloha', h('span', { class: 'dialog-input' }, position, h('span', { class: 'muted' }, '%'))), remove);
  };

  /** Překreslí pruh a značky bez přestavby polí (aby se při psaní neztratil fokus). */
  const renderPreview = () => {
    bar.style.background = `${gradientCss(def)}, ${CHECKER}`;
    for (const track of [alphaTrack, colorTrack]) {
      for (const marker of track.querySelectorAll<HTMLElement>('.gradient-stop')) {
        const stop = def[marker.dataset.kind as Kind][Number(marker.dataset.index)];
        marker.style.left = `${stop.pos * 100}%`;
        if ('color' in stop) marker.style.setProperty('--stop-fill', stop.color);
        else marker.style.setProperty('--stop-fill', gray(stop.opacity));
      }
    }
  };

  const removeStop = (kind: Kind, index: number) => {
    if (def[kind].length <= 2) return;
    def[kind].splice(index, 1);
    selected = null;
    render();
  };

  const posFromEvent = (e: PointerEvent | MouseEvent, track: HTMLElement) => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  const addStop = (e: MouseEvent, kind: Kind, track: HTMLElement) => {
    if ((e.target as HTMLElement).classList.contains('gradient-stop')) return;
    const pos = posFromEvent(e, track);
    const c = sampleGradient(def, pos);
    if (kind === 'colors') def.colors.push({ pos, color: toHex(c) });
    else def.alphas.push({ pos, opacity: Math.round((c.a / 255) * 100) / 100 });
    selected = { kind, index: def[kind].length - 1 };
    render();
  };
  alphaTrack.addEventListener('click', (e) => addStop(e, 'alphas', alphaTrack));
  colorTrack.addEventListener('click', (e) => addStop(e, 'colors', colorTrack));

  const startDrag = (e: PointerEvent, kind: Kind, index: number, track: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    selected = { kind, index };
    render();
    const marker = track.querySelector<HTMLElement>(`[data-index="${index}"]`)!;
    const stop = def[kind][index];
    const original = stop.pos;
    let away = false;
    const move = (ev: PointerEvent) => {
      const r = track.getBoundingClientRect();
      const dist = ev.clientY < r.top ? r.top - ev.clientY : ev.clientY > r.bottom ? ev.clientY - r.bottom : 0;
      away = def[kind].length > 2 && dist > REMOVE_DISTANCE;
      marker.classList.toggle('removing', away);
      stop.pos = away ? original : posFromEvent(ev, track);
      renderPreview();
      const field = stopFields.querySelector<HTMLInputElement>('.stop-pos');
      if (field) field.value = String(pct(stop.pos));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (away) removeStop(kind, index);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const library = h('div', { class: 'gradient-library' });
  const presetButton = (name: string, preview: GradientDef, onRemove?: () => void) => {
    const b = h('button', {
      type: 'button',
      class: 'gradient-preset',
      title: name,
      'aria-label': name,
      onClick: () => {
        def = structuredClone(preview);
        selected = null;
        render();
      },
    });
    b.style.background = `${gradientCss(preview)}, ${CHECKER}`;
    if (onRemove) {
      const x = h('span', { class: 'gradient-preset-remove', title: 'Smazat z knihovny' }, '×');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        onRemove();
      });
      b.append(x);
    }
    return b;
  };
  const renderLibrary = () => {
    library.replaceChildren(
      ...GRADIENT_LIBRARY.map((item) => presetButton(item.name, libraryGradient(item.def, fg, bg))),
      ...userGradients().map((item, index) =>
        presetButton(item.name, item.def, () => {
          void confirmDialog('Smazat přechod', `Smazat přechod „${item.name}“ z knihovny?`).then((ok) => {
            if (!ok) return;
            removeUserGradient(index);
            renderLibrary();
          });
        }),
      ),
    );
  };
  renderLibrary();

  // Uložení aktuálního přechodu do knihovny
  const nameInput = h('input', { type: 'text', class: 'opt-input gradient-name', value: 'Vlastní', title: 'Název přechodu' });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      save();
    }
  });
  const save = () => {
    try {
      addUserGradient(nameInput.value.trim() || 'Vlastní', normalize(def));
      renderLibrary();
    } catch (err) {
      void showMessage('Knihovna přechodů', [(err as Error).message]);
    }
  };
  const saveRow = h(
    'div',
    { class: 'gradient-save' },
    h('label', {}, 'Název', nameInput),
    h('button', { type: 'button', class: 'gradient-save-btn', onClick: save }, 'Přidat do knihovny'),
  );

  render();
  return showCustomDialog(
    'Editor přechodů',
    [library, h('div', { class: 'gradient-editor' }, alphaTrack, bar, colorTrack), stopFields, saveRow],
    () => normalize(def),
    'gradient-editor-form',
  );
}

/** Seřadí zastávky podle polohy (pořadí v poli je jinak dané pořadím přidání). */
function normalize(def: GradientDef): GradientDef {
  return {
    colors: [...def.colors].sort((a, b) => a.pos - b.pos).map((c) => ({ pos: Math.round(c.pos * 10000) / 10000, color: c.color })),
    alphas: [...def.alphas].sort((a, b) => a.pos - b.pos).map((a) => ({ pos: Math.round(a.pos * 10000) / 10000, opacity: a.opacity })),
  };
}
