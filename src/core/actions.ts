export interface Action {
  readonly id: string;
  readonly label: string;
  /** Např. "Ctrl+Z", "Ctrl+Shift+Z", "[". */
  readonly shortcuts?: readonly string[];
  /** Zkratka jen k zobrazení v menu (obsluhuje ji prohlížeč, např. Ctrl+V → událost paste). */
  readonly shortcutHint?: string;
  run(): void | Promise<void>;
  isEnabled?(): boolean;
  /** Zaškrtnutí v menu (přepínače typu „Pravítka“). */
  isChecked?(): boolean;
  /** Akce je zatím jen připravená v menu (bez funkce, zobrazí se zašedle). */
  placeholder?: boolean;
}

/** Připravená, zatím nefunkční položka menu. */
export function placeholderAction(id: string, label: string, ...shortcuts: string[]): Action {
  return { id, label, shortcuts, placeholder: true, run: () => {} };
}

const CODE_KEYS: Record<string, string> = {
  Semicolon: ';',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Equal: '=',
  Minus: '-',
  NumpadAdd: '+',
  NumpadSubtract: '-',
};

function keyFromCode(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return CODE_KEYS[code] ?? null;
}

function combo(e: KeyboardEvent, key: string): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

/**
 * Registr akcí (menu, zkratky). Nová funkce = registrace akce + případně položka v menu.
 */
export class ActionRegistry {
  private readonly actions = new Map<string, Action>();

  register(...actions: Action[]): void {
    for (const a of actions) this.actions.set(a.id, a);
  }

  get(id: string): Action | undefined {
    return this.actions.get(id);
  }

  isEnabled(id: string): boolean {
    const a = this.actions.get(id);
    return !!a && !a.placeholder && (a.isEnabled?.() ?? true);
  }

  run(id: string): void {
    const a = this.actions.get(id);
    if (!a || !this.isEnabled(id)) return;
    Promise.resolve(a.run()).catch((err) => {
      console.error(err);
      alert(`Akce „${a.label}“ selhala: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** Najde akci podle stisknuté klávesy (nejdřív podle znaku, pak podle fyzické klávesy – kvůli CZ rozložení). */
  match(e: KeyboardEvent): Action | undefined {
    const candidates = [combo(e, e.key)];
    const fromCode = keyFromCode(e.code);
    if (fromCode) candidates.push(combo(e, fromCode));
    for (const c of candidates) {
      for (const a of this.actions.values()) {
        // Zkratky připravených akcí jsou jen informativní – nechceme blokovat výchozí chování prohlížeče.
        if (!a.placeholder && a.shortcuts?.includes(c)) return a;
      }
    }
    return undefined;
  }
}
