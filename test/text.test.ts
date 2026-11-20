import { describe, expect, it, vi } from 'vitest';

// Plátna jsou v Node jen atrapy – textová data se k nim váží přes WeakMap.
vi.mock('../src/core/canvas', () => ({
  createCanvas: (width: number, height: number) => ({ width, height }),
  cloneCanvas: (c: { width: number; height: number }) => ({ ...c }),
  get2d: () => ({ drawImage: () => {} }),
}));

import { LayerStateCommand } from '../src/core/commands/stateCommands';
import { History } from '../src/core/History';
import { captureLayer, ImageDocument } from '../src/core/ImageDocument';
import { Layer } from '../src/core/Layer';
import {
  anchoredPosition,
  autoLayerName,
  DEFAULT_TEXT,
  layoutText,
  lineStart,
  padX,
  padY,
  positionForClick,
  setTextData,
  type TextData,
} from '../src/core/text';

const data = (patch: Partial<TextData> = {}): TextData => ({ ...DEFAULT_TEXT, size: 20, ...patch });
/** Měření: 10 px na znak. */
const measure = (line: string) => line.length * 10;

describe('rozložení textu', () => {
  it('rozměry podle nejdelšího řádku, řádkování a okrajů', () => {
    const d = data({ content: 'ab\nabcd', lineHeight: 1.5 });
    const l = layoutText(d, measure);
    expect(l.lines).toEqual(['ab', 'abcd']);
    expect(l.contentWidth).toBe(40);
    expect(l.width).toBe(40 + 2 * padX(d));
    expect(l.height).toBe(2 * 30 + 2 * padY(d));
  });

  it('prázdný text má minimální šířku pro kurzor', () => {
    expect(layoutText(data(), measure).contentWidth).toBe(10);
  });

  it('kurzíva má větší vodorovný okraj', () => {
    expect(padX(data({ style: 'italic' }))).toBeGreaterThan(padX(data()));
  });

  it('začátek řádku podle zarovnání', () => {
    const l = layoutText(data({ content: 'ab\nabcd' }), measure);
    expect(lineStart(l, 0, 'left')).toBe(l.padX);
    expect(lineStart(l, 0, 'center')).toBe(l.padX + 10);
    expect(lineStart(l, 0, 'right')).toBe(l.padX + 20);
    expect(lineStart(l, 1, 'right')).toBe(l.padX);
  });
});

describe('ukotvení textu', () => {
  const old = { x: 100, y: 50, width: 80, data: data() };
  it('vlevo zarovnaný text drží levý okraj', () => {
    expect(anchoredPosition(old, { width: 200, data: data() })).toEqual({ x: 100, y: 50 });
  });
  it('vpravo zarovnaný drží pravý okraj, na střed drží střed', () => {
    expect(anchoredPosition({ ...old, data: data({ align: 'right' }) }, { width: 120, data: data({ align: 'right' }) }).x).toBe(60);
    expect(anchoredPosition({ ...old, data: data({ align: 'center' }) }, { width: 120, data: data({ align: 'center' }) }).x).toBe(80);
  });
  it('větší písmo drží střed prvního řádku', () => {
    const p = anchoredPosition(old, { width: 80, data: data({ size: 40 }) });
    const mid = (y: number, d: TextData) => y + padY(d) + (d.size * d.lineHeight) / 2;
    expect(Math.abs(mid(p.y, data({ size: 40 })) - mid(50, data()))).toBeLessThan(1);
  });
  it('klik = začátek účaří prvního řádku', () => {
    const d = data();
    const p = positionForClick(200, 100, d, 60);
    expect(p.x).toBe(200 - padX(d));
    expect(p.y).toBeLessThan(100 - d.size * 0.5);
    expect(positionForClick(200, 100, data({ align: 'right' }), 60).x).toBe(200 - 60 + padX(d));
  });
});

describe('textová vrstva', () => {
  it('název z prvního neprázdného řádku', () => {
    expect(autoLayerName('\n  Ahoj světe  \ndruhý')).toBe('Ahoj světe');
    expect(autoLayerName('')).toBe('Text');
    expect(autoLayerName('x'.repeat(40))).toBe(`${'x'.repeat(30)}…`);
  });

  it('text patří k plátnu – nové plátno = rastr, undo vrátí text', () => {
    const doc = new ImageDocument(100, 100);
    const layer = new Layer(10, 10, { id: 't' });
    setTextData(layer.canvas, data({ content: 'Ahoj' }));
    doc.insertLayer(layer);
    expect(layer.text?.content).toBe('Ahoj');
    const before = captureLayer(layer);
    const h = new History();
    h.execute(new LayerStateCommand(doc, 't', before, { ...before, canvas: { width: 10, height: 10 } as HTMLCanvasElement }, 'Rastrovat'));
    expect(layer.text).toBeNull();
    h.undo();
    expect(layer.text?.content).toBe('Ahoj');
    // Posun vrstvy plátno nemění – text zůstává.
    doc.updateLayer('t', { x: 30 });
    expect(layer.text?.content).toBe('Ahoj');
  });

  it('duplikát textové vrstvy je také textový', () => {
    const layer = new Layer(10, 10);
    setTextData(layer.canvas, data({ content: 'X' }));
    const copy = layer.duplicate() as Layer;
    expect(copy.text?.content).toBe('X');
  });
});
