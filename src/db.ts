import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Vault } from "./security/vault.ts";
import type {
  Appointment, Call, Channel, Clinic, ClinicProfile, Contact, Conversation, Message, MessageAuthor,
  MessagePurpose, MessageStatus, Stage, Task, TaskType,
} from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clinics (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  profile TEXT NOT NULL
);
-- Which clinic owns an inbound address (phone number, WhatsApp phone_number_id, page id, inbox).
CREATE TABLE IF NOT EXISTS channel_accounts (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  channel TEXT NOT NULL,
  address TEXT NOT NULL,
  UNIQUE(channel, address)
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  name TEXT, phone TEXT, email TEXT,
  whatsapp_id TEXT, messenger_id TEXT, instagram_id TEXT,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  stage TEXT NOT NULL DEFAULT 'new_lead',
  opted_out INTEGER NOT NULL DEFAULT 0,
  preferred_channel TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS contacts_phone ON contacts(clinic_id, phone);
CREATE INDEX IF NOT EXISTS contacts_email ON contacts(clinic_id, email);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  contact_id INTEGER NOT NULL UNIQUE REFERENCES contacts(id),
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  needs_attention INTEGER NOT NULL DEFAULT 0,
  attention_reason TEXT,
  last_channel TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  author TEXT NOT NULL,
  author_name TEXT,
  body TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL,
  external_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_external ON messages(channel, external_id) WHERE external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  service_id TEXT NOT NULL,
  practitioner_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  notes TEXT,
  created_via TEXT NOT NULL,
  reminder_sent_at TEXT,
  followup_sent_at TEXT,
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS appts_time ON appointments(clinic_id, starts_at);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  contact_id INTEGER REFERENCES contacts(id),
  conversation_id INTEGER REFERENCES conversations(id),
  type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  contact_id INTEGER REFERENCES contacts(id),
  conversation_id INTEGER REFERENCES conversations(id),
  external_id TEXT UNIQUE,
  from_number TEXT,
  duration_s INTEGER,
  summary TEXT,
  transcript TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Inbound EHR events already applied (replay protection).
CREATE TABLE IF NOT EXISTS ehr_events (
  clinic_id INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (clinic_id, event_id)
);
-- Per-clinic EHR pairing: set by provisioning only, never from the staff-editable profile.
CREATE TABLE IF NOT EXISTS clinic_integrations (
  clinic_id INTEGER PRIMARY KEY REFERENCES clinics(id),
  ehr_location_id TEXT UNIQUE,
  ehr_key_id TEXT UNIQUE,
  ehr_secret TEXT
);
-- AI turns, for per-contact and per-clinic limits (denial-of-wallet protection).
CREATE TABLE IF NOT EXISTS ai_turns (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL,
  contact_id INTEGER,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ai_turns_clinic ON ai_turns(clinic_id, at);
-- Contact detail changes collected by the AI wait here for staff approval; they never change delivery addresses directly.
CREATE TABLE IF NOT EXISTS contact_proposals (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_by TEXT,
  decided_at TEXT
);
-- One-time codes that prove a caller or emailer is the patient on file before appointment details are shared.
CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE INDEX IF NOT EXISTS verifications_scope ON verifications(contact_id, scope);
-- Idempotency for automations: one run per (automation, subject).
CREATE TABLE IF NOT EXISTS automation_runs (
  automation_id TEXT NOT NULL,
  clinic_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  ran_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (clinic_id, automation_id, subject)
);
`;

type Row = Record<string, unknown>;

export class Db {
  readonly sql: DatabaseSync;
  readonly vault: Vault;

  constructor(path: string, vault?: Vault) {
    const onDisk = path !== ":memory:";
    if (onDisk) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      process.umask(0o077);
    }
    this.sql = new DatabaseSync(path);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.sql.exec(SCHEMA);
    this.migrate();
    // Without an explicit vault (tests), a throwaway key still exercises the encryption paths.
    this.vault = vault ?? new Vault("ephemeral-test-key");
    if (onDisk) {
      // Patient data files are readable by this service account only.
      for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
      chmodSync(dirname(path), 0o700);
    }
  }

  private migrate(): void {
    const cols = (table: string) => new Set((this.sql.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    const add = (table: string, column: string, ddl: string) => {
      if (!cols(table).has(column)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    };
    // purpose: reply (answer to the patient), service (reminders, confirmations), marketing (campaigns).
    add("messages", "purpose", "TEXT");
    // 1 when the sender's identity was authenticated by the channel (e.g. DMARC pass on email).
    add("messages", "sender_verified", "INTEGER NOT NULL DEFAULT 1");
    add("messages", "simulated", "INTEGER NOT NULL DEFAULT 0");
    add("messages", "staff_user_id", "INTEGER");
    add("messages", "purged_at", "TEXT");
    add("calls", "notice_version", "TEXT");
    add("calls", "purged_at", "TEXT");
    add("conversations", "paused_by", "TEXT");
    add("appointments", "confirmed_at", "TEXT");
  }

  // ---- encryption helpers -----------------------------------------------------

  private clinicOfConversation(conversationId: number): number {
    return Number(this.one<{ clinic_id: number }>("SELECT clinic_id FROM conversations WHERE id = ?", conversationId)?.clinic_id ?? 0);
  }

  private decMessage<T extends Message | undefined>(m: T, clinicId?: number): T {
    if (!m) return m;
    const cid = clinicId ?? this.clinicOfConversation(m.conversation_id);
    const aad = `msg:${m.conversation_id}`;
    return { ...m, body: this.vault.open(cid, aad, m.body) ?? "", subject: this.vault.open(cid, `${aad}:subject`, m.subject) };
  }

  private decContact<T extends Contact | undefined>(c: T): T {
    if (!c) return c;
    return { ...c, notes: this.vault.open(c.clinic_id, `contact:${c.id}:notes`, c.notes) };
  }

  private decTask<T extends Task>(t: T): T {
    return { ...t, details: this.vault.open(t.clinic_id, `task:${t.clinic_id}`, t.details) };
  }

  private decCall<T extends Call>(c: T): T {
    const aad = `call:${c.clinic_id}`;
    return { ...c, summary: this.vault.open(c.clinic_id, `${aad}:summary`, c.summary), transcript: this.vault.open(c.clinic_id, `${aad}:transcript`, c.transcript) };
  }

  private decAppointment<T extends Appointment | undefined>(a: T): T {
    if (!a) return a;
    return { ...a, notes: this.vault.open(a.clinic_id, `appt:${a.clinic_id}`, a.notes) };
  }

  private one<T>(query: string, ...params: (string | number | null)[]): T | undefined {
    return this.sql.prepare(query).get(...params) as T | undefined;
  }

  private all<T>(query: string, ...params: (string | number | null)[]): T[] {
    return this.sql.prepare(query).all(...params) as T[];
  }

  private run(query: string, ...params: (string | number | null)[]): number {
    return Number(this.sql.prepare(query).run(...params).lastInsertRowid);
  }

  transaction<T>(fn: () => T): T {
    this.sql.exec("BEGIN");
    try {
      const result = fn();
      this.sql.exec("COMMIT");
      return result;
    } catch (err) {
      this.sql.exec("ROLLBACK");
      throw err;
    }
  }

  // ---- clinics -------------------------------------------------------------

  createClinic(profile: ClinicProfile): number {
    return this.run("INSERT INTO clinics (name, profile) VALUES (?, ?)", profile.name, JSON.stringify(profile));
  }

  updateClinicProfile(id: number, profile: ClinicProfile): void {
    this.run("UPDATE clinics SET name = ?, profile = ? WHERE id = ?", profile.name, JSON.stringify(profile), id);
  }

  getClinic(id: number): Clinic | undefined {
    const row = this.one<Row>("SELECT * FROM clinics WHERE id = ?", id);
    return row && { id: Number(row.id), name: String(row.name), profile: JSON.parse(String(row.profile)) };
  }

  listClinics(): Clinic[] {
    return this.all<Row>("SELECT * FROM clinics ORDER BY id").map((row) => ({
      id: Number(row.id), name: String(row.name), profile: JSON.parse(String(row.profile)),
    }));
  }

  addChannelAccount(clinicId: number, channel: Channel, address: string): void {
    this.run("INSERT OR IGNORE INTO channel_accounts (clinic_id, channel, address) VALUES (?, ?, ?)", clinicId, channel, address);
  }

  listChannelAccounts(clinicId: number): { channel: Channel; address: string }[] {
    return this.all("SELECT channel, address FROM channel_accounts WHERE clinic_id = ? ORDER BY channel", clinicId);
  }

  /** The clinic address used to send on a channel (e.g. the clinic's SMS number). */
  channelAddress(clinicId: number, channel: Channel): string | undefined {
    return this.one<{ address: string }>(
      "SELECT address FROM channel_accounts WHERE clinic_id = ? AND channel = ? ORDER BY id LIMIT 1", clinicId, channel,
    )?.address;
  }

  clinicForAddress(channel: Channel, address: string): number | undefined {
    const row = this.one<{ clinic_id: number }>(
      "SELECT clinic_id FROM channel_accounts WHERE channel = ? AND lower(address) = lower(?)", channel, address,
    );
    return row?.clinic_id;
  }

  // ---- contacts ------------------------------------------------------------

  getContact(id: number): Contact | undefined {
    return this.decContact(this.one<Contact>("SELECT * FROM contacts WHERE id = ?", id));
  }

  /** Column holding the patient's identity on a channel. */
  static identityColumn(channel: Channel): keyof Contact {
    switch (channel) {
      case "sms":
      case "voice":
        return "phone";
      case "whatsapp":
        return "whatsapp_id";
      case "messenger":
        return "messenger_id";
      case "instagram":
        return "instagram_id";
      case "email":
        return "email";
    }
  }

  findContactByIdentity(clinicId: number, channel: Channel, address: string): Contact | undefined {
    const column = Db.identityColumn(channel);
    const direct = this.one<Contact>(`SELECT * FROM contacts WHERE clinic_id = ? AND lower(${column}) = lower(?) ORDER BY id LIMIT 1`, clinicId, address);
    if (direct) return this.decContact(direct);
    // A WhatsApp id is the patient's phone number, so SMS/voice and WhatsApp threads merge into one contact.
    if (channel === "whatsapp") return this.decContact(this.one<Contact>("SELECT * FROM contacts WHERE clinic_id = ? AND phone = ? ORDER BY id LIMIT 1", clinicId, normalizePhone(address)));
    if (channel === "sms" || channel === "voice") return this.decContact(this.one<Contact>("SELECT * FROM contacts WHERE clinic_id = ? AND whatsapp_id = ? ORDER BY id LIMIT 1", clinicId, address.replace(/^\+/, "")));
    return undefined;
  }

  createContact(clinicId: number, fields: Partial<Contact>): Contact {
    const id = this.run(
      `INSERT INTO contacts (clinic_id, name, phone, email, whatsapp_id, messenger_id, instagram_id, notes, tags, stage, preferred_channel, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      clinicId, fields.name ?? null, fields.phone ?? null, fields.email ?? null, fields.whatsapp_id ?? null,
      fields.messenger_id ?? null, fields.instagram_id ?? null, null, fields.tags ?? "[]",
      fields.stage ?? "new_lead", fields.preferred_channel ?? null, fields.external_id ?? null,
    );
    if (fields.notes) this.updateContact(id, { notes: fields.notes });
    return this.getContact(id)!;
  }

  updateContact(id: number, fields: Partial<Pick<Contact, "name" | "phone" | "email" | "whatsapp_id" | "messenger_id" | "instagram_id" | "notes" | "tags" | "stage" | "opted_out" | "preferred_channel" | "external_id">>): Contact {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length) {
      const clinicId = Number(this.one<{ clinic_id: number }>("SELECT clinic_id FROM contacts WHERE id = ?", id)?.clinic_id ?? 0);
      this.run(
        `UPDATE contacts SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
        ...entries.map(([k, v]) => (k === "notes" ? this.vault.seal(clinicId, `contact:${id}:notes`, v as string | null) : v as string | number | null)), id,
      );
    }
    return this.getContact(id)!;
  }

  /** Deletes a contact's messaging data (messages, calls, tasks text) but keeps consent records, appointments and the audit trail. */
  eraseMessagingData(contactId: number): { messages: number; calls: number } {
    const conv = this.one<{ id: number }>("SELECT id FROM conversations WHERE contact_id = ?", contactId);
    let messages = 0;
    if (conv) messages = Number(this.sql.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conv.id).changes);
    const calls = Number(this.sql.prepare("UPDATE calls SET summary = NULL, transcript = NULL, purged_at = ? WHERE contact_id = ?").run(new Date().toISOString(), contactId).changes);
    this.sql.prepare("UPDATE tasks SET details = NULL WHERE contact_id = ?").run(contactId);
    this.sql.prepare("UPDATE contacts SET notes = NULL WHERE id = ?").run(contactId);
    return { messages, calls };
  }

  /** Retention: clears message text and call text older than the cutoff; keeps who/when/channel metadata. */
  purgeOlderThan(clinicId: number, messagesBefore: string, callsBefore: string): { messages: number; calls: number } {
    const now = new Date().toISOString();
    const messages = Number(this.sql.prepare(
      `UPDATE messages SET body = '', subject = NULL, purged_at = ? WHERE purged_at IS NULL AND status != 'draft' AND created_at < ?
         AND conversation_id IN (SELECT id FROM conversations WHERE clinic_id = ?)`,
    ).run(now, messagesBefore, clinicId).changes);
    const calls = Number(this.sql.prepare(
      "UPDATE calls SET transcript = NULL, summary = NULL, purged_at = ? WHERE purged_at IS NULL AND clinic_id = ? AND created_at < ?",
    ).run(now, clinicId, callsBefore).changes);
    return { messages, calls };
  }

  findContactByExternalId(clinicId: number, externalId: string): Contact | undefined {
    return this.decContact(this.one<Contact>("SELECT * FROM contacts WHERE clinic_id = ? AND external_id = ?", clinicId, externalId));
  }

  listContacts(clinicId: number, opts: { search?: string; tag?: string; stage?: Stage } = {}): Contact[] {
    const where = ["clinic_id = ?"];
    const params: (string | number)[] = [clinicId];
    if (opts.search) {
      where.push("(name LIKE ? OR phone LIKE ? OR email LIKE ?)");
      const like = `%${opts.search}%`;
      params.push(like, like, like);
    }
    if (opts.tag) {
      where.push("EXISTS (SELECT 1 FROM json_each(contacts.tags) WHERE value = ?)");
      params.push(opts.tag);
    }
    if (opts.stage) {
      where.push("stage = ?");
      params.push(opts.stage);
    }
    return this.all<Contact>(`SELECT * FROM contacts WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 500`, ...params).map((c) => this.decContact(c));
  }

  // ---- conversations & messages -------------------------------------------

  getConversation(id: number): Conversation | undefined {
    return this.one<Conversation>("SELECT * FROM conversations WHERE id = ?", id);
  }

  conversationForContact(contact: Contact, channel: Channel): Conversation {
    const existing = this.one<Conversation>("SELECT * FROM conversations WHERE contact_id = ?", contact.id);
    if (existing) return existing;
    const id = this.run(
      "INSERT INTO conversations (clinic_id, contact_id, last_channel, last_message_at) VALUES (?, ?, ?, ?)",
      contact.clinic_id, contact.id, channel, new Date().toISOString(),
    );
    return this.getConversation(id)!;
  }

  listConversations(clinicId: number, filter: "all" | "attention" | "unread" = "all"): (Conversation & { contact_name: string | null; contact_phone: string | null; contact_email: string | null; stage: Stage; preview: string | null; preview_author: MessageAuthor | null })[] {
    const extra = filter === "attention" ? "AND c.needs_attention = 1" : filter === "unread" ? "AND c.unread > 0" : "";
    const rows = this.all<Conversation & { contact_name: string | null; contact_phone: string | null; contact_email: string | null; stage: Stage; preview: string | null; preview_author: MessageAuthor | null }>(
      `SELECT c.*, ct.name AS contact_name, ct.phone AS contact_phone, ct.email AS contact_email, ct.stage AS stage,
              (SELECT body FROM messages m WHERE m.conversation_id = c.id AND m.status != 'draft' ORDER BY m.id DESC LIMIT 1) AS preview,
              (SELECT author FROM messages m WHERE m.conversation_id = c.id AND m.status != 'draft' ORDER BY m.id DESC LIMIT 1) AS preview_author
       FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.clinic_id = ? ${extra}
       ORDER BY c.needs_attention DESC, c.last_message_at DESC LIMIT 200`,
      clinicId,
    );
    return rows.map((r) => ({ ...r, preview: this.vault.open(clinicId, `msg:${r.id}`, r.preview) }));
  }

  updateConversation(id: number, fields: Partial<Pick<Conversation, "ai_enabled" | "needs_attention" | "attention_reason" | "unread" | "status" | "last_channel" | "last_message_at" | "paused_by">>): void {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    this.run(
      `UPDATE conversations SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
      ...entries.map(([, v]) => v as string | number | null), id,
    );
  }

  addMessage(msg: {
    conversationId: number; channel: Channel; direction: "in" | "out"; author: MessageAuthor; authorName?: string | null;
    body: string; subject?: string | null; status: MessageStatus; externalId?: string | null;
    purpose?: MessagePurpose | null; senderVerified?: boolean; simulated?: boolean; staffUserId?: number | null;
  }): Message {
    const now = new Date().toISOString();
    const clinicId = this.clinicOfConversation(msg.conversationId);
    const aad = `msg:${msg.conversationId}`;
    const id = this.run(
      `INSERT INTO messages (conversation_id, channel, direction, author, author_name, body, subject, status, external_id, created_at,
         purpose, sender_verified, simulated, staff_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      msg.conversationId, msg.channel, msg.direction, msg.author, msg.authorName ?? null,
      this.vault.seal(clinicId, aad, msg.body) ?? "", this.vault.seal(clinicId, `${aad}:subject`, msg.subject ?? null),
      msg.status, msg.externalId ?? null, now, msg.purpose ?? null, msg.senderVerified === false ? 0 : 1, msg.simulated ? 1 : 0,
      msg.staffUserId ?? null,
    );
    if (msg.status !== "draft") {
      this.sql.prepare(
        `UPDATE conversations SET last_message_at = ?, last_channel = CASE WHEN ? = 'in' THEN ? ELSE last_channel END,
           unread = CASE WHEN ? = 'in' THEN unread + 1 ELSE unread END WHERE id = ?`,
      ).run(now, msg.direction, msg.channel, msg.direction, msg.conversationId);
    }
    return this.getMessage(id)!;
  }

  messageExists(channel: Channel, externalId: string): boolean {
    return !!this.one("SELECT 1 FROM messages WHERE channel = ? AND external_id = ?", channel, externalId);
  }

  /** When the patient last wrote on a channel in this thread (UTC ISO), if ever. */
  lastInboundAt(conversationId: number, channel: Channel): string | undefined {
    return this.one<{ t: string | null }>(
      "SELECT MAX(created_at) t FROM messages WHERE conversation_id = ? AND channel = ? AND direction = 'in'", conversationId, channel,
    )?.t ?? undefined;
  }

  getMessage(id: number): Message | undefined {
    return this.decMessage(this.one<Message>("SELECT * FROM messages WHERE id = ?", id));
  }

  /** Finds a message by provider id (e.g. a Twilio SID from a delivery-status callback). */
  findMessageByExternalId(channel: Channel, externalId: string): Message | undefined {
    return this.decMessage(this.one<Message>("SELECT * FROM messages WHERE channel = ? AND external_id = ?", channel, externalId));
  }

  updateMessage(id: number, fields: Partial<Pick<Message, "status" | "external_id" | "error" | "body" | "author" | "author_name">>): void {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    const current = this.one<{ conversation_id: number }>("SELECT conversation_id FROM messages WHERE id = ?", id);
    const clinicId = current ? this.clinicOfConversation(current.conversation_id) : 0;
    this.run(
      `UPDATE messages SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
      ...entries.map(([k, v]) => (k === "body" && current ? this.vault.seal(clinicId, `msg:${current.conversation_id}`, v as string) : v as string | number | null)), id,
    );
  }

  /** Outbound messages to a contact on a channel since a time (for rate limits). */
  countOutboundSince(contactId: number, channel: Channel, since: string): number {
    return Number(this.one<{ n: number }>(
      `SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.contact_id = ? AND m.channel = ? AND m.direction = 'out' AND m.status IN ('sent','simulated') AND m.created_at >= ?`,
      contactId, channel, since,
    )?.n ?? 0);
  }

  /** Marketing/service campaign messages a clinic sent since a time (daily campaign cap). */
  campaignMessagesSince(clinicId: number, since: string): number {
    return Number(this.one<{ n: number }>(
      `SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.clinic_id = ? AND m.direction = 'out' AND m.purpose = 'marketing' AND m.created_at >= ?`,
      clinicId, since,
    )?.n ?? 0);
  }

  deleteMessage(id: number): void {
    this.run("DELETE FROM messages WHERE id = ?", id);
  }

  listMessages(conversationId: number, limit = 200): Message[] {
    const clinicId = this.clinicOfConversation(conversationId);
    return this.all<Message>(
      "SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id", conversationId, limit,
    ).map((m) => this.decMessage(m, clinicId));
  }

  // ---- appointments --------------------------------------------------------

  findAppointmentByExternalRef(clinicId: number, ref: string): Appointment | undefined {
    return this.decAppointment(this.one<Appointment>("SELECT * FROM appointments WHERE clinic_id = ? AND external_ref = ?", clinicId, ref));
  }

  getAppointment(id: number): Appointment | undefined {
    return this.decAppointment(this.one<Appointment>("SELECT * FROM appointments WHERE id = ?", id));
  }

  createAppointment(a: Pick<Appointment, "clinic_id" | "contact_id" | "service_id" | "practitioner_id" | "starts_at" | "ends_at" | "created_via"> & { notes?: string | null; external_ref?: string | null }): Appointment {
    const id = this.run(
      `INSERT INTO appointments (clinic_id, contact_id, service_id, practitioner_id, starts_at, ends_at, notes, created_via, external_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.clinic_id, a.contact_id, a.service_id, a.practitioner_id, a.starts_at, a.ends_at,
      this.vault.seal(a.clinic_id, `appt:${a.clinic_id}`, a.notes ?? null), a.created_via, a.external_ref ?? null,
    );
    return this.getAppointment(id)!;
  }

  updateAppointment(id: number, fields: Partial<Pick<Appointment, "starts_at" | "ends_at" | "status" | "notes" | "practitioner_id" | "service_id" | "reminder_sent_at" | "followup_sent_at">>): Appointment {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length) {
      const clinicId = Number(this.one<{ clinic_id: number }>("SELECT clinic_id FROM appointments WHERE id = ?", id)?.clinic_id ?? 0);
      this.run(
        `UPDATE appointments SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
        ...entries.map(([k, v]) => (k === "notes" ? this.vault.seal(clinicId, `appt:${clinicId}`, v as string | null) : v as string | number | null)), id,
      );
    }
    return this.getAppointment(id)!;
  }

  confirmAppointment(id: number): void {
    this.run("UPDATE appointments SET confirmed_at = ? WHERE id = ?", new Date().toISOString(), id);
  }

  /** Booked appointments overlapping [from, to) for a clinic, optionally for one practitioner. */
  appointmentsBetween(clinicId: number, from: string, to: string, practitionerId?: string): Appointment[] {
    const extra = practitionerId ? "AND practitioner_id = ?" : "";
    const params: (string | number)[] = [clinicId, to, from];
    if (practitionerId) params.push(practitionerId);
    return this.all<Appointment>(
      `SELECT * FROM appointments WHERE clinic_id = ? AND status = 'booked' AND starts_at < ? AND ends_at > ? ${extra} ORDER BY starts_at`,
      ...params,
    ).map((a) => this.decAppointment(a));
  }

  listAppointments(clinicId: number, from: string, to: string): (Appointment & { contact_name: string | null })[] {
    return this.all<Appointment & { contact_name: string | null }>(
      `SELECT a.*, c.name AS contact_name FROM appointments a JOIN contacts c ON c.id = a.contact_id
       WHERE a.clinic_id = ? AND a.starts_at >= ? AND a.starts_at < ? ORDER BY a.starts_at`,
      clinicId, from, to,
    ).map((a) => this.decAppointment(a));
  }

  contactAppointments(contactId: number, upcomingOnly = false): Appointment[] {
    const extra = upcomingOnly ? "AND status = 'booked' AND starts_at >= ?" : "";
    const params: (string | number)[] = [contactId];
    if (upcomingOnly) params.push(new Date().toISOString());
    return this.all<Appointment>(`SELECT * FROM appointments WHERE contact_id = ? ${extra} ORDER BY starts_at DESC LIMIT 50`, ...params).map((a) => this.decAppointment(a));
  }

  // ---- tasks ---------------------------------------------------------------

  createTask(t: { clinicId: number; contactId?: number | null; conversationId?: number | null; type: TaskType; priority?: Task["priority"]; title: string; details?: string | null; createdBy: string }): Task {
    const id = this.run(
      `INSERT INTO tasks (clinic_id, contact_id, conversation_id, type, priority, title, details, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      t.clinicId, t.contactId ?? null, t.conversationId ?? null, t.type, t.priority ?? "normal", t.title,
      this.vault.seal(t.clinicId, `task:${t.clinicId}`, t.details ?? null), t.createdBy,
    );
    return this.getTask(id)!;
  }

  getTask(id: number): Task | undefined {
    const t = this.one<Task>("SELECT * FROM tasks WHERE id = ?", id);
    return t && this.decTask(t);
  }

  listTasks(clinicId: number, status: "open" | "done" | "all" = "open", contactId?: number): (Task & { contact_name: string | null })[] {
    const where = ["t.clinic_id = ?"];
    const params: (string | number)[] = [clinicId];
    if (status !== "all") {
      where.push("t.status = ?");
      params.push(status);
    }
    if (contactId) {
      where.push("t.contact_id = ?");
      params.push(contactId);
    }
    return this.all<Task & { contact_name: string | null }>(
      `SELECT t.*, c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id AND c.clinic_id = t.clinic_id
       WHERE ${where.join(" AND ")}
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id DESC LIMIT 300`,
      ...params,
    ).map((t) => this.decTask(t as Task & { contact_name: string | null }));
  }

  updateTaskStatus(id: number, status: "open" | "done"): void {
    this.run("UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?", status, status === "done" ? new Date().toISOString() : null, id);
  }

  // ---- calls ---------------------------------------------------------------

  upsertCall(c: Omit<Call, "id" | "created_at"> & { notice_version?: string | null }): Call {
    const aad = `call:${c.clinic_id}`;
    this.run(
      `INSERT INTO calls (clinic_id, contact_id, conversation_id, external_id, from_number, duration_s, summary, transcript, outcome, notice_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(external_id) DO UPDATE SET duration_s = excluded.duration_s, summary = excluded.summary,
         transcript = excluded.transcript, outcome = excluded.outcome`,
      c.clinic_id, c.contact_id, c.conversation_id, c.external_id, c.from_number, c.duration_s,
      this.vault.seal(c.clinic_id, `${aad}:summary`, c.summary), this.vault.seal(c.clinic_id, `${aad}:transcript`, c.transcript),
      c.outcome, c.notice_version ?? null,
    );
    return this.decCall(this.one<Call>("SELECT * FROM calls WHERE external_id = ?", c.external_id)!);
  }

  listCalls(clinicId: number): (Call & { contact_name: string | null })[] {
    return this.all<Call & { contact_name: string | null }>(
      `SELECT k.*, c.name AS contact_name FROM calls k LEFT JOIN contacts c ON c.id = k.contact_id
       WHERE k.clinic_id = ? ORDER BY k.id DESC LIMIT 200`,
      clinicId,
    ).map((k) => this.decCall(k));
  }

  callsForContact(contactId: number): Call[] {
    return this.all<Call>("SELECT * FROM calls WHERE contact_id = ? ORDER BY id", contactId).map((k) => this.decCall(k));
  }

  // ---- usage limits ---------------------------------------------------------

  recordAiTurn(clinicId: number, contactId: number): void {
    this.run("INSERT INTO ai_turns (clinic_id, contact_id) VALUES (?, ?)", clinicId, contactId);
  }

  aiTurnsSince(clinicId: number, since: string, contactId?: number): number {
    return contactId
      ? Number(this.one<{ n: number }>("SELECT COUNT(*) n FROM ai_turns WHERE clinic_id = ? AND contact_id = ? AND at >= ?", clinicId, contactId, since)?.n ?? 0)
      : Number(this.one<{ n: number }>("SELECT COUNT(*) n FROM ai_turns WHERE clinic_id = ? AND at >= ?", clinicId, since)?.n ?? 0);
  }

  futureAiBookings(contactId: number): number {
    return Number(this.one<{ n: number }>(
      "SELECT COUNT(*) n FROM appointments WHERE contact_id = ? AND status = 'booked' AND starts_at > ? AND created_via LIKE 'ai:%'",
      contactId, new Date().toISOString(),
    )?.n ?? 0);
  }

  aiBookingsSince(clinicId: number, since: string): number {
    return Number(this.one<{ n: number }>(
      "SELECT COUNT(*) n FROM appointments WHERE clinic_id = ? AND created_at >= ? AND created_via LIKE 'ai:%'", clinicId, since,
    )?.n ?? 0);
  }

  // ---- identity verification ---------------------------------------------------

  createVerification(clinicId: number, contactId: number, scope: string, codeHash: string, minutes = 10): void {
    this.run(
      "INSERT INTO verifications (clinic_id, contact_id, scope, code_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
      clinicId, contactId, scope, codeHash, new Date(Date.now() + minutes * 60_000).toISOString(),
    );
  }

  recentVerificationCount(contactId: number, sinceIso: string): number {
    return Number(this.one<{ n: number }>("SELECT COUNT(*) n FROM verifications WHERE contact_id = ? AND expires_at >= ?", contactId, sinceIso)?.n ?? 0);
  }

  /** Checks a code against the newest pending verification for this scope (max 5 tries). */
  checkVerification(contactId: number, scope: string, codeHash: string): "ok" | "wrong" | "expired" | "none" {
    const v = this.one<{ id: number; code_hash: string; attempts: number; expires_at: string; verified_at: string | null }>(
      "SELECT * FROM verifications WHERE contact_id = ? AND scope = ? ORDER BY id DESC LIMIT 1", contactId, scope,
    );
    if (!v) return "none";
    if (v.verified_at) return "ok";
    if (v.expires_at < new Date().toISOString() || v.attempts >= 5) return "expired";
    if (v.code_hash !== codeHash) {
      this.run("UPDATE verifications SET attempts = attempts + 1 WHERE id = ?", v.id);
      return "wrong";
    }
    this.run("UPDATE verifications SET verified_at = ? WHERE id = ?", new Date().toISOString(), v.id);
    return "ok";
  }

  isVerified(contactId: number, scope: string): boolean {
    return !!this.one(
      "SELECT 1 FROM verifications WHERE contact_id = ? AND scope = ? AND verified_at IS NOT NULL AND verified_at >= ?",
      contactId, scope, new Date(Date.now() - 30 * 60_000).toISOString(),
    );
  }

  // ---- contact change proposals ----------------------------------------------

  proposeContactChange(clinicId: number, contactId: number, field: "phone" | "email" | "name", value: string, source: string): number {
    return this.run(
      "INSERT INTO contact_proposals (clinic_id, contact_id, field, value, source) VALUES (?, ?, ?, ?, ?)",
      clinicId, contactId, field, this.vault.seal(clinicId, `proposal:${contactId}`, value) ?? "", source,
    );
  }

  listProposals(contactId: number): { id: number; field: string; value: string; source: string; status: string; created_at: string }[] {
    return this.all<{ id: number; clinic_id: number; field: string; value: string; source: string; status: string; created_at: string }>(
      "SELECT * FROM contact_proposals WHERE contact_id = ? AND status = 'pending' ORDER BY id", contactId,
    ).map((p) => ({ ...p, value: this.vault.open(p.clinic_id, `proposal:${contactId}`, p.value) ?? "" }));
  }

  getProposal(id: number): { id: number; clinic_id: number; contact_id: number; field: string; value: string; status: string } | undefined {
    const p = this.one<{ id: number; clinic_id: number; contact_id: number; field: string; value: string; status: string }>("SELECT * FROM contact_proposals WHERE id = ?", id);
    return p && { ...p, value: this.vault.open(p.clinic_id, `proposal:${p.contact_id}`, p.value) ?? "" };
  }

  decideProposal(id: number, status: "approved" | "rejected", by: string): void {
    this.run("UPDATE contact_proposals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?", status, by, new Date().toISOString(), id);
  }

  // ---- EHR integration (provisioning only) -------------------------------------

  setEhrIntegration(clinicId: number, locationId: string, keyId: string, secret: string): void {
    this.run(
      `INSERT INTO clinic_integrations (clinic_id, ehr_location_id, ehr_key_id, ehr_secret) VALUES (?, ?, ?, ?)
       ON CONFLICT(clinic_id) DO UPDATE SET ehr_location_id = excluded.ehr_location_id, ehr_key_id = excluded.ehr_key_id, ehr_secret = excluded.ehr_secret`,
      clinicId, locationId, keyId, this.vault.seal(clinicId, `ehr-secret:${clinicId}`, secret),
    );
  }

  ehrIntegrationByKeyId(keyId: string): { clinicId: number; locationId: string; secret: string } | undefined {
    const row = this.one<{ clinic_id: number; ehr_location_id: string; ehr_secret: string }>("SELECT * FROM clinic_integrations WHERE ehr_key_id = ?", keyId);
    return row && { clinicId: row.clinic_id, locationId: row.ehr_location_id, secret: this.vault.open(row.clinic_id, `ehr-secret:${row.clinic_id}`, row.ehr_secret) ?? "" };
  }

  ehrLocationOf(clinicId: number): string | undefined {
    return this.one<{ ehr_location_id: string }>("SELECT ehr_location_id FROM clinic_integrations WHERE clinic_id = ?", clinicId)?.ehr_location_id;
  }

  /** Records an EHR event id; returns false when it was already applied (replay). */
  claimEhrEvent(clinicId: number, eventId: string): boolean {
    return Number(this.sql.prepare("INSERT OR IGNORE INTO ehr_events (clinic_id, event_id) VALUES (?, ?)").run(clinicId, eventId).changes) > 0;
  }

  // ---- automations ---------------------------------------------------------

  /** Records an automation run; returns false if it already ran for this subject. */
  claimAutomationRun(clinicId: number, automationId: string, subject: string): boolean {
    const result = this.sql
      .prepare("INSERT OR IGNORE INTO automation_runs (clinic_id, automation_id, subject) VALUES (?, ?, ?)")
      .run(clinicId, automationId, subject);
    return Number(result.changes) > 0;
  }

  /** Booked appointments starting in (from, to]. */
  appointmentsStartingBetween(clinicId: number, from: string, to: string): Appointment[] {
    return this.all<Appointment>(
      "SELECT * FROM appointments WHERE clinic_id = ? AND status = 'booked' AND starts_at > ? AND starts_at <= ?", clinicId, from, to,
    );
  }

  /** Attended (or not yet marked) appointments that ended in (from, to]. */
  appointmentsEndedBetween(clinicId: number, from: string, to: string): Appointment[] {
    return this.all<Appointment>(
      "SELECT * FROM appointments WHERE clinic_id = ? AND status IN ('booked','completed') AND ends_at > ? AND ends_at <= ?", clinicId, from, to,
    );
  }

  /** Leads created in (from, to] who have never booked. */
  unbookedLeads(clinicId: number, from: string, to: string): Contact[] {
    return this.all<Contact>(
      `SELECT * FROM contacts c WHERE clinic_id = ? AND stage IN ('new_lead','contacted') AND created_at > ? AND created_at <= ?
       AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = c.id)`, clinicId, from, to,
    );
  }

  /** Active patients whose last visit ended before `before` with nothing upcoming, plus that visit's end time. */
  lapsedPatients(clinicId: number, before: string): (Contact & { last_visit: string })[] {
    return this.all(
      `SELECT c.*, MAX(a.ends_at) AS last_visit FROM contacts c JOIN appointments a ON a.contact_id = c.id
       WHERE c.clinic_id = ? AND c.stage = 'active_patient' AND a.status IN ('booked','completed')
       GROUP BY c.id
       HAVING MAX(a.ends_at) < ? AND NOT EXISTS (
         SELECT 1 FROM appointments u WHERE u.contact_id = c.id AND u.status = 'booked' AND u.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      clinicId, before,
    );
  }

  // ---- reporting -----------------------------------------------------------

  stats(clinicId: number): Record<string, number> {
    const count = (q: string, ...p: (string | number)[]) => Number(this.one<{ n: number }>(q, ...p)?.n ?? 0);
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    return {
      openConversations: count("SELECT COUNT(*) n FROM conversations WHERE clinic_id = ? AND status = 'open'", clinicId),
      needsAttention: count("SELECT COUNT(*) n FROM conversations WHERE clinic_id = ? AND needs_attention = 1", clinicId),
      openTasks: count("SELECT COUNT(*) n FROM tasks WHERE clinic_id = ? AND status = 'open'", clinicId),
      messagesThisWeek: count("SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.clinic_id = ? AND m.created_at >= ?", clinicId, weekAgo),
      aiRepliesThisWeek: count("SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.clinic_id = ? AND m.author = 'ai' AND m.status IN ('sent','simulated') AND m.created_at >= ?", clinicId, weekAgo),
      bookingsThisWeek: count("SELECT COUNT(*) n FROM appointments WHERE clinic_id = ? AND created_at >= ?", clinicId, weekAgo),
      aiBookingsThisWeek: count("SELECT COUNT(*) n FROM appointments WHERE clinic_id = ? AND created_at >= ? AND created_via LIKE 'ai%'", clinicId, weekAgo),
      callsThisWeek: count("SELECT COUNT(*) n FROM calls WHERE clinic_id = ? AND created_at >= ?", clinicId, weekAgo),
      newLeadsThisWeek: count("SELECT COUNT(*) n FROM contacts WHERE clinic_id = ? AND created_at >= ?", clinicId, weekAgo),
    };
  }
}

/** E.164-ish normalization for North American numbers; leaves other formats alone. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed.startsWith("+") ? `+${digits}` : digits ? `+${digits}` : trimmed;
}

export function parseTags(contact: Pick<Contact, "tags">): string[] {
  try {
    const tags = JSON.parse(contact.tags);
    return Array.isArray(tags) ? tags.map(String) : [];
  } catch {
    return [];
  }
}
