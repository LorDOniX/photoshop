import { describe, expect, it, vi } from 'vitest';

// Vrstvy v Node nemají skutečný canvas – pro strukturální testy stačí atrapa.
vi.mock('../src/core/canvas', () => ({
  createCanvas: (width: number, height: number) => ({ width, height }),
  get2d: () => ({}),
}));

import { History, type Command } from '../src/core/History';
import { ImageDocument } from '../src/core/ImageDocument';
import { Layer } from '../src/core/Layer';
import {
  AddLayerCommand,
  MoveLayerCommand,
  RemoveLayerCommand,
  SetLayerPropsCommand,
} from '../src/core/commands/layerCommands';

function counter(log: string[], name: string): Command {
  return { label: name, do: () => log.push(`do ${name}`), undo: () => log.push(`undo ${name}`) };
}

function docWithLayers(...names: string[]): ImageDocument {
  const doc = new ImageDocument(10, 10);
  for (const name of names) doc.insertLayer(new Layer(10, 10, { id: name, name }));
  return doc;
}

const order = (doc: ImageDocument) => doc.layers.map((l) => l.id);

describe('History', () => {
  it('undo/redo a skok na libovolnou pozici', () => {
    const log: string[] = [];
    const h = new History();
    h.execute(counter(log, 'a'));
    h.execute(counter(log, 'b'));
    h.execute(counter(log, 'c'));
    expect(h.position).toBe(3);

    h.goTo(1);
    expect(log.slice(3)).toEqual(['undo c', 'undo b']);
    expect(h.canRedo).toBe(true);

    h.goTo(3);
    expect(log.slice(5)).toEqual(['do b', 'do c']);
    expect(h.undo()).toBe(true);
    expect(h.redo()).toBe(true);
    expect(h.redo()).toBe(false);
  });

  it('nový příkaz po undo zahodí „budoucnost“ a uvolní ji', () => {
    const disposed: string[] = [];
    const h = new History();
    const mk = (n: string): Command => ({ label: n, do() {}, undo() {}, dispose: () => disposed.push(n) });
    h.execute(mk('a'));
    h.execute(mk('b'));
    h.undo();
    h.execute(mk('c'));
    expect(h.entries.map((c) => c.label)).toEqual(['a', 'c']);
    expect(disposed).toEqual(['b']);
  });

  it('push zapíše bez provedení', () => {
    const log: string[] = [];
    const h = new History();
    h.push(counter(log, 'a'));
    expect(log).toEqual([]);
    h.undo();
    expect(log).toEqual(['undo a']);
  });
});

describe('příkazy vrstev', () => {
  it('přidání vrstvy a undo vrátí i aktivní vrstvu', () => {
    const doc = docWithLayers('bg');
    const h = new History();
    h.execute(new AddLayerCommand(doc, new Layer(10, 10, { id: 'top' }), 1));
    expect(order(doc)).toEqual(['bg', 'top']);
    expect(doc.activeLayerId).toBe('top');
    h.undo();
    expect(order(doc)).toEqual(['bg']);
    expect(doc.activeLayerId).toBe('bg');
    h.redo();
    expect(order(doc)).toEqual(['bg', 'top']);
  });

  it('smazání vrstvy vrátí vrstvu na původní index', () => {
    const doc = docWithLayers('a', 'b', 'c');
    doc.setActive('b');
    const h = new History();
    h.execute(new RemoveLayerCommand(doc, 'b'));
    expect(order(doc)).toEqual(['a', 'c']);
    expect(doc.activeLayerId).toBe('c');
    h.undo();
    expect(order(doc)).toEqual(['a', 'b', 'c']);
    expect(doc.activeLayerId).toBe('b');
  });

  it('změna pořadí a vlastností je vratná', () => {
    const doc = docWithLayers('a', 'b', 'c');
    const h = new History();
    h.execute(new MoveLayerCommand(doc, 'a', 2));
    expect(order(doc)).toEqual(['b', 'c', 'a']);
    h.execute(new SetLayerPropsCommand(doc, 'c', { opacity: 1, visible: true }, { opacity: 0.5, visible: false }));
    expect(doc.getLayer('c')).toMatchObject({ opacity: 0.5, visible: false });
    h.goTo(0);
    expect(order(doc)).toEqual(['a', 'b', 'c']);
    expect(doc.getLayer('c')).toMatchObject({ opacity: 1, visible: true });
  });
});
