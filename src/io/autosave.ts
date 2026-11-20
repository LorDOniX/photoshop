import type { DocSession, Editor } from '../core/Editor';
import type { Command } from '../core/History';
import { saveProject } from './project';

/*
 * Automatické ukládání rozpracovaných dokumentů do IndexedDB prohlížeče. Ukládají se jen záložky
 * s neuloženými změnami (formát .ptsp), záznam zmizí po uložení do souboru nebo zavření záložky.
 * Po spuštění aplikace se nabídne obnova (např. po pádu prohlížeče nebo zavření bez uložení).
 */

const DB_NAME = 'photoshop-ts';
const STORE = 'autosave';
/** Prodleva po poslední změně, než se uloží (ms). */
const DELAY = 2500;

export interface AutosaveEntry {
  id: string;
  fileName: string;
  /** Čas uložení (ms od epochy). */
  savedAt: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function listAutosaves(): Promise<AutosaveEntry[]> {
  return tx<AutosaveEntry[]>('readonly', (s) => s.getAll() as IDBRequest<AutosaveEntry[]>).then((all) => all.sort((a, b) => a.savedAt - b.savedAt));
}

export function putAutosave(entry: AutosaveEntry): Promise<unknown> {
  return tx('readwrite', (s) => s.put(entry));
}

export function deleteAutosave(id: string): Promise<unknown> {
  return tx('readwrite', (s) => s.delete(id));
}

/** Hlídá otevřené záložky a jejich neuložené změny průběžně ukládá. */
export class AutoSaver {
  private timer = 0;
  /** Stav historie při posledním automatickém uložení (aby se neukládalo znovu totéž). */
  private readonly lastSaved = new Map<string, { entry: Command | null; position: number; fileName: string }>();
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly editor: Editor) {
    editor.on('history', () => this.schedule());
    editor.on('documents', () => this.schedule());
    // Odchod ze stránky / přepnutí do jiné aplikace: uložit hned.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), DELAY);
  }

  private stateOf(s: DocSession): { entry: Command | null; position: number; fileName: string } {
    return { entry: s.history.entries[s.history.position - 1] ?? null, position: s.history.position, fileName: s.fileName };
  }

  /** Uloží změněné neuložené záložky a smaže záznamy uložených / zavřených. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.saving = this.saving.then(() => this.run()).catch((err) => console.warn('Automatické uložení selhalo:', err));
    return this.saving;
  }

  private async run(): Promise<void> {
    const open = new Set(this.editor.sessions.map((s) => s.id));
    for (const id of [...this.lastSaved.keys()]) {
      if (!open.has(id)) {
        this.lastSaved.delete(id);
        await deleteAutosave(id);
      }
    }
    for (const s of this.editor.sessions) {
      if (!this.editor.isDirty(s)) {
        if (this.lastSaved.delete(s.id)) await deleteAutosave(s.id);
        continue;
      }
      const state = this.stateOf(s);
      const prev = this.lastSaved.get(s.id);
      if (prev && prev.entry === state.entry && prev.position === state.position && prev.fileName === state.fileName) continue;
      await putAutosave({ id: s.id, fileName: s.fileName, savedAt: Date.now(), blob: await saveProject(s.doc) });
      this.lastSaved.set(s.id, state);
    }
  }
}
