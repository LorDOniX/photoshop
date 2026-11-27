import { SNAP_DISTANCE, type Editor } from '../core/Editor';
import { hitGuide, snapValue, type GuideDir } from '../core/guides';
import { onPatternsChange } from '../core/patterns';
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
  /** Tažení vodítka (nového z pravítka, nebo posun existujícího). */
  private guide: { pointerId: number; dir: GuideDir; index: number | null; cleanup: () => void } | null = null;

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
    // Vzorek načtený až po vykreslení (knihovna, otevřený soubor) – překreslit vrstvy s překrytím vzorkem.
    onPatternsChange(() => {
      this.renderer.invalidate();
      editor.notifyView();
    });

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

    // Nové vodítko tažením z pravítka (horní = vodorovné, levé = svislé).
    for (const [ruler, dir] of [
      [this.rulers.top, 'h'],
      [this.rulers.left, 'v'],
    ] as const) {
      ruler.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || editor.viewOptions.lockGuides) return;
        e.preventDefault();
        // Bez zachycení ukazatele na pravítku (Chrome by pak další stisk nad pravítkem poslal plátnu) – sleduje se okno.
        const move = (ev: PointerEvent) => this.moveGuideDrag(ev);
        const up = (ev: PointerEvent) => this.endGuideDrag(ev, ev.type === 'pointercancel');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        this.startGuideDrag(e, dir, null, () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        });
      });
    }
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
    const g = e.button === 0 ? this.guideAt(p) : -1;
    if (g >= 0) {
      // Plátno už ukazatel zachytilo (výše) – pohyb a puštění přijdou do jeho posluchačů.
      this.startGuideDrag(e, this.editor.doc.guides[g].dir, g, () => {});
      return;
    }
    this.toolActive = true;
    this.editor.activeTool?.pointerDown?.(p);
  }

  /**
   * Vodítko pod kurzorem, které jde posunout: nástroj Přesun nebo Ctrl, vodítka vidět a nezamčená. -1 = žádné.
   */
  private guideAt(p: ToolPointer): number {
    const { editor } = this;
    if (!editor.guidesVisible || editor.viewOptions.lockGuides) return -1;
    if (editor.activeTool?.id !== 'move' && !p.ctrlKey) return -1;
    return hitGuide(editor.doc.guides, p.x, p.y, 4 / editor.viewport.zoom);
  }

  private startGuideDrag(e: PointerEvent, dir: GuideDir, index: number | null, cleanup: () => void): void {
    this.guide = { pointerId: e.pointerId, dir, index, cleanup };
    const pos = index === null ? this.guidePos(e, dir) : this.editor.doc.guides[index].pos;
    this.editor.guideDrag = { guide: { dir, pos }, index };
    this.canvas.style.cursor = dir === 'h' ? 'row-resize' : 'col-resize';
    this.editor.notifyView();
  }

  /** Poloha vodítka pod kurzorem (px dokumentu, celé px, s přichycením). */
  private guidePos(e: PointerEvent, dir: GuideDir): number {
    const rect = this.canvas.getBoundingClientRect();
    const { x, y } = this.editor.viewport.toDoc(e.clientX - rect.left, e.clientY - rect.top);
    const v = dir === 'h' ? y : x;
    const t = this.editor.snapTargets();
    // K jiným vodítkům se vodítko nepřichytává (zdvojilo by se).
    const guides = new Set(this.editor.doc.guides.filter((g) => g.dir === dir).map((g) => g.pos));
    const targets = (dir === 'h' ? t.ys : t.xs).filter((p) => !guides.has(p));
    return snapValue(v, targets, SNAP_DISTANCE / this.editor.viewport.zoom) ?? Math.round(v);
  }

  /** Kurzor je nad plátnem (ne nad pravítkem ani mimo pohled). */
  private overCanvas(e: PointerEvent): boolean {
    const r = this.canvas.getBoundingClientRect();
    return e.clientX >= r.left && e.clientY >= r.top && e.clientX < r.right && e.clientY < r.bottom;
  }

  private moveGuideDrag(e: PointerEvent): boolean {
    const g = this.guide;
    if (!g || e.pointerId !== g.pointerId) return false;
    this.editor.guideDrag = { guide: { dir: g.dir, pos: this.guidePos(e, g.dir) }, index: g.index };
    const rect = this.canvas.getBoundingClientRect();
    this.editor.pointer = this.editor.viewport.toDoc(e.clientX - rect.left, e.clientY - rect.top);
    this.editor.notifyView();
    return true;
  }

  /** Puštění vodítka: nad plátnem = přidat / posunout, jinde = zrušit / smazat. */
  private endGuideDrag(e: PointerEvent, cancel = false): boolean {
    const g = this.guide;
    if (!g || e.pointerId !== g.pointerId) return false;
    g.cleanup();
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const drag = this.editor.guideDrag;
    this.guide = null;
    this.editor.guideDrag = null;
    const { editor } = this;
    const guides = editor.doc.guides;
    if (!cancel && drag) {
      const inside = this.overCanvas(e);
      if (g.index === null) {
        if (inside) editor.addGuide(drag.guide);
      } else if (!inside) editor.setGuides(guides.filter((_, i) => i !== g.index), 'Smazat vodítko');
      else if (drag.guide.pos !== guides[g.index].pos) editor.setGuides(guides.map((x, i) => (i === g.index ? drag.guide : x)), 'Přesunout vodítko');
    }
    this.updateCursor();
    editor.notifyView();
    return true;
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.moveGuideDrag(e)) return;
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
        const g = this.guideAt(p);
        this.canvas.style.cursor = g >= 0 ? (this.editor.doc.guides[g].dir === 'h' ? 'row-resize' : 'col-resize') : (tool?.cursorAt?.(p) ?? tool?.cursor ?? 'default');
      }
    }
    this.editor.notifyView();
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.endGuideDrag(e)) return;
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
