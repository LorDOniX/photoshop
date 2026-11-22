import { histogram, type Adjustment, type Channel } from './adjust';
import type { Rect } from './canvas';
import type { Editor } from './Editor';
import type { Job } from './jobs';
import { PixelSession, sessionTarget } from './pixelSession';

/*
 * Úprava obrazu s náhledem naživo (Obraz → Úpravy): pixely aktivní vrstvy (nebo masky) ve výběru se při
 * každé změně přepočítají z originálu na pozadí (PixelSession) a zapíšou přímo do vrstvy. Potvrzení = jeden
 * krok historie, zrušení vrátí originál. Měkký výběr upraví pixely jen zčásti, průhlednost se nemění.
 */
export class AdjustmentSession extends PixelSession<Adjustment> {
  private source: Uint8ClampedArray | null = null;
  // Úprava, která nic nezměnila (výchozí hodnoty), nemá být krokem historie.
  protected override readonly skipUnchanged = true;

  /** Začne úpravu aktivní vrstvy (masky, je-li cílem). Null = není co upravit (skupina, zamčené pixely, prázdný výběr). */
  static start(editor: Editor): AdjustmentSession | null {
    const target = sessionTarget(editor, false);
    return target ? new AdjustmentSession(editor, target) : null;
  }

  /** Barvy originálu ve výběru (histogram, automatické úrovně). */
  override get pixels(): Uint8ClampedArray {
    return (this.source ??= super.pixels);
  }

  histogram(channel: Channel): Uint32Array {
    return histogram(this.pixels, channel, this.weights ?? undefined);
  }

  protected reach(): number {
    return 0;
  }

  protected job(a: Adjustment, _area: Rect, _scale: number): Job {
    return { type: 'adjust', adjustment: a };
  }
}

/**
 * Úprava bez dialogu (Invertovat, Odbarvit, automatické úpravy). `make` dostane barvy originálu ve výběru.
 * Null = není co upravit; jinak promise s tím, zda vznikl krok historie.
 */
export function applyAdjustmentNow(editor: Editor, make: (session: AdjustmentSession) => Adjustment, label: string): Promise<boolean> | null {
  const session = AdjustmentSession.start(editor);
  if (!session) return null;
  return session.commitWith(make(session), label);
}
