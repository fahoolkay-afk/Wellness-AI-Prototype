// Encryption at rest for free text (message bodies, call transcripts and summaries, notes, task details).
// Every clinic has its own key derived from DATA_KEY, and every value is bound (AAD) to the conversation
// or clinic it belongs to, so a sealed value copied into another patient's row fails to open.

import { deriveKey, open, parseKey, seal } from "./crypto.ts";

export class Vault {
  private readonly master: Buffer;
  private readonly cache = new Map<number, Buffer>();

  constructor(dataKey: string) {
    this.master = parseKey(dataKey);
  }

  private key(clinicId: number): Buffer {
    let k = this.cache.get(clinicId);
    if (!k) {
      k = deriveKey(this.master, `clinic:${clinicId}:fields:v1`);
      this.cache.set(clinicId, k);
    }
    return k;
  }

  seal(clinicId: number, aad: string, text: string | null | undefined): string | null {
    if (text === null || text === undefined || text === "") return text ?? null;
    return seal(this.key(clinicId), text, aad);
  }

  open(clinicId: number, aad: string, value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    try {
      return open(this.key(clinicId), value, aad);
    } catch {
      // Tampered with, moved between rows, or the wrong key: never show it as if it were real.
      return "[unreadable: this text failed its integrity check]";
    }
  }

  /** A clinic-scoped key for another purpose (e.g. signing unsubscribe links). */
  purposeKey(clinicId: number, purpose: string): Buffer {
    return deriveKey(this.master, `clinic:${clinicId}:${purpose}`);
  }

  systemKey(purpose: string): Buffer {
    return deriveKey(this.master, `system:${purpose}`);
  }
}
