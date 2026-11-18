type Args<T> = [T] extends [void] ? [] : [T];
type AnyListener = (...args: unknown[]) => void;

/** Minimalistický typovaný event emitter. */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<AnyListener>>();

  on<K extends keyof Events>(type: K, listener: (...args: Args<Events[K]>) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const fn = listener as AnyListener;
    set.add(fn);
    return () => set.delete(fn);
  }

  protected emit<K extends keyof Events>(type: K, ...args: Args<Events[K]>): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }
}
