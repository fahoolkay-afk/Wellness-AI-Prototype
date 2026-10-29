import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Appointment, Call, Channel, Clinic, ClinicProfile, Contact, Conversation, Message, MessageAuthor,
  MessageStatus, Stage, Task, TaskType,
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

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.sql.exec(SCHEMA);
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
    return this.one<Contact>("SELECT * FROM contacts WHERE id = ?", id);
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
    const direct = this.one<Contact>(`SELECT * FROM contacts WHERE clinic_id = ? AND lower(${column}) = lower(?)`, clinicId, address);
    if (direct) return direct;
    // A WhatsApp id is the patient's phone number, so SMS/voice and WhatsApp threads merge into one contact.
    if (channel === "whatsapp") return this.one<Contact>("SELECT * FROM contacts WHERE clinic_id = ? AND phone = ?", clinicId, normalizePhone(address));
    if (channel === "sms" || channel === "voice") return this.one<Contact>("SELECT * FROM contacts WHERE clinic_id = ? AND whatsapp_id = ?", clinicId, address.replace(/^\+/, ""));
    return undefined;
  }

  createContact(clinicId: number, fields: Partial<Contact>): Contact {
    const id = this.run(
      `INSERT INTO contacts (clinic_id, name, phone, email, whatsapp_id, messenger_id, instagram_id, notes, tags, stage, preferred_channel, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      clinicId, fields.name ?? null, fields.phone ?? null, fields.email ?? null, fields.whatsapp_id ?? null,
      fields.messenger_id ?? null, fields.instagram_id ?? null, fields.notes ?? null, fields.tags ?? "[]",
      fields.stage ?? "new_lead", fields.preferred_channel ?? null, fields.external_id ?? null,
    );
    return this.getContact(id)!;
  }

  updateContact(id: number, fields: Partial<Pick<Contact, "name" | "phone" | "email" | "whatsapp_id" | "messenger_id" | "instagram_id" | "notes" | "tags" | "stage" | "opted_out" | "preferred_channel" | "external_id">>): Contact {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length) {
      this.run(
        `UPDATE contacts SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
        ...entries.map(([, v]) => v as string | number | null), id,
      );
    }
    return this.getContact(id)!;
  }

  findContactByExternalId(clinicId: number, externalId: string): Contact | undefined {
    return this.one<Contact>("SELECT * FROM contacts WHERE clinic_id = ? AND external_id = ?", clinicId, externalId);
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
    return this.all<Contact>(`SELECT * FROM contacts WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 500`, ...params);
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
    return this.all(
      `SELECT c.*, ct.name AS contact_name, ct.phone AS contact_phone, ct.email AS contact_email, ct.stage AS stage,
              (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS preview,
              (SELECT author FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS preview_author
       FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.clinic_id = ? ${extra}
       ORDER BY c.needs_attention DESC, c.last_message_at DESC LIMIT 200`,
      clinicId,
    );
  }

  updateConversation(id: number, fields: Partial<Pick<Conversation, "ai_enabled" | "needs_attention" | "attention_reason" | "unread" | "status" | "last_channel" | "last_message_at">>): void {
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
  }): Message {
    const now = new Date().toISOString();
    const id = this.run(
      `INSERT INTO messages (conversation_id, channel, direction, author, author_name, body, subject, status, external_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      msg.conversationId, msg.channel, msg.direction, msg.author, msg.authorName ?? null, msg.body, msg.subject ?? null,
      msg.status, msg.externalId ?? null, now,
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
    return this.one<Message>("SELECT * FROM messages WHERE id = ?", id);
  }

  updateMessage(id: number, fields: Partial<Pick<Message, "status" | "external_id" | "error" | "body" | "author" | "author_name">>): void {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    this.run(`UPDATE messages SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, v]) => v as string | number | null), id);
  }

  deleteMessage(id: number): void {
    this.run("DELETE FROM messages WHERE id = ?", id);
  }

  listMessages(conversationId: number, limit = 200): Message[] {
    return this.all<Message>(
      "SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id", conversationId, limit,
    );
  }

  // ---- appointments --------------------------------------------------------

  findAppointmentByExternalRef(clinicId: number, ref: string): Appointment | undefined {
    return this.one<Appointment>("SELECT * FROM appointments WHERE clinic_id = ? AND external_ref = ?", clinicId, ref);
  }

  getAppointment(id: number): Appointment | undefined {
    return this.one<Appointment>("SELECT * FROM appointments WHERE id = ?", id);
  }

  createAppointment(a: Pick<Appointment, "clinic_id" | "contact_id" | "service_id" | "practitioner_id" | "starts_at" | "ends_at" | "created_via"> & { notes?: string | null; external_ref?: string | null }): Appointment {
    const id = this.run(
      `INSERT INTO appointments (clinic_id, contact_id, service_id, practitioner_id, starts_at, ends_at, notes, created_via, external_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.clinic_id, a.contact_id, a.service_id, a.practitioner_id, a.starts_at, a.ends_at, a.notes ?? null, a.created_via, a.external_ref ?? null,
    );
    return this.getAppointment(id)!;
  }

  updateAppointment(id: number, fields: Partial<Pick<Appointment, "starts_at" | "ends_at" | "status" | "notes" | "practitioner_id" | "service_id" | "reminder_sent_at" | "followup_sent_at">>): Appointment {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length) {
      this.run(`UPDATE appointments SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, v]) => v as string | number | null), id);
    }
    return this.getAppointment(id)!;
  }

  /** Booked appointments overlapping [from, to) for a clinic, optionally for one practitioner. */
  appointmentsBetween(clinicId: number, from: string, to: string, practitionerId?: string): Appointment[] {
    const extra = practitionerId ? "AND practitioner_id = ?" : "";
    const params: (string | number)[] = [clinicId, to, from];
    if (practitionerId) params.push(practitionerId);
    return this.all<Appointment>(
      `SELECT * FROM appointments WHERE clinic_id = ? AND status = 'booked' AND starts_at < ? AND ends_at > ? ${extra} ORDER BY starts_at`,
      ...params,
    );
  }

  listAppointments(clinicId: number, from: string, to: string): (Appointment & { contact_name: string | null })[] {
    return this.all(
      `SELECT a.*, c.name AS contact_name FROM appointments a JOIN contacts c ON c.id = a.contact_id
       WHERE a.clinic_id = ? AND a.starts_at >= ? AND a.starts_at < ? ORDER BY a.starts_at`,
      clinicId, from, to,
    );
  }

  contactAppointments(contactId: number, upcomingOnly = false): Appointment[] {
    const extra = upcomingOnly ? "AND status = 'booked' AND starts_at >= ?" : "";
    const params: (string | number)[] = [contactId];
    if (upcomingOnly) params.push(new Date().toISOString());
    return this.all<Appointment>(`SELECT * FROM appointments WHERE contact_id = ? ${extra} ORDER BY starts_at DESC LIMIT 50`, ...params);
  }

  // ---- tasks ---------------------------------------------------------------

  createTask(t: { clinicId: number; contactId?: number | null; conversationId?: number | null; type: TaskType; priority?: Task["priority"]; title: string; details?: string | null; createdBy: string }): Task {
    const id = this.run(
      `INSERT INTO tasks (clinic_id, contact_id, conversation_id, type, priority, title, details, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      t.clinicId, t.contactId ?? null, t.conversationId ?? null, t.type, t.priority ?? "normal", t.title, t.details ?? null, t.createdBy,
    );
    return this.one<Task>("SELECT * FROM tasks WHERE id = ?", id)!;
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
    return this.all(
      `SELECT t.*, c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
       WHERE ${where.join(" AND ")}
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id DESC LIMIT 300`,
      ...params,
    );
  }

  updateTaskStatus(id: number, status: "open" | "done"): void {
    this.run("UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?", status, status === "done" ? new Date().toISOString() : null, id);
  }

  // ---- calls ---------------------------------------------------------------

  upsertCall(c: Omit<Call, "id" | "created_at">): Call {
    this.run(
      `INSERT INTO calls (clinic_id, contact_id, conversation_id, external_id, from_number, duration_s, summary, transcript, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(external_id) DO UPDATE SET duration_s = excluded.duration_s, summary = excluded.summary,
         transcript = excluded.transcript, outcome = excluded.outcome`,
      c.clinic_id, c.contact_id, c.conversation_id, c.external_id, c.from_number, c.duration_s, c.summary, c.transcript, c.outcome,
    );
    return this.one<Call>("SELECT * FROM calls WHERE external_id = ?", c.external_id)!;
  }

  listCalls(clinicId: number): (Call & { contact_name: string | null })[] {
    return this.all(
      `SELECT k.*, c.name AS contact_name FROM calls k LEFT JOIN contacts c ON c.id = k.contact_id
       WHERE k.clinic_id = ? ORDER BY k.id DESC LIMIT 200`,
      clinicId,
    );
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
