// HTTP-level protections shared by every route.

import type { NextFunction, Request, Response } from "express";
import { hmac, safeEqual } from "../security/crypto.ts";
import type { Vault } from "../security/vault.ts";
import type { Channel } from "../types.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Browser hardening for every response; no caching of anything under /api (it holds patient data). */
export function securityHeaders(opts: { https: boolean }) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (opts.https) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (req.path.startsWith("/api/") || req.path.startsWith("/u/")) res.setHeader("Cache-Control", "no-store");
    next();
  };
}

/**
 * Cross-site request protection for cookie-authenticated API calls: state-changing requests must come from
 * our own origin. (SameSite=Strict cookies are the first line; this is the second.)
 */
export function sameOrigin(allowedOrigins: () => string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const origin = req.get("origin") ?? (req.get("referer") ? new URL(req.get("referer")!).origin : undefined);
    if (!origin) return next(new HttpError(403, "Missing request origin"));
    const host = req.get("host");
    const allowed = allowedOrigins();
    if (allowed.includes(origin) || (host && (origin === `http://${host}` || origin === `https://${host}`))) return next();
    next(new HttpError(403, "Request from another site was refused"));
  };
}

export const COOKIE_SECURE = "__Host-fd_session";
export const COOKIE_PLAIN = "fd_session";

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k !== name) continue;
    try {
      return decodeURIComponent(v.join("="));
    } catch {
      return undefined; // malformed cookie = no session
    }
  }
  return undefined;
}

export function sessionCookie(name: string, token: string, secure: boolean, maxAgeS: number): string {
  return `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(name: string, secure: boolean): string {
  return `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** Constant-time comparison of a provided secret (header or Basic-auth password) with the configured one. */
export function secretMatches(provided: string | undefined, expected: string): boolean {
  return !!provided && !!expected && safeEqual(provided, expected);
}

export function basicAuthPassword(req: Request): string | undefined {
  const header = req.get("authorization");
  if (!header?.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return decoded.slice(decoded.indexOf(":") + 1);
}

// ---- unsubscribe links (CASL s.11) --------------------------------------------

export class UnsubscribeLinks {
  private readonly vault: Vault;
  private readonly baseUrl: string;

  constructor(vault: Vault, baseUrl: string) {
    this.vault = vault;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private sign(clinicId: number, contactId: number, channel: string): string {
    return hmac(this.vault.purposeKey(clinicId, "unsubscribe"), `${contactId}:${channel}`).slice(0, 32);
  }

  url(clinicId: number, contactId: number, channel: Channel): string {
    return `${this.baseUrl}/u/${clinicId}.${contactId}.${channel}.${this.sign(clinicId, contactId, channel)}`;
  }

  parse(token: string): { clinicId: number; contactId: number; channel: Channel } | undefined {
    const m = /^(\d+)\.(\d+)\.(sms|whatsapp|email|messenger|instagram)\.([0-9a-f]{32})$/.exec(token);
    if (!m) return undefined;
    const [, c, p, ch, sig] = m;
    return safeEqual(sig, this.sign(Number(c), Number(p), ch)) ? { clinicId: Number(c), contactId: Number(p), channel: ch as Channel } : undefined;
  }
}
