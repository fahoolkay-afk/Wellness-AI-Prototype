// The front desk side of the bridge to the clinic's EHRM (docs/INTEGRATION-CONTRACT.md).
//
//   - Producers: booking requests, patient confirm / change replies, consent withdrawals and delivery
//     statuses become queued events (codes, refs, times, first name, phone). Never message text.
//   - Outbox: a message a practitioner released one by one in the EHRM is checked again here at send time
//     (exact channel + purpose consent, newer cloud withdrawal wins, pinned wording guard on body and
//     subject, privacy, links, quiet hours, 24-hour window) and sent through Inbox.deliver on exactly
//     that channel. The EHRM consent fact is kept as evidence on that one item, never as a standing grant.
//   - Bridge mode: the clinic's own cloud reminders, campaigns and new conversations are switched off.

import { inQuietHours } from "../automations.ts";
import type { Consents } from "../consent.ts";
import { Db, normalizePhone } from "../db.ts";
import type { Events } from "../events.ts";
import type { Inbox } from "../inbox.ts";
import { DEFAULT_WORDING_RULES, privacyProblems, wordingProblems } from "../policy/guards.ts";
import type { AuditLog } from "../security/audit.ts";
import { randomToken } from "../security/crypto.ts";
import { parseLocalDateTime } from "../time.ts";
import type { Channel, Clinic, Contact } from "../types.ts";
import { CONSENT_CHANNELS, E164_RE, FIRST_NAME_RE, NAME_RE, REF, SERVICE_CODES, sealedProblem, type DeliveryCode } from "./events.ts";
import { PASSED_TO_CLINIC, registerBridge, type BridgeHooks, type ReplyIntent, type WithdrawVia } from "./hooks.ts";
import type { BridgeStore } from "./store.ts";

export { PASSED_TO_CLINIC };

/** Placeholder for the pending AI-disclosure wording (open decision 1). Never allowed in patient text. */
export const DISCLOSURE_PLACEHOLDER = "[[DISCLOSURE-WORDING: pending owner and counsel; guard unchanged]]";

export const OUTBOX_CHANNELS = ["sms", "email", "whatsapp"] as const;
type OutboxChannel = (typeof OUTBOX_CHANNELS)[number];

export interface OutboxItem {
  releaseRef: string; patientRef: string; appointmentRef?: string | null; channel: string; purpose: "service" | "marketing";
  to: string; firstName: string; subject?: string | null; text: string;
  consent: { channel: string; purpose: string; status: string; express: boolean; givenBy: string; recordedAt: string; textVersion: string };
  releasedBy: string; releasedAt: string;
}
export interface OutboxResult { releaseRef: string; result: "accepted" | "refused" | "duplicate"; code: DeliveryCode | null }

const HOUR = 3600_000;
const MAX_REQUESTS_PER_CONVERSATION_DAY = 3;
const MAX_REQUESTS_PER_CLINIC_HOUR = 30;
const PRIVATE_HOST = /(^|[^\w.-])(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|[\w-]+\.(local|lan|internal|home\.arpa))(?![\w-])/i;
const URL_RE = /\b(?:https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s<>"]*)/gi;

/** v1.2 website booking (contract 12.1). The words the patient ticks, kept with its version as consent evidence. */
export const WEB_TEXT_CONSENT_VERSION = "web-text-v1";
export const WEB_TEXT_CONSENT = "Yes, the clinic may text me at this number about this booking request, including a secure link to finish my details. I can reply STOP at any time.";
export const SERVICE_LABEL: Record<(typeof SERVICE_CODES)[number], string> = { initial: "First visit (assessment)", treatment: "Treatment visit", followup: "Short follow-up" };
const FORM_SECTIONS = ["details", "intake"] as const;
const WEB_PER_PHONE_DAY = 2;
/** The front desk's own public address: the only host a released message may link to besides the clinic's site, and only to /f/. */
let formLinkBase: URL | undefined;

export class Bridge implements BridgeHooks {
  readonly store: BridgeStore;
  private readonly db: Db;
  private readonly inbox: Inbox;
  private readonly consents: Consents;
  private readonly audit: AuditLog;
  private readonly events: Events;
  private timer?: NodeJS.Timeout;

  constructor(store: BridgeStore, inbox: Inbox, consents: Consents, audit: AuditLog, events: Events) {
    this.store = store;
    this.db = store.db;
    this.inbox = inbox;
    this.consents = consents;
    this.audit = audit;
    this.events = events;
    registerBridge(this.db, this);
  }

  enabled(clinicId: number): boolean {
    return this.store.enabled(clinicId);
  }

  /** The address patients reach the front desk at (config.publicUrl); form links are built on it. */
  setPublicUrl(url: string): void {
    try {
      formLinkBase = new URL(url);
    } catch {
      formLinkBase = undefined;
    }
  }

  start(intervalMs: number): void {
    this.timer = setInterval(() => this.tick().catch((err) => console.error("[bridge] tick", (err as Error).message)), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private queue(clinicId: number, type: Parameters<BridgeStore["enqueue"]>[1], fields: Record<string, unknown>, target: string, source: string | null = null, actor = "front-desk"): string {
    const id = this.store.enqueue(clinicId, type, fields, source);
    this.audit.record({ actorType: "system", actor: `bridge:${actor}`, role: "bridge", clinicId, action: "bridge.queue.add", target, outcome: "ok", detail: `type=${type} event=${id}` });
    this.events.emit("changed", { clinicId, kind: "bridge" });
    return id;
  }

  // ------------------------------------------------------------------ bridge mode

  /** WhatsApp/Messenger/Instagram: Meta's 24-hour window on that channel. SMS and email: 24 hours since the patient last wrote or called. */
  replyAllowed(conversationId: number, channel: Channel): boolean {
    const meta = channel === "whatsapp" || channel === "messenger" || channel === "instagram";
    const last = this.store.lastInbound(conversationId, meta ? channel : undefined);
    return !!last && Date.now() - Date.parse(last) < 24 * HOUR;
  }

  // ------------------------------------------------------------------ producers

  fileBookingRequest(args: Parameters<BridgeHooks["fileBookingRequest"]>[0]): ReturnType<BridgeHooks["fileBookingRequest"]> {
    const { clinic, contact, conversationId, channel } = args;
    const refuse = (code: string, message: string) => ({ ok: false as const, code, message });
    const firstName = (args.firstName ?? "").trim().split(/\s+/)[0] ?? "";
    if (!FIRST_NAME_RE.test(firstName) || wordingProblems(firstName, DEFAULT_WORDING_RULES).length) return refuse("first_name", "Ask for the patient's first name (letters only).");
    // Phone and channel come from the conversation record, never from what the model or patient says.
    const phone = channel === "whatsapp" && contact.whatsapp_id ? normalizePhone(`+${contact.whatsapp_id.replace(/\D/g, "")}`) : contact.phone ?? "";
    if (!E164_RE.test(phone)) return refuse("no_phone", "This conversation has no phone number on file, so the clinic could not confirm a time. Hand off to staff.");
    const times = parseTimes(args.preferredTimes, clinic.profile.timezone);
    if (typeof times === "string") return refuse("preferred_times", times);
    const source = `conversation:${conversationId}`;
    if (this.store.queuedSince(clinic.id, "booking.requested", new Date(Date.now() - 24 * HOUR).toISOString(), source) >= MAX_REQUESTS_PER_CONVERSATION_DAY
      || this.store.queuedSince(clinic.id, "booking.requested", new Date(Date.now() - HOUR).toISOString()) >= MAX_REQUESTS_PER_CLINIC_HOUR) {
      return refuse("rate_capped", "A request is already with the clinic. Tell the patient the clinic will confirm a time, or hand off to staff.");
    }
    const requestRef = `brq_${randomToken(16).slice(0, 22)}`;
    const service = args.service && (SERVICE_CODES as readonly string[]).includes(args.service) ? args.service : null;
    this.queue(clinic.id, "booking.requested", {
      requestRef, kind: "new", channel: channel === "voice" ? "voice" : channel, firstName, phone, phoneVerified: args.verified, preferredTimes: times,
      service, returning: false, textConsent: false,
    }, `conversation:${conversationId}`, source, args.actor.startsWith("staff:") ? "staff" : "receptionist");
    return { ok: true, requestRef };
  }

  // ------------------------------------------------------------------ website booking (v1.2, contract 12.1)

  /**
   * A booking request from the clinic's own website. Only first name, phone, service code, returning, up to three
   * preferred times and the text-consent tick are accepted: no last name, birth date, reason or free text.
   */
  bookFromWebsite(clinic: Clinic, body: unknown): { ok: true } | { ok: false; status: number; code: string; message: string } {
    const refuse = (code: string, message: string, status = 400) => ({ ok: false as const, status, code, message });
    if (!this.enabled(clinic.id)) return refuse("not_found", "Online booking is not available for this clinic.", 404);
    if (!body || typeof body !== "object" || Array.isArray(body)) return refuse("bad_request", "Please fill in the form.");
    const b = body as Record<string, unknown>;
    const allowed = ["firstName", "phone", "service", "returning", "times", "textConsent", "website"];
    if (Object.keys(b).some((k) => !allowed.includes(k))) return refuse("bad_request", "Please fill in the form.");
    if (typeof b.website === "string" && b.website.trim()) return refuse("bad_request", "Please fill in the form."); // honeypot
    const firstName = String(b.firstName ?? "").trim();
    if (!FIRST_NAME_RE.test(firstName) || wordingProblems(firstName, DEFAULT_WORDING_RULES).length) return refuse("first_name", "Please enter your first name (letters only, one word).");
    const phone = normalizePhone(String(b.phone ?? ""));
    if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(phone)) return refuse("phone", "Please enter a Canadian or US mobile number, with the area code.");
    if (!(SERVICE_CODES as readonly string[]).includes(String(b.service))) return refuse("service", "Please choose the kind of visit.");
    if (typeof b.returning !== "boolean" || typeof b.textConsent !== "boolean") return refuse("bad_request", "Please fill in the form.");
    const rawTimes = Array.isArray(b.times) ? b.times : [];
    const shaped = rawTimes.map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const ok = Object.keys(o).every((k) => ["day", "from", "to"].includes(k)) && /^\d{4}-\d{2}-\d{2}$/.test(String(o.day)) && /^\d{2}:\d{2}$/.test(String(o.from)) && /^\d{2}:\d{2}$/.test(String(o.to));
      return ok ? { start: `${o.day}T${o.from}`, end: `${o.day}T${o.to}` } : null;
    });
    if (shaped.some((t) => !t)) return refuse("times", "Please pick a day and a time range for each choice.");
    const times = parseTimes(shaped, clinic.profile.timezone);
    if (typeof times === "string") return refuse("times", times);
    const source = `web:${this.store.addressHash(clinic.id, "sms", phone)}`;
    if (this.store.queuedSince(clinic.id, "booking.requested", new Date(Date.now() - 24 * HOUR).toISOString(), source) >= WEB_PER_PHONE_DAY
      || this.store.queuedSince(clinic.id, "booking.requested", new Date(Date.now() - HOUR).toISOString()) >= MAX_REQUESTS_PER_CLINIC_HOUR) {
      return refuse("rate_capped", `Your request is already with the clinic. If you need to change it, call ${clinic.profile.phone || "the clinic"}.`, 429);
    }
    const { contact } = this.inbox.findOrCreateContact(clinic, "sms", phone, firstName);
    if (b.textConsent === true) {
      this.consents.record({ clinicId: clinic.id, contactId: contact.id, channel: "sms", purpose: "service", status: "granted", basis: "express", source: "website booking form", textVersion: WEB_TEXT_CONSENT_VERSION, by: "patient" });
    }
    const service = b.service as (typeof SERVICE_CODES)[number];
    const conversation = this.db.conversationForContact(contact, "sms");
    // A note for staff in the person's thread. Not a patient message: it opens no reply window and counts toward no limit.
    this.db.addMessage({
      conversationId: conversation.id, channel: "sms", direction: "out", author: "system", status: "received",
      body: `Booking request from the website: ${SERVICE_LABEL[service]}, ${times.length} preferred time${times.length === 1 ? "" : "s"}${b.returning ? ", says they have been before" : ""}. Sent to the records system; the clinic confirms a time.${b.textConsent ? "" : " They did not agree to texts: call them."}`,
    });
    const requestRef = `brq_${randomToken(16).slice(0, 22)}`;
    this.queue(clinic.id, "booking.requested", {
      requestRef, kind: "new", channel: "web", firstName, phone, phoneVerified: false, preferredTimes: times, service, returning: b.returning, textConsent: b.textConsent,
    }, `contact:${contact.id}`, source, "website");
    this.audit.record({ actorType: "webhook", actor: "website", clinicId: clinic.id, action: "public.book", target: `contact:${contact.id}`, contactId: contact.id, outcome: "ok", detail: `service=${service} times=${times.length} returning=${b.returning} text_consent=${b.textConsent}` });
    this.events.emit("changed", { clinicId: clinic.id, kind: "conversation", id: conversation.id });
    return { ok: true };
  }

  // ------------------------------------------------------------------ sealed patient forms (v1.2, contract 12.2)

  setFormKey(clinicId: number, keyId: string, publicKey: string): void {
    this.store.setFormKey(clinicId, keyId, publicKey);
  }

  /** Makes a one-time link for a form the laptop asked for. The token is returned once (to the laptop) and kept only as a hash. */
  createForm(clinicId: number, f: { formRef: string; firstName: string; sections: string[]; expiresAt: string }): { url: string } | { code: string } {
    if (!formLinkBase) return { code: "no_public_url" };
    if (!this.store.formKey(clinicId)) return { code: "no_form_key" };
    const token = randomToken(32);
    if (!this.store.addForm(clinicId, { ...f, token })) return { code: "duplicate" };
    return { url: new URL(`/f/${token}`, formLinkBase).toString() };
  }

  revokeForm(clinicId: number, formRef: string): boolean {
    return this.store.revokeForm(clinicId, formRef);
  }

  /** What the patient's page needs to encrypt: the clinic's name and public key, the first name and the sections. */
  formMeta(token: string): { status: 200; meta: Record<string, unknown> } | { status: 404 | 410; code: string } {
    const form = /^[A-Za-z0-9_-]{30,64}$/.test(token) ? this.store.formByToken(token) : undefined;
    if (!form || !this.enabled(form.clinic_id)) return { status: 404, code: "not_found" };
    if (form.used_at || form.revoked_at || Date.parse(form.expires_at) <= Date.now()) return { status: 410, code: form.used_at ? "used" : "expired" };
    const key = this.store.formKey(form.clinic_id);
    const clinic = this.db.getClinic(form.clinic_id);
    if (!key || !clinic) return { status: 404, code: "not_found" };
    return { status: 200, meta: { clinicName: clinic.profile.name || clinic.name, firstName: form.first_name, sections: form.sections, formRef: form.form_ref, keyId: key.key_id, publicKey: key.public_key, expiresAt: form.expires_at } };
  }

  /** Takes the sealed answers. The front desk cannot open them; it only checks the shape, uses the link once and queues them. */
  submitForm(token: string, body: unknown): { status: 200 } | { status: 400 | 404 | 410; code: string } {
    const form = /^[A-Za-z0-9_-]{30,64}$/.test(token) ? this.store.formByToken(token) : undefined;
    if (!form || !this.enabled(form.clinic_id)) return { status: 404, code: "not_found" };
    if (form.used_at || form.revoked_at || Date.parse(form.expires_at) <= Date.now()) return { status: 410, code: form.used_at ? "used" : "expired" };
    if (sealedProblem(body)) return { status: 400, code: "bad_value" };
    const sealed = body as { v: 1; keyId: string; epk: string; iv: string; ct: string };
    if (sealed.keyId !== this.store.formKey(form.clinic_id)?.key_id) return { status: 400, code: "stale_key" };
    if (!this.store.useForm(form.clinic_id, form.form_ref)) return { status: 410, code: "used" };
    this.queue(form.clinic_id, "form.submitted", { formRef: form.form_ref, sealed: { v: 1, keyId: sealed.keyId, epk: sealed.epk, iv: sealed.iv, ct: sealed.ct } }, `form:${form.form_ref}`, `form:${form.form_ref}`, "patient-form");
    this.audit.record({ actorType: "webhook", actor: "patient-form", clinicId: form.clinic_id, action: "form.submitted", target: `form:${form.form_ref}`, outcome: "ok", detail: `bytes=${sealed.ct.length}` });
    return { status: 200 };
  }

  replyKeyword(clinic: Clinic, contact: Contact, channel: Channel, address: string, intent: ReplyIntent): "queued" | "no_match" {
    const ch: Channel = channel === "voice" ? "sms" : channel;
    // Exactly one bridge item delivered to this exact address and channel in the last 48 hours, carrying an
    // appointment. Two patients on one phone, or nothing recent: staff triage it.
    const recent = this.store.recentDeliveries(clinic.id, ch, address, new Date(Date.now() - 48 * HOUR).toISOString());
    if (recent.length !== 1 || !recent[0].appointment_ref) return "no_match";
    const appt = this.store.getAppointment(clinic.id, recent[0].appointment_ref);
    if (!appt || appt.status !== "booked") return "no_match";
    if (intent === "confirm") {
      this.queue(clinic.id, "appointment.confirmed", { appointmentRef: appt.appointment_ref, channel: ch }, `contact:${contact.id}`);
      this.store.markConfirmRelayed(clinic.id, appt.appointment_ref);
    } else {
      this.queue(clinic.id, "appointment.change_requested", { appointmentRef: appt.appointment_ref, intent, channel: ch }, `contact:${contact.id}`);
    }
    return "queued";
  }

  withdrawn(clinicId: number, contactId: number, channel: Channel, purposes: ("service" | "marketing")[], via: WithdrawVia, scope: "address" | "contact"): void {
    if (!this.enabled(clinicId) || !(CONSENT_CHANNELS as readonly string[]).includes(channel)) return;
    const contact = this.db.getContact(contactId);
    if (!contact) return;
    const refs = new Set<string>();
    if (contact.external_id) refs.add(contact.external_id);
    if (scope === "address") {
      const address = channel === "email" ? contact.email : channel === "whatsapp" ? contact.whatsapp_id ?? contact.phone : contact.phone;
      // A shared family phone withdraws for every patient linked to it.
      if (address) for (const c of this.store.linkedContacts(clinicId, channel, address)) refs.add(c.external_id);
    }
    for (const patientRef of refs) {
      if (!REF.patient.test(patientRef)) continue; // not a bridge ref (e.g. an old EHR-edition id)
      for (const purpose of purposes) this.queue(clinicId, "consent.withdrawn", { patientRef, channel, purpose, via }, `contact:${contactId}`);
    }
  }

  /** Twilio delivery receipts for a bridge item become delivery.status events. */
  onSmsStatus(messageId: number, carrierStatus: string): void {
    const d = this.store.deliveryForMessage(messageId);
    if (!d) return;
    const map: Record<string, [string, DeliveryCode | null]> = {
      sent: ["sent", null], delivered: ["delivered", null], failed: ["failed", "carrier_failed"], undelivered: ["failed", "undelivered"],
    };
    const next = map[carrierStatus];
    if (!next || d.status === next[0] || d.status === "delivered" || d.status === "failed") return;
    this.store.updateDelivery(d.clinic_id, d.release_ref, { status: next[0] });
    this.queue(d.clinic_id, "delivery.status", { releaseRef: d.release_ref, status: next[0], code: next[1] }, `release:${d.release_ref}`);
  }

  // ------------------------------------------------------------------ outbox

  async receiveOutbox(clinic: Clinic, items: OutboxItem[], actor: string): Promise<OutboxResult[]> {
    const results: OutboxResult[] = [];
    for (const item of items) {
      if (!this.store.claim(clinic.id, `release:${item.releaseRef}`)) {
        // A repeat (e.g. the laptop never got our first answer): give the outcome we recorded, so a refusal is
        // never mistaken for acceptance.
        const prior = this.store.getDelivery(clinic.id, item.releaseRef);
        const result = prior?.result === "refused" ? "refused" : prior?.result === "accepted" ? "accepted" : "duplicate";
        results.push({ releaseRef: item.releaseRef, result, code: (prior?.code as DeliveryCode | null) ?? null });
        continue;
      }
      const out = await this.intake(clinic, item);
      this.audit.record({
        actorType: "device", actor, role: "bridge", clinicId: clinic.id, action: out.result === "refused" ? "bridge.outbox.refuse" : "bridge.outbox.deliver",
        target: `release:${item.releaseRef}`, contactId: out.contactId ?? null, outcome: out.result === "refused" ? "denied" : "ok",
        detail: `channel=${item.channel} purpose=${item.purpose} result=${out.result}${out.code ? ` code=${out.code}` : ""}`,
      });
      results.push({ releaseRef: item.releaseRef, result: out.result, code: out.code });
    }
    return results;
  }

  private async intake(clinic: Clinic, item: OutboxItem): Promise<{ result: "accepted" | "refused"; code: DeliveryCode | null; contactId?: number }> {
    const record = (result: "accepted" | "refused" | "pending", code: DeliveryCode | null, contactId: number | null, pending?: OutboxItem) => {
      this.store.addDelivery({
        clinicId: clinic.id, releaseRef: item.releaseRef, contactId, channel: (item.channel as Channel), purpose: item.purpose, address: item.to,
        appointmentRef: item.appointmentRef ?? null, evidence: { ...item.consent, basis: "ehr", releasedBy: item.releasedBy, releasedAt: item.releasedAt },
        result, code, pending,
      });
    };
    if (!(OUTBOX_CHANNELS as readonly string[]).includes(item.channel)) {
      record("refused", "channel_not_allowed", null);
      return { result: "refused", code: "channel_not_allowed" };
    }
    const early = this.itemProblem(clinic, item);
    if (early) {
      record("refused", early, null);
      return { result: "refused", code: early };
    }
    const resolved = this.resolveContact(clinic, item);
    if ("code" in resolved) {
      record("refused", resolved.code, resolved.contactId ?? null);
      return { result: "refused", code: resolved.code, contactId: resolved.contactId };
    }
    const contact = resolved.contact;
    const late = this.contactProblem(clinic, contact, item);
    if (late) {
      record("refused", late, contact.id);
      return { result: "refused", code: late, contactId: contact.id };
    }
    if (inQuietHours(clinic, new Date())) {
      // Handed to the sending service: it goes out after quiet hours, after every check runs again.
      record("pending", null, contact.id, item);
      return { result: "accepted", code: null, contactId: contact.id };
    }
    const code = await this.send(clinic, contact, item, (result, c) => record(result, c, contact.id));
    return code ? { result: "refused", code, contactId: contact.id } : { result: "accepted", code: null, contactId: contact.id };
  }

  /** Checks that need no contact: release age, appointment still current, links, pinned wording, consent fact. */
  private itemProblem(clinic: Clinic, item: OutboxItem): DeliveryCode | undefined {
    const released = Date.parse(item.releasedAt);
    if (Number.isNaN(released) || Date.now() - released > 7 * 24 * HOUR || released - Date.now() > 5 * 60_000) return "stale_release";
    if (item.appointmentRef) {
      const appt = this.store.getAppointment(clinic.id, item.appointmentRef);
      if (!appt || appt.status !== "booked" || Date.parse(appt.starts_at) <= Date.now()) return "stale_release";
    }
    for (const part of [item.text, item.subject ?? ""]) if (linkProblem(clinic, part)) return "link_not_allowed";
    // Wording rules are pinned to the full default set: a clinic setting cannot loosen them for bridge items.
    for (const part of [item.text, item.subject ?? ""]) {
      if (wordingProblems(part, DEFAULT_WORDING_RULES).length || part.includes("[[DISCLOSURE-WORDING")) return "wording";
    }
    const c = item.consent;
    if (c.channel !== item.channel || c.purpose !== item.purpose) return "consent_mismatch";
    const recorded = Date.parse(c.recordedAt);
    if (c.status !== "granted" || Number.isNaN(recorded) || recorded > Date.now() + 60_000) return "consent_missing";
    if (item.purpose === "marketing" && c.express !== true) return "consent_missing";
    return undefined;
  }

  /** Checks against the cloud's own records: newer withdrawal or suppression wins; privacy on lock screens. */
  private contactProblem(clinic: Clinic, contact: Contact, item: OutboxItem): DeliveryCode | undefined {
    const channel = item.channel as OutboxChannel;
    const recordedAt = Date.parse(item.consent.recordedAt);
    const newer = (row?: { status: string; recorded_at: string }) => !!row && row.status === "withdrawn" && Date.parse(row.recorded_at) >= recordedAt;
    const block = this.consents.addressBlock(contact.id, channel);
    // A carrier STOP stands until the patient texts START, whatever the EHRM says.
    if (block && (channel === "sms" || Date.parse(block.recorded_at) >= recordedAt)) return "consent_withdrawn";
    if (newer(this.consents.latest(contact.id, channel, "service"))) return "consent_withdrawn";
    if (item.purpose === "marketing" && newer(this.consents.latest(contact.id, channel, "marketing"))) return "consent_withdrawn";
    for (const part of [item.text, item.subject ?? ""]) if (privacyProblems(part, channel, clinic).length) return "privacy";
    return undefined;
  }

  /** Matches the contact by patientRef; never merges two patientRefs that share an address. */
  private resolveContact(clinic: Clinic, item: OutboxItem): { contact: Contact } | { code: DeliveryCode; contactId?: number } {
    const channel = item.channel as OutboxChannel;
    const address = channel === "email" ? item.to.trim().toLowerCase() : channel === "whatsapp" ? item.to.replace(/\D/g, "") : normalizePhone(item.to);
    const column = Db.identityColumn(channel) as "phone" | "email" | "whatsapp_id";
    const same = (stored: string | null) => !!stored && (channel === "email" ? stored.toLowerCase() === address : stored.replace(/\D/g, "") === address.replace(/\D/g, ""));
    const existing = this.db.findContactByExternalId(clinic.id, item.patientRef);
    if (existing) {
      const stored = existing[column] as string | null;
      if (stored && !same(stored)) {
        // Never overwrite a delivery address from outside: staff confirm the change first.
        this.db.proposeContactChange(clinic.id, existing.id, channel === "email" ? "email" : "phone", channel === "email" ? address : normalizePhone(item.to), "bridge");
        return { code: "address_pending_review", contactId: existing.id };
      }
      if (!stored) return { contact: this.db.updateContact(existing.id, { [column]: address, ...(channel === "whatsapp" && !existing.phone ? { phone: `+${address}` } : {}) }) };
      return { contact: existing };
    }
    const holders = this.store.contactsWithAddress(clinic.id, channel, address);
    if (holders.length === 1 && !holders[0].external_id) {
      // The one unlinked thread on this address (typically the patient who asked to book) is linked to the ref.
      const c = this.db.getContact(holders[0].id)!;
      return { contact: this.db.updateContact(c.id, { external_id: item.patientRef, ...(c[column] ? {} : { [column]: address }), ...(c.name ? {} : { name: item.firstName }) }) };
    }
    // Otherwise a contact of its own: first name and this one address. No automation fires for it.
    return { contact: this.db.createContact(clinic.id, {
      name: item.firstName, [column]: address, ...(channel === "whatsapp" ? { phone: `+${address}` } : {}),
      external_id: item.patientRef, preferred_channel: channel, stage: "booked",
    }) };
  }

  /** Window, rate and channel checks, then Inbox.deliver on exactly this channel (no fallback). Returns a refusal code or undefined. */
  private async send(clinic: Clinic, contact: Contact, item: OutboxItem, record: (result: "accepted" | "refused", code: DeliveryCode | null) => void): Promise<DeliveryCode | undefined> {
    const channel = item.channel as OutboxChannel;
    const conversation = this.db.conversationForContact(contact, channel);
    if (channel === "whatsapp") {
      const last = this.store.lastInbound(conversation.id, "whatsapp");
      if (!last || Date.now() - Date.parse(last) >= 24 * HOUR) {
        record("refused", "window_closed");
        return "window_closed";
      }
    }
    const opts = { purpose: item.purpose, bypassConsent: true, bridgeRelease: true } as const;
    for (const part of [item.text, ...(item.subject ? [item.subject] : [])]) {
      const problem = this.inbox.sendProblem(clinic, contact, conversation.id, channel, part, opts);
      if (problem) {
        const code = problemCode(problem);
        record("refused", code);
        return code;
      }
    }
    record("accepted", null);
    const message = await this.inbox.deliver(clinic, contact, conversation.id, channel, item.text, {
      ...opts, author: "system", authorName: `Released in the records system by ${item.releasedBy}`, subject: item.subject ?? undefined,
    });
    this.store.updateDelivery(clinic.id, item.releaseRef, { messageId: message.id });
    const [status, code]: [string, DeliveryCode | null] = message.status === "sent" ? ["sent", null] : message.status === "simulated" ? ["not_sent", "simulated"] : ["failed", "send_failed"];
    this.store.updateDelivery(clinic.id, item.releaseRef, { status });
    this.queue(clinic.id, "delivery.status", { releaseRef: item.releaseRef, status, code }, `release:${item.releaseRef}`);
    return undefined;
  }

  /** Sends items held for quiet hours, re-running every check first. Anything that now fails is reported, never sent. */
  async tick(now = new Date()): Promise<void> {
    for (const { clinic_id, release_ref } of this.store.pendingDeliveries()) {
      const clinic = this.db.getClinic(clinic_id);
      if (!clinic || inQuietHours(clinic, now)) continue;
      const d = this.store.getDelivery(clinic_id, release_ref);
      const item = d?.pending as OutboxItem | null;
      const contact = d?.contact_id ? this.db.getContact(d.contact_id) : undefined;
      this.store.updateDelivery(clinic_id, release_ref, { clearPending: true });
      const fail = (code: DeliveryCode) => {
        this.store.updateDelivery(clinic_id, release_ref, { result: "refused", code, status: "not_sent" });
        this.queue(clinic_id, "delivery.status", { releaseRef: release_ref, status: "not_sent", code }, `release:${release_ref}`);
      };
      if (!item || !contact || !this.enabled(clinic_id)) {
        fail("stale_release");
        continue;
      }
      const problem = this.itemProblem(clinic, item) ?? this.contactProblem(clinic, contact, item);
      if (problem) {
        fail(problem);
        continue;
      }
      const code = await this.send(clinic, contact, item, (result, c) => this.store.updateDelivery(clinic_id, release_ref, { result, code: c }));
      if (code) fail(code);
    }
  }

  // ------------------------------------------------------------------ retention

  purge(now = new Date()): void {
    for (const [clinicId, counts] of this.store.purge(now)) {
      if (counts.queue_expired) this.audit.record({ actorType: "system", actor: "retention", clinicId, action: "bridge.queue.expired", outcome: "ok", detail: `count=${counts.queue_expired}` });
      const rest = Object.entries(counts).filter(([k]) => k !== "queue_expired");
      if (rest.length) this.audit.record({ actorType: "system", actor: "retention", clinicId, action: "bridge.purge", outcome: "ok", detail: rest.map(([k, v]) => `${k}=${v}`).join(" ") });
    }
    for (const clinic of this.db.listClinics()) {
      const days = clinic.profile.retention?.messageDays ?? 180;
      this.store.purgeDeliveries(clinic.id, new Date(now.getTime() - days * 864e5).toISOString());
    }
  }
}

function problemCode(problem: string): DeliveryCode {
  if (/opted out/i.test(problem)) return "consent_withdrawn";
  if (/too many/i.test(problem)) return "rate_capped";
  if (/window/i.test(problem)) return "window_closed";
  if (/health details/i.test(problem)) return "privacy";
  if (/wording/i.test(problem)) return "wording";
  return "channel_not_allowed";
}

/** Links only to the clinic's own hosts; never the laptop's /x/ exercise links, loopback or private networks. */
export function linkProblem(clinic: Clinic, text: string): boolean {
  // The front desk's own one-time form links (<publicUrl>/f/<token>) are allowed, exactly that origin and path, nothing else on it.
  if (formLinkBase) {
    const origin = formLinkBase.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`${origin}/f/[A-Za-z0-9_-]{30,64}(?![\\w/?#-])`, "g"), " ");
  }
  if (/\/x\//i.test(text) || PRIVATE_HOST.test(text)) return true;
  const allowed = new Set([clinic.profile.website, clinic.profile.reviewUrl].filter(Boolean).map((u) => {
    try {
      return new URL(u!).hostname.toLowerCase();
    } catch {
      return "";
    }
  }).filter(Boolean));
  for (const m of text.match(URL_RE) ?? []) {
    let host = "";
    try {
      host = new URL(/^https?:\/\//i.test(m) ? m : `https://${m}`).hostname.toLowerCase();
    } catch {
      return true;
    }
    if (!/^https:\/\//i.test(m) && /^https?:/i.test(m)) return true; // plain http
    if (!allowed.has(host)) return true;
  }
  return false;
}

/** Up to three preferred times: clinic-local "YYYY-MM-DDTHH:MM" or ISO with offset, in the future, at most 60 days out. */
function parseTimes(raw: unknown, timeZone: string): { start: string; end: string }[] | string {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length || list.length > 3) return "Ask for one to three preferred times (a day and a time range).";
  const out: { start: string; end: string }[] = [];
  for (const t of list) {
    const o = (t ?? {}) as Record<string, unknown>;
    const when = (v: unknown) => (typeof v === "string" ? parseLocalDateTime(v, timeZone) : undefined);
    const start = when(o.start);
    const end = when(o.end);
    if (!start || !end || end <= start) return "Each preferred time needs a start and a later end.";
    if (start.getTime() < Date.now() || start.getTime() > Date.now() + 60 * 864e5) return "Preferred times must be in the next 60 days.";
    if (end.getTime() - start.getTime() > 12 * HOUR) return "Keep each preferred time to part of one day.";
    out.push({ start: start.toISOString(), end: end.toISOString() });
  }
  return out;
}
