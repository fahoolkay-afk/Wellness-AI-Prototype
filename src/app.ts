import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { addTag } from "./automations.ts";
import { serviceOf } from "./booking/backend.ts";
import { verifyEhrSignature, type EhrAppointment } from "./booking/ehr.ts";
import { ChannelError, reachableChannels } from "./channels/index.ts";
import { parseEmailInbound } from "./channels/email.ts";
import { parseMetaWebhook, verifyMetaSignature } from "./channels/meta.ts";
import { parseTelnyxInbound, parseTwilioInbound, verifyTelnyxSignature, verifyTwilioSignature } from "./channels/sms.ts";
import { verifyElevenLabsSignature } from "./channels/voice.ts";
import { clearCookie, currentSession, issueSession, passwordMatches, requireStaff, sessionCookie, type Session } from "./auth.ts";
import { normalizePhone, parseTags } from "./db.ts";
import type { Services } from "./services.ts";
import { addDays, localDate, parseLocalDateTime, zonedToUtc } from "./time.ts";
import { CHANNELS, STAGES, type Channel, type ClinicProfile, type Contact, type Stage } from "./types.ts";

type RawRequest = Request & { rawBody?: Buffer };

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Webhook signature gate. With a secret configured the signature must verify.
 * Without one, webhooks are accepted only outside production (local demos).
 */
function gate(secret: string, verify: () => boolean): void {
  if (secret) {
    if (!verify()) throw new HttpError(403, "Invalid signature");
  } else if (isProduction()) {
    throw new HttpError(503, "Webhook secret not configured");
  }
}

export function createApp(s: Services): express.Express {
  const { db, inbox, config, events } = s;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  const keepRaw = (req: Request, _res: Response, buf: Buffer) => {
    (req as RawRequest).rawBody = buf;
  };
  app.use(express.json({ limit: "2mb", verify: keepRaw }));
  app.use(express.urlencoded({ extended: false, verify: keepRaw }));

  const num = (v: unknown) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid id");
    return n;
  };
  const clinicOr404 = (id: unknown) => {
    const clinic = db.getClinic(num(id));
    if (!clinic) throw new HttpError(404, "Clinic not found");
    return clinic;
  };
  const changed = (clinicId: number, kind: string, id?: number) => events.emit("changed", { clinicId, kind, id });

  // ---------------------------------------------------------------- webhooks

  app.post("/webhooks/twilio/sms", async (req, res) => {
    const params = req.body as Record<string, string>;
    gate(config.sms.twilioAuthToken, () => verifyTwilioSignature(
      config.sms.twilioAuthToken, `${config.publicUrl.replace(/\/$/, "")}${req.originalUrl}`, params, req.get("x-twilio-signature"),
    ));
    const inbound = parseTwilioInbound(params);
    if (inbound) await inbox.receive(inbound);
    res.type("text/xml").send("<Response></Response>");
  });

  app.post("/webhooks/telnyx/sms", async (req, res) => {
    gate(config.sms.telnyxPublicKey, () => verifyTelnyxSignature(
      config.sms.telnyxPublicKey, (req as RawRequest).rawBody ?? Buffer.alloc(0), req.get("telnyx-signature-ed25519"), req.get("telnyx-timestamp"),
    ));
    const inbound = parseTelnyxInbound(req.body);
    if (inbound) await inbox.receive(inbound);
    res.sendStatus(200);
  });

  // Meta webhook verification handshake (WhatsApp, Messenger, Instagram).
  app.get("/webhooks/meta", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === config.meta.verifyToken) {
      res.type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
    } else {
      res.sendStatus(403);
    }
  });

  app.post("/webhooks/meta", async (req, res) => {
    gate(config.meta.appSecret, () => verifyMetaSignature(config.meta.appSecret, (req as RawRequest).rawBody ?? Buffer.alloc(0), req.get("x-hub-signature-256")));
    for (const inbound of parseMetaWebhook(req.body)) await inbox.receive(inbound);
    res.sendStatus(200);
  });

  app.post("/webhooks/email", async (req, res) => {
    gate(config.email.inboundSecret, () => req.query.secret === config.email.inboundSecret || req.get("x-inbound-secret") === config.email.inboundSecret);
    const inbound = parseEmailInbound(req.body);
    if (inbound) await inbox.receive(inbound);
    res.sendStatus(200);
  });

  const toolSecretOk = (req: Request) => req.get("x-tool-secret") === config.elevenlabs.toolSecret;

  app.post("/webhooks/elevenlabs/init", (req, res) => {
    gate(config.elevenlabs.toolSecret, () => toolSecretOk(req));
    res.json(s.voice.initiation(req.body ?? {}));
  });

  app.post("/webhooks/elevenlabs/tools/:name", async (req, res) => {
    gate(config.elevenlabs.toolSecret, () => toolSecretOk(req));
    const outcome = await s.voice.tool(String(req.params.name), req.body ?? {});
    res.json({ result: outcome.result, error: outcome.isError ?? false });
  });

  app.post("/webhooks/elevenlabs/post-call", (req, res) => {
    gate(config.elevenlabs.webhookSecret, () => verifyElevenLabsSignature(
      config.elevenlabs.webhookSecret, (req as RawRequest).rawBody ?? Buffer.alloc(0), req.get("elevenlabs-signature"),
    ));
    s.voice.postCall(req.body ?? {});
    res.sendStatus(200);
  });

  // EHR-connected edition: the EHRM pushes appointment changes made on its side.
  app.post("/webhooks/ehr", (req, res) => {
    if (!s.backends.ehr) throw new HttpError(404, "EHR edition not enabled");
    gate(config.ehr.webhookSecret, () => verifyEhrSignature(config.ehr.webhookSecret, (req as RawRequest).rawBody ?? Buffer.alloc(0), req.get("x-ehr-signature")));
    const event = req.body as { type?: string; locationId?: string; appointment?: EhrAppointment; patient?: { id: string; firstName?: string; lastName?: string; phone?: string; email?: string } };
    const clinic = db.listClinics().find((c) => (c.profile.ehrLocationId ?? String(c.id)) === event.locationId);
    if (!clinic) throw new HttpError(404, "Unknown locationId");
    if (event.type?.startsWith("appointment.") && event.appointment) {
      const a = event.appointment;
      let contact = db.findContactByExternalId(clinic.id, a.patientId);
      if (!contact && event.patient) {
        contact = db.createContact(clinic.id, {
          name: [event.patient.firstName, event.patient.lastName].filter(Boolean).join(" ") || null,
          phone: event.patient.phone ? normalizePhone(event.patient.phone) : null, email: event.patient.email ?? null,
          external_id: a.patientId, stage: "booked", preferred_channel: event.patient.phone ? "sms" : "email",
        });
      }
      if (!contact) throw new HttpError(422, "Unknown patient; include `patient` in the event");
      const before = db.findAppointmentByExternalRef(clinic.id, a.id);
      const appt = s.backends.ehr.mirror(clinic, a, contact.id, "ehr");
      if (!before && appt.status === "booked") events.emit("appointment.booked", appt);
      if (before?.status === "booked" && appt.status === "cancelled") events.emit("appointment.cancelled", appt);
      changed(clinic.id, "appointment", appt.id);
    } else if (event.type === "patient.updated" && event.patient) {
      const contact = db.findContactByExternalId(clinic.id, event.patient.id);
      if (contact) {
        db.updateContact(contact.id, {
          name: [event.patient.firstName, event.patient.lastName].filter(Boolean).join(" ") || undefined,
          phone: event.patient.phone ? normalizePhone(event.patient.phone) : undefined, email: event.patient.email ?? undefined,
        });
        changed(clinic.id, "contact", contact.id);
      }
    }
    res.json({ ok: true });
  });

  // -------------------------------------------------------------- staff auth

  app.post("/api/login", (req, res) => {
    if (!passwordMatches(config.staffPassword, req.body?.password)) throw new HttpError(401, "Wrong password");
    const name = String(req.body?.name ?? "").trim().slice(0, 60) || "Front desk";
    res.setHeader("set-cookie", sessionCookie(issueSession(config.sessionSecret, name), req.secure));
    res.json({ name });
  });

  app.post("/api/logout", (_req, res) => {
    res.setHeader("set-cookie", clearCookie);
    res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => {
    const session = currentSession(config.sessionSecret, req);
    res.json(session ? { name: session.name, edition: config.edition, responder: inbox.responderName } : null);
  });

  const api = express.Router();
  api.use(requireStaff(config.sessionSecret));
  const staffName = (res: Response) => (res.locals.staff as Session).name;

  // Live updates for the staff UI (Server-Sent Events).
  api.get("/events", (req, res) => {
    const clinicId = Number(req.query.clinic);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write("retry: 3000\n\n");
    const off = events.on("changed", (e) => {
      if (!clinicId || e.clinicId === clinicId) res.write(`data: ${JSON.stringify(e)}\n\n`);
    });
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      off();
      clearInterval(ping);
    });
  });

  api.get("/clinics", (_req, res) => {
    res.json(db.listClinics().map((c) => ({ id: c.id, name: c.name })));
  });

  api.get("/clinics/:cid", (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    res.json({
      ...clinic, edition: config.edition, responder: inbox.responderName,
      channels: s.channels.status(), accounts: db.listChannelAccounts(clinic.id), stages: STAGES,
    });
  });

  api.put("/clinics/:cid/profile", (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const profile = req.body as ClinicProfile;
    if (!profile?.name || !profile.timezone || !Array.isArray(profile.services) || !Array.isArray(profile.practitioners) || !Array.isArray(profile.automations)) {
      throw new HttpError(400, "Profile needs name, timezone, services, practitioners and automations");
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: profile.timezone });
    } catch {
      throw new HttpError(400, `Unknown timezone ${profile.timezone}`);
    }
    db.updateClinicProfile(clinic.id, profile);
    changed(clinic.id, "clinic");
    res.json(db.getClinic(clinic.id));
  });

  api.get("/clinics/:cid/stats", (req, res) => {
    res.json(db.stats(clinicOr404(req.params.cid).id));
  });

  api.get("/clinics/:cid/conversations", (req, res) => {
    const filter = (["all", "attention", "unread"] as const).find((f) => f === req.query.filter) ?? "all";
    res.json(db.listConversations(clinicOr404(req.params.cid).id, filter));
  });

  const conversationOr404 = (id: unknown) => {
    const conversation = db.getConversation(num(id));
    if (!conversation) throw new HttpError(404, "Conversation not found");
    return conversation;
  };

  api.get("/conversations/:id", (req, res) => {
    const conversation = conversationOr404(req.params.id);
    const contact = db.getContact(conversation.contact_id)!;
    res.json({
      conversation, contact: { ...contact, tags: parseTags(contact) }, reachable: reachableChannels(contact),
      messages: db.listMessages(conversation.id),
      appointments: db.contactAppointments(contact.id),
      tasks: db.listTasks(conversation.clinic_id, "all", contact.id),
    });
  });

  api.post("/conversations/:id/read", (req, res) => {
    const conversation = conversationOr404(req.params.id);
    db.updateConversation(conversation.id, { unread: 0 });
    changed(conversation.clinic_id, "conversation", conversation.id);
    res.json({ ok: true });
  });

  api.post("/conversations/:id/reply", async (req, res) => {
    const conversation = conversationOr404(req.params.id);
    const body = String(req.body?.body ?? "").trim();
    if (!body) throw new HttpError(400, "Message is empty");
    const channel = CHANNELS.find((c) => c === req.body?.channel);
    const message = await inbox.staffReply(conversation.id, body, {
      staffName: staffName(res), channel, subject: req.body?.subject, keepAiOn: !!req.body?.keepAiOn,
    });
    res.json(message);
  });

  api.post("/conversations/:id/ai", (req, res) => {
    const conversation = conversationOr404(req.params.id);
    const enabled = !!req.body?.enabled;
    db.updateConversation(conversation.id, { ai_enabled: enabled ? 1 : 0, ...(enabled ? { needs_attention: 0, attention_reason: null } : {}) });
    changed(conversation.clinic_id, "conversation", conversation.id);
    // Turning the AI back on answers any patient message still waiting.
    if (enabled) inbox.scheduleReply(conversation.id);
    res.json(db.getConversation(conversation.id));
  });

  api.post("/conversations/:id/resolve", (req, res) => {
    const conversation = conversationOr404(req.params.id);
    db.updateConversation(conversation.id, { needs_attention: 0, attention_reason: null, unread: 0 });
    changed(conversation.clinic_id, "conversation", conversation.id);
    res.json(db.getConversation(conversation.id));
  });

  api.post("/messages/:id/approve", async (req, res) => {
    res.json(await inbox.approveDraft(num(req.params.id), staffName(res), req.body?.body));
  });

  api.post("/messages/:id/discard", (req, res) => {
    const message = db.getMessage(num(req.params.id));
    if (!message || message.status !== "draft") throw new HttpError(404, "Draft not found");
    db.deleteMessage(message.id);
    const conversation = db.getConversation(message.conversation_id)!;
    changed(conversation.clinic_id, "message", conversation.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- CRM

  const contactFields = (body: Record<string, unknown>): Partial<Contact> => {
    const out: Partial<Contact> = {};
    if (typeof body.name === "string") out.name = body.name.trim() || null;
    if (typeof body.email === "string") out.email = body.email.trim().toLowerCase() || null;
    if (typeof body.phone === "string") out.phone = body.phone.trim() ? normalizePhone(body.phone) : null;
    if (typeof body.notes === "string") out.notes = body.notes;
    if (typeof body.stage === "string") {
      if (!STAGES.includes(body.stage as Stage)) throw new HttpError(400, "Unknown stage");
      out.stage = body.stage as Stage;
    }
    return out;
  };

  api.get("/clinics/:cid/contacts", (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const contacts = db.listContacts(clinic.id, {
      search: req.query.search ? String(req.query.search) : undefined,
      tag: req.query.tag ? String(req.query.tag) : undefined,
      stage: STAGES.find((st) => st === req.query.stage),
    });
    res.json(contacts.map((c) => ({ ...c, tags: parseTags(c) })));
  });

  api.post("/clinics/:cid/contacts", (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const fields = contactFields(req.body ?? {});
    if (!fields.name && !fields.phone && !fields.email) throw new HttpError(400, "Name, phone or email is required");
    const contact = db.createContact(clinic.id, { ...fields, preferred_channel: fields.phone ? "sms" : fields.email ? "email" : null });
    events.emit("contact.created", contact);
    changed(clinic.id, "contact", contact.id);
    res.status(201).json(contact);
  });

  api.patch("/contacts/:id", (req, res) => {
    let contact = db.getContact(num(req.params.id));
    if (!contact) throw new HttpError(404, "Contact not found");
    contact = db.updateContact(contact.id, contactFields(req.body ?? {}));
    if (Array.isArray(req.body?.tags)) {
      const wanted = [...new Set((req.body.tags as unknown[]).map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
      const before = parseTags(contact);
      contact = db.updateContact(contact.id, { tags: JSON.stringify(before.filter((t) => wanted.includes(t))) });
      for (const tag of wanted.filter((t) => !before.includes(t))) contact = addTag(db, events, contact, tag);
    }
    changed(contact.clinic_id, "contact", contact.id);
    res.json({ ...contact, tags: parseTags(contact) });
  });

  /** Opens (or returns) the thread for a contact so staff can message them first. */
  api.post("/contacts/:id/conversation", (req, res) => {
    const contact = db.getContact(num(req.params.id));
    if (!contact) throw new HttpError(404, "Contact not found");
    const channel = reachableChannels(contact)[0];
    if (!channel) throw new HttpError(400, "Contact has no phone, email or social account");
    res.json(db.conversationForContact(contact, channel));
  });

  api.get("/clinics/:cid/pipeline", (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const contacts = db.listContacts(clinic.id);
    res.json(Object.fromEntries(STAGES.map((stage) => [stage, contacts.filter((c) => c.stage === stage).map((c) => ({ ...c, tags: parseTags(c) }))])));
  });

  // ------------------------------------------------------------ calendar

  api.get("/clinics/:cid/appointments", (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const tz = clinic.profile.timezone;
    const from = String(req.query.from ?? localDate(new Date(), tz));
    const days = Math.min(Number(req.query.days ?? 7), 62);
    res.json(db.listAppointments(clinic.id, zonedToUtc(from, "00:00", tz).toISOString(), zonedToUtc(addDays(from, days), "00:00", tz).toISOString()));
  });

  api.get("/clinics/:cid/slots", async (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const serviceId = String(req.query.service ?? "");
    if (!serviceOf(clinic, serviceId)) throw new HttpError(400, "Unknown service");
    res.json(await s.backends.forClinic(clinic).findSlots(clinic, {
      serviceId, dateFrom: String(req.query.from ?? localDate(new Date(), clinic.profile.timezone)),
      practitionerId: req.query.practitioner ? String(req.query.practitioner) : undefined, limit: 30,
    }));
  });

  api.post("/clinics/:cid/appointments", async (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const contact = db.getContact(num(req.body?.contactId));
    if (!contact || contact.clinic_id !== clinic.id) throw new HttpError(400, "Unknown contact");
    const start = parseLocalDateTime(String(req.body?.start ?? ""), clinic.profile.timezone);
    if (!start) throw new HttpError(400, "Invalid start");
    const result = await s.backends.forClinic(clinic).book(clinic, {
      contact, serviceId: String(req.body?.serviceId ?? ""), practitionerId: String(req.body?.practitionerId ?? ""),
      start: start.toISOString(), notes: req.body?.notes, createdVia: `staff:${staffName(res)}`,
    });
    if (!result.ok) throw new HttpError(409, result.reason);
    events.emit("appointment.booked", result.appointment);
    changed(clinic.id, "appointment", result.appointment.id);
    res.status(201).json(result.appointment);
  });

  api.post("/appointments/:id/status", async (req, res) => {
    const appt = db.getAppointment(num(req.params.id));
    if (!appt) throw new HttpError(404, "Appointment not found");
    const clinic = db.getClinic(appt.clinic_id)!;
    const status = String(req.body?.status);
    if (status === "cancelled") {
      const result = await s.backends.forClinic(clinic).cancel(clinic, appt, req.body?.reason);
      if (!result.ok) throw new HttpError(409, result.reason);
      events.emit("appointment.cancelled", result.appointment);
    } else if (status === "completed" || status === "no_show") {
      db.updateAppointment(appt.id, { status });
    } else {
      throw new HttpError(400, "Status must be cancelled, completed or no_show");
    }
    changed(clinic.id, "appointment", appt.id);
    res.json(db.getAppointment(appt.id));
  });

  // --------------------------------------------------------- tasks & calls

  api.get("/clinics/:cid/tasks", (req, res) => {
    const status = (["open", "done", "all"] as const).find((x) => x === req.query.status) ?? "open";
    res.json(db.listTasks(clinicOr404(req.params.cid).id, status));
  });

  api.post("/clinics/:cid/tasks", (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const title = String(req.body?.title ?? "").trim();
    if (!title) throw new HttpError(400, "Title is required");
    const task = db.createTask({
      clinicId: clinic.id, contactId: req.body?.contactId ? num(req.body.contactId) : null, type: "other",
      priority: req.body?.priority === "urgent" ? "urgent" : "normal", title, details: req.body?.details ?? null, createdBy: `staff:${staffName(res)}`,
    });
    changed(clinic.id, "task", task.id);
    res.status(201).json(task);
  });

  api.post("/tasks/:id", (req, res) => {
    const id = num(req.params.id);
    db.updateTaskStatus(id, req.body?.status === "done" ? "done" : "open");
    const clinicId = Number(req.body?.clinicId);
    if (clinicId) changed(clinicId, "task", id);
    res.json({ ok: true });
  });

  api.get("/clinics/:cid/calls", (req, res) => {
    res.json(db.listCalls(clinicOr404(req.params.cid).id));
  });

  // ------------------------------------------------- marketing & settings

  api.post("/clinics/:cid/broadcast", async (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const template = String(req.body?.template ?? "").trim();
    if (!template) throw new HttpError(400, "Message is empty");
    const channel = req.body?.channel === "preferred" ? "preferred" : CHANNELS.find((c) => c === req.body?.channel) ?? "preferred";
    res.json(await s.automations.broadcast(clinic, {
      name: String(req.body?.name ?? "Broadcast"), template, channel, subject: req.body?.subject,
      tag: req.body?.tag || undefined, stage: STAGES.find((st) => st === req.body?.stage),
    }));
  });

  api.get("/clinics/:cid/voice-config", (req, res) => {
    res.json(s.voice.agentConfig(clinicOr404(req.params.cid), config.publicUrl));
  });

  /** Test console: inject a message as if a patient sent it on a channel. */
  api.post("/clinics/:cid/simulate", async (req, res) => {
    const clinic = clinicOr404(req.params.cid);
    const channel = CHANNELS.find((c) => c === req.body?.channel && c !== "voice") as Exclude<Channel, "voice"> | undefined;
    if (!channel) throw new HttpError(400, "Pick sms, whatsapp, messenger, instagram or email");
    const to = db.channelAddress(clinic.id, channel);
    if (!to) throw new HttpError(400, `No ${channel} account connected`);
    const from = String(req.body?.from ?? "").trim();
    const body = String(req.body?.body ?? "").trim();
    if (!from || !body) throw new HttpError(400, "From and message are required");
    const result = await inbox.receive({
      channel, to, from: channel === "whatsapp" ? from.replace(/\D/g, "") : from, fromName: req.body?.name || undefined,
      body, subject: req.body?.subject || undefined, externalId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    res.json({ conversationId: result?.conversation.id });
  });

  app.use("/api", api);

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, edition: config.edition });
  });

  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url)), { extensions: ["html"] }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else if (err instanceof ChannelError) {
      res.status(400).json({ error: err.message });
    } else if (err instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid JSON" });
    } else {
      console.error(err);
      res.status(500).json({ error: "Something went wrong" });
    }
  });

  return app;
}
