import type { Editor } from '../core/Editor';
import type { IconNode } from '../ui/icons';

export interface ToolPointer {
  /** Souřadnice v dokumentu. */
  x: number;
  y: number;
  /** Souřadnice na obrazovce (CSS px v plátně). */
  screenX: number;
  screenY: number;
  pressure: number;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}

export interface ToolOptionsUI {
  element: HTMLElement;
  dispose?(): void;
}

/**
 * Rozhraní nástroje. Nový nástroj = nová třída implementující Tool + registrace v main.ts.
 */
export interface Tool {
  readonly id: string;
  readonly name: string;
  readonly icon: IconNode;
  /** Nástroj je zatím jen připravený v UI (bez funkce). */
  readonly placeholder?: boolean;
  /** Jednopísmenná klávesová zkratka (bez modifikátorů), např. "B". */
  readonly shortcut?: string;
  readonly cursor: string;

  activate?(): void;
  deactivate?(): void;
  pointerDown?(p: ToolPointer): void;
  pointerMove?(p: ToolPointer): void;
  pointerUp?(p: ToolPointer): void;
  /** Klávesa při aktivním nástroji; `true` = zpracováno (nepoužije se jako zkratka). */
  keyDown?(e: KeyboardEvent): boolean;
  /** Kreslení pomocné grafiky přes plátno (v souřadnicích obrazovky). */
  drawOverlay?(ctx: CanvasRenderingContext2D, editor: Editor): void;
  /** UI s volbami nástroje zobrazené v horní liště. */
  createOptions?(): ToolOptionsUI;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  /** Naposledy použitý nástroj pro každou zkratku (skupiny nástrojů sdílejí písmeno). */
  private readonly lastUsed = new Map<string, Tool>();

  register(...tools: Tool[]): void {
    for (const tool of tools) {
      if (this.tools.has(tool.id)) throw new Error(`Nástroj ${tool.id} už je registrován`);
      this.tools.set(tool.id, tool);
    }
  }

  markUsed(tool: Tool): void {
    if (tool.shortcut) this.lastUsed.set(tool.shortcut, tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  all(): Tool[] {
    return [...this.tools.values()];
  }

  byShortcut(key: string): Tool | undefined {
    const k = key.toUpperCase();
    return this.lastUsed.get(k) ?? this.all().find((t) => t.shortcut === k);
  }
}
