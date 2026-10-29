import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { addTag, type CampaignOptions } from "./automations.ts";
import { serviceOf } from "./booking/backend.ts";
import { verifyEhrSignature, type EhrAppointment } from "./booking/ehr.ts";
import { ChannelError, reachableChannels } from "./channels/index.ts";
import { parseEmailInbound } from "./channels/email.ts";
import { parseMetaWebhook, verifyMetaSignature } from "./channels/meta.ts";
import { parseTelnyxInbound, parseTwilioInbound, verifyTelnyxSignature, verifyTwilioSignature } from "./channels/sms.ts";
import { verifyElevenLabsSignature } from "./channels/voice.ts";
import { toFhirConsent } from "./consent.ts";
import { normalizePhone, parseTags } from "./db.ts";
import {
  basicAuthPassword, clearSessionCookie, COOKIE_PLAIN, COOKIE_SECURE, HttpError, readCookie, sameOrigin, secretMatches,
  securityHeaders, sessionCookie,
} from "./http/security.ts";
import { DEFAULT_WORDING_RULES, privacyProblems, WORDING_RULES, wordingProblems } from "./policy/guards.ts";
import { AccountError, type SessionInfo, type SessionScope } from "./security/accounts.ts";
import { toFhirAuditEvent } from "./security/audit.ts";
import { hmac, safeEqual, sha256 } from "./security/crypto.ts";
import { can, permissionsOf, ROLE_LABEL, ROLES, type Permission, type Role } from "./security/permissions.ts";
import type { Services } from "./services.ts";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "./seed.ts";
import { addDays, localDate, parseLocalDateTime, zonedToUtc } from "./time.ts";
import { CHANNELS, STAGES, type Channel, type ClinicProfile, type Contact, type Stage } from "./types.ts";

type RawRequest = Request & { rawBody?: Buffer };
type Authed = Response & { locals: { session: SessionInfo } };

const ALL_CHANNELS_BUT_VOICE: Channel[] = ["sms", "whatsapp", "messenger", "instagram", "email"];
/** Most campaign messages a clinic can send per day. */
const DAILY_CAMPAIGN_CAP = 2_000;

export function createApp(s: Services): express.Express {
  const { db, inbox, config, events, accounts, audit, consents } = s;
  const app = express();
  const https = config.publicUrl.startsWith("https://");
  const cookieName = https ? COOKIE_SECURE : COOKIE_PLAIN;
  const unsigned = config.security.allowUnsignedWebhooks;
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);
  app.use(securityHeaders({ https }));

  const keepRaw = (req: Request, _res: Response, buf: Buffer) => {
    (req as RawRequest).rawBody = buf;
  };
  const json = (limit: string) => express.json({ limit, verify: keepRaw });
  const form = express.urlencoded({ extended: false, limit: "64kb", verify: keepRaw });

  const num = (v: unknown) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid id");
    return n;
  };
  const changed = (clinicId: number, kind: string, id?: number) => events.emit("changed", { clinicId, kind, id });
  const raw = (req: Request) => (req as RawRequest).rawBody ?? Buffer.alloc(0);
  const ipOf = (req: Request) => req.ip ?? "unknown";

  // ------------------------------------------------------------------ webhooks
  // A provider's route exists only when its verification secret is configured. Unsigned webhooks are
  // possible only in demo mode with DEMO_UNSIGNED_WEBHOOKS=1.

  const verifyOr403 = (secret: string, ok: () => boolean) => {
    if (secret) {
      if (!ok()) throw new HttpError(403, "Invalid signature");
    } else if (!unsigned) {
      throw new HttpError(404, "Not found");
    }
  };

  if (config.sms.twilioAuthToken || unsigned) {
    const twilioOk = (req: Request) => verifyTwilioSignature(
      config.sms.twilioAuthToken, `${config.publicUrl.replace(/\/$/, "")}${req.originalUrl}`, req.body as Record<string, string>, req.get("x-twilio-signature"),
    );
    app.post("/webhooks/twilio/sms", form, async (req, res) => {
      verifyOr403(config.sms.twilioAuthToken, () => twilioOk(req));
      const inbound = parseTwilioInbound(req.body);
      if (inbound) await inbox.receive(inbound);
      res.type("text/xml").send("<Response></Response>");
    });
    // Delivery receipts: a message that never arrived is flagged so staff can follow up another way.
    app.post("/webhooks/twilio/status", form, (req, res) => {
      verifyOr403(config.sms.twilioAuthToken, () => twilioOk(req));
      const sid = String(req.body?.MessageSid ?? "");
      const status = String(req.body?.MessageStatus ?? "");
      const message = sid ? db.findMessageByExternalId("sms", sid) : undefined;
      if (message && (status === "failed" || status === "undelivered")) {
        db.updateMessage(message.id, { status: "failed", error: `Carrier reported ${status} (${String(req.body?.ErrorCode ?? "no code")})` });
        db.updateConversation(message.conversation_id, { needs_attention: 1, attention_reason: "A text was not delivered" });
        const conv = db.getConversation(message.conversation_id);
        if (conv) changed(conv.clinic_id, "message", conv.id);
      }
      res.sendStatus(204);
    });
  }

  if (config.sms.telnyxPublicKey || unsigned) {
    app.post("/webhooks/telnyx/sms", json("64kb"), async (req, res) => {
      verifyOr403(config.sms.telnyxPublicKey, () => verifyTelnyxSignature(config.sms.telnyxPublicKey, raw(req), req.get("telnyx-signature-ed25519"), req.get("telnyx-timestamp")));
      const inbound = parseTelnyxInbound(req.body);
      if (inbound) await inbox.receive(inbound);
      res.sendStatus(200);
    });
  }

  if (config.meta.appSecret || unsigned) {
    // Meta webhook verification handshake (WhatsApp, Messenger, Instagram).
    app.get("/webhooks/meta", (req, res) => {
      const challenge = String(req.query["hub.challenge"] ?? "");
      const tokenOk = !!config.meta.verifyToken && secretMatches(String(req.query["hub.verify_token"] ?? ""), config.meta.verifyToken);
      if (req.query["hub.mode"] === "subscribe" && tokenOk && /^[0-9A-Za-z_-]{1,128}$/.test(challenge)) res.type("text/plain").send(challenge);
      else res.sendStatus(403);
    });
    app.post("/webhooks/meta", json("256kb"), async (req, res) => {
      verifyOr403(config.meta.appSecret, () => verifyMetaSignature(config.meta.appSecret, raw(req), req.get("x-hub-signature-256")));
      const all = parseMetaWebhook(req.body);
      if (all.length > 50) console.warn(`[meta] webhook carried ${all.length} messages; processing the first 50`);
      res.sendStatus(200);
      for (const inbound of all.slice(0, 50)) await inbox.receive(inbound).catch((err) => console.error("[meta]", (err as Error).message));
    });
  }

  if (config.email.inboundSecret || unsigned) {
    // Postmark posts with HTTP Basic auth (https://inbound:<secret>@host/webhooks/email). No secrets in URLs.
    app.post("/webhooks/email", json("2mb"), async (req, res) => {
      verifyOr403(config.email.inboundSecret, () => secretMatches(basicAuthPassword(req) ?? req.get("x-inbound-secret"), config.email.inboundSecret));
      const inbound = parseEmailInbound(req.body);
      if (inbound) await inbox.receive(inbound);
      res.sendStatus(200);
    });
  }

  if (config.elevenlabs.toolSecret || unsigned) {
    const toolOk = (req: Request) => secretMatches(req.get("x-tool-secret"), config.elevenlabs.toolSecret);
    app.post("/webhooks/elevenlabs/init", json("32kb"), (req, res) => {
      verifyOr403(config.elevenlabs.toolSecret, () => toolOk(req));
      res.json(s.voice.initiation(req.body ?? {}));
    });
    app.post("/webhooks/elevenlabs/tools/:name", json("32kb"), async (req, res) => {
      verifyOr403(config.elevenlabs.toolSecret, () => toolOk(req));
      const outcome = await s.voice.tool(String(req.params.name), req.body ?? {});
      res.json({ result: outcome.result, error: outcome.isError ?? false });
    });
  }
  if (config.elevenlabs.webhookSecret || unsigned) {
    app.post("/webhooks/elevenlabs/post-call", json("1mb"), (req, res) => {
      verifyOr403(config.elevenlabs.webhookSecret, () => verifyElevenLabsSignature(config.elevenlabs.webhookSecret, raw(req), req.get("elevenlabs-signature")));
      s.voice.postCall(req.body ?? {});
      res.sendStatus(200);
    });
  }

  // EHR-connected edition: each paired EHRM signs with its own key; the clinic comes from the key, not the body.
  if (config.edition === "ehr" && s.backends.ehr) {
    const ehr = s.backends.ehr;
    app.post("/webhooks/ehr", json("256kb"), (req, res) => {
      const pairing = db.ehrIntegrationByKeyId(String(req.get("x-ehr-key-id") ?? ""));
      if (!pairing || !verifyEhrSignature(pairing.secret, raw(req), req.get("x-ehr-signature"), req.get("x-ehr-timestamp"))) throw new HttpError(403, "Invalid signature");
      const event = req.body as { id?: string; type?: string; locationId?: string; appointment?: EhrAppointment; patient?: { id: string; firstName?: string; lastName?: string; phone?: string; email?: string } };
      if (event.locationId !== pairing.locationId) throw new HttpError(403, "locationId does not match this key");
      if (!event.id || !/^[\w.:-]{6,100}$/.test(event.id)) throw new HttpError(400, "Event id required");
      if (!db.claimEhrEvent(pairing.clinicId, event.id)) {
        res.json({ ok: true, duplicate: true });
        return;
      }
      const clinic = db.getClinic(pairing.clinicId)!;
      if (event.type?.startsWith("appointment.") && event.appointment) {
        const a = event.appointment;
        let contact = db.findContactByExternalId(clinic.id, a.patientId);
        if (!contact && event.patient) {
          contact = db.createContact(clinic.id, {
            name: [event.patient.firstName, event.patient.lastName].filter(Boolean).join(" ") || null,
            phone: event.patient.phone ? normalizePhone(event.patient.phone) : null, email: event.patient.email?.toLowerCase() ?? null,
            external_id: a.patientId, stage: "booked", preferred_channel: event.patient.phone ? "sms" : "email",
          });
        }
        if (!contact) throw new HttpError(422, "Unknown patient; include `patient` in the event");
        const before = db.findAppointmentByExternalRef(clinic.id, a.id);
        const appt = ehr.mirror(clinic, a, contact.id, "ehr");
        if (!before && appt.status === "booked") events.emit("appointment.booked", appt);
        if (before?.status === "booked" && appt.status === "cancelled") events.emit("appointment.cancelled", appt);
        audit.record({ actorType: "webhook", actor: "ehr", clinicId: clinic.id, action: `ehr.${event.type}`, target: `appointment:${appt.id}`, contactId: contact.id, outcome: "ok" });
        changed(clinic.id, "appointment", appt.id);
      } else if (event.type === "patient.updated" && event.patient) {
        const contact = db.findContactByExternalId(clinic.id, event.patient.id);
        if (contact) {
          // Address changes from the EHR wait for staff confirmation, like any other change of delivery address.
          if (event.patient.phone && normalizePhone(event.patient.phone) !== contact.phone) db.proposeContactChange(clinic.id, contact.id, "phone", normalizePhone(event.patient.phone), "ehr");
          if (event.patient.email && event.patient.email.toLowerCase() !== contact.email) db.proposeContactChange(clinic.id, contact.id, "email", event.patient.email.toLowerCase(), "ehr");
          const name = [event.patient.firstName, event.patient.lastName].filter(Boolean).join(" ");
          if (name) db.updateContact(contact.id, { name });
          audit.record({ actorType: "webhook", actor: "ehr", clinicId: clinic.id, action: "ehr.patient.updated", target: `contact:${contact.id}`, contactId: contact.id, outcome: "ok" });
          changed(clinic.id, "contact", contact.id);
        }
      }
      res.json({ ok: true });
    });
  }

  // ---------------------------------------------------- unsubscribe (CASL s.11)

  const unsubscribePage = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/styles.css"></head><body class="plain-page"><main class="plain-card"><h1>${title}</h1>${body}</main></body></html>`;
  app.get("/u/:token", (req, res) => {
    const target = s.unsubscribe.parse(String(req.params.token));
    if (!target) throw new HttpError(404, "This link isn't valid.");
    const clinic = db.getClinic(target.clinicId);
    res.type("html").send(unsubscribePage("Unsubscribe", `<p>Stop marketing ${target.channel === "email" ? "emails" : "messages"} from ${escapeHtml(clinic?.name ?? "this clinic")}?</p><form method="post"><button class="btn primary" type="submit">Unsubscribe</button></form><p class="muted small">Appointment reminders are not affected.</p>`));
  });
  app.post("/u/:token", form, (req, res) => {
    const target = s.unsubscribe.parse(String(req.params.token));
    if (!target) throw new HttpError(404, "This link isn't valid.");
    if (consents.latest(target.contactId, target.channel, "marketing")?.status !== "withdrawn") {
      consents.record({ clinicId: target.clinicId, contactId: target.contactId, channel: target.channel, purpose: "marketing", status: "withdrawn", basis: "link", source: "unsubscribe link", by: "patient" });
      audit.record({ actorType: "anonymous", actor: "unsubscribe-link", clinicId: target.clinicId, action: "consent.withdraw", target: `${target.channel}:marketing`, contactId: target.contactId, outcome: "ok", ip: ipOf(req) });
    }
    res.type("html").send(unsubscribePage("You're unsubscribed", "<p>You won't receive marketing messages here any more. Appointment reminders are not affected.</p>"));
  });

  // -------------------------------------------------------------- staff auth

  app.use("/api", json("256kb"), sameOrigin(() => [new URL(config.publicUrl).origin]));

  const setSession = (res: Response, userId: number, scope: SessionScope, req: Request) => {
    const token = accounts.issueSession(userId, scope, ipOf(req));
    const maxAge = scope === "full" ? config.security.sessionHours * 3600 : scope === "setup" ? 1800 : 300;
    res.setHeader("set-cookie", sessionCookie(cookieName, token, https, maxAge));
  };

  app.post("/api/login", (req, res) => {
    const ip = ipOf(req);
    if (!accounts.allowAttempt(ip)) throw new HttpError(429, "Too many sign-in attempts. Wait 15 minutes and try again.");
    const username = String(req.body?.username ?? "").trim();
    const result = accounts.login(username, String(req.body?.password ?? ""));
    if (!result.ok) {
      audit.record({ actorType: "anonymous", actor: username.slice(0, 80) || "-", action: "login", target: "session", outcome: "denied", ip, detail: result.reason });
      if (result.reason === "locked") throw new HttpError(423, "This account is locked for 15 minutes after too many wrong tries.");
      throw new HttpError(401, "That username and passphrase don't match.");
    }
    const scope: SessionScope = result.next === "done" ? "full" : result.next === "second_step" ? "second" : "setup";
    setSession(res, result.user.id, scope, req);
    audit.record({ actorType: "user", actor: result.user.username, role: result.user.role, action: scope === "full" ? "login" : "login.step1", target: "session", outcome: "ok", ip });
    res.json({ next: result.next });
  });

  const sessionOf = (req: Request, touch = true) => accounts.readSession(readCookie(req, cookieName), { touch });

  app.post("/api/login/code", (req, res) => {
    const session = sessionOf(req);
    if (!session || session.scope !== "second") throw new HttpError(401, "Sign in again.");
    if (!accounts.allowAttempt(ipOf(req))) throw new HttpError(429, "Too many sign-in attempts. Wait 15 minutes and try again.");
    if (accounts.isLocked(session.user.id)) throw new HttpError(423, "This account is locked for 15 minutes after too many wrong tries.");
    if (!accounts.checkCode(session.user.id, String(req.body?.code ?? ""))) {
      audit.record({ actorType: "user", actor: session.user.username, action: "login.code", target: "session", outcome: "denied", ip: ipOf(req) });
      throw new HttpError(401, "That code didn't work. Check your phone app and try again.");
    }
    accounts.revoke(readCookie(req, cookieName)!);
    setSession(res, session.user.id, "full", req);
    audit.record({ actorType: "user", actor: session.user.username, role: session.user.role, action: "login", target: "session", outcome: "ok", ip: ipOf(req) });
    res.json({ next: "done" });
  });

  app.post("/api/logout", (req, res) => {
    const token = readCookie(req, cookieName);
    const session = sessionOf(req, false);
    if (token) accounts.revoke(token);
    if (session) audit.record({ actorType: "user", actor: session.user.username, role: session.user.role, action: "logout", target: "session", outcome: "ok", ip: ipOf(req) });
    res.setHeader("set-cookie", clearSessionCookie(cookieName, https));
    res.setHeader("Clear-Site-Data", '"cache", "storage"');
    res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => {
    const session = sessionOf(req, req.get("x-background") !== "1");
    res.json({
      demo: config.demo,
      demoAccounts: config.demo ? { usernames: DEMO_ACCOUNTS.map((a) => `${a.username} (${ROLE_LABEL[a.role]})`), password: DEMO_PASSWORD } : null,
      session: session && {
        scope: session.scope,
        user: { id: session.user.id, name: session.user.name, username: session.user.username, role: session.user.role, roleLabel: ROLE_LABEL[session.user.role] },
        mustChangePassword: !!session.user.must_change_password,
        needsTotp: config.security.requireTotp && !session.user.totp_enabled,
        permissions: permissionsOf(session.user.role),
        edition: config.edition,
        responder: inbox.responderName,
        simulator: config.security.enableSimulator,
      },
    });
  });

  // Account setup (first sign-in): change the temporary passphrase, then enrol the phone app.
  const setupSession = (req: Request) => {
    const session = sessionOf(req);
    if (!session || session.scope === "second") throw new HttpError(401, "Sign in again.");
    return session;
  };
  const finishSetupIfDone = (req: Request, res: Response, userId: number) => {
    const user = accounts.getUser(userId)!;
    const done = !user.must_change_password && (!config.security.requireTotp || !!user.totp_enabled);
    accounts.revoke(readCookie(req, cookieName) ?? "");
    setSession(res, userId, done ? "full" : "setup", req);
    return done;
  };

  app.post("/api/me/password", (req, res) => {
    const session = setupSession(req);
    const problem = accounts.changePassword(session.user.id, String(req.body?.current ?? ""), String(req.body?.next ?? ""));
    if (problem) throw new HttpError(400, problem);
    accounts.revokeAll(session.user.id);
    audit.record({ actorType: "user", actor: session.user.username, role: session.user.role, action: "account.password", target: "self", outcome: "ok", ip: ipOf(req) });
    res.json({ done: finishSetupIfDone(req, res, session.user.id) });
  });

  app.post("/api/me/totp/start", (req, res) => {
    const session = setupSession(req);
    if (session.user.must_change_password) throw new HttpError(409, "Change your temporary passphrase first.");
    // Moving codes to a new phone from a signed-in session needs the passphrase again (a borrowed session isn't enough).
    if (session.user.totp_enabled && !accounts.verifyPasswordOf(session.user.id, String(req.body?.current ?? ""))) {
      throw new HttpError(403, "Enter your current passphrase to move codes to a new phone.");
    }
    res.json(accounts.startTotpEnrolment(session.user.id, "Clinic Front Desk"));
  });

  app.post("/api/me/totp/confirm", (req, res) => {
    const session = setupSession(req);
    if (!accounts.confirmTotpEnrolment(session.user.id, String(req.body?.code ?? ""))) throw new HttpError(400, "That code didn't match. Codes change every 30 seconds; try the current one.");
    audit.record({ actorType: "user", actor: session.user.username, role: session.user.role, action: "account.totp.enrol", target: "self", outcome: "ok", ip: ipOf(req) });
    res.json({ done: finishSetupIfDone(req, res, session.user.id) });
  });

  // ------------------------------------------------------- authenticated API

  const api = express.Router();
  api.use((req, res, next) => {
    const session = sessionOf(req, req.get("x-background") !== "1");
    if (!session) throw new HttpError(401, "Not signed in");
    if (session.scope !== "full") throw new HttpError(403, "Finish setting up your account first.", { setup: true });
    (res as Authed).locals.session = session;
    next();
  });

  const sess = (res: Response) => (res as Authed).locals.session;
  const need = (res: Response, perm: Permission) => {
    const s0 = sess(res);
    if (!can(s0.user.role, perm)) throw new HttpError(403, "Your role doesn't allow this.", { needs: perm });
  };
  const actor = (req: Request, res: Response) => ({ actorType: "user" as const, actor: sess(res).user.username, role: sess(res).user.role, ip: ipOf(req) });
  /** Every record is checked against the clinics this person works at. Others look like they don't exist. */
  const ownClinic = (res: Response, clinicId: number | undefined) => {
    if (!clinicId || !sess(res).clinicIds.includes(clinicId)) throw new HttpError(404, "Not found");
  };
  const clinicOr404 = (res: Response, id: unknown) => {
    const cid = num(id);
    ownClinic(res, cid);
    const clinic = db.getClinic(cid);
    if (!clinic) throw new HttpError(404, "Not found");
    return clinic;
  };
  const conversationOr404 = (res: Response, id: unknown) => {
    const c = db.getConversation(num(id));
    ownClinic(res, c?.clinic_id);
    return c!;
  };
  const contactOr404 = (res: Response, id: unknown) => {
    const c = db.getContact(num(id));
    ownClinic(res, c?.clinic_id);
    return c!;
  };
  const staffOf = (res: Response) => ({ id: sess(res).user.id, name: sess(res).user.name });

  // Live updates for the staff UI (Server-Sent Events), only for a clinic this person works at.
  api.get("/events", (req, res) => {
    const clinicId = num(req.query.clinic);
    ownClinic(res, clinicId);
    const token = readCookie(req, cookieName);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write("retry: 3000\n\n");
    const off = events.on("changed", (e) => {
      if (e.clinicId === clinicId) res.write(`data: ${JSON.stringify(e)}\n\n`);
    });
    // The stream ends within seconds of the session ending (logout, expiry, password change, disable).
    let ticks = 0;
    const ping = setInterval(() => {
      if (!accounts.readSession(token, { touch: false })) {
        res.end();
        return;
      }
      if (++ticks % 4 === 0) res.write(": ping\n\n");
    }, 5_000);
    req.on("close", () => {
      off();
      clearInterval(ping);
    });
  });

  api.get("/clinics", (_req, res) => {
    res.json(sess(res).clinicIds.map((id) => db.getClinic(id)).filter(Boolean).map((c) => ({ id: c!.id, name: c!.name })));
  });

  api.get("/clinics/:cid", (req, res) => {
    const clinic = clinicOr404(res, req.params.cid);
    res.json({
      id: clinic.id, name: clinic.name, profile: clinic.profile, edition: config.edition, responder: inbox.responderName,
      channels: s.channels.status(), accounts: db.listChannelAccounts(clinic.id), stages: STAGES,
      wordingRules: Object.fromEntries(Object.entries(WORDING_RULES).map(([k, v]) => [k, v.label])),
      ehrPaired: !!db.ehrLocationOf(clinic.id),
    });
  });

  api.put("/clinics/:cid/profile", (req, res) => {
    need(res, "settings.manage");
    const clinic = clinicOr404(res, req.params.cid);
    const profile = validateProfile(req.body as ClinicProfile, clinic.profile);
    db.updateClinicProfile(clinic.id, profile);
    audit.record({ ...actor(req, res), clinicId: clinic.id, action: "settings.update", target: "clinic-profile", outcome: "ok" });
    changed(clinic.id, "clinic");
    res.json(db.getClinic(clinic.id));
  });

  api.get("/clinics/:cid/stats", (req, res) => {
    need(res, "stats.read");
    res.json(db.stats(clinicOr404(res, req.params.cid).id));
  });

  api.get("/clinics/:cid/conversations", (req, res) => {
    need(res, "inbox.read");
    const filter = (["all", "attention", "unread"] as const).find((f) => f === req.query.filter) ?? "all";
    res.json(db.listConversations(clinicOr404(res, req.params.cid).id, filter));
  });

  api.get("/conversations/:id", (req, res) => {
    need(res, "inbox.read");
    const conversation = conversationOr404(res, req.params.id);
    const contact = db.getContact(conversation.contact_id)!;
    audit.record({ ...actor(req, res), clinicId: conversation.clinic_id, action: "conversation.view", target: `conversation:${conversation.id}`, contactId: contact.id, outcome: "ok" });
    res.json({
      conversation, contact: { ...contact, tags: parseTags(contact) }, reachable: reachableChannels(contact),
      messages: db.listMessages(conversation.id),
      appointments: db.contactAppointments(contact.id),
      tasks: db.listTasks(conversation.clinic_id, "all", contact.id),
      consents: consents.summary(contact.id),
      proposals: db.listProposals(contact.id),
      // Who contacted whom: the clinic's own number/handle on each channel, and this person's calls.
      clinicAddresses: Object.fromEntries(CHANNELS.map((ch) => [ch, db.channelAddress(conversation.clinic_id, ch) ?? null])),
      calls: can(sess(res).user.role, "calls.read") ? db.callsForContact(contact.id) : [],
      windows: Object.fromEntries((["whatsapp", "messenger", "instagram"] as Channel[]).map((ch) => {
        const last = db.lastInboundAt(conversation.id, ch);
        return [ch, last ? new Date(Date.parse(last) + 24 * 3600_000).toISOString() : null];
      })),
    });
  });

  api.post("/conversations/:id/read", (req, res) => {
    need(res, "inbox.read");
    const conversation = conversationOr404(res, req.params.id);
    db.updateConversation(conversation.id, { unread: 0 });
    changed(conversation.clinic_id, "conversation", conversation.id);
    res.json({ ok: true });
  });

  api.post("/conversations/:id/reply", async (req, res) => {
    need(res, "inbox.reply");
    const conversation = conversationOr404(res, req.params.id);
    const body = String(req.body?.body ?? "").trim();
    if (!body) throw new HttpError(400, "Message is empty");
    if (body.length > 1600) throw new HttpError(400, "Keep messages under 1,600 characters.");
    const channel = CHANNELS.find((c) => c === req.body?.channel);
    const message = await inbox.staffReply(conversation.id, body, {
      staffName: sess(res).user.name, staffUserId: sess(res).user.id, channel, subject: req.body?.subject, keepAiOn: !!req.body?.keepAiOn,
    });
    audit.record({ ...actor(req, res), clinicId: conversation.clinic_id, action: "message.send", target: `conversation:${conversation.id}`, contactId: conversation.contact_id, outcome: message.status === "failed" ? "error" : "ok", detail: `${message.channel}, ${body.length} chars` });
    res.json(message);
  });

  api.post("/conversations/:id/ai", (req, res) => {
    need(res, "inbox.manage");
    const conversation = conversationOr404(res, req.params.id);
    const enabled = !!req.body?.enabled;
    db.updateConversation(conversation.id, { ai_enabled: enabled ? 1 : 0, paused_by: enabled ? null : sess(res).user.name, ...(enabled ? { needs_attention: 0, attention_reason: null } : {}) });
    audit.record({ ...actor(req, res), clinicId: conversation.clinic_id, action: enabled ? "ai.resume" : "ai.pause", target: `conversation:${conversation.id}`, contactId: conversation.contact_id, outcome: "ok" });
    changed(conversation.clinic_id, "conversation", conversation.id);
    if (enabled) inbox.scheduleReply(conversation.id);
    res.json(db.getConversation(conversation.id));
  });

  api.post("/conversations/:id/resolve", (req, res) => {
    need(res, "inbox.manage");
    const conversation = conversationOr404(res, req.params.id);
    db.updateConversation(conversation.id, { needs_attention: 0, attention_reason: null, unread: 0 });
    changed(conversation.clinic_id, "conversation", conversation.id);
    res.json(db.getConversation(conversation.id));
  });

  const draftOr404 = (res: Response, id: unknown) => {
    const message = db.getMessage(num(id));
    const conversation = message ? db.getConversation(message.conversation_id) : undefined;
    ownClinic(res, conversation?.clinic_id);
    if (!message || message.status !== "draft") throw new HttpError(404, "Draft not found");
    return { message, conversation: conversation! };
  };

  api.post("/messages/:id/approve", async (req, res) => {
    need(res, "drafts.approve");
    const { message, conversation } = draftOr404(res, req.params.id);
    const sent = await inbox.approveDraft(message.id, staffOf(res), req.body?.body);
    audit.record({ ...actor(req, res), clinicId: conversation.clinic_id, action: "draft.approve", target: `conversation:${conversation.id}`, contactId: conversation.contact_id, outcome: sent.status === "failed" ? "error" : "ok" });
    res.json(sent);
  });

  api.post("/messages/:id/discard", (req, res) => {
    need(res, "drafts.approve");
    const { message, conversation } = draftOr404(res, req.params.id);
    db.deleteMessage(message.id);
    changed(conversation.clinic_id, "message", conversation.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- CRM

  const contactFields = (body: Record<string, unknown>): Partial<Contact> => {
    const out: Partial<Contact> = {};
    if (typeof body.name === "string") out.name = body.name.trim().slice(0, 80) || null;
    if (typeof body.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That email address doesn't look right.");
      out.email = email || null;
    }
    if (typeof body.phone === "string") out.phone = body.phone.trim() ? normalizePhone(body.phone) : null;
    if (typeof body.notes === "string") out.notes = body.notes.slice(0, 2000);
    if (typeof body.stage === "string") {
      if (!STAGES.includes(body.stage as Stage)) throw new HttpError(400, "Unknown stage");
      out.stage = body.stage as Stage;
    }
    return out;
  };

  api.get("/clinics/:cid/contacts", (req, res) => {
    need(res, "contacts.read");
    const clinic = clinicOr404(res, req.params.cid);
    const contacts = db.listContacts(clinic.id, {
      search: req.query.search ? String(req.query.search).slice(0, 80) : undefined,
      tag: req.query.tag ? String(req.query.tag) : undefined,
      stage: STAGES.find((st) => st === req.query.stage),
    });
    audit.record({ ...actor(req, res), clinicId: clinic.id, action: "contacts.list", target: "contacts", outcome: "ok", detail: `${contacts.length} rows` });
    res.json(contacts.map((c) => ({ ...c, notes: undefined, tags: parseTags(c), consents: consents.summary(c.id) })));
  });

  api.post("/clinics/:cid/contacts", (req, res) => {
    need(res, "contacts.write");
    const clinic = clinicOr404(res, req.params.cid);
    const fields = contactFields(req.body ?? {});
    if (!fields.name && !fields.phone && !fields.email) throw new HttpError(400, "Name, phone or email is required");
    const contact = db.createContact(clinic.id, { ...fields, preferred_channel: fields.phone ? "sms" : fields.email ? "email" : null });
    // Consent the patient gave at the desk (e.g. intake form), recorded with who took it.
    const given = req.body?.consents ?? {};
    for (const channel of ["sms", "email", "whatsapp"] as Channel[]) {
      if (given[channel]?.reminders) consents.record({ clinicId: clinic.id, contactId: contact.id, channel, purpose: "service", status: "granted", basis: "staff", source: String(given.source ?? "recorded at the front desk").slice(0, 120), by: sess(res).user.username });
      if (given[channel]?.marketing) consents.record({ clinicId: clinic.id, contactId: contact.id, channel, purpose: "marketing", status: "granted", basis: "express", source: String(given.source ?? "recorded at the front desk").slice(0, 120), textVersion: String(given.textVersion ?? "desk-v1").slice(0, 40), by: sess(res).user.username });
    }
    events.emit("contact.created", contact);
    audit.record({ ...actor(req, res), clinicId: clinic.id, action: "contact.create", target: `contact:${contact.id}`, contactId: contact.id, outcome: "ok" });
    changed(clinic.id, "contact", contact.id);
    res.status(201).json(contact);
  });

  api.patch("/contacts/:id", (req, res) => {
    need(res, "contacts.write");
    let contact = contactOr404(res, req.params.id);
    const fields = contactFields(req.body ?? {});
    contact = db.updateContact(contact.id, fields);
    if (Array.isArray(req.body?.tags)) {
      const wanted = [...new Set((req.body.tags as unknown[]).map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 30);
      const before = parseTags(contact);
      contact = db.updateContact(contact.id, { tags: JSON.stringify(before.filter((t) => wanted.includes(t))) });
      for (const tag of wanted.filter((t) => !before.includes(t))) contact = addTag(db, events, contact, tag);
    }
    audit.record({ ...actor(req, res), clinicId: contact.clinic_id, action: "contact.update", target: `contact:${contact.id}`, contactId: contact.id, outcome: "ok", detail: Object.keys(fields).join(",") || "tags" });
    changed(contact.clinic_id, "contact", contact.id);
    res.json({ ...contact, tags: parseTags(contact) });
  });

  api.post("/contacts/:id/consent", (req, res) => {
    need(res, "consent.write");
    const contact = contactOr404(res, req.params.id);
    const channel = ALL_CHANNELS_BUT_VOICE.find((c) => c === req.body?.channel);
    const purpose = req.body?.purpose === "marketing" ? "marketing" : req.body?.purpose === "service" ? "service" : undefined;
    const status = req.body?.status === "granted" ? "granted" : req.body?.status === "withdrawn" ? "withdrawn" : undefined;
    const source = String(req.body?.source ?? "").trim().slice(0, 200);
    if (!channel || !purpose || !status) throw new HttpError(400, "Pick a channel, a purpose and granted or withdrawn.");
    if (status === "granted" && !source) throw new HttpError(400, "Say how the patient gave consent (for example: intake form, said yes on the phone).");
    // An SMS STOP can only be lifted by the patient texting START (carrier rule).
    if (status === "granted" && channel === "sms" && ((consents.latest(contact.id, "sms", "service")?.basis === "keyword" && consents.latest(contact.id, "sms", "service")?.status === "withdrawn") || consents.addressBlock(contact.id, "sms"))) {
      throw new HttpError(409, "This patient texted STOP. Only they can turn texts back on, by texting START.");
    }
    consents.record({ clinicId: contact.clinic_id, contactId: contact.id, channel, purpose, status, basis: status === "granted" ? (purpose === "marketing" ? "express" : "staff") : "staff", source: source || "withdrawn by staff on the patient's request", textVersion: req.body?.textVersion ? String(req.body.textVersion).slice(0, 40) : null, by: sess(res).user.username });
    audit.record({ ...actor(req, res), clinicId: contact.clinic_id, action: status === "granted" ? "consent.grant" : "consent.withdraw", target: `${channel}:${purpose}`, contactId: contact.id, outcome: "ok" });
    changed(contact.clinic_id, "contact", contact.id);
    res.json(consents.summary(contact.id));
  });

  api.post("/proposals/:id/:decision", (req, res) => {
    need(res, "proposals.decide");
    const proposal = db.getProposal(num(req.params.id));
    ownClinic(res, proposal?.clinic_id);
    if (!proposal || proposal.status !== "pending") throw new HttpError(404, "Not found");
    const approve = req.params.decision === "approve";
    if (approve) db.updateContact(proposal.contact_id, { [proposal.field]: proposal.value } as Partial<Contact>);
    db.decideProposal(proposal.id, approve ? "approved" : "rejected", sess(res).user.username);
    audit.record({ ...actor(req, res), clinicId: proposal.clinic_id, action: approve ? "contact.change.approve" : "contact.change.reject", target: `contact:${proposal.contact_id}:${proposal.field}`, contactId: proposal.contact_id, outcome: "ok" });
    changed(proposal.clinic_id, "contact", proposal.contact_id);
    res.json({ ok: true });
  });

  /** Opens (or returns) the thread for a contact so staff can message them first. */
  api.post("/contacts/:id/conversation", (req, res) => {
    need(res, "inbox.read");
    const contact = contactOr404(res, req.params.id);
    const channel = reachableChannels(contact)[0];
    if (!channel) throw new HttpError(400, "Contact has no phone, email or social account");
    res.json(db.conversationForContact(contact, channel));
  });

  /** Everything the cloud holds about one person, as a FHIR R4 Bundle (access requests, PHIPA s.52). */
  api.get("/contacts/:id/export", (req, res) => {
    need(res, "contacts.export");
    const contact = contactOr404(res, req.params.id);
    const clinic = db.getClinic(contact.clinic_id)!;
    const conv = db.conversationForContact(contact, contact.preferred_channel ?? "sms");
    const bundle = exportBundle(clinic.profile.timezone, contact, db.listMessages(conv.id, 5000), db.contactAppointments(contact.id), consents.history(contact.id), db.callsForContact(contact.id));
    audit.record({ ...actor(req, res), clinicId: contact.clinic_id, action: "contact.export", target: `contact:${contact.id}`, contactId: contact.id, outcome: "ok", detail: `${bundle.entry.length} resources` });
    res.setHeader("content-disposition", `attachment; filename="contact-${contact.id}-fhir.json"`);
    res.type("application/fhir+json").send(JSON.stringify(bundle, null, 2));
  });

  /** Erases one person's messaging data (messages, call text, notes). Keeps consent records, bookings and the audit trail. */
  api.post("/contacts/:id/erase", (req, res) => {
    need(res, "contacts.erase");
    const contact = contactOr404(res, req.params.id);
    if (req.body?.confirm !== `ERASE ${contact.id}`) throw new HttpError(400, `Type ERASE ${contact.id} to confirm.`);
    const out = db.eraseMessagingData(contact.id);
    audit.record({ ...actor(req, res), clinicId: contact.clinic_id, action: "contact.erase", target: `contact:${contact.id}`, contactId: contact.id, outcome: "ok", detail: `${out.messages} messages, ${out.calls} calls` });
    changed(contact.clinic_id, "contact", contact.id);
    res.json(out);
  });

  api.get("/clinics/:cid/pipeline", (req, res) => {
    need(res, "contacts.read");
    const clinic = clinicOr404(res, req.params.cid);
    const contacts = db.listContacts(clinic.id);
    res.json(Object.fromEntries(STAGES.map((stage) => [stage, contacts.filter((c) => c.stage === stage).map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, stage: c.stage, tags: parseTags(c) }))])));
  });

  // ------------------------------------------------------------ calendar

  api.get("/clinics/:cid/appointments", (req, res) => {
    need(res, "calendar.read");
    const clinic = clinicOr404(res, req.params.cid);
    const tz = clinic.profile.timezone;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : localDate(new Date(), tz);
    const days = Math.max(1, Math.min(Number(req.query.days ?? 7) || 7, 62));
    res.json(db.listAppointments(clinic.id, zonedToUtc(from, "00:00", tz).toISOString(), zonedToUtc(addDays(from, days), "00:00", tz).toISOString()).map((a) => ({ ...a, notes: undefined })));
  });

  api.get("/clinics/:cid/slots", async (req, res) => {
    need(res, "calendar.read");
    const clinic = clinicOr404(res, req.params.cid);
    const serviceId = String(req.query.service ?? "");
    if (!serviceOf(clinic, serviceId)) throw new HttpError(400, "Unknown service");
    res.json(await s.backends.forClinic(clinic).findSlots(clinic, {
      serviceId, dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : localDate(new Date(), clinic.profile.timezone),
      practitionerId: req.query.practitioner ? String(req.query.practitioner) : undefined, limit: 30,
    }));
  });

  api.post("/clinics/:cid/appointments", async (req, res) => {
    need(res, "calendar.write");
    const clinic = clinicOr404(res, req.params.cid);
    const contact = db.getContact(num(req.body?.contactId));
    if (!contact || contact.clinic_id !== clinic.id) throw new HttpError(400, "Unknown contact");
    const start = parseLocalDateTime(String(req.body?.start ?? ""), clinic.profile.timezone);
    if (!start) throw new HttpError(400, "Invalid start");
    const result = await s.backends.forClinic(clinic).book(clinic, {
      contact, serviceId: String(req.body?.serviceId ?? ""), practitionerId: String(req.body?.practitionerId ?? ""),
      start: start.toISOString(), notes: typeof req.body?.notes === "string" ? req.body.notes.slice(0, 500) : undefined, createdVia: `staff:${sess(res).user.username}`,
    });
    if (!result.ok) throw new HttpError(409, result.reason);
    events.emit("appointment.booked", result.appointment);
    audit.record({ ...actor(req, res), clinicId: clinic.id, action: "appointment.book", target: `appointment:${result.appointment.id}`, contactId: contact.id, outcome: "ok" });
    changed(clinic.id, "appointment", result.appointment.id);
    res.status(201).json(result.appointment);
  });

  api.post("/appointments/:id/status", async (req, res) => {
    need(res, "calendar.write");
    const appt = db.getAppointment(num(req.params.id));
    ownClinic(res, appt?.clinic_id);
    const clinic = db.getClinic(appt!.clinic_id)!;
    const status = String(req.body?.status);
    if (status === "cancelled") {
      const result = await s.backends.forClinic(clinic).cancel(clinic, appt!, typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : undefined);
      if (!result.ok) throw new HttpError(409, result.reason);
      events.emit("appointment.cancelled", result.appointment);
    } else if (status === "completed" || status === "no_show") {
      db.updateAppointment(appt!.id, { status });
    } else {
      throw new HttpError(400, "Status must be cancelled, completed or no_show");
    }
    audit.record({ ...actor(req, res), clinicId: clinic.id, action: `appointment.${status}`, target: `appointment:${appt!.id}`, contactId: appt!.contact_id, outcome: "ok" });
    changed(clinic.id, "appointment", appt!.id);
    res.json(db.getAppointment(appt!.id));
  });

  // --------------------------------------------------------- tasks & calls

  api.get("/clinics/:cid/tasks", (req, res) => {
    need(res, "tasks.read");
    const status = (["open", "done", "all"] as const).find((x) => x === req.query.status) ?? "open";
    res.json(db.listTasks(clinicOr404(res, req.params.cid).id, status));
  });

  api.post("/clinics/:cid/tasks", (req, res) => {
    need(res, "tasks.write");
    const clinic = clinicOr404(res, req.params.cid);
    const title = String(req.body?.title ?? "").trim().slice(0, 200);
    if (!title) throw new HttpError(400, "Title is required");
    let contactId: number | null = null;
    if (req.body?.contactId) {
      const contact = db.getContact(num(req.body.contactId));
      if (!contact || contact.clinic_id !== clinic.id) throw new HttpError(400, "Unknown contact");
      contactId = contact.id;
    }
    const task = db.createTask({
      clinicId: clinic.id, contactId, type: "other", priority: req.body?.priority === "urgent" ? "urgent" : "normal",
      title, details: typeof req.body?.details === "string" ? req.body.details.slice(0, 2000) : null, createdBy: `staff:${sess(res).user.username}`,
    });
    changed(clinic.id, "task", task.id);
    res.status(201).json(task);
  });

  api.post("/tasks/:id", (req, res) => {
    need(res, "tasks.write");
    const task = db.getTask(num(req.params.id));
    ownClinic(res, task?.clinic_id);
    db.updateTaskStatus(task!.id, req.body?.status === "done" ? "done" : "open");
    changed(task!.clinic_id, "task", task!.id);
    res.json({ ok: true });
  });

  api.get("/clinics/:cid/calls", (req, res) => {
    need(res, "calls.read");
    const clinic = clinicOr404(res, req.params.cid);
    audit.record({ ...actor(req, res), clinicId: clinic.id, action: "calls.list", target: "calls", outcome: "ok" });
    res.json(db.listCalls(clinic.id));
  });

  // ------------------------------------------------------------ campaigns

  const campaignOptions = (clinic: { profile: ClinicProfile }, body: Record<string, unknown>): CampaignOptions => ({
    name: String(body.name ?? "Campaign").trim().slice(0, 80) || "Campaign",
    template: String(body.template ?? "").trim().slice(0, 1200),
    subject: typeof body.subject === "string" ? body.subject.slice(0, 120) : undefined,
    tag: typeof body.tag === "string" && body.tag ? body.tag : undefined,
    stage: STAGES.find((st) => st === body.stage),
    channel: body.channel === "preferred" ? "preferred" : ALL_CHANNELS_BUT_VOICE.find((c) => c === body.channel) ?? "preferred",
    purpose: body.purpose === "service" ? "service" : "marketing",
  });
  const usedConfirmations = new Map<string, number>();
  const campaignsRunning = new Set<number>();
  const confirmToken = (clinicId: number, opts: CampaignOptions, eligible: number, userId: number, minute: number) =>
    hmac(db.vault.purposeKey(clinicId, "campaign-confirm"), JSON.stringify([opts, eligible, userId, minute])).slice(0, 32);

  api.post("/clinics/:cid/campaigns/preview", (req, res) => {
    need(res, "broadcast.send");
    const clinic = clinicOr404(res, req.params.cid);
    const opts = campaignOptions(clinic, req.body ?? {});
    const preview = s.automations.preview(clinic, opts);
    const minute = Math.floor(Date.now() / 60_000);
    res.json({ ...preview, confirmToken: preview.problem ? null : confirmToken(clinic.id, opts, preview.eligible, sess(res).user.id, minute) });
  });

  api.post("/clinics/:cid/campaigns", async (req, res) => {
    need(res, "broadcast.send");
    const clinic = clinicOr404(res, req.params.cid);
    const opts = campaignOptions(clinic, req.body ?? {});
    const preview = s.automations.preview(clinic, opts);
    if (preview.problem) throw new HttpError(400, preview.problem);
    // The confirmation must match exactly what was previewed (same audience, message and count) within 15 minutes.
    const minute = Math.floor(Date.now() / 60_000);
    const token = String(req.body?.confirmToken ?? "");
    const valid = Array.from({ length: 15 }, (_, i) => confirmToken(clinic.id, opts, preview.eligible, sess(res).user.id, minute - i)).some((t) => safeEqual(t, token));
    if (!valid) throw new HttpError(409, "The audience or message changed since the preview. Preview again before sending.");
    // Each confirmation works once, and a clinic runs one campaign at a time (no double sends).
    const used = sha256(`${clinic.id}:${token}`);
    for (const [k, exp] of usedConfirmations) if (exp < Date.now()) usedConfirmations.delete(k);
    if (usedConfirmations.has(used)) throw new HttpError(409, "This campaign was already sent. Preview again to send another.");
    if (campaignsRunning.has(clinic.id)) throw new HttpError(409, "A campaign is still sending for this clinic. Try again when it finishes.");
    const sentToday = db.campaignMessagesSince(clinic.id, new Date(Date.now() - 24 * 3600_000).toISOString());
    if (sentToday + preview.eligible > DAILY_CAMPAIGN_CAP) throw new HttpError(429, `That would pass the daily campaign limit of ${DAILY_CAMPAIGN_CAP} messages.`);
    audit.record({ ...actor(req, res), clinicId: clinic.id, action: "campaign.send", target: `campaign:${sha256(opts.name).slice(0, 8)}`, outcome: "ok", detail: `${preview.eligible} recipients, ${opts.purpose}` });
    usedConfirmations.set(used, Date.now() + 20 * 60_000);
    campaignsRunning.add(clinic.id);
    const staff = staffOf(res);
    // Sent in the background so a large audience doesn't hold the request open.
    void s.automations.broadcast(clinic, opts, staff).then((r) => {
      audit.record({ actorType: "system", actor: "campaign", clinicId: clinic.id, action: "campaign.done", outcome: "ok", detail: `${r.sent} sent, ${r.skipped} skipped` });
      changed(clinic.id, "campaign");
    }).catch((err) => console.error("[campaign]", (err as Error).message)).finally(() => campaignsRunning.delete(clinic.id));
    res.status(202).json({ queued: preview.eligible });
  });

  // ---------------------------------------------------- users & settings

  api.get("/clinics/:cid/users", (req, res) => {
    need(res, "users.manage");
    const clinic = clinicOr404(res, req.params.cid);
    res.json({ users: accounts.listUsers(clinic.id), roles: ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r] })) });
  });

  api.post("/clinics/:cid/users", (req, res) => {
    need(res, "users.manage");
    const clinic = clinicOr404(res, req.params.cid);
    const role = ROLES.find((r) => r === req.body?.role) as Role | undefined;
    if (!role) throw new HttpError(400, "Pick a role.");
    const { user, tempPassword } = accounts.createUser({
      username: String(req.body?.username ?? ""), name: String(req.body?.name ?? ""), role, clinicIds: [clinic.id], createdBy: sess(res).user.username,
    });
    audit.record({ ...actor(req, res), clinicId: clinic.id, action: "user.create", target: `user:${user.id}`, outcome: "ok", detail: role });
    // Shown once to the owner, who hands it over in person. Never stored in clear.
    res.status(201).json({ user, tempPassword });
  });

  api.post("/users/:id/:action", (req, res) => {
    need(res, "users.manage");
    const user = accounts.getUser(num(req.params.id));
    const theirs = user ? accounts.clinicsOf(user.id) : [];
    const shared = theirs.filter((c) => sess(res).clinicIds.includes(c));
    if (!user || !shared.length) throw new HttpError(404, "Not found");
    // Resetting someone hands over their access, so it's only allowed when you cover every clinic they work at.
    if (shared.length !== theirs.length) throw new HttpError(403, "This person also works at a clinic you don't manage. Ask the operator to change their account (npm run cli -- reset-user).");
    if (user.id === sess(res).user.id) throw new HttpError(400, "You can't change your own account here.");
    const action = String(req.params.action);
    let out: Record<string, unknown> = { ok: true };
    if (action === "reset") out = { tempPassword: accounts.resetCredentials(user.id) };
    else if (action === "disable" || action === "enable") accounts.setDisabled(user.id, action === "disable");
    else throw new HttpError(400, "Unknown action");
    audit.record({ ...actor(req, res), clinicId: shared[0], action: `user.${action}`, target: `user:${user.id}`, outcome: "ok" });
    res.json(out);
  });

  api.get("/clinics/:cid/audit", (req, res) => {
    need(res, "audit.read");
    const clinic = clinicOr404(res, req.params.cid);
    res.json({ rows: audit.list(clinic.id, { contactId: req.query.contact ? num(req.query.contact) : undefined, beforeId: req.query.before ? num(req.query.before) : undefined }), chain: audit.verify(), triggers: audit.triggersPresent() });
  });

  api.get("/clinics/:cid/audit/fhir", (req, res) => {
    need(res, "audit.read");
    const clinic = clinicOr404(res, req.params.cid);
    const rows = audit.list(clinic.id, { limit: 1000 });
    audit.record({ ...actor(req, res), clinicId: clinic.id, action: "audit.export", target: "audit", outcome: "ok", detail: `${rows.length} events` });
    res.type("application/fhir+json").send(JSON.stringify({ resourceType: "Bundle", type: "collection", timestamp: new Date().toISOString(), entry: rows.map((r) => ({ resource: toFhirAuditEvent(r, "Clinic Front Desk") })) }, null, 2));
  });

  api.get("/clinics/:cid/voice-config", (req, res) => {
    need(res, "settings.manage");
    res.json(s.voice.agentConfig(clinicOr404(res, req.params.cid), config.publicUrl));
  });

  /** Test console: inject a message as if a patient sent it. Demo / development only, and clearly marked. */
  if (config.security.enableSimulator) {
    api.post("/clinics/:cid/simulate", async (req, res) => {
      need(res, "simulator.use");
      const clinic = clinicOr404(res, req.params.cid);
      const channel = ALL_CHANNELS_BUT_VOICE.find((c) => c === req.body?.channel);
      if (!channel) throw new HttpError(400, "Pick sms, whatsapp, messenger, instagram or email");
      const to = db.channelAddress(clinic.id, channel);
      if (!to) throw new HttpError(400, `No ${channel} account connected`);
      const from = String(req.body?.from ?? "").trim().slice(0, 120);
      const body = String(req.body?.body ?? "").trim().slice(0, 4000);
      if (!from || !body) throw new HttpError(400, "From and message are required");
      const result = await inbox.receive({
        channel, to, from: channel === "whatsapp" ? from.replace(/\D/g, "") : from, fromName: req.body?.name ? String(req.body.name).slice(0, 80) : undefined,
        body, subject: req.body?.subject ? String(req.body.subject).slice(0, 200) : undefined, externalId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        simulated: !config.demo, senderVerified: true,
      });
      res.json({ conversationId: result?.conversation.id });
    });
  }

  app.use("/api", api);

  let chainCache: { at: number; result: ReturnType<typeof audit.verify> } | undefined;
  app.get("/healthz", (_req, res) => {
    let dbOk = true;
    try {
      db.sql.prepare("SELECT 1").get();
    } catch {
      dbOk = false;
    }
    // Re-checking the whole chain is costly, and this route needs no sign-in: check at most every 5 minutes.
    if (!chainCache || Date.now() - chainCache.at > 5 * 60_000) chainCache = { at: Date.now(), result: audit.verify() };
    const chain = chainCache.result;
    const tickAge = s.maintenance.lastRun ? Date.now() - Date.parse(s.maintenance.lastRun) : null;
    const ok = dbOk && chain.ok && audit.triggersPresent();
    res.status(ok ? 200 : 503).json({ ok, db: dbOk, auditChain: chain.ok, maintenanceMinutesAgo: tickAge === null ? null : Math.round(tickAge / 60_000), lastBackup: s.maintenance.lastBackup ?? null });
  });

  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url)), { extensions: ["html"], index: "index.html" }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
    } else if (err instanceof ChannelError || err instanceof AccountError) {
      res.status(400).json({ error: err.message });
    } else if (typeof (err as { status?: number }).status === "number" && (err as { status: number }).status < 500) {
      // Body-parser errors (bad JSON, too large): a client problem, not a crash.
      res.status((err as { status: number }).status).json({ error: (err as { status: number }).status === 413 ? "Request too large" : "Invalid request" });
    } else {
      console.error("[error]", (err as Error)?.message ?? err);
      res.status(500).json({ error: "Something went wrong" });
    }
  });

  return app;

  function validateProfile(next: ClinicProfile, current: ClinicProfile): ClinicProfile {
    if (!next?.name || !next.timezone || !Array.isArray(next.services) || !Array.isArray(next.practitioners) || !Array.isArray(next.automations)) {
      throw new HttpError(400, "Profile needs name, timezone, services, practitioners and automations");
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: next.timezone });
    } catch {
      throw new HttpError(400, `Unknown timezone ${next.timezone}`);
    }
    for (const url of [next.reviewUrl, next.website]) {
      if (url && !/^https:\/\//.test(url)) throw new HttpError(400, "Links must start with https://");
    }
    const rules = Array.isArray(next.wordingRules) ? next.wordingRules.filter((r) => r in WORDING_RULES) : DEFAULT_WORDING_RULES;
    const tags = (next.audienceTags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    const clinical = tags.filter((t) => privacyProblems(t.replace(/-/g, " "), "sms", { id: 0, name: next.name, profile: { ...next, services: [], practitioners: [] } }).length);
    if (clinical.length) throw new HttpError(400, `These audience tags describe health information and can't be used for campaigns: ${clinical.join(", ")}`);
    for (const automation of next.automations) {
      for (const action of automation.actions ?? []) {
        if (action.type !== "send_message") continue;
        if (action.purpose !== "service" && action.purpose !== "marketing") throw new HttpError(400, `"${automation.name}": say whether the message is a reminder (service) or marketing.`);
        const words = wordingProblems(action.template, rules as typeof DEFAULT_WORDING_RULES);
        if (words.length) throw new HttpError(400, `"${automation.name}" uses wording the clinic doesn't allow: ${words.join(", ")}`);
      }
    }
    const retention = next.retention && Number.isFinite(next.retention.messageDays) && Number.isFinite(next.retention.callDays)
      ? { messageDays: Math.max(1, Math.min(3650, Math.round(next.retention.messageDays))), callDays: Math.max(1, Math.min(3650, Math.round(next.retention.callDays))) }
      : current.retention;
    return {
      ...next,
      wordingRules: rules,
      audienceTags: tags,
      retention,
      // Integration settings are set by provisioning, never from this form (they route patient data).
      bookingProvider: current.bookingProvider,
      janeBookingUrl: current.janeBookingUrl,
      ehrLocationId: current.ehrLocationId,
    };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** One person's cloud data as a FHIR R4 Bundle: Patient (minimal), Communication, Appointment, Consent. */
function exportBundle(timeZone: string, contact: Contact, messages: ReturnType<Services["db"]["listMessages"]>, appointments: ReturnType<Services["db"]["contactAppointments"]>, consentRows: ReturnType<Services["consents"]["history"]>, calls: ReturnType<Services["db"]["callsForContact"]>) {
  const patientRef = { reference: `Patient/contact-${contact.id}` };
  const [given, ...family] = (contact.name ?? "").split(" ");
  const telecom = [
    contact.phone && { system: "phone", value: contact.phone },
    contact.email && { system: "email", value: contact.email },
  ].filter(Boolean);
  const entry: { resource: Record<string, unknown> }[] = [
    { resource: { resourceType: "Patient", id: `contact-${contact.id}`, ...(contact.name ? { name: [{ text: contact.name, given: [given], family: family.join(" ") || undefined }] } : {}), telecom } },
    ...messages.map((m) => ({ resource: {
      resourceType: "Communication", id: `msg-${m.id}`, status: m.status === "failed" ? "not-done" : "completed",
      subject: patientRef, sent: m.created_at, medium: [{ coding: [{ system: "urn:frontdesk:channel", code: m.channel }] }],
      ...(m.direction === "in" ? { sender: patientRef } : { recipient: [patientRef] }),
      payload: m.purged_at ? [] : [{ contentString: m.body }],
    } })),
    ...calls.map((c) => ({ resource: {
      resourceType: "Communication", id: `call-${c.id}`, status: "completed", subject: patientRef, sent: c.created_at,
      medium: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationMode", code: "VOICE" }] }],
      payload: c.summary ? [{ contentString: c.summary }] : [],
    } })),
    ...appointments.map((a) => ({ resource: {
      resourceType: "Appointment", id: `appt-${a.id}`,
      status: a.status === "booked" ? "booked" : a.status === "cancelled" ? "cancelled" : a.status === "no_show" ? "noshow" : "fulfilled",
      start: a.starts_at, end: a.ends_at, serviceType: [{ coding: [{ system: "urn:frontdesk:service", code: a.service_id }] }],
      participant: [{ actor: patientRef, status: "accepted" }, { actor: { display: a.practitioner_id }, status: "accepted" }],
      comment: `clinic time zone ${timeZone}`,
    } })),
    ...consentRows.map((r) => ({ resource: toFhirConsent(r) })),
  ];
  // Fail closed: every resource must have the fields FHIR R4 requires.
  for (const e of entry) {
    const r = e.resource;
    const bad = !r.resourceType || !r.id
      || (r.resourceType === "Communication" && !r.status)
      || (r.resourceType === "Appointment" && (!r.status || !Array.isArray(r.participant) || !(r.participant as unknown[]).length))
      || (r.resourceType === "Consent" && (!r.status || !r.scope || !r.category));
    if (bad) throw new HttpError(500, "Export failed validation; nothing was exported.");
  }
  return { resourceType: "Bundle" as const, type: "collection", timestamp: new Date().toISOString(), entry };
}
