// Bridge tables (docs/INTEGRATION-CONTRACT.md sections 4 and 7). Everything is scoped by clinic_id, which is
// always taken from the bridge key, never from a request. Free text (first names in the mirror, queue
// payloads, consent evidence, deferred message text) is sealed with the clinic's vault key (PHIPA s.12).
// None of these tables is read by the automations, campaigns or the EHR client.

import type { Db } from "../db.ts";
import { hmac, randomToken, sha256 } from "../security/crypto.ts";
import type { Channel } from "../types.ts";
import type { BridgeEvent, EventType } from "./events.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bridge_nonces (
  clinic_id INTEGER NOT NULL, nonce TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY (clinic_id, nonce)
);
CREATE TABLE IF NOT EXISTS bridge_claims (
  clinic_id INTEGER NOT NULL, id TEXT NOT NULL, claimed_at TEXT NOT NULL, PRIMARY KEY (clinic_id, id)
);
-- Reminder facts for future visits only. No service, notes, fee or outcome. Deleted on "removed" and
-- one day after the visit ends.
CREATE TABLE IF NOT EXISTS bridge_appointments (
  clinic_id INTEGER NOT NULL, appointment_ref TEXT NOT NULL, version INTEGER NOT NULL, patient_ref TEXT NOT NULL,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL, practitioner_name TEXT NOT NULL,
  first_name TEXT NOT NULL, confirm_relayed_at TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (clinic_id, appointment_ref)
);
-- Events waiting for the laptop to pull. Payload sealed. Deleted on ack, or after 14 days.
CREATE TABLE IF NOT EXISTS bridge_queue (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, clinic_id INTEGER NOT NULL, event_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
  payload TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bridge_queue_clinic ON bridge_queue(clinic_id, seq);
-- One row per released item received. address_hash is a keyed hash (reply matching without storing the
-- address twice); evidence is the EHRM consent fact for this one item, never a standing grant.
CREATE TABLE IF NOT EXISTS bridge_deliveries (
  clinic_id INTEGER NOT NULL, release_ref TEXT NOT NULL, contact_id INTEGER, message_id INTEGER, channel TEXT NOT NULL,
  purpose TEXT NOT NULL, address_hash TEXT NOT NULL, appointment_ref TEXT, evidence TEXT NOT NULL,
  result TEXT NOT NULL, code TEXT, status TEXT, pending TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (clinic_id, release_ref)
);
-- v1.2 sealed patient forms. The laptop's public key only (the private key never leaves the laptop). A form row holds a
-- keyed hash of the link token, never the token; the first name is sealed. Rows go 14 days after they expire or are used.
CREATE TABLE IF NOT EXISTS bridge_form_keys (
  clinic_id INTEGER PRIMARY KEY, key_id TEXT NOT NULL, public_key TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bridge_forms (
  clinic_id INTEGER NOT NULL, form_ref TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL, sections TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY (clinic_id, form_ref)
);
CREATE INDEX IF NOT EXISTS bridge_deliveries_match ON bridge_deliveries(clinic_id, channel, address_hash, created_at);
CREATE INDEX IF NOT EXISTS bridge_deliveries_message ON bridge_deliveries(message_id);
`;

export interface Pairing { clinicId: number; keyId: string; locationId: string; secret: string }
export interface MirrorAppointment {
  clinic_id: number; appointment_ref: string; version: number; patient_ref: string; starts_at: string; ends_at: string;
  status: "booked" | "cancelled"; practitioner_name: string; first_name: string; confirm_relayed_at: string | null;
}
export interface Delivery {
  clinic_id: number; release_ref: string; contact_id: number | null; message_id: number | null; channel: Channel;
  purpose: "service" | "marketing"; appointment_ref: string | null; result: string; code: string | null; status: string | null;
  created_at: string;
}

const now = () => new Date().toISOString();
const canon = (channel: Channel, address: string) => (channel === "email" ? address.trim().toLowerCase() : address.replace(/\D/g, ""));

export class BridgeStore {
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    db.sql.exec(SCHEMA);
    // The bridge has its own key, separate from ehr_key_id / ehr_secret (which also open /webhooks/ehr).
    const cols = new Set((db.sql.prepare("PRAGMA table_info(clinic_integrations)").all() as { name: string }[]).map((c) => c.name));
    const add = (col: string, ddl: string) => { if (!cols.has(col)) db.sql.exec(`ALTER TABLE clinic_integrations ADD COLUMN ${col} ${ddl}`); };
    add("bridge_key_id", "TEXT");
    add("bridge_secret", "TEXT");
    add("bridge_location_id", "TEXT");
    add("bridge_enabled", "INTEGER NOT NULL DEFAULT 0");
    add("bridge_paired_at", "TEXT");
    db.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS clinic_integrations_bridge_key ON clinic_integrations(bridge_key_id) WHERE bridge_key_id IS NOT NULL");
  }

  private run(q: string, ...p: (string | number | null)[]) { return this.db.sql.prepare(q).run(...p); }
  private get<T>(q: string, ...p: (string | number | null)[]) { return this.db.sql.prepare(q).get(...p) as T | undefined; }
  private all<T>(q: string, ...p: (string | number | null)[]) { return this.db.sql.prepare(q).all(...p) as T[]; }

  // ---- pairing -----------------------------------------------------------------

  /** Issues a fresh key for the clinic's one laptop. Pairing again replaces (kills) the old key. */
  pair(clinicId: number, locationId: string): { keyId: string; secret: string } {
    const keyId = `brk_${randomToken(12)}`;
    const secret = randomToken(32);
    this.run(
      `INSERT INTO clinic_integrations (clinic_id, bridge_key_id, bridge_secret, bridge_location_id, bridge_enabled, bridge_paired_at) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(clinic_id) DO UPDATE SET bridge_key_id = excluded.bridge_key_id, bridge_secret = excluded.bridge_secret,
         bridge_location_id = excluded.bridge_location_id, bridge_enabled = 1, bridge_paired_at = excluded.bridge_paired_at`,
      clinicId, keyId, this.db.vault.seal(clinicId, `bridge-secret:${clinicId}`, secret), locationId, now(),
    );
    this.run("DELETE FROM bridge_nonces WHERE clinic_id = ?", clinicId);
    return { keyId, secret };
  }

  /** Revokes the key and deletes everything the bridge holds for the clinic. Returns counts for the audit row. */
  unpair(clinicId: number): Record<string, number> {
    return this.db.transaction(() => {
      this.run("UPDATE clinic_integrations SET bridge_key_id = NULL, bridge_secret = NULL, bridge_enabled = 0 WHERE clinic_id = ?", clinicId);
      const out: Record<string, number> = {};
      for (const t of ["bridge_appointments", "bridge_queue", "bridge_nonces", "bridge_claims", "bridge_deliveries", "bridge_form_keys", "bridge_forms"]) {
        out[t.replace("bridge_", "")] = Number(this.run(`DELETE FROM ${t} WHERE clinic_id = ?`, clinicId).changes);
      }
      return out;
    });
  }

  byKeyId(keyId: string): Pairing | undefined {
    if (!keyId) return undefined;
    const row = this.get<{ clinic_id: number; bridge_secret: string | null; bridge_location_id: string; bridge_enabled: number }>(
      "SELECT clinic_id, bridge_secret, bridge_location_id, bridge_enabled FROM clinic_integrations WHERE bridge_key_id = ?", keyId);
    if (!row || !row.bridge_enabled || !row.bridge_secret) return undefined;
    try {
      return { clinicId: row.clinic_id, keyId, locationId: row.bridge_location_id, secret: this.db.vault.openStrict(row.clinic_id, `bridge-secret:${row.clinic_id}`, row.bridge_secret) };
    } catch {
      return undefined; // a secret that fails its integrity check never authenticates anything
    }
  }

  enabled(clinicId: number): boolean {
    return !!this.get<{ bridge_enabled: number }>("SELECT bridge_enabled FROM clinic_integrations WHERE clinic_id = ?", clinicId)?.bridge_enabled;
  }

  // ---- replay protection ---------------------------------------------------------

  /** Records a request nonce for 10 minutes; false when it was already seen (replay). */
  claimNonce(clinicId: number, nonce: string): boolean {
    this.run("DELETE FROM bridge_nonces WHERE seen_at < ?", new Date(Date.now() - 10 * 60_000).toISOString());
    return Number(this.run("INSERT OR IGNORE INTO bridge_nonces (clinic_id, nonce, seen_at) VALUES (?, ?, ?)", clinicId, nonce, now()).changes) > 0;
  }

  /** Applies an item id once per clinic (releaseRef, appointmentRef:version). */
  claim(clinicId: number, id: string): boolean {
    return Number(this.run("INSERT OR IGNORE INTO bridge_claims (clinic_id, id, claimed_at) VALUES (?, ?, ?)", clinicId, id, now()).changes) > 0;
  }

  // ---- appointment mirror -----------------------------------------------------------

  getAppointment(clinicId: number, ref: string): MirrorAppointment | undefined {
    const row = this.get<MirrorAppointment>("SELECT * FROM bridge_appointments WHERE clinic_id = ? AND appointment_ref = ?", clinicId, ref);
    return row && { ...row, first_name: this.db.vault.open(clinicId, `bridge-appt:${clinicId}:${ref}`, row.first_name) ?? "" };
  }

  upsertAppointment(clinicId: number, a: { appointmentRef: string; version: number; patientRef: string; start: string; end: string; status: string; practitionerName: string; firstName: string }): void {
    this.run(
      `INSERT INTO bridge_appointments (clinic_id, appointment_ref, version, patient_ref, starts_at, ends_at, status, practitioner_name, first_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(clinic_id, appointment_ref) DO UPDATE SET version = excluded.version, patient_ref = excluded.patient_ref,
         starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status, practitioner_name = excluded.practitioner_name,
         first_name = excluded.first_name, updated_at = excluded.updated_at,
         confirm_relayed_at = CASE WHEN bridge_appointments.starts_at = excluded.starts_at THEN bridge_appointments.confirm_relayed_at ELSE NULL END`,
      clinicId, a.appointmentRef, a.version, a.patientRef, new Date(a.start).toISOString(), new Date(a.end).toISOString(), a.status,
      a.practitionerName, this.db.vault.seal(clinicId, `bridge-appt:${clinicId}:${a.appointmentRef}`, a.firstName) ?? "", now(),
    );
  }

  removeAppointment(clinicId: number, ref: string): void {
    this.run("DELETE FROM bridge_appointments WHERE clinic_id = ? AND appointment_ref = ?", clinicId, ref);
  }

  markConfirmRelayed(clinicId: number, ref: string): void {
    this.run("UPDATE bridge_appointments SET confirm_relayed_at = ? WHERE clinic_id = ? AND appointment_ref = ?", now(), clinicId, ref);
  }

  listAppointments(clinicId: number): MirrorAppointment[] {
    return this.all<MirrorAppointment>("SELECT appointment_ref FROM bridge_appointments WHERE clinic_id = ? ORDER BY starts_at", clinicId)
      .map((r) => this.getAppointment(clinicId, r.appointment_ref)!);
  }

  // ---- queue ---------------------------------------------------------------------------

  enqueue(clinicId: number, type: EventType, fields: Record<string, unknown>, source: string | null): string {
    const id = `evt_${randomToken(16).slice(0, 22)}`;
    const at = now();
    const payload = JSON.stringify({ ...fields });
    this.run("INSERT INTO bridge_queue (clinic_id, event_id, type, payload, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      clinicId, id, type, this.db.vault.seal(clinicId, `bridge-queue:${clinicId}:${id}`, payload)!, source, at);
    return id;
  }

  readQueue(clinicId: number, after: number, limit: number): { events: BridgeEvent[]; more: boolean } {
    const rows = this.all<{ seq: number; event_id: string; type: EventType; payload: string; created_at: string }>(
      "SELECT seq, event_id, type, payload, created_at FROM bridge_queue WHERE clinic_id = ? AND seq > ? ORDER BY seq LIMIT ?", clinicId, after, limit + 1);
    const events = rows.slice(0, limit).map((r) => {
      let fields: Record<string, unknown> = {};
      try {
        fields = JSON.parse(this.db.vault.openStrict(clinicId, `bridge-queue:${clinicId}:${r.event_id}`, r.payload));
      } catch {
        fields = { unreadable: true }; // fails the allow-list and is never sent
      }
      return { ...fields, id: r.event_id, seq: r.seq, type: r.type, at: r.created_at } as BridgeEvent;
    });
    return { events, more: rows.length > limit };
  }

  ack(clinicId: number, ids: string[]): number {
    if (!ids.length) return 0;
    return Number(this.run(`DELETE FROM bridge_queue WHERE clinic_id = ? AND event_id IN (${ids.map(() => "?").join(",")})`, clinicId, ...ids).changes);
  }

  /** Booking requests filed from one source (e.g. a conversation) since a time: abuse limit. */
  queuedSince(clinicId: number, type: EventType, since: string, source?: string): number {
    return Number(this.get<{ n: number }>(
      `SELECT COUNT(*) n FROM bridge_queue WHERE clinic_id = ? AND type = ? AND created_at >= ? ${source ? "AND source = ?" : ""}`,
      ...[clinicId, type, since, ...(source ? [source] : [])])?.n ?? 0);
  }

  // ---- deliveries ---------------------------------------------------------------------

  addressHash(clinicId: number, channel: Channel, address: string): string {
    return hmac(this.db.vault.purposeKey(clinicId, "bridge-address:v1"), `${channel === "voice" ? "sms" : channel}:${canon(channel, address)}`);
  }

  addDelivery(d: { clinicId: number; releaseRef: string; contactId: number | null; channel: Channel; purpose: string; address: string; appointmentRef: string | null; evidence: unknown; result: string; code: string | null; pending?: unknown }): void {
    const aad = `bridge-delivery:${d.clinicId}:${d.releaseRef}`;
    this.run(
      `INSERT INTO bridge_deliveries (clinic_id, release_ref, contact_id, channel, purpose, address_hash, appointment_ref, evidence, result, code, pending, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.clinicId, d.releaseRef, d.contactId, d.channel, d.purpose, this.addressHash(d.clinicId, d.channel, d.address), d.appointmentRef,
      this.db.vault.seal(d.clinicId, `${aad}:evidence`, JSON.stringify(d.evidence))!, d.result, d.code,
      d.pending ? this.db.vault.seal(d.clinicId, `${aad}:pending`, JSON.stringify(d.pending)) : null, now(),
    );
  }

  updateDelivery(clinicId: number, releaseRef: string, f: { messageId?: number; result?: string; code?: string | null; status?: string; clearPending?: boolean }): void {
    if (f.messageId !== undefined) this.run("UPDATE bridge_deliveries SET message_id = ? WHERE clinic_id = ? AND release_ref = ?", f.messageId, clinicId, releaseRef);
    if (f.result !== undefined) this.run("UPDATE bridge_deliveries SET result = ?, code = ? WHERE clinic_id = ? AND release_ref = ?", f.result, f.code ?? null, clinicId, releaseRef);
    if (f.status !== undefined) this.run("UPDATE bridge_deliveries SET status = ? WHERE clinic_id = ? AND release_ref = ?", f.status, clinicId, releaseRef);
    if (f.clearPending) this.run("UPDATE bridge_deliveries SET pending = NULL WHERE clinic_id = ? AND release_ref = ?", clinicId, releaseRef);
  }

  getDelivery(clinicId: number, releaseRef: string): (Delivery & { evidence: unknown; pending: unknown }) | undefined {
    const row = this.get<Delivery & { evidence: string; pending: string | null }>("SELECT * FROM bridge_deliveries WHERE clinic_id = ? AND release_ref = ?", clinicId, releaseRef);
    if (!row) return undefined;
    const aad = `bridge-delivery:${clinicId}:${releaseRef}`;
    const parse = (v: string | null, suffix: string) => (v ? JSON.parse(this.db.vault.openStrict(clinicId, `${aad}:${suffix}`, v)) : null);
    return { ...row, evidence: parse(row.evidence, "evidence"), pending: parse(row.pending, "pending") };
  }

  deliveryForMessage(messageId: number): Delivery | undefined {
    return this.get<Delivery>("SELECT * FROM bridge_deliveries WHERE message_id = ?", messageId);
  }

  pendingDeliveries(): { clinic_id: number; release_ref: string }[] {
    return this.all("SELECT clinic_id, release_ref FROM bridge_deliveries WHERE result = 'pending' ORDER BY created_at");
  }

  /** Items handed to the sending service for this exact address and channel since a time. */
  recentDeliveries(clinicId: number, channel: Channel, address: string, since: string): Delivery[] {
    return this.all<Delivery>(
      "SELECT * FROM bridge_deliveries WHERE clinic_id = ? AND channel = ? AND address_hash = ? AND created_at >= ? AND result IN ('accepted','pending')",
      clinicId, channel, this.addressHash(clinicId, channel, address), since);
  }

  // ---- contacts linked to a patientRef ----------------------------------------------

  /** Contacts in the clinic that carry a patientRef and hold this address on the channel. */
  linkedContacts(clinicId: number, channel: Channel, address: string): { id: number; external_id: string }[] {
    if (channel === "email") {
      return this.all("SELECT id, external_id FROM contacts WHERE clinic_id = ? AND external_id IS NOT NULL AND lower(email) = lower(?)", clinicId, address);
    }
    const digits = address.replace(/\D/g, "");
    if (!digits) return [];
    if (channel === "whatsapp") {
      return this.all("SELECT id, external_id FROM contacts WHERE clinic_id = ? AND external_id IS NOT NULL AND (whatsapp_id = ? OR phone = ?)", clinicId, digits, `+${digits}`);
    }
    return this.all("SELECT id, external_id FROM contacts WHERE clinic_id = ? AND external_id IS NOT NULL AND phone = ?", clinicId, `+${digits}`);
  }

  /** Every contact in the clinic holding this address on the channel (linked or not). */
  contactsWithAddress(clinicId: number, channel: Channel, address: string): { id: number; external_id: string | null }[] {
    if (channel === "email") return this.all("SELECT id, external_id FROM contacts WHERE clinic_id = ? AND lower(email) = lower(?)", clinicId, address);
    const digits = address.replace(/\D/g, "");
    if (channel === "whatsapp") return this.all("SELECT id, external_id FROM contacts WHERE clinic_id = ? AND (whatsapp_id = ? OR phone = ?)", clinicId, digits, `+${digits}`);
    return this.all("SELECT id, external_id FROM contacts WHERE clinic_id = ? AND phone = ?", clinicId, `+${digits}`);
  }

  /** Latest inbound patient message in a conversation, on one channel or any. */
  lastInbound(conversationId: number, channel?: Channel): string | undefined {
    return this.get<{ t: string | null }>(
      `SELECT MAX(created_at) t FROM messages WHERE conversation_id = ? AND direction = 'in' ${channel ? "AND channel = ?" : ""}`,
      ...[conversationId, ...(channel ? [channel] : [])])?.t ?? undefined;
  }

  // ---- retention (PHIPA s.13) -----------------------------------------------------------

  purge(at = new Date()): Map<number, Record<string, number>> {
    const iso = (ms: number) => new Date(at.getTime() - ms).toISOString();
    const out = new Map<number, Record<string, number>>();
    const bump = (clinicId: number, key: string, n: number) => {
      if (!n) return;
      const r = out.get(clinicId) ?? {};
      r[key] = (r[key] ?? 0) + n;
      out.set(clinicId, r);
    };
    for (const r of this.all<{ clinic_id: number; n: number }>("SELECT clinic_id, COUNT(*) n FROM bridge_appointments WHERE ends_at < ? GROUP BY clinic_id", iso(864e5))) bump(r.clinic_id, "appointments", r.n);
    this.run("DELETE FROM bridge_appointments WHERE ends_at < ?", iso(864e5));
    for (const r of this.all<{ clinic_id: number; n: number }>("SELECT clinic_id, COUNT(*) n FROM bridge_queue WHERE created_at < ? GROUP BY clinic_id", iso(14 * 864e5))) bump(r.clinic_id, "queue_expired", r.n);
    this.run("DELETE FROM bridge_queue WHERE created_at < ?", iso(14 * 864e5));
    this.run("DELETE FROM bridge_nonces WHERE seen_at < ?", iso(10 * 60_000));
    this.run("DELETE FROM bridge_claims WHERE claimed_at < ?", iso(30 * 864e5));
    // Deferred text that never went out (quiet hours, then refused) is not kept.
    this.run("UPDATE bridge_deliveries SET pending = NULL WHERE pending IS NOT NULL AND created_at < ?", iso(2 * 864e5));
    for (const r of this.all<{ clinic_id: number; n: number }>("SELECT clinic_id, COUNT(*) n FROM contact_proposals WHERE source = 'bridge' AND status = 'pending' AND created_at < ? GROUP BY clinic_id", iso(30 * 864e5))) bump(r.clinic_id, "proposals", r.n);
    this.run("DELETE FROM contact_proposals WHERE source = 'bridge' AND status = 'pending' AND created_at < ?", iso(30 * 864e5));
    for (const r of this.all<{ clinic_id: number; n: number }>("SELECT clinic_id, COUNT(*) n FROM bridge_forms WHERE expires_at < ? OR used_at < ? OR revoked_at < ? GROUP BY clinic_id", iso(14 * 864e5), iso(14 * 864e5), iso(14 * 864e5))) bump(r.clinic_id, "forms", r.n);
    this.run("DELETE FROM bridge_forms WHERE expires_at < ? OR used_at < ? OR revoked_at < ?", iso(14 * 864e5), iso(14 * 864e5), iso(14 * 864e5));
    return out;
  }

  // ---- sealed patient forms (v1.2) -------------------------------------------------

  setFormKey(clinicId: number, keyId: string, publicKey: string): void {
    this.run(`INSERT INTO bridge_form_keys (clinic_id, key_id, public_key, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(clinic_id) DO UPDATE SET key_id = excluded.key_id, public_key = excluded.public_key, updated_at = excluded.updated_at`, clinicId, keyId, publicKey, now());
  }

  formKey(clinicId: number): { key_id: string; public_key: string } | undefined {
    return this.get("SELECT key_id, public_key FROM bridge_form_keys WHERE clinic_id = ?", clinicId);
  }

  /** The token is 32 random bytes, so a plain hash is enough to find the row without keeping the token. */
  tokenHash(token: string): string {
    return sha256(`bridge-form-token:${token}`);
  }

  addForm(clinicId: number, f: { formRef: string; token: string; firstName: string; sections: string[]; expiresAt: string }): boolean {
    const r = this.run(
      "INSERT OR IGNORE INTO bridge_forms (clinic_id, form_ref, token_hash, first_name, sections, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      clinicId, f.formRef, this.tokenHash(f.token), this.db.vault.seal(clinicId, `bridge-form:${clinicId}:${f.formRef}`, f.firstName)!, f.sections.join(","), f.expiresAt, now());
    return Number(r.changes) === 1;
  }

  revokeForm(clinicId: number, formRef: string): boolean {
    return Number(this.run("UPDATE bridge_forms SET revoked_at = ? WHERE clinic_id = ? AND form_ref = ? AND revoked_at IS NULL", now(), clinicId, formRef).changes) === 1;
  }

  formByToken(token: string): { clinic_id: number; form_ref: string; first_name: string; sections: string[]; expires_at: string; used_at: string | null; revoked_at: string | null } | undefined {
    const row = this.get<{ clinic_id: number; form_ref: string; first_name: string; sections: string; expires_at: string; used_at: string | null; revoked_at: string | null }>(
      "SELECT clinic_id, form_ref, first_name, sections, expires_at, used_at, revoked_at FROM bridge_forms WHERE token_hash = ?", this.tokenHash(token));
    if (!row) return undefined;
    try {
      return { ...row, first_name: this.db.vault.openStrict(row.clinic_id, `bridge-form:${row.clinic_id}:${row.form_ref}`, row.first_name), sections: row.sections.split(",") };
    } catch {
      return undefined;
    }
  }

  /** Marks a form used. Only one submit ever wins. */
  useForm(clinicId: number, formRef: string): boolean {
    return Number(this.run("UPDATE bridge_forms SET used_at = ? WHERE clinic_id = ? AND form_ref = ? AND used_at IS NULL AND revoked_at IS NULL", now(), clinicId, formRef).changes) === 1;
  }

  /** Delivery rows (and their consent evidence) live as long as the message they belong to. */
  purgeDeliveries(clinicId: number, before: string): number {
    return Number(this.run("DELETE FROM bridge_deliveries WHERE clinic_id = ? AND created_at < ? AND result != 'pending'", clinicId, before).changes);
  }
}
