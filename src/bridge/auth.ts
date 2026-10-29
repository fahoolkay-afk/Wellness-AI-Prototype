// Bridge request authentication and response signing (docs/INTEGRATION-CONTRACT.md section 4.3).
//
// Every request is started by the clinic laptop and signed with the clinic's own bridge key:
//   HMAC-SHA256(secret, "<timestamp>.req.<METHOD> <originalUrl>\n<nonce>\n<raw body>")
// This reuses verifyEhrSignature exactly (same "<ts>." prefix, 5-minute window, constant-time compare);
// the "req." label and the method + full path stop a signature being reused on another endpoint or as a
// response. Responses are signed with a "res." label over the request nonce, so the laptop can refuse
// anything that did not come from this server for this request.

import { createHmac } from "node:crypto";
import { verifyEhrSignature } from "../booking/ehr.ts";

export const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;
export const WINDOW_S = 300;

/** The bytes passed to verifyEhrSignature as its "body" argument for a request. */
export function requestMaterial(method: string, originalUrl: string, nonce: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`req.${method.toUpperCase()} ${originalUrl}\n${nonce}\n`), rawBody]);
}

export function verifyRequest(secret: string, method: string, originalUrl: string, nonce: string, rawBody: Buffer, signature: string | undefined, timestamp: string | undefined): boolean {
  return verifyEhrSignature(secret, requestMaterial(method, originalUrl, nonce, rawBody), signature, timestamp, WINDOW_S);
}

/** What the laptop sends (used by tests and by anyone building a client against this contract). */
export function signRequest(secret: string, method: string, originalUrl: string, nonce: string, rawBody: string | Buffer, timestamp = Math.floor(Date.now() / 1000)): { timestamp: string; signature: string } {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  const mac = createHmac("sha256", secret).update(`${timestamp}.`).update(requestMaterial(method, originalUrl, nonce, body)).digest("hex");
  return { timestamp: String(timestamp), signature: `sha256=${mac}` };
}

export function signResponse(secret: string, nonce: string, body: string, timestamp = Math.floor(Date.now() / 1000)): { timestamp: string; signature: string } {
  const mac = createHmac("sha256", secret).update(`${timestamp}.res.${nonce}\n${body}`).digest("hex");
  return { timestamp: String(timestamp), signature: `sha256=${mac}` };
}

export function timestampFresh(timestamp: string | undefined, nowS = Date.now() / 1000): boolean {
  return !!timestamp && /^\d{9,11}$/.test(timestamp) && Math.abs(nowS - Number(timestamp)) <= WINDOW_S;
}

/** Fixed-window rate limit per key id (60 requests a minute by default). In memory: one server process. */
export class RateLimiter {
  private readonly hits = new Map<string, { minute: number; n: number }>();
  private readonly perMinute: number;

  constructor(perMinute = 60) {
    this.perMinute = perMinute;
  }

  allow(key: string, nowMs = Date.now()): boolean {
    const minute = Math.floor(nowMs / 60_000);
    const cur = this.hits.get(key);
    if (!cur || cur.minute !== minute) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(key, { minute, n: 1 });
      return true;
    }
    cur.n++;
    return cur.n <= this.perMinute;
  }
}
