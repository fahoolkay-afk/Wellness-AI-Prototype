// Housekeeping that protects patient data over time:
//   - retention: message and call text in the cloud is cleared after the clinic's retention period
//     (PHIPA s.13, secure disposal); who/when/channel metadata stays for the record.
//   - encrypted backups: an online SQLite snapshot sealed with AES-256-GCM (authenticated, so a tampered or
//     planted backup fails to restore), kept for 14 days. PHIPA s.12: protect against loss.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db.ts";
import type { AuditLog } from "./security/audit.ts";
import type { Accounts } from "./security/accounts.ts";

const MAGIC = Buffer.from("FDBK1");
const KEEP_DAYS = 14;

export class Maintenance {
  private readonly db: Db;
  private readonly audit: AuditLog;
  private readonly accounts: Accounts;
  private readonly backupDir: string;
  lastRun?: string;
  lastBackup?: string;

  constructor(db: Db, audit: AuditLog, accounts: Accounts, backupDir: string) {
    this.db = db;
    this.audit = audit;
    this.accounts = accounts;
    this.backupDir = backupDir;
  }

  runRetention(now = new Date()): { messages: number; calls: number } {
    let messages = 0;
    let calls = 0;
    for (const clinic of this.db.listClinics()) {
      const r = clinic.profile.retention ?? { messageDays: 180, callDays: 30 };
      const out = this.db.purgeOlderThan(
        clinic.id,
        new Date(now.getTime() - r.messageDays * 864e5).toISOString(),
        new Date(now.getTime() - r.callDays * 864e5).toISOString(),
      );
      if (out.messages || out.calls) {
        this.audit.record({ actorType: "system", actor: "retention", clinicId: clinic.id, action: "retention.purge", outcome: "ok", detail: `${out.messages} messages, ${out.calls} calls cleared` });
      }
      messages += out.messages;
      calls += out.calls;
    }
    this.accounts.pruneSessions();
    this.lastRun = now.toISOString();
    return { messages, calls };
  }

  /** Writes an encrypted, authenticated snapshot and removes snapshots older than 14 days. */
  backup(now = new Date()): string | undefined {
    if (!this.backupDir) return undefined;
    mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    const tmp = join(this.backupDir, `.snapshot-${process.pid}-${now.getTime()}.db`);
    this.db.sql.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const plain = readFileSync(tmp);
    rmSync(tmp, { force: true });
    const key = this.db.vault.systemKey("backup:v1");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(MAGIC);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const file = join(this.backupDir, `frontdesk-${now.toISOString().replace(/[:.]/g, "-")}.db.enc`);
    writeFileSync(file, Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]), { mode: 0o600 });
    for (const name of readdirSync(this.backupDir)) {
      const full = join(this.backupDir, name);
      if (name.endsWith(".db.enc") && statSync(full).mtimeMs < now.getTime() - KEEP_DAYS * 864e5) rmSync(full, { force: true });
    }
    this.audit.record({ actorType: "system", actor: "backup", action: "backup.create", outcome: "ok", detail: `${plain.length} bytes` });
    this.lastBackup = now.toISOString();
    return file;
  }
}

/** Decrypts a backup into a plain SQLite file (used by `npm run cli -- restore`). Throws if it was altered. */
export function decryptBackup(file: string, key: Buffer): Buffer {
  const raw = readFileSync(file);
  if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a front desk backup file");
  const iv = raw.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = raw.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(raw.subarray(MAGIC.length + 28)), decipher.final()]);
}
