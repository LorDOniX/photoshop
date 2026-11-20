import type { Editor } from '../core/Editor';
import { Renderer } from '../render/Renderer';
import type { ToolPointer } from '../tools/Tool';
import { h } from './dom';
import { Rulers } from './Rulers';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** Gesto sevření v Safari (nestandardní GestureEvent). */
interface SafariGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/**
 * Plátno s obsluhou ukazatele: předává události aktivnímu nástroji.
 * Touchpad / kolečko: dva prsty = posun všemi směry, sevření nebo Ctrl/Cmd/Alt + kolečko = zoom,
 * Shift + kolečko myši = vodorovný posun. Mezerník / prostřední tlačítko + tažení = posun.
 */
export class CanvasView {
  readonly element: HTMLElement;
  readonly renderer: Renderer;
  readonly rulers: Rulers;
  private readonly canvas: HTMLCanvasElement;
  private spaceHeld = false;
  private panning: { x: number; y: number } | null = null;
  private toolActive = false;
  private rulersVisible = true;

  constructor(private readonly editor: Editor) {
    this.canvas = h('canvas', { class: 'viewport-canvas' });
    this.rulers = new Rulers(editor);
    const wrap = h('div', { class: 'canvas-wrap' }, this.canvas);
    this.element = h(
      'main',
      { class: 'canvas-area' },
      h('div', { class: 'ruler-corner' }),
      this.rulers.top,
      this.rulers.left,
      wrap,
    );
    this.renderer = new Renderer(this.canvas, editor);

    let measured = false;
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.renderer.resize(width, height);
      this.rulers.resize(width, height);
      if (!measured && width > 0 && height > 0) {
        measured = true;
        editor.viewport.fit(editor.doc.width, editor.doc.height, false);
      }
      editor.notifyView();
    }).observe(wrap);

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    // Výchozí akce kliknutí by vzala fokus textovému poli, které nástroj právě otevřel (Text).
    this.canvas.addEventListener('mousedown', (e) => {
      if (document.activeElement?.classList.contains('text-editor')) e.preventDefault();
    });
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      if (this.toolActive || this.panning) return;
      editor.pointer = null;
      editor.notifyView();
    });
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // Safari posílá sevření prstů jako gesturestart/gesturechange místo kolečka s Ctrl.
    let gestureZoom = 1;
    this.canvas.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      gestureZoom = editor.viewport.zoom;
    });
    this.canvas.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const g = e as SafariGestureEvent;
      const rect = this.canvas.getBoundingClientRect();
      editor.viewport.zoomAt(gestureZoom * g.scale, g.clientX - rect.left, g.clientY - rect.top);
      editor.notifyView();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        e.preventDefault();
        if (!this.spaceHeld) {
          this.spaceHeld = true;
          this.updateCursor();
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        this.updateCursor();
      }
    });
    editor.on('tool', () => this.updateCursor());
    this.updateCursor();
  }

  get showRulers(): boolean {
    return this.rulersVisible;
  }

  set showRulers(visible: boolean) {
    this.rulersVisible = visible;
    this.element.classList.toggle('no-rulers', !visible);
  }

  private updateCursor(): void {
    this.canvas.style.cursor = this.spaceHeld || this.panning ? 'grab' : (this.editor.activeTool?.cursor ?? 'default');
  }

  private toPointer(e: PointerEvent): ToolPointer {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const { x, y } = this.editor.viewport.toDoc(screenX, screenY);
    return {
      x,
      y,
      screenX,
      screenY,
      pressure: e.pressure,
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey || e.metaKey,
    };
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toPointer(e);
    if (e.button === 1 || this.spaceHeld) {
      e.preventDefault();
      this.panning = { x: p.screenX, y: p.screenY };
      this.updateCursor();
      return;
    }
    this.toolActive = true;
    this.editor.activeTool?.pointerDown?.(p);
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.toPointer(e);
    this.editor.pointer = { x: p.x, y: p.y };
    if (this.panning) {
      this.editor.viewport.panBy(p.screenX - this.panning.x, p.screenY - this.panning.y);
      this.panning = { x: p.screenX, y: p.screenY };
    } else if (this.toolActive) {
      // Mezilehlé body (coalesced events) dávají plynulé tahy i při rychlém pohybu.
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ce of events.length ? events : [e]) this.editor.activeTool?.pointerMove?.(this.toPointer(ce));
    } else {
      this.editor.activeTool?.pointerMove?.(p);
      if (!this.spaceHeld) {
        const tool = this.editor.activeTool;
        this.canvas.style.cursor = tool?.cursorAt?.(p) ?? tool?.cursor ?? 'default';
      }
    }
    this.editor.notifyView();
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.panning) {
      this.panning = null;
      this.updateCursor();
      return;
    }
    if (!this.toolActive) return;
    this.toolActive = false;
    this.editor.activeTool?.pointerUp?.(this.toPointer(e));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const vp = this.editor.viewport;
    // Převod na pixely (řádkový / stránkový režim kolečka u některých myší).
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // Sevření na touchpadu = kolečko s ctrlKey a malými kroky; kolečko myši dělá skoky ~100 px – omezí se.
      const d = Math.max(-50, Math.min(50, dy || dx));
      vp.zoomAt(vp.zoom * Math.exp(-d * 0.01), sx, sy);
    } else {
      // Shift + svislé kolečko myši = vodorovný posun (touchpad posílá deltaX sám).
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      vp.panBy(-dx, -dy);
    }
    this.editor.notifyView();
  }

}
