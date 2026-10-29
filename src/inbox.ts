import type { Backends } from "./booking/index.ts";
import { ChannelError, isNanp, reachableChannels, type Channels } from "./channels/index.ts";
import type { Config } from "./config.ts";
import type { Consents, SendPurpose } from "./consent.ts";
import { Db, normalizePhone } from "./db.ts";
import type { Events } from "./events.ts";
import type { Responder } from "./ai/receptionist.ts";
import { detectIntent } from "./policy/keywords.ts";
import { enabledWordingRules, privacyProblems, wordingProblems } from "./policy/guards.ts";
import type { AuditLog } from "./security/audit.ts";
import { formatLocal } from "./time.ts";
import type { Channel, Clinic, Contact, Conversation, InboundMessage, Message, MessageAuthor } from "./types.ts";

export interface InboxOptions {
  /** Wait this long after an inbound message so a burst of texts gets one reply. */
  replyDelayMs?: number;
}

/** Inbound text longer than this is cut before storage and before the AI sees it (cost and abuse limit). */
const MAX_CHAT_CHARS = 4_000;
const MAX_EMAIL_CHARS = 16_000;
/** Channels where Meta enforces a 24-hour customer-service window. */
export const SESSION_CHANNELS: Channel[] = ["whatsapp", "messenger", "instagram"];
const WINDOW_MS = 24 * 3600_000;

export type SendOutcome = { message: Message } | { skipped: string };

export class Inbox {
  private readonly db: Db;
  private readonly channels: Channels;
  private readonly backends: Backends;
  private readonly events: Events;
  private readonly responder: Responder;
  private readonly consents: Consents;
  private readonly audit: AuditLog;
  private readonly config: Config;
  private readonly replyDelayMs: number;
  /** Per-conversation queue so AI turns for one patient never overlap. */
  private readonly queues = new Map<number, Promise<void>>();
  private readonly pending = new Set<number>();
  /** Clinics already told today that the AI budget ran out (one task per day, not one per message). */
  private readonly budgetWarned = new Set<string>();

  constructor(db: Db, channels: Channels, backends: Backends, events: Events, responder: Responder, consents: Consents, audit: AuditLog, config: Config, opts: InboxOptions = {}) {
    this.db = db;
    this.channels = channels;
    this.backends = backends;
    this.events = events;
    this.responder = responder;
    this.consents = consents;
    this.audit = audit;
    this.config = config;
    this.replyDelayMs = opts.replyDelayMs ?? 1500;
  }

  get responderName(): string {
    return this.responder.name;
  }

  /** Waits for all queued AI work (used by tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.queues.size || this.pending.size) {
      await Promise.all([...this.queues.values()]);
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  /** Finds the patient for a channel identity, creating them if new. */
  findOrCreateContact(clinic: Clinic, channel: Channel, address: string, name?: string): { contact: Contact; created: boolean } {
    const normalized = channel === "sms" || channel === "voice" ? normalizePhone(address) : address;
    const existing = this.db.findContactByIdentity(clinic.id, channel, normalized);
    if (existing) {
      // Fill in identities learned on a new channel. A WhatsApp id is a phone number Meta has verified.
      const updates: Partial<Contact> = {};
      const column = Db.identityColumn(channel);
      if (!existing[column]) (updates as Record<string, string>)[column] = normalized;
      if (channel === "whatsapp" && !existing.phone) updates.phone = normalizePhone(address);
      if (!existing.name && name) updates.name = name.slice(0, 80);
      return { contact: Object.keys(updates).length ? this.db.updateContact(existing.id, updates) : existing, created: false };
    }
    const fields: Partial<Contact> = { name: name?.slice(0, 80) ?? null, preferred_channel: channel === "voice" ? "sms" : channel };
    (fields as Record<string, string>)[Db.identityColumn(channel)] = normalized;
    if (channel === "whatsapp") fields.phone = normalizePhone(address);
    const contact = this.db.createContact(clinic.id, fields);
    this.events.emit("contact.created", contact);
    return { contact, created: true };
  }

  /** EHR edition: links the contact to an EHR patient by its channel identity only (best effort). */
  async linkToEhr(clinic: Clinic, contact: Contact): Promise<Contact> {
    const backend = this.backends.forClinic(clinic);
    if (contact.external_id || !backend.syncContact) return contact;
    try {
      await backend.syncContact(clinic, contact);
    } catch (err) {
      console.error("[ehr] syncContact failed:", (err as Error).message);
    }
    return this.db.getContact(contact.id)!;
  }

  /** Entry point for every inbound patient message, from any channel. */
  async receive(inbound: InboundMessage): Promise<{ conversation: Conversation; message: Message } | undefined> {
    const clinicId = this.db.clinicForAddress(inbound.channel, inbound.to);
    const clinic = clinicId ? this.db.getClinic(clinicId) : undefined;
    if (!clinic) {
      console.warn(`[inbox] no clinic owns this ${inbound.channel} address; dropping message`);
      return undefined;
    }
    if (inbound.externalId && this.db.messageExists(inbound.channel, inbound.externalId)) return undefined; // webhook retry

    const limit = inbound.channel === "email" ? MAX_EMAIL_CHARS : MAX_CHAT_CHARS;
    const body = inbound.body.length > limit ? `${inbound.body.slice(0, limit)}\n[message shortened]` : inbound.body;
    let { contact } = this.findOrCreateContact(clinic, inbound.channel, inbound.from, inbound.fromName);
    contact = await this.linkToEhr(clinic, contact);
    const conversation = this.db.conversationForContact(contact, inbound.channel);
    const message = this.db.addMessage({
      conversationId: conversation.id, channel: inbound.channel, direction: "in", author: "patient",
      body, subject: inbound.subject?.slice(0, 200) ?? null, status: "received", externalId: inbound.externalId ?? null,
      senderVerified: inbound.senderVerified !== false, simulated: inbound.simulated,
    });
    if (contact.preferred_channel !== inbound.channel) contact = this.db.updateContact(contact.id, { preferred_channel: inbound.channel });
    this.db.updateConversation(conversation.id, { status: "open" });
    this.audit.record({ actorType: "webhook", actor: inbound.channel, clinicId: clinic.id, action: "message.receive", target: `conversation:${conversation.id}`, contactId: contact.id, outcome: "ok", detail: `${body.length} chars${inbound.simulated ? ", test console" : ""}` });
    if (!inbound.simulated) {
      this.backends.ehr?.logCommunication(clinic, contact, { channel: inbound.channel, direction: "in", body, occurredAt: message.created_at })
        .catch((err) => console.error("[ehr] logCommunication failed:", (err as Error).message));
    }

    const handled = this.handleKeywords(clinic, contact, conversation, inbound, body);
    if (!handled) {
      if (!inbound.simulated) this.consents.noteInbound(clinic.id, contact.id, inbound.channel);
      const current = this.db.getConversation(conversation.id)!;
      if (!current.ai_enabled) {
        // A person has taken over this thread: make sure the new message isn't missed.
        this.db.updateConversation(conversation.id, { needs_attention: 1, attention_reason: "New message from the patient (AI is paused here)" });
      } else if ((inbound.channel === "sms" || inbound.channel === "voice") && !this.config.security.allowInternational && !isNanp(contact.phone ?? inbound.from)) {
        this.db.updateConversation(conversation.id, { needs_attention: 1, attention_reason: "Message from a number outside North America: reply manually" });
      } else {
        this.scheduleReply(conversation.id);
      }
    }
    this.events.emit("changed", { clinicId: clinic.id, kind: "message", id: conversation.id });
    return { conversation: this.db.getConversation(conversation.id)!, message };
  }

  /** Opt-outs, opt-ins and reminder confirmations. Returns true when the message needs no AI reply. */
  private handleKeywords(clinic: Clinic, contact: Contact, conversation: Conversation, inbound: InboundMessage, body: string): boolean {
    const intent = detectIntent(body, inbound.channel);
    if (!intent) return false;
    const note = (text: string) => this.db.addMessage({ conversationId: conversation.id, channel: inbound.channel, direction: "out", author: "system", body: text, status: "sent" });
    if (inbound.simulated && intent.kind !== "confirm" && intent.kind !== "change") {
      note("Test console message: consent was not changed.");
      return true;
    }
    switch (intent.kind) {
      case "carrier_stop": {
        // Carriers treat these words as an opt-out and send their own confirmation; we must honour it.
        this.consents.withdraw(clinic.id, contact.id, "sms", `patient texted ${intent.word.toUpperCase()}`, "keyword", "patient");
        this.audit.record({ actorType: "webhook", actor: "sms", clinicId: clinic.id, action: "consent.withdraw", target: "sms", contactId: contact.id, outcome: "ok", detail: "carrier keyword" });
        if (intent.word === "cancel") {
          const next = this.db.contactAppointments(contact.id, true).at(-1);
          const when = next ? ` on ${formatLocal(next.starts_at, clinic.profile.timezone)}` : "";
          this.db.createTask({
            clinicId: clinic.id, contactId: contact.id, conversationId: conversation.id, type: "callback", priority: "urgent",
            title: `Patient texted CANCEL: call them about their appointment${when}`,
            details: "CANCEL is a carrier opt-out word, so texts to this number are now blocked. The patient may have meant to cancel their appointment. Call to check, and ask whether they want texts turned back on (they can text START).",
            createdBy: "system",
          });
          note("Patient texted CANCEL. Texts to this number are now blocked (carrier rule). A call-back task was created in case they meant their appointment.");
          this.db.updateConversation(conversation.id, { needs_attention: 1, attention_reason: "Texted CANCEL: call the patient" });
        } else {
          note("Patient opted out of SMS. No further texts will be sent.");
        }
        return true;
      }
      case "carrier_start": {
        this.consents.record({ clinicId: clinic.id, contactId: contact.id, channel: inbound.channel, purpose: "service", status: "granted", basis: "keyword", source: "patient texted START", by: "patient" });
        note(`Patient opted back in to ${inbound.channel} messages.`);
        return true;
      }
      case "revoke": {
        this.consents.withdraw(clinic.id, contact.id, inbound.channel, "patient asked to stop", "keyword", "patient");
        this.audit.record({ actorType: "webhook", actor: inbound.channel, clinicId: clinic.id, action: "consent.withdraw", target: inbound.channel, contactId: contact.id, outcome: "ok", detail: "patient request" });
        note(`Patient asked to stop ${inbound.channel} messages. Recorded; no further automated or campaign messages on this channel.`);
        // One plain confirmation is allowed and expected (CASL / FCC). Bypasses consent because it confirms the withdrawal.
        void this.deliver(clinic, contact, conversation.id, inbound.channel,
          `You won't get any more messages from ${clinic.profile.name} here. If you change your mind, just send START.`,
          { author: "system", purpose: "reply", bypassConsent: true });
        return true;
      }
      case "confirm": {
        const soon = this.db.contactAppointments(contact.id, true).filter((a) => Date.parse(a.starts_at) - Date.now() < 72 * 3600_000).at(-1);
        if (!soon) return false;
        this.db.confirmAppointment(soon.id);
        void this.deliver(clinic, contact, conversation.id, inbound.channel,
          `Thanks${contact.name ? `, ${contact.name.split(" ")[0]}` : ""}! You're confirmed for ${formatLocal(soon.starts_at, clinic.profile.timezone)}.`,
          { author: "system", purpose: "reply" });
        this.events.emit("changed", { clinicId: clinic.id, kind: "appointment", id: soon.id });
        return true;
      }
      case "change":
        return false; // the receptionist handles rescheduling
    }
  }

  scheduleReply(conversationId: number): void {
    if (this.pending.has(conversationId)) return;
    this.pending.add(conversationId);
    setTimeout(() => {
      this.pending.delete(conversationId);
      this.enqueue(conversationId, () => this.runAi(conversationId));
    }, this.replyDelayMs);
  }

  private enqueue(conversationId: number, work: () => Promise<void>): void {
    const previous = this.queues.get(conversationId) ?? Promise.resolve();
    const next = previous.then(work).catch((err) => console.error(`[inbox] conversation ${conversationId}:`, (err as Error).message));
    this.queues.set(conversationId, next);
    next.finally(() => {
      if (this.queues.get(conversationId) === next) this.queues.delete(conversationId);
    });
  }

  /** Lets the AI answer the latest patient message, if AI is on for this thread and channel. */
  async runAi(conversationId: number): Promise<void> {
    const conversation = this.db.getConversation(conversationId);
    if (!conversation?.ai_enabled) return;
    const clinic = this.db.getClinic(conversation.clinic_id)!;
    const contact = this.db.getContact(conversation.contact_id)!;
    const history = this.db.listMessages(conversationId);
    const lastInbound = [...history].reverse().find((m) => m.direction === "in" && m.author === "patient");
    if (!lastInbound || history.at(-1)?.author !== "patient") return; // already answered
    const channel = lastInbound.channel;
    const mode = clinic.profile.aiModes[channel] ?? "auto";
    if (mode === "off") return;
    const flag = (reason: string) => {
      this.db.updateConversation(conversationId, { needs_attention: 1, attention_reason: reason });
      this.events.emit("changed", { clinicId: clinic.id, kind: "conversation", id: conversationId });
    };

    // PHIPA s.17 / O. Reg. 329/04: no patient text goes to the AI processor until agreements are recorded.
    if (!this.config.demo && !clinic.profile.processorAgreementsRecorded) return flag("AI receptionist is off until processor agreements are recorded (Settings)");

    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    if (this.db.aiTurnsSince(clinic.id, hourAgo, contact.id) >= this.config.anthropic.hourlyTurnsPerContact) {
      return flag("Unusually many messages from this person: AI paused for an hour, please review");
    }
    if (this.db.aiTurnsSince(clinic.id, dayAgo) >= this.config.anthropic.dailyTurnsPerClinic) {
      const key = `${clinic.id}:${dayAgo.slice(0, 10)}`;
      if (!this.budgetWarned.has(key)) {
        this.budgetWarned.add(key);
        this.db.createTask({ clinicId: clinic.id, type: "other", priority: "urgent", title: "AI receptionist daily limit reached: new messages need a staff reply", createdBy: "system" });
      }
      return flag("AI daily limit reached: please reply");
    }
    this.db.recordAiTurn(clinic.id, contact.id);

    const ctx = {
      db: this.db, events: this.events, backend: this.backends.forClinic(clinic), clinic, contact, conversation,
      channel, actor: `ai:${channel}`,
      // Email "From" can be forged; only DMARC/SPF/DKIM-verified senders may see or change appointments.
      identityVerified: lastInbound.sender_verified === 1,
      verificationScope: `conv:${conversationId}`,
      sendCode: async (code: string) => {
        const current = this.db.getContact(contact.id)!;
        const text = `${code} is your ${clinic.profile.name} verification code. It expires in 10 minutes.`;
        for (const ch of [channel, "sms", "email"] as Channel[]) {
          if (!reachableChannels(current).includes(ch) || !this.consents.check(current.id, ch, "reply").ok) continue;
          const m = await this.deliver(clinic, current, conversationId, ch, text, { author: "system", purpose: "reply", recordAs: "Verification code sent." });
          if (m.status !== "failed") return ch === "email" ? "email address" : "phone number";
        }
        return undefined;
      },
    };
    const reply = await this.responder.reply(ctx, history);
    if (!reply.text) return;
    const subject = channel === "email" ? replySubject(lastInbound.subject) : undefined;
    const wording = wordingProblems(reply.text, enabledWordingRules(clinic));
    if (mode === "draft" || wording.length) {
      this.db.addMessage({ conversationId, channel, direction: "out", author: "ai", body: reply.text, subject, status: "draft", purpose: "reply" });
      flag(wording.length ? `AI reply held for review: it used ${wording.join(", ")}` : conversation.attention_reason ?? "AI draft waiting for approval");
      return;
    }
    await this.deliver(clinic, this.db.getContact(contact.id)!, conversationId, channel, reply.text, { author: "ai", subject, purpose: "reply" });
  }

  /**
   * Sends a message and records it in the thread. Applies, in order: consent for the purpose, the wording
   * check (all messages), the privacy check (messages the clinic starts), and per-person SMS limits.
   * Failures are recorded on the message and flagged for staff, not thrown (except for staff, see staffReply).
   */
  async deliver(clinic: Clinic, contact: Contact, conversationId: number, channel: Channel, body: string,
    opts: { author: MessageAuthor; authorName?: string; subject?: string; purpose: SendPurpose; staffUserId?: number; bypassConsent?: boolean; recordAs?: string }): Promise<Message> {
    const problem = this.sendProblem(clinic, contact, conversationId, channel, body, opts);
    const message = this.db.addMessage({
      conversationId, channel, direction: "out", author: opts.author, authorName: opts.authorName ?? null,
      // recordAs keeps secrets (like one-time codes) out of the stored thread.
      body: opts.recordAs ?? body, subject: opts.subject ?? null, status: problem ? "failed" : "sent", purpose: opts.purpose, staffUserId: opts.staffUserId,
    });
    if (problem) {
      this.db.updateMessage(message.id, { error: problem });
      this.db.updateConversation(conversationId, { needs_attention: 1, attention_reason: `Message not sent: ${problem}` });
    } else {
      try {
        const result = await this.channels.send(clinic, contact, channel, body, { subject: opts.subject, purpose: opts.purpose === "reply" ? "service" : opts.purpose });
        this.db.updateMessage(message.id, { status: result.status, external_id: result.externalId ?? null });
        this.backends.ehr?.logCommunication(clinic, contact, { channel, direction: "out", body, occurredAt: message.created_at })
          .catch((err) => console.error("[ehr] logCommunication failed:", (err as Error).message));
      } catch (err) {
        const error = err instanceof ChannelError ? err.message : `Send failed: ${(err as Error).message}`;
        this.db.updateMessage(message.id, { status: "failed", error });
        this.db.updateConversation(conversationId, { needs_attention: 1, attention_reason: `Message not delivered: ${error}` });
      }
    }
    this.events.emit("changed", { clinicId: clinic.id, kind: "message", id: conversationId });
    return this.db.getMessage(message.id)!;
  }

  /** Why a message may not be sent, or undefined when it may. */
  sendProblem(clinic: Clinic, contact: Contact, conversationId: number, channel: Channel, body: string,
    opts: { purpose: SendPurpose; bypassConsent?: boolean }): string | undefined {
    if (!opts.bypassConsent) {
      const consent = this.consents.check(contact.id, channel, opts.purpose);
      if (!consent.ok) return consent.reason;
    }
    const wording = wordingProblems(body, enabledWordingRules(clinic));
    if (wording.length) return `It uses wording the clinic doesn't allow: ${wording.join(", ")}`;
    if (opts.purpose !== "reply") {
      const privacy = privacyProblems(body, channel, clinic);
      if (privacy.length) return `It names health details on ${channel} (${privacy.join(", ")}). Keep reminders to name, date and time.`;
      if (SESSION_CHANNELS.includes(channel) && !this.withinWindow(conversationId, channel)) {
        return `${channel === "whatsapp" ? "WhatsApp" : "Meta"}'s 24-hour window is closed; an approved template is needed`;
      }
    }
    if (channel === "sms") {
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      if (this.db.countOutboundSince(contact.id, "sms", hourAgo) >= this.config.sms.maxPerContactPerHour) return "Too many texts to this person in the last hour";
      if (!this.config.security.allowInternational && contact.phone && !isNanp(contact.phone)) return "Texts outside North America are switched off";
    }
    return undefined;
  }

  /** A staff member replies from the inbox. Pauses the AI on that thread unless told otherwise. */
  async staffReply(conversationId: number, body: string, opts: { staffName: string; staffUserId: number; channel?: Channel; subject?: string; keepAiOn?: boolean }): Promise<Message> {
    const conversation = this.db.getConversation(conversationId);
    if (!conversation) throw new ChannelError("Conversation not found");
    const clinic = this.db.getClinic(conversation.clinic_id)!;
    const contact = this.db.getContact(conversation.contact_id)!;
    const channel = opts.channel ?? conversation.last_channel;
    if (channel === "voice" || !reachableChannels(contact).includes(channel)) throw new ChannelError("This patient can't be reached on that channel");
    // An answer to something the patient wrote on this channel is a reply; anything else needs reminder-level consent.
    const purpose: SendPurpose = this.db.lastInboundAt(conversationId, channel) ? "reply" : "service";
    const problem = this.sendProblem(clinic, contact, conversationId, channel, body, { purpose });
    if (problem) throw new ChannelError(problem);
    this.db.updateConversation(conversationId, {
      needs_attention: 0, attention_reason: null, unread: 0,
      ai_enabled: opts.keepAiOn ? conversation.ai_enabled : 0, paused_by: opts.keepAiOn ? conversation.paused_by : opts.staffName,
    });
    const lastSubject = this.db.listMessages(conversationId).reverse().find((m) => m.subject)?.subject;
    return this.deliver(clinic, contact, conversationId, channel, body, {
      author: "staff", authorName: opts.staffName, staffUserId: opts.staffUserId, purpose,
      subject: opts.subject ?? (channel === "email" ? replySubject(lastSubject) : undefined),
    });
  }

  /** Staff approve (optionally edit) an AI draft, which then sends to the address the patient wrote from. */
  async approveDraft(messageId: number, staff: { name: string; id: number }, editedBody?: string): Promise<Message> {
    const draft = this.db.getMessage(messageId);
    if (!draft || draft.status !== "draft") throw new ChannelError("Draft not found");
    const conversation = this.db.getConversation(draft.conversation_id)!;
    const clinic = this.db.getClinic(conversation.clinic_id)!;
    const contact = this.db.getContact(conversation.contact_id)!;
    const text = editedBody?.trim() || draft.body;
    const problem = this.sendProblem(clinic, contact, conversation.id, draft.channel, text, { purpose: "reply" });
    if (problem) throw new ChannelError(problem);
    this.db.deleteMessage(draft.id);
    this.db.updateConversation(conversation.id, { needs_attention: 0, attention_reason: null, unread: 0 });
    const edited = editedBody !== undefined && editedBody.trim() !== draft.body.trim();
    return this.deliver(clinic, contact, conversation.id, draft.channel, text, {
      author: edited ? "staff" : "ai", authorName: edited ? staff.name : `Approved by ${staff.name}`, staffUserId: staff.id,
      subject: draft.subject ?? undefined, purpose: "reply",
    });
  }

  private withinWindow(conversationId: number, channel: Channel): boolean {
    const last = this.db.lastInboundAt(conversationId, channel);
    return !!last && Date.now() - Date.parse(last) < WINDOW_MS;
  }

  /**
   * Outbound message from an automation or campaign. Picks the patient's preferred channel among those
   * with consent for this purpose; never falls back to a channel the patient didn't agree to.
   */
  async sendToContact(clinic: Clinic, contact: Contact, channelPref: Channel | "preferred", body: (channel: Channel) => string,
    opts: { authorName: string; subject?: string; purpose: "service" | "marketing"; staffUserId?: number }): Promise<SendOutcome> {
    const reachable = reachableChannels(contact);
    const order = channelPref === "preferred"
      ? [contact.preferred_channel === "voice" ? "sms" : contact.preferred_channel, ...reachable].filter((c, i, a): c is Channel => !!c && a.indexOf(c) === i && reachable.includes(c as Channel))
      : reachable.includes(channelPref) ? [channelPref] : [];
    if (!order.length) return { skipped: "Patient has no address on that channel" };
    const conversation = this.db.conversationForContact(contact, order[0]);
    let lastReason = "No channel with consent";
    for (const channel of order) {
      const text = body(channel);
      const problem = this.sendProblem(clinic, contact, conversation.id, channel, text, { purpose: opts.purpose });
      if (problem) {
        lastReason = problem;
        continue;
      }
      const message = await this.deliver(clinic, contact, conversation.id, channel, text, {
        author: opts.staffUserId ? "staff" : "ai", authorName: opts.authorName, subject: opts.subject, purpose: opts.purpose, staffUserId: opts.staffUserId,
      });
      return { message };
    }
    return { skipped: lastReason };
  }
}

function replySubject(subject: string | null | undefined): string {
  if (!subject) return "Re: your message";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}
