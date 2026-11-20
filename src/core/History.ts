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
  /** Odhad paměti, kterou příkaz drží (pixely stavu před / po), v bajtech. */
  readonly bytes?: number;
}

/** Paměť pixelů plátna (RGBA). */
export function canvasBytes(c: { width: number; height: number } | null | undefined): number {
  return c ? c.width * c.height * 4 : 0;
}

/**
 * Lineární historie s ukazatelem pozice. Uchovává celou historii (volitelně s limitem),
 * umožňuje undo/redo i skok na libovolný krok.
 */
export class History extends Emitter<{ change: void }> {
  private stack: Command[] = [];
  private pos = 0;
  private readonly sizes = new WeakMap<Command, number>();
  private total = 0;
  /** Kolik nejstarších kroků už bylo kvůli limitům zahozeno. */
  dropped = 0;

  constructor(
    private readonly limit = Number.POSITIVE_INFINITY,
    /** Limit paměti kroků v bajtech – nejstarší kroky nad limit se zahodí (aktuální stav zůstává). */
    public memoryLimit = Number.POSITIVE_INFINITY,
  ) {
    super();
  }

  /** Odhad paměti, kterou drží všechny kroky historie (bajty). */
  get memory(): number {
    return this.total;
  }

  private drop(command: Command | undefined): void {
    if (!command) return;
    this.total -= this.sizes.get(command) ?? 0;
    command.dispose?.();
  }

  /** Zahodí nejstarší kroky nad limit počtu / paměti (poslední krok vždy zůstane). */
  trim(): void {
    let changed = false;
    while (this.stack.length > 1 && (this.stack.length > this.limit || this.total > this.memoryLimit) && this.pos > 0) {
      this.drop(this.stack.shift());
      this.pos--;
      this.dropped++;
      changed = true;
    }
    if (changed) this.emit('change');
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
    for (const dropped of this.stack.splice(this.pos)) this.drop(dropped);
    this.stack.push(command);
    const size = command.bytes ?? 0;
    this.sizes.set(command, size);
    this.total += size;
    this.pos = this.stack.length;
    this.trim();
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
    for (const c of this.stack) this.drop(c);
    this.stack = [];
    this.pos = 0;
    this.total = 0;
    this.emit('change');
  }
}
