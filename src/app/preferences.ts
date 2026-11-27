/*
 * Uživatelské předvolby uložené v prohlížeči (localStorage). Nedostupné úložiště (soukromý režim,
 * zakázané cookies) se tiše ignoruje – použijí se výchozí hodnoty.
 */

import type { ViewOptions } from '../core/Editor';

const KEY = 'photoshop-ts:preferences';

export interface Preferences {
  /** Limit paměti historie na dokument (bajty). */
  historyMemoryLimit?: number;
  /** Pomocné prvky, vodítka a přichytávání (menu Zobrazení). */
  viewOptions?: Partial<ViewOptions>;
}

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Preferences) : {};
  } catch {
    return {};
  }
}

export function savePreferences(patch: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPreferences(), ...patch }));
  } catch {
    // Bez úložiště předvolby platí jen do zavření stránky.
  }
}
