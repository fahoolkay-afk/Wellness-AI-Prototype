import type { Backends } from "./booking/index.ts";
import { ChannelError, pickChannel, type Channels } from "./channels/index.ts";
import { optOutKeyword } from "./channels/sms.ts";
import { Db, normalizePhone } from "./db.ts";
import type { Events } from "./events.ts";
import type { Responder } from "./ai/receptionist.ts";
import type { Channel, Clinic, Contact, Conversation, InboundMessage, Message, MessageAuthor } from "./types.ts";

export interface InboxOptions {
  /** Wait this long after an inbound message so a burst of texts gets one reply. */
  replyDelayMs?: number;
}

export class Inbox {
  private readonly db: Db;
  private readonly channels: Channels;
  private readonly backends: Backends;
  private readonly events: Events;
  private readonly responder: Responder;
  private readonly replyDelayMs: number;
  /** Per-conversation queue so AI turns for one patient never overlap. */
  private readonly queues = new Map<number, Promise<void>>();
  private readonly pending = new Set<number>();

  constructor(db: Db, channels: Channels, backends: Backends, events: Events, responder: Responder, opts: InboxOptions = {}) {
    this.db = db;
    this.channels = channels;
    this.backends = backends;
    this.events = events;
    this.responder = responder;
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
      // Fill in identities learned on a new channel (e.g. a WhatsApp user is also reachable by SMS).
      const updates: Partial<Contact> = {};
      const column = Db.identityColumn(channel);
      if (!existing[column]) (updates as Record<string, string>)[column] = normalized;
      if (channel === "whatsapp" && !existing.phone) updates.phone = normalizePhone(address);
      if (!existing.name && name) updates.name = name;
      return { contact: Object.keys(updates).length ? this.db.updateContact(existing.id, updates) : existing, created: false };
    }
    const fields: Partial<Contact> = { name: name ?? null, preferred_channel: channel === "voice" ? "sms" : channel };
    (fields as Record<string, string>)[Db.identityColumn(channel)] = normalized;
    if (channel === "whatsapp") fields.phone = normalizePhone(address);
    const contact = this.db.createContact(clinic.id, fields);
    this.events.emit("contact.created", contact);
    return { contact, created: true };
  }

  /** EHR edition: makes sure the contact is linked to an EHR patient (best effort). */
  async linkToEhr(clinic: Clinic, contact: Contact): Promise<Contact> {
    const backend = this.backends.forClinic(clinic);
    if (contact.external_id || !backend.syncContact) return contact;
    try {
      await backend.syncContact(clinic, contact);
    } catch (err) {
      console.error("[ehr] syncContact", err);
    }
    return this.db.getContact(contact.id)!;
  }

  /** Entry point for every inbound patient message, from any channel. */
  async receive(inbound: InboundMessage): Promise<{ conversation: Conversation; message: Message } | undefined> {
    const clinicId = this.db.clinicForAddress(inbound.channel, inbound.to);
    const clinic = clinicId ? this.db.getClinic(clinicId) : undefined;
    if (!clinic) {
      console.warn(`[inbox] no clinic owns ${inbound.channel} address ${inbound.to}; dropping message`);
      return undefined;
    }
    if (inbound.externalId && this.db.messageExists(inbound.channel, inbound.externalId)) return undefined; // webhook retry

    let { contact } = this.findOrCreateContact(clinic, inbound.channel, inbound.from, inbound.fromName);
    contact = await this.linkToEhr(clinic, contact);
    const conversation = this.db.conversationForContact(contact, inbound.channel);
    const message = this.db.addMessage({
      conversationId: conversation.id, channel: inbound.channel, direction: "in", author: "patient",
      body: inbound.body, subject: inbound.subject ?? null, status: "received", externalId: inbound.externalId ?? null,
    });
    if (contact.preferred_channel !== inbound.channel) contact = this.db.updateContact(contact.id, { preferred_channel: inbound.channel });
    this.db.updateConversation(conversation.id, { status: "open" });
    this.events.emit("changed", { clinicId: clinic.id, kind: "message", id: conversation.id });
    this.backends.ehr?.logCommunication(clinic, contact, { channel: inbound.channel, direction: "in", body: inbound.body, occurredAt: message.created_at })
      .catch((err) => console.error("[ehr] logCommunication", err));

    if (inbound.channel === "sms") {
      const keyword = optOutKeyword(inbound.body);
      if (keyword) {
        // The carrier sends the legally required confirmation; we just record consent.
        this.db.updateContact(contact.id, { opted_out: keyword === "stop" ? 1 : 0 });
        this.db.addMessage({
          conversationId: conversation.id, channel: "sms", direction: "out", author: "system",
          body: keyword === "stop" ? "Patient opted out of SMS. No further texts will be sent." : "Patient opted back in to SMS.", status: "sent",
        });
        return { conversation: this.db.getConversation(conversation.id)!, message };
      }
    }

    this.scheduleReply(conversation.id);
    return { conversation: this.db.getConversation(conversation.id)!, message };
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
    const next = previous.then(work).catch((err) => console.error(`[inbox] conversation ${conversationId}`, err));
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

    const ctx = {
      db: this.db, events: this.events, backend: this.backends.forClinic(clinic), clinic, contact, conversation,
      channel, actor: `ai:${channel}`,
    };
    const reply = await this.responder.reply(ctx, history);
    if (!reply.text) return;
    const subject = channel === "email" ? replySubject(lastInbound.subject) : undefined;
    if (mode === "draft") {
      this.db.addMessage({ conversationId, channel, direction: "out", author: "ai", body: reply.text, subject, status: "draft" });
      this.db.updateConversation(conversationId, { needs_attention: 1, attention_reason: conversation.attention_reason ?? "AI draft waiting for approval" });
      this.events.emit("changed", { clinicId: clinic.id, kind: "message", id: conversationId });
      return;
    }
    await this.deliver(clinic, ctx.contact, conversationId, channel, reply.text, { author: "ai", subject });
  }

  /** Sends a message and records it in the thread, marking it failed (not thrown) on channel errors. */
  async deliver(clinic: Clinic, contact: Contact, conversationId: number, channel: Channel, body: string,
    opts: { author: MessageAuthor; authorName?: string; subject?: string }): Promise<Message> {
    const message = this.db.addMessage({
      conversationId, channel, direction: "out", author: opts.author, authorName: opts.authorName ?? null,
      body, subject: opts.subject ?? null, status: "sent",
    });
    try {
      const result = await this.channels.send(clinic, contact, channel, body, opts.subject);
      this.db.updateMessage(message.id, { status: result.status, external_id: result.externalId ?? null });
      this.backends.ehr?.logCommunication(clinic, contact, { channel, direction: "out", body, occurredAt: message.created_at })
        .catch((err) => console.error("[ehr] logCommunication", err));
    } catch (err) {
      const error = err instanceof ChannelError ? err.message : `Send failed: ${(err as Error).message}`;
      this.db.updateMessage(message.id, { status: "failed", error });
      this.db.updateConversation(conversationId, { needs_attention: 1, attention_reason: `Message not delivered: ${error}` });
    }
    this.events.emit("changed", { clinicId: clinic.id, kind: "message", id: conversationId });
    return this.db.getMessage(message.id)!;
  }

  /** A staff member replies from the inbox. Pauses the AI on that thread unless told otherwise. */
  async staffReply(conversationId: number, body: string, opts: { staffName: string; channel?: Channel; subject?: string; keepAiOn?: boolean }): Promise<Message> {
    const conversation = this.db.getConversation(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    const clinic = this.db.getClinic(conversation.clinic_id)!;
    const contact = this.db.getContact(conversation.contact_id)!;
    const channel = pickChannel(contact, opts.channel ?? conversation.last_channel);
    if (!channel) throw new ChannelError("This contact can't be reached on that channel");
    this.db.updateConversation(conversationId, {
      needs_attention: 0, attention_reason: null, unread: 0, ai_enabled: opts.keepAiOn ? conversation.ai_enabled : 0,
    });
    const lastSubject = this.db.listMessages(conversationId).reverse().find((m) => m.subject)?.subject;
    return this.deliver(clinic, contact, conversationId, channel, body, {
      author: "staff", authorName: opts.staffName, subject: opts.subject ?? (channel === "email" ? replySubject(lastSubject) : undefined),
    });
  }

  /** Staff approve (optionally edit) an AI draft, which then sends. */
  async approveDraft(messageId: number, staffName: string, editedBody?: string): Promise<Message> {
    const draft = this.db.getMessage(messageId);
    if (!draft || draft.status !== "draft") throw new Error("Draft not found");
    const conversation = this.db.getConversation(draft.conversation_id)!;
    const clinic = this.db.getClinic(conversation.clinic_id)!;
    const contact = this.db.getContact(conversation.contact_id)!;
    this.db.deleteMessage(draft.id);
    this.db.updateConversation(conversation.id, { needs_attention: 0, attention_reason: null, unread: 0 });
    const edited = editedBody !== undefined && editedBody.trim() !== draft.body.trim();
    return this.deliver(clinic, contact, conversation.id, draft.channel, editedBody?.trim() || draft.body, {
      author: edited ? "staff" : "ai", authorName: edited ? staffName : `Approved by ${staffName}`, subject: draft.subject ?? undefined,
    });
  }

  private withinWindow(conversationId: number, channel: Channel): boolean {
    const last = this.db.lastInboundAt(conversationId, channel);
    return !!last && Date.now() - Date.parse(last) < WINDOW_MS;
  }

  /** Outbound message from an automation or broadcast; opens a thread if the patient has none. */
  async sendToContact(clinic: Clinic, contact: Contact, channelPref: Channel | "preferred", body: string,
    opts: { authorName: string; subject?: string }): Promise<Message | undefined> {
    let channel = pickChannel(contact, channelPref);
    if (!channel) return undefined;
    const conversation = this.db.conversationForContact(contact, channel);
    if (SESSION_CHANNELS.includes(channel) && !this.withinWindow(conversation.id, channel)) {
      // Meta only allows free-form business messages within 24h of the patient's last message.
      // Fall back to SMS or email rather than send something that will be rejected.
      channel = (["sms", "email"] as const).find((c) => pickChannel(contact, c) && !(c === "sms" && contact.opted_out)) ?? channel;
    }
    if (channel === "sms" && contact.opted_out) return undefined;
    return this.deliver(clinic, contact, conversation.id, channel, body, { author: "ai", authorName: opts.authorName, subject: opts.subject });
  }
}

/** Channels where Meta enforces a 24-hour customer-service window. */
const SESSION_CHANNELS: Channel[] = ["whatsapp", "messenger", "instagram"];
const WINDOW_MS = 24 * 3600_000;

function replySubject(subject: string | null | undefined): string {
  if (!subject) return "Re: your message";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}
