// Individual staff accounts (no shared password), server-side sessions, phone-app codes (TOTP),
// lockout after repeated wrong tries, idle and absolute session limits, revocation on logout and
// password change. PHIPA s.12: reasonable safeguards and individual accountability.

import type { DatabaseSync } from "node:sqlite";
import type { Vault } from "./vault.ts";
import {
  hashPassword, newTotpSecret, otpauthUri, passwordProblem, randomToken, sha256, verifyPassword, verifyTotp,
} from "./crypto.ts";
import { ROLES, type Role } from "./permissions.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last_counter INTEGER,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  credential_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS user_clinics (
  user_id INTEGER NOT NULL REFERENCES users(id),
  clinic_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, clinic_id)
);
-- Only a hash of each session token is stored, so a copied database holds no live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,
  credential_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`;

/** full: normal access. setup: may only change password / enrol the phone-app code. second: waiting for the code. */
export type SessionScope = "full" | "setup" | "second";

export interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
  must_change_password: number;
  totp_enabled: number;
  disabled: number;
  locked_until: string | null;
  created_at: string;
}

export interface SessionInfo {
  user: User;
  scope: SessionScope;
  clinicIds: number[];
  tokenHash: string;
}

export type LoginResult =
  | { ok: false; reason: "invalid" | "locked" | "disabled"; lockedUntil?: string }
  | { ok: true; user: User; next: "done" | "second_step" | "setup" };

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const SECOND_STEP_MINUTES = 5;

export class Accounts {
  private readonly db: DatabaseSync;
  private readonly vault: Vault;
  private readonly opts: { idleMinutes: number; sessionHours: number; requireTotp: boolean };
  /** Per-IP limiter for sign-in attempts (accounts also lock on their own). */
  private readonly ipAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(db: DatabaseSync, vault: Vault, opts: { idleMinutes: number; sessionHours: number; requireTotp: boolean }) {
    this.db = db;
    this.vault = vault;
    this.opts = opts;
    db.exec(SCHEMA);
  }

  private q<T>(sql: string, ...p: (string | number | null)[]): T | undefined {
    return this.db.prepare(sql).get(...p) as T | undefined;
  }

  count(): number {
    return Number(this.q<{ n: number }>("SELECT COUNT(*) n FROM users")?.n ?? 0);
  }

  getUser(id: number): User | undefined {
    return this.q<User>("SELECT * FROM users WHERE id = ?", id);
  }

  findByUsername(username: string): User | undefined {
    return this.q<User>("SELECT * FROM users WHERE username = ?", username.trim());
  }

  clinicsOf(userId: number): number[] {
    return (this.db.prepare("SELECT clinic_id FROM user_clinics WHERE user_id = ? ORDER BY clinic_id").all(userId) as { clinic_id: number }[]).map((r) => r.clinic_id);
  }

  listUsers(clinicId: number): (User & { clinic_ids: string })[] {
    return this.db.prepare(
      `SELECT u.id, u.username, u.name, u.role, u.must_change_password, u.totp_enabled, u.disabled, u.locked_until, u.created_at,
              (SELECT group_concat(clinic_id) FROM user_clinics x WHERE x.user_id = u.id) AS clinic_ids
       FROM users u JOIN user_clinics uc ON uc.user_id = u.id WHERE uc.clinic_id = ? ORDER BY u.name`,
    ).all(clinicId) as unknown as (User & { clinic_ids: string })[];
  }

  /**
   * Creates an account with a one-time temporary passphrase the person must change at first sign-in.
   * The temporary passphrase is returned once and never stored in clear.
   */
  createUser(input: { username: string; name: string; role: Role; clinicIds: number[]; createdBy: string; password?: string }): { user: User; tempPassword: string } {
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9._@+-]{3,80}$/.test(username)) throw new AccountError("Use 3-80 letters, numbers or . _ @ + - for the username.");
    if (!ROLES.includes(input.role)) throw new AccountError("Unknown role.");
    if (!input.name.trim()) throw new AccountError("Name is required.");
    if (!input.clinicIds.length) throw new AccountError("Pick at least one clinic.");
    if (this.q("SELECT 1 FROM users WHERE username = ?", username)) throw new AccountError("That username is taken.");
    const tempPassword = input.password ?? randomToken(12);
    const id = Number(this.db.prepare(
      "INSERT INTO users (username, name, role, password_hash, must_change_password, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(username, input.name.trim().slice(0, 80), input.role, hashPassword(tempPassword), input.password ? 0 : 1, input.createdBy).lastInsertRowid);
    for (const c of input.clinicIds) this.db.prepare("INSERT INTO user_clinics (user_id, clinic_id) VALUES (?, ?)").run(id, c);
    return { user: this.getUser(id)!, tempPassword };
  }

  /** Throttles by IP: 20 attempts per 15 minutes. Returns false when the caller must wait. */
  allowAttempt(ip: string): boolean {
    const now = Date.now();
    const entry = this.ipAttempts.get(ip);
    if (!entry || entry.resetAt < now) {
      this.ipAttempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
      return true;
    }
    entry.count++;
    return entry.count <= 20;
  }

  login(username: string, password: string): LoginResult {
    const row = this.q<User & { password_hash: string; failed_logins: number }>("SELECT * FROM users WHERE username = ?", username.trim().toLowerCase());
    // Always run a hash so response time doesn't reveal whether the username exists.
    const ok = row ? verifyPassword(password, row.password_hash) : (verifyPassword(password, DUMMY_HASH), false);
    if (!row) return { ok: false, reason: "invalid" };
    if (row.disabled) return { ok: false, reason: "disabled" };
    if (row.locked_until && row.locked_until > new Date().toISOString()) return { ok: false, reason: "locked", lockedUntil: row.locked_until };
    if (!ok) {
      const fails = row.failed_logins + 1;
      const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      this.db.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?").run(lock ? 0 : fails, lock, row.id);
      return lock ? { ok: false, reason: "locked", lockedUntil: lock } : { ok: false, reason: "invalid" };
    }
    this.db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").run(row.id);
    const user = this.getUser(row.id)!;
    if (user.must_change_password || (this.opts.requireTotp && !user.totp_enabled)) return { ok: true, user, next: "setup" };
    if (user.totp_enabled) return { ok: true, user, next: "second_step" };
    return { ok: true, user, next: "done" };
  }

  /** Second step: checks the phone-app code; a code can't be used twice. */
  checkCode(userId: number, code: string): boolean {
    const row = this.q<{ totp_secret: string | null; totp_last_counter: number | null }>("SELECT totp_secret, totp_last_counter FROM users WHERE id = ?", userId);
    if (!row?.totp_secret) return false;
    const secret = this.vault.open(0, `totp:${userId}`, row.totp_secret) ?? "";
    const counter = verifyTotp(secret, code, row.totp_last_counter);
    if (counter === undefined) {
      this.registerFailure(userId);
      return false;
    }
    this.db.prepare("UPDATE users SET totp_last_counter = ?, failed_logins = 0 WHERE id = ?").run(counter, userId);
    return true;
  }

  private registerFailure(userId: number): void {
    const row = this.q<{ failed_logins: number }>("SELECT failed_logins FROM users WHERE id = ?", userId);
    const fails = (row?.failed_logins ?? 0) + 1;
    const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    this.db.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?").run(lock ? 0 : fails, lock, userId);
  }

  startTotpEnrolment(userId: number, issuer: string): { secret: string; uri: string } {
    const user = this.getUser(userId)!;
    const secret = newTotpSecret();
    this.db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_counter = NULL WHERE id = ?")
      .run(this.vault.seal(0, `totp:${userId}`, secret), userId);
    return { secret, uri: otpauthUri(secret, user.username, issuer) };
  }

  confirmTotpEnrolment(userId: number, code: string): boolean {
    if (!this.checkCode(userId, code)) return false;
    this.db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(userId);
    return true;
  }

  changePassword(userId: number, current: string, next: string): string | undefined {
    const row = this.q<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", userId);
    if (!row || !verifyPassword(current, row.password_hash)) return "Your current passphrase is not right.";
    const problem = passwordProblem(next);
    if (problem) return problem;
    if (current === next) return "Choose a passphrase you haven't used here before.";
    this.db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, credential_version = credential_version + 1 WHERE id = ?")
      .run(hashPassword(next), userId);
    return undefined;
  }

  /** Owner reset: a new temporary passphrase, the phone-app code cleared, every session ended. */
  resetCredentials(userId: number): string {
    const temp = randomToken(12);
    this.db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 1, totp_secret = NULL, totp_enabled = 0, totp_last_counter = NULL,
         failed_logins = 0, locked_until = NULL, credential_version = credential_version + 1 WHERE id = ?`,
    ).run(hashPassword(temp), userId);
    this.revokeAll(userId);
    return temp;
  }

  setDisabled(userId: number, disabled: boolean): void {
    this.db.prepare("UPDATE users SET disabled = ?, credential_version = credential_version + 1 WHERE id = ?").run(disabled ? 1 : 0, userId);
    if (disabled) this.revokeAll(userId);
  }

  // ---- sessions ------------------------------------------------------------

  issueSession(userId: number, scope: SessionScope, ip: string): string {
    const token = randomToken(32);
    const now = new Date();
    const minutes = scope === "second" ? SECOND_STEP_MINUTES : scope === "setup" ? 30 : this.opts.sessionHours * 60;
    const user = this.q<{ credential_version: number }>("SELECT credential_version FROM users WHERE id = ?", userId)!;
    this.db.prepare(
      "INSERT INTO sessions (token_hash, user_id, scope, credential_version, created_at, last_seen_at, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(sha256(token), userId, scope, user.credential_version, now.toISOString(), now.toISOString(), new Date(now.getTime() + minutes * 60_000).toISOString(), ip);
    return token;
  }

  /** Validates a session token. Expired, idle, revoked or outdated (password changed) sessions are refused. */
  readSession(token: string | undefined, opts: { touch?: boolean } = {}): SessionInfo | undefined {
    if (!token || token.length > 200) return undefined;
    const hash = sha256(token);
    const row = this.q<{ user_id: number; scope: SessionScope; credential_version: number; last_seen_at: string; expires_at: string }>(
      "SELECT * FROM sessions WHERE token_hash = ?", hash,
    );
    if (!row) return undefined;
    const now = Date.now();
    const idleLimit = Date.parse(row.last_seen_at) + this.opts.idleMinutes * 60_000;
    const user = this.q<User & { credential_version: number }>("SELECT * FROM users WHERE id = ?", row.user_id);
    if (!user || user.disabled || user.credential_version !== row.credential_version || now > Date.parse(row.expires_at) || (row.scope === "full" && now > idleLimit)) {
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return undefined;
    }
    if (opts.touch !== false) this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(new Date(now).toISOString(), hash);
    return { user: this.getUser(user.id)!, scope: row.scope, clinicIds: this.clinicsOf(user.id), tokenHash: hash };
  }

  revoke(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  }

  revokeAll(userId: number): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  pruneSessions(): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  }
}

export class AccountError extends Error {}

const DUMMY_HASH = hashPassword("timing-equaliser-not-a-real-account");
