import { X } from 'lucide';
import type { Editor } from '../core/Editor';
import { iconButton } from './controls';
import { h } from './dom';

export interface DocumentTabsOptions {
  /** Zavření záložky (s případným dotazem na neuložené změny). */
  close(id: string): void;
  /** Soubory přetažené na lištu záložek se otevřou jako nové dokumenty. */
  openFiles(files: File[]): void;
}

/**
 * Záložky otevřených dokumentů: klik přepne, × nebo prostřední tlačítko zavře,
 * tečka u názvu = neuložené změny. Soubory přetažené na lištu se otevřou v nových záložkách.
 */
export class DocumentTabs {
  readonly element: HTMLElement;

  constructor(editor: Editor, options: DocumentTabsOptions) {
    this.element = h('div', { class: 'doc-tabs' });
    const render = () => {
      const tabs = editor.sessions.map((s) => {
        const active = s === editor.session;
        const layer = s.doc.activeLayer;
        const suffix = active && editor.maskTarget && layer ? ` (${layer.name}, maska vrstvy)` : '';
        const dirty = editor.isDirty(s);
        const tab = h(
          'div',
          {
            class: `doc-tab${active ? ' active' : ''}${dirty ? ' dirty' : ''}`,
            title: `${s.fileName} – ${s.doc.width} × ${s.doc.height} px${dirty ? ' (neuloženo)' : ''}`,
            onPointerdown: (e: PointerEvent) => {
              if (e.button === 0) editor.activateDocument(s.id);
            },
            // Prostřední tlačítko nesmí spustit automatické posouvání prohlížeče.
            onMousedown: (e: MouseEvent) => {
              if (e.button === 1) e.preventDefault();
            },
            onAuxclick: (e: MouseEvent) => {
              if (e.button === 1) options.close(s.id);
            },
          },
          h('span', { class: 'doc-tab-name' }, s.fileName + suffix),
          iconButton(
            X,
            'Zavřít',
            (e) => {
              e.stopPropagation();
              options.close(s.id);
            },
            'doc-tab-close',
          ),
        );
        // Kliknutí na × nesmí nejdřív přepnout záložku.
        tab.lastElementChild?.addEventListener('pointerdown', (e) => e.stopPropagation());
        return tab;
      });
      this.element.replaceChildren(...tabs);
      this.element.querySelector('.doc-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    editor.on('documents', render);
    editor.on('document', render);
    editor.on('target', render);
    render();

    this.element.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      this.element.classList.add('drop-target');
    });
    this.element.addEventListener('dragleave', () => this.element.classList.remove('drop-target'));
    this.element.addEventListener('drop', (e) => {
      this.element.classList.remove('drop-target');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      options.openFiles(files);
    });
  }
}

export class StatusBar {
  readonly element: HTMLElement;

  constructor(editor: Editor) {
    const zoom = h('input', { class: 'status-zoom', type: 'text', title: 'Zvětšení' });
    zoom.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') zoom.blur();
    });
    zoom.addEventListener('change', () => {
      const v = Number.parseFloat(zoom.value.replace(',', '.'));
      if (Number.isFinite(v) && v > 0) {
        editor.viewport.zoomAt(v / 100);
        editor.notifyView();
      } else update();
    });
    const size = h('span', { class: 'status-box' });
    const pos = h('span', { class: 'status-pos' });
    this.element = h('footer', { class: 'statusbar' }, zoom, size, pos);

    const update = () => {
      if (document.activeElement !== zoom) zoom.value = `${Math.round(editor.viewport.zoom * 1000) / 10}%`;
      size.textContent = `${editor.doc.width} × ${editor.doc.height} px`;
      const p = editor.pointer;
      pos.textContent = p ? `X: ${Math.floor(p.x)}  Y: ${Math.floor(p.y)}` : '';
    };
    editor.on('view', update);
    editor.on('document', update);
    editor.on('docChange', (c) => {
      if (c.kind === 'size') update();
    });
    update();
  }
}
