// Cryptographic building blocks, on node:crypto only.
//   - Field encryption at rest: AES-256-GCM, "e1:" format, AAD binds a value to its row so it cannot be
//     swapped between patients unnoticed.
//   - Per-purpose / per-clinic keys derived with HKDF from one master key.
//   - Password hashing with scrypt.
//   - TOTP (RFC 6238) for staff second-step sign-in.

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Accepts a 32-byte key as 64 hex chars or base64; any other string is stretched (demo keys only). */
export function parseKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 32 && /^[A-Za-z0-9+/=_-]+$/.test(raw)) return b64;
  return createHash("sha256").update(raw).digest();
}

/** True when the string is a real 32-byte key (hex or base64), not a passphrase. */
export function isStrongKey(raw: string): boolean {
  if (/^[0-9a-fA-F]{64,}$/.test(raw)) return true;
  return /^[A-Za-z0-9+/=_-]{43,}$/.test(raw) && Buffer.from(raw, "base64").length >= 32;
}

export function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), purpose, 32));
}

const PREFIX = "e1:";

export function seal(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function isSealed(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Decrypts an "e1:" value. Plain (legacy) values pass through. Throws if the value was tampered with or moved. */
export function open(key: Buffer, value: string, aad: string): string {
  if (!isSealed(value)) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
export const hmac = (key: Buffer | string, s: string): string => createHmac("sha256", key).update(s).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

// ---- passwords ---------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

/** Minimum passphrase policy: 12+ characters and not trivially guessable. */
export function passwordProblem(password: string): string | undefined {
  if (password.length < 12) return "Use at least 12 characters. A short sentence works well.";
  if (/^(.)\1+$/.test(password) || /^(password|demo|letmein|changeme|qwerty)/i.test(password)) return "That passphrase is too easy to guess.";
  return undefined;
}

// ---- TOTP (RFC 6238) ---------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export function totpCode(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = digest[digest.length - 1] & 15;
  const bin = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(bin).padStart(6, "0");
}

/**
 * Checks a 6-digit code within ±1 step. Returns the matched counter (to block reuse), or undefined.
 * `lastCounter` is the last counter already accepted for this account.
 */
export function verifyTotp(secret: string, code: string, lastCounter: number | null, now = Date.now()): number | undefined {
  if (!/^\d{6}$/.test(code.trim())) return undefined;
  const current = Math.floor(now / 30_000);
  for (const c of [current - 1, current, current + 1]) {
    if (lastCounter !== null && c <= lastCounter) continue;
    if (safeEqual(totpCode(secret, c), code.trim())) return c;
  }
  return undefined;
}

export function otpauthUri(secret: string, account: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
