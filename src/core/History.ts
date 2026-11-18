import { Emitter } from './Emitter';

/**
 * Vratná operace nad dokumentem. Každá úprava, která má jít vrátit, musí být příkaz.
 * `do()` se volá při prvním provedení (přes History.execute) i při redo.
 */
export interface Command {
  readonly label: string;
  do(): void;
  undo(): void;
  /** Uvolnění zdrojů, když příkaz definitivně vypadne z historie. */
  dispose?(): void;
}

/**
 * Lineární historie s ukazatelem pozice. Uchovává celou historii (volitelně s limitem),
 * umožňuje undo/redo i skok na libovolný krok.
 */
export class History extends Emitter<{ change: void }> {
  private stack: Command[] = [];
  private pos = 0;

  constructor(private readonly limit = Number.POSITIVE_INFINITY) {
    super();
  }

  get entries(): readonly Command[] {
    return this.stack;
  }

  /** Počet aplikovaných příkazů (0 = výchozí stav). */
  get position(): number {
    return this.pos;
  }

  get canUndo(): boolean {
    return this.pos > 0;
  }

  get canRedo(): boolean {
    return this.pos < this.stack.length;
  }

  /** Provede příkaz a zapíše ho do historie. */
  execute(command: Command): void {
    command.do();
    this.push(command);
  }

  /** Zapíše příkaz, jehož efekt už byl aplikován (např. tah štětcem). */
  push(command: Command): void {
    for (const dropped of this.stack.splice(this.pos)) dropped.dispose?.();
    this.stack.push(command);
    while (this.stack.length > this.limit) this.stack.shift()?.dispose?.();
    this.pos = this.stack.length;
    this.emit('change');
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    this.stack[--this.pos].undo();
    this.emit('change');
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.stack[this.pos++].do();
    this.emit('change');
    return true;
  }

  /** Přesune stav na danou pozici (0..entries.length). */
  goTo(position: number): void {
    const target = Math.max(0, Math.min(position, this.stack.length));
    if (target === this.pos) return;
    while (this.pos > target) this.stack[--this.pos].undo();
    while (this.pos < target) this.stack[this.pos++].do();
    this.emit('change');
  }

  clear(): void {
    for (const c of this.stack) c.dispose?.();
    this.stack = [];
    this.pos = 0;
    this.emit('change');
  }
}
