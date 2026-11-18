import { ArrowLeftRight, Square, SquaresIntersect, SquaresSubtract, SquaresUnite } from 'lucide';
import type { Editor, SelectionOptions } from '../../core/Editor';
import type { SelectionMode } from '../../core/selection/SelectionMask';
import { checkbox, iconButton, segmented, selectField, separator, SliderField, textButton } from '../../ui/controls';
import { h } from '../../ui/dom';
import type { ToolOptionsUI } from '../Tool';

const MODES: SelectionMode[] = ['replace', 'add', 'subtract', 'intersect'];

export interface SelectionOptionParts {
  antiAlias?: boolean;
  /** Styl obdélníku/elipsy (normální, pevný poměr, pevná velikost). */
  style?: boolean;
  wand?: boolean;
  magnetic?: boolean;
}

/** Lišta voleb nástrojů výběru – hodnoty se ukládají do `editor.selectionOptions`. */
export function selectionOptionsUI(editor: Editor, parts: SelectionOptionParts): ToolOptionsUI {
  const o = editor.selectionOptions;
  const set = (patch: Partial<SelectionOptions>) => editor.updateSelectionOptions(patch);
  const slider = (label: string, key: keyof SelectionOptions, max: number, unit: string, min = 0) =>
    new SliderField({ label, value: o[key] as number, min, max, unit, onCommit: (v) => set({ [key]: v }) }).element;

  const modes = segmented(
    [
      { icon: Square, title: 'Nový výběr' },
      { icon: SquaresUnite, title: 'Přidat k výběru (Shift)' },
      { icon: SquaresSubtract, title: 'Odečíst od výběru (Alt)' },
      { icon: SquaresIntersect, title: 'Průnik s výběrem (Shift+Alt)' },
    ],
    MODES.indexOf(o.mode),
    (i) => set({ mode: MODES[i] }),
  );

  const items: Node[] = [modes, separator(), slider('Prolnutí:', 'feather', 250, ' px')];
  if (parts.antiAlias) items.push(checkbox('Vyhlazování', o.antiAlias, (v) => set({ antiAlias: v })));
  items.push(textButton('Upřesnit okraj', undefined, 'Připravujeme'));

  if (parts.style) {
    const sizeInput = (key: 'fixedWidth' | 'fixedHeight') => {
      const input = h('input', { type: 'text', class: 'opt-input', value: String(o[key]), style: { width: '48px' } });
      input.addEventListener('keydown', (e) => e.stopPropagation());
      input.addEventListener('change', () => {
        const v = Math.round(Number.parseFloat(input.value));
        if (v > 0) set({ [key]: v });
        else input.value = String(editor.selectionOptions[key]);
      });
      return input;
    };
    const w = sizeInput('fixedWidth');
    const hh = sizeInput('fixedHeight');
    items.push(
      separator(),
      selectField(
        'Styl:',
        [
          { value: 'normal', label: 'Normální' },
          { value: 'ratio', label: 'Pevný poměr' },
          { value: 'size', label: 'Pevná velikost' },
        ],
        o.style,
        (v) => set({ style: v as SelectionOptions['style'] }),
      ),
      h('label', { class: 'opt-field' }, 'Š:', w),
      iconButton(ArrowLeftRight, 'Prohodit šířku a výšku', () => {
        const { fixedWidth, fixedHeight } = editor.selectionOptions;
        set({ fixedWidth: fixedHeight, fixedHeight: fixedWidth });
        w.value = String(fixedHeight);
        hh.value = String(fixedWidth);
      }),
      h('label', { class: 'opt-field' }, 'V:', hh),
    );
  }

  if (parts.wand) {
    items.push(
      separator(),
      slider('Tolerance:', 'tolerance', 255, ''),
      checkbox('Souvislé', o.contiguous, (v) => set({ contiguous: v })),
      checkbox('Ze všech vrstev', o.sampleAll, (v) => set({ sampleAll: v })),
    );
  }

  if (parts.magnetic) {
    items.push(
      separator(),
      slider('Šířka:', 'lassoWidth', 40, ' px', 1),
      slider('Kontrast:', 'lassoContrast', 100, '%', 1),
      slider('Frekvence:', 'lassoFrequency', 100, '', 0),
    );
  }

  return { element: h('div', { class: 'tool-options' }, ...items) };
}

/** Dashované vykreslení pomocné geometrie (náhled výběru) v souřadnicích obrazovky. */
export function strokeDashed(ctx: CanvasRenderingContext2D, build: (ctx: CanvasRenderingContext2D) => void): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.beginPath();
  build(ctx);
  ctx.strokeStyle = '#000';
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineDashOffset = 4;
  ctx.stroke();
  ctx.restore();
}
