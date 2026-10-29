// Minimal staff authentication for the MVP: a shared clinic password and an
// HMAC-signed session cookie. Replace with per-user accounts (and SSO from the
// EHRM in the connected edition) before real patient data goes in.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE = "fd_session";
const MAX_AGE_S = 12 * 3600;

export interface Session {
  name: string;
  exp: number;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueSession(secret: string, name: string): string {
  const payload = Buffer.from(JSON.stringify({ name, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S })).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function readSession(secret: string, token: string | undefined): Session | undefined {
  if (!token) return undefined;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return undefined;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
  return session.exp > Date.now() / 1000 ? session : undefined;
}

export function passwordMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = createHmac("sha256", "pw").update(expected).digest();
  const b = createHmac("sha256", "pw").update(given).digest();
  return timingSafeEqual(a, b);
}

function cookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_S}${secure ? "; Secure" : ""}`;
}

export const clearCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export function currentSession(secret: string, req: Request): Session | undefined {
  return readSession(secret, cookie(req, COOKIE) ?? req.headers.authorization?.replace(/^Bearer /, ""));
}

export function requireStaff(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = currentSession(secret, req);
    if (!session) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }
    res.locals.staff = session;
    next();
  };
}
