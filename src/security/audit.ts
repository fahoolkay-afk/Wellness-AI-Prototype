// Tamper-evident, append-only access log. Every view or change of patient data, every sign-in and every
// setting change is recorded (who, what, when, from where) - never the words of a message, only ids and
// counts. Rows are hash-chained with an HMAC key, and database triggers refuse updates and deletes.
// Exportable as FHIR R4 AuditEvent resources. PHIPA s.10.1 (electronic audit log) and s.12.

import type { DatabaseSync } from "node:sqlite";
import { hmac } from "./crypto.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS access_events (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  role TEXT,
  clinic_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  contact_id INTEGER,
  outcome TEXT NOT NULL,
  ip TEXT,
  detail TEXT,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS access_events_clinic ON access_events(clinic_id, id);
CREATE INDEX IF NOT EXISTS access_events_contact ON access_events(contact_id);
CREATE TRIGGER IF NOT EXISTS access_events_no_update BEFORE UPDATE ON access_events
  BEGIN SELECT RAISE(ABORT, 'access_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS access_events_no_delete BEFORE DELETE ON access_events
  BEGIN SELECT RAISE(ABORT, 'access_events is append-only'); END;
`;

export interface AuditEntry {
  actorType: "user" | "ai" | "system" | "webhook" | "anonymous";
  actor: string;
  role?: string | null;
  clinicId?: number | null;
  action: string;
  target?: string | null;
  contactId?: number | null;
  outcome: "ok" | "denied" | "error";
  ip?: string | null;
  /** Ids and counts only. Never message text or clinical details. */
  detail?: string | null;
}

export interface AuditRow {
  id: number;
  ts: string;
  actor_type: string;
  actor: string;
  role: string | null;
  clinic_id: number | null;
  action: string;
  target: string | null;
  contact_id: number | null;
  outcome: string;
  ip: string | null;
  detail: string | null;
  prev_hash: string;
  row_hash: string;
}

const GENESIS = "0".repeat(64);
const FIELDS = ["id", "ts", "actor_type", "actor", "role", "clinic_id", "action", "target", "contact_id", "outcome", "ip", "detail"] as const;

export class AuditLog {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;

  constructor(db: DatabaseSync, key: Buffer) {
    this.db = db;
    this.key = key;
    db.exec(SCHEMA);
  }

  private hashRow(prev: string, row: Omit<AuditRow, "prev_hash" | "row_hash">): string {
    return hmac(this.key, prev + "|" + JSON.stringify(FIELDS.map((f) => row[f] ?? null)));
  }

  record(e: AuditEntry): void {
    const last = this.db.prepare("SELECT id, row_hash FROM access_events ORDER BY id DESC LIMIT 1").get() as { id: number; row_hash: string } | undefined;
    const row = {
      id: (last?.id ?? 0) + 1,
      ts: new Date().toISOString(),
      actor_type: e.actorType,
      actor: e.actor.slice(0, 120),
      role: e.role ?? null,
      clinic_id: e.clinicId ?? null,
      action: e.action,
      target: e.target ?? null,
      contact_id: e.contactId ?? null,
      outcome: e.outcome,
      ip: e.ip ?? null,
      detail: e.detail ? e.detail.slice(0, 300) : null,
    };
    const prev = last?.row_hash ?? GENESIS;
    this.db.prepare(
      `INSERT INTO access_events (id, ts, actor_type, actor, role, clinic_id, action, target, contact_id, outcome, ip, detail, prev_hash, row_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.ts, row.actor_type, row.actor, row.role, row.clinic_id, row.action, row.target, row.contact_id, row.outcome, row.ip, row.detail, prev, this.hashRow(prev, row));
  }

  list(clinicId: number, opts: { contactId?: number; limit?: number; beforeId?: number } = {}): AuditRow[] {
    const where = ["clinic_id = ?"];
    const params: (number | string)[] = [clinicId];
    if (opts.contactId) {
      where.push("contact_id = ?");
      params.push(opts.contactId);
    }
    if (opts.beforeId) {
      where.push("id < ?");
      params.push(opts.beforeId);
    }
    return this.db.prepare(`SELECT * FROM access_events WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...params, Math.min(opts.limit ?? 200, 1000)) as unknown as AuditRow[];
  }

  /** Re-computes the whole chain. Any edited, inserted or missing row breaks it. */
  verify(): { ok: boolean; rows: number; brokenAt?: number } {
    let prev = GENESIS;
    let expectedId = 1;
    const rows = this.db.prepare("SELECT * FROM access_events ORDER BY id").all() as unknown as AuditRow[];
    for (const row of rows) {
      if (row.id !== expectedId || row.prev_hash !== prev || row.row_hash !== this.hashRow(prev, row)) return { ok: false, rows: rows.length, brokenAt: row.id };
      prev = row.row_hash;
      expectedId++;
    }
    return { ok: true, rows: rows.length };
  }

  triggersPresent(): boolean {
    const names = (this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'access_events'").all() as { name: string }[]).map((r) => r.name);
    return names.includes("access_events_no_update") && names.includes("access_events_no_delete");
  }
}

/** FHIR R4 AuditEvent for one row (http://hl7.org/fhir/R4/auditevent.html). */
export function toFhirAuditEvent(row: AuditRow, systemName: string): Record<string, unknown> {
  const verb = /\.(read|list|view|export)$/.test(row.action) ? "R" : /\.(create|book|add)$/.test(row.action) ? "C" : /\.(delete|erase|purge)$/.test(row.action) ? "D" : /login|logout|session/.test(row.action) ? "E" : "U";
  const isLogin = /^(login|logout|session)/.test(row.action);
  return {
    resourceType: "AuditEvent",
    id: `ae-${row.id}`,
    type: isLogin
      ? { system: "http://dicom.nema.org/resources/ontology/DCM", code: "110114", display: "User Authentication" }
      : { system: "http://terminology.hl7.org/CodeSystem/audit-event-type", code: "rest", display: "RESTful Operation" },
    subtype: [{ system: "urn:frontdesk:action", code: row.action }],
    action: verb,
    recorded: row.ts,
    outcome: row.outcome === "ok" ? "0" : row.outcome === "denied" ? "4" : "8",
    agent: [{
      type: { coding: [{ system: "urn:frontdesk:actor-type", code: row.actor_type }] },
      who: { display: row.actor },
      ...(row.role ? { role: [{ coding: [{ system: "urn:frontdesk:role", code: row.role }] }] } : {}),
      requestor: row.actor_type === "user",
      ...(row.ip ? { network: { address: row.ip, type: "2" } } : {}),
    }],
    source: { observer: { display: systemName } },
    ...(row.contact_id || row.target ? {
      entity: [{
        ...(row.contact_id ? { what: { reference: `Patient/contact-${row.contact_id}` } } : {}),
        ...(row.target ? { description: row.target } : {}),
      }],
    } : {}),
    extension: [{ url: "urn:frontdesk:chain", valueString: `${row.prev_hash}:${row.row_hash}` }],
  };
}
