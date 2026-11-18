import { X } from 'lucide';
import type { Editor } from '../core/Editor';
import { iconButton } from './controls';
import { h } from './dom';

/** Záložky otevřených dokumentů. Zatím jen jeden dokument – připraveno pro více. */
export class DocumentTabs {
  readonly element: HTMLElement;

  constructor(editor: Editor) {
    this.element = h('div', { class: 'doc-tabs' });
    const render = () => {
      const layer = editor.doc.activeLayer;
      const suffix = editor.maskTarget && layer ? ` (${layer.name}, maska vrstvy)` : '';
      const tab = h(
        'div',
        { class: 'doc-tab active', title: `${editor.doc.width} × ${editor.doc.height} px` },
        h('span', { class: 'doc-tab-name' }, editor.fileName + suffix),
        iconButton(X, 'Zavřít – připravujeme', undefined, 'doc-tab-close'),
      );
      this.element.replaceChildren(tab);
    };
    editor.on('document', render);
    editor.on('target', render);
    render();
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
