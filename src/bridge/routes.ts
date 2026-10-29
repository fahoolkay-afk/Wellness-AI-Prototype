// /bridge/v1: the only door between the front desk and a clinic's EHRM (docs/INTEGRATION-CONTRACT.md 4).
// Every request is started by the laptop (the cloud never connects in), signed with the clinic's own
// bridge key, fresh, never replayed, rate limited, and its body is held to a strict allow-list. The clinic
// is always the key's clinic. No staff session, no cookie, no body logging: only method, path, status and
// key id ever reach a log, and audit rows hold ids, codes and counts.

import express, { type NextFunction, type Request, type Response } from "express";
import { DEFAULT_WORDING_RULES, wordingProblems } from "../policy/guards.ts";
import type { AuditLog } from "../security/audit.ts";
import type { Db } from "../db.ts";
import { NONCE_RE, RateLimiter, signResponse, timestampFresh, verifyRequest } from "./auth.ts";
import { E164_RE, eventProblem, NAME_RE, REF } from "./events.ts";
import type { Bridge, OutboxItem } from "./service.ts";
import type { Pairing } from "./store.ts";

type Locals = { pairing: Pairing; nonce: string; actor: string };
type Body = Record<string, unknown>;

class BridgeError extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}
const fail = (status: number, code: string): never => {
  throw new BridgeError(status, code);
};

const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,180}\.[A-Za-z]{2,24}$/;
const DAY = 864e5;

/** Exactly these keys: any unknown key is refused, any required key missing is refused. */
function exactKeys(o: unknown, required: string[], optional: string[] = []): Body {
  if (!o || typeof o !== "object" || Array.isArray(o)) fail(400, "bad_value");
  const body = o as Body;
  for (const k of Object.keys(body)) if (!required.includes(k) && !optional.includes(k)) fail(400, "unknown_field");
  for (const k of required) if (!(k in body)) fail(400, "missing_field");
  return body;
}
const isStr = (v: unknown, re: RegExp) => typeof v === "string" && re.test(v);
const need = (ok: boolean, code = "bad_value") => {
  if (!ok) fail(400, code);
};
const cleanName = (v: unknown) => isStr(v, NAME_RE) && !wordingProblems(v as string, DEFAULT_WORDING_RULES).length;

export function bridgeRouter(deps: { db: Db; audit: AuditLog; bridge: Bridge; rateLimiter?: RateLimiter }): express.Router {
  const { audit, bridge } = deps;
  const store = bridge.store;
  const limiter = deps.rateLimiter ?? new RateLimiter(60);
  // Failed authentication per client address: 20 a minute, then refused until the minute is up.
  const failures = new Map<string, { minute: number; n: number }>();
  const failLimiter = {
    blocked: (ip: string) => { const f = failures.get(ip); return !!f && f.minute === Math.floor(Date.now() / 60_000) && f.n >= 20; },
    hit: (ip: string) => {
      const minute = Math.floor(Date.now() / 60_000);
      const f = failures.get(ip);
      if (failures.size > 10_000) failures.clear();
      failures.set(ip, f && f.minute === minute ? { minute, n: f.n + 1 } : { minute, n: 1 });
    },
  };
  const router = express.Router();
  const raw = (limit: string) => express.raw({ type: () => true, limit });

  const keyLabel = (req: Request) => {
    const k = req.get("x-bridge-key-id") ?? "";
    return /^[\w-]{1,64}$/.test(k) ? k : "unknown";
  };

  const deny = (req: Request, status: number, code: string, clinicId: number | null = null) => {
    audit.record({ actorType: "device", actor: `bridge:${keyLabel(req)}`, role: "bridge", clinicId, action: "bridge.denied", target: `${req.method} ${req.path}`.slice(0, 80), outcome: "denied", detail: `code=${code}` });
    return new BridgeError(status, code);
  };

  /** Signature, freshness, replay and rate checks. Runs before the body is read as JSON. */
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const keyId = keyLabel(req);
    // Failed sign-ins are limited per client address, so a stranger who knows the (non-secret) key id can't
    // use up the clinic's own budget; the per-key budget is charged only after the signature checks out.
    if (failLimiter.blocked(req.ip ?? "unknown")) return next(deny(req, 429, "rate_limited"));
    const fail = (code: string, status = 401, clinicId: number | null = null) => { failLimiter.hit(req.ip ?? "unknown"); return next(deny(req, status, code, clinicId)); };
    const pairing = store.byKeyId(keyId === "unknown" ? "" : keyId);
    if (!pairing) return fail("auth");
    const nonce = req.get("x-bridge-nonce") ?? "";
    const ts = req.get("x-bridge-timestamp");
    if (!NONCE_RE.test(nonce)) return fail("auth", 401, pairing.clinicId);
    if (!timestampFresh(ts)) return fail("stale_timestamp", 401, pairing.clinicId);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyRequest(pairing.secret, req.method, req.originalUrl, nonce, body, req.get("x-bridge-signature"), ts)) return fail("auth", 401, pairing.clinicId);
    if (!limiter.allow(keyId)) return next(deny(req, 429, "rate_limited", pairing.clinicId));
    if (!store.claimNonce(pairing.clinicId, nonce)) return next(deny(req, 409, "replay", pairing.clinicId));
    if (!store.enabled(pairing.clinicId)) return next(deny(req, 403, "not_enabled", pairing.clinicId));
    (res.locals as Locals).pairing = pairing;
    (res.locals as Locals).nonce = nonce;
    (res.locals as Locals).actor = `bridge:${pairing.keyId}`;
    next();
  };

  /** Every response to an authenticated request is signed over the request nonce ("res." label). */
  const reply = (res: Response, status: number, payload: unknown) => {
    const { pairing, nonce } = res.locals as Locals;
    const body = JSON.stringify(payload);
    if (pairing && nonce) {
      const sig = signResponse(pairing.secret, nonce, body);
      res.setHeader("x-bridge-timestamp", sig.timestamp);
      res.setHeader("x-bridge-signature", sig.signature);
    }
    res.setHeader("cache-control", "no-store");
    res.status(status).type("application/json").send(body);
  };

  const json = (req: Request): Body => {
    if (!/^application\/json\b/i.test(req.get("content-type") ?? "")) fail(415, "bad_content_type");
    try {
      return JSON.parse((req.body as Buffer).toString("utf8"));
    } catch {
      return fail(400, "bad_json");
    }
  };

  const location = (res: Response, body: Body) => {
    if (body.locationId !== (res.locals as Locals).pairing.locationId) fail(403, "wrong_location");
  };

  const handle = (fn: (req: Request, res: Response) => Promise<void> | void) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  // ------------------------------------------------------------------ appointments (reminder facts)

  router.post("/appointments", raw("64kb"), authenticate, handle((req, res) => {
    const { pairing, actor } = res.locals as Locals;
    const body = exactKeys(json(req), ["locationId", "appointments"]);
    location(res, body);
    const list = body.appointments;
    need(Array.isArray(list) && list.length >= 1, "bad_value");
    need((list as unknown[]).length <= 200, "too_many_items");
    const now = Date.now();
    // Validate everything first; apply nothing unless the whole request is allowed.
    const items = (list as unknown[]).map((raw0) => {
      const removed = !!raw0 && typeof raw0 === "object" && (raw0 as Body).removed !== undefined;
      const a = removed
        ? exactKeys(raw0, ["appointmentRef", "version", "removed"])
        : exactKeys(raw0, ["appointmentRef", "version", "patientRef", "start", "end", "status", "practitionerName", "firstName"]);
      need(isStr(a.appointmentRef, REF.appointment));
      need(Number.isInteger(a.version) && (a.version as number) >= 0 && (a.version as number) < 2 ** 31);
      if (removed) {
        need(a.removed === true);
        return { ...a, removed: true } as Body;
      }
      need(isStr(a.patientRef, REF.patient));
      // booked or cancelled only: whether a patient came, did not come or arrived never reaches the cloud.
      need(a.status === "booked" || a.status === "cancelled", "bad_status");
      need(isStr(a.start, ISO_OFFSET) && isStr(a.end, ISO_OFFSET));
      const start = Date.parse(a.start as string);
      const end = Date.parse(a.end as string);
      need(!Number.isNaN(start) && !Number.isNaN(end) && end > start);
      if (start <= now || start > now + 60 * DAY) fail(400, "out_of_window");
      need(cleanName(a.practitionerName) && cleanName(a.firstName));
      return a;
    });
    let applied = 0;
    let duplicate = 0;
    const clinicId = pairing.clinicId;
    store.db.transaction(() => {
      for (const a of items) {
        const ref = a.appointmentRef as string;
        const version = a.version as number;
        const current = store.getAppointment(clinicId, ref);
        if (!store.claim(clinicId, `appt:${ref}:${version}${a.removed ? ":removed" : ""}`) || (current && version < current.version)) {
          if (current && version < current.version) audit.record({ actorType: "device", actor, role: "bridge", clinicId, action: "bridge.appointments.upsert", target: `appointment-ref:${ref}`, outcome: "denied", detail: "code=stale_version" });
          duplicate++;
          continue;
        }
        if (a.removed) store.removeAppointment(clinicId, ref);
        else store.upsertAppointment(clinicId, a as Parameters<typeof store.upsertAppointment>[1]);
        audit.record({ actorType: "device", actor, role: "bridge", clinicId, action: a.removed ? "bridge.appointments.remove" : "bridge.appointments.upsert", target: `appointment-ref:${ref}`, outcome: "ok", detail: `version=${version}${a.removed ? "" : ` status=${a.status}`}` });
        applied++;
      }
    });
    reply(res, 200, { ok: true, applied, duplicate });
  }));

  // ------------------------------------------------------------------ outbox (released messages)

  router.post("/outbox", raw("64kb"), authenticate, handle(async (req, res) => {
    const { pairing, actor } = res.locals as Locals;
    const body = exactKeys(json(req), ["locationId", "items"]);
    location(res, body);
    const list = body.items;
    need(Array.isArray(list) && list.length >= 1, "bad_value");
    need((list as unknown[]).length <= 50, "too_many_items");
    const items = (list as unknown[]).map((raw0) => {
      const i = exactKeys(raw0, ["releaseRef", "patientRef", "channel", "purpose", "to", "firstName", "text", "consent", "releasedBy", "releasedAt"], ["appointmentRef", "subject"]);
      need(isStr(i.releaseRef, REF.release) && isStr(i.patientRef, REF.patient));
      need(i.appointmentRef === undefined || i.appointmentRef === null || isStr(i.appointmentRef, REF.appointment));
      need(isStr(i.channel, /^[a-z]{2,12}$/));
      need(i.purpose === "service" || i.purpose === "marketing");
      need(typeof i.to === "string" && (i.to as string).length <= 254);
      if (i.channel === "email") need(isStr(i.to, EMAIL_RE));
      if (i.channel === "sms" || i.channel === "whatsapp") need(isStr(i.to, E164_RE));
      need(isStr(i.firstName, NAME_RE) && isStr(i.releasedBy, NAME_RE));
      need(typeof i.text === "string" && (i.text as string).trim().length >= 1 && (i.text as string).length <= 1000);
      if (i.subject !== undefined && i.subject !== null) need(i.channel === "email" && typeof i.subject === "string" && (i.subject as string).length >= 1 && (i.subject as string).length <= 120);
      need(isStr(i.releasedAt, ISO_OFFSET));
      const c = exactKeys(i.consent, ["channel", "purpose", "status", "express", "givenBy", "recordedAt", "textVersion"]);
      need(isStr(c.channel, /^[a-z]{2,12}$/) && isStr(c.purpose, /^[a-z]{2,12}$/) && isStr(c.status, /^[a-z]{2,12}$/));
      need(typeof c.express === "boolean" && (c.givenBy === "patient" || c.givenBy === "substitute_decision_maker"));
      need(isStr(c.recordedAt, ISO_OFFSET) && isStr(c.textVersion, /^[\w.:-]{1,40}$/));
      return i as unknown as OutboxItem;
    });
    const clinic = store.db.getClinic(pairing.clinicId);
    if (!clinic) return fail(404, "not_found");
    const results = await bridge.receiveOutbox(clinic, items, actor);
    reply(res, 200, { ok: true, results });
  }));

  // ------------------------------------------------------------------ sealed patient forms (v1.2, contract 12.2)

  router.put("/form-key", raw("4kb"), authenticate, handle((req, res) => {
    const { pairing, actor } = res.locals as Locals;
    const body = exactKeys(json(req), ["locationId", "keyId", "publicKey"]);
    location(res, body);
    need(isStr(body.keyId, REF.formKey));
    // An uncompressed P-256 point: 65 bytes, starting 0x04, as base64url (87 characters).
    need(isStr(body.publicKey, /^[A-Za-z0-9_-]{87}$/) && Buffer.from(body.publicKey as string, "base64url")[0] === 4);
    bridge.setFormKey(pairing.clinicId, body.keyId as string, body.publicKey as string);
    audit.record({ actorType: "device", actor, role: "bridge", clinicId: pairing.clinicId, action: "bridge.form_key", target: `form-key:${body.keyId}`, outcome: "ok" });
    reply(res, 200, { ok: true });
  }));

  router.post("/forms", raw("4kb"), authenticate, handle((req, res) => {
    const { pairing, actor } = res.locals as Locals;
    const body = exactKeys(json(req), ["locationId", "formRef", "firstName", "sections", "expiresAt"]);
    location(res, body);
    need(isStr(body.formRef, REF.form) && cleanName(body.firstName));
    const sections = body.sections;
    need(Array.isArray(sections) && sections.length >= 1 && sections.length <= 2 && new Set(sections).size === sections.length
      && (sections as unknown[]).every((x) => x === "details" || x === "intake"));
    need(isStr(body.expiresAt, ISO_OFFSET));
    const exp = Date.parse(body.expiresAt as string);
    need(!Number.isNaN(exp) && exp > Date.now() && exp <= Date.now() + 14 * DAY, "out_of_window");
    const out = bridge.createForm(pairing.clinicId, { formRef: body.formRef as string, firstName: body.firstName as string, sections: sections as string[], expiresAt: new Date(exp).toISOString() });
    if ("code" in out) fail(409, out.code);
    audit.record({ actorType: "device", actor, role: "bridge", clinicId: pairing.clinicId, action: "bridge.form.invite", target: `form:${body.formRef}`, outcome: "ok", detail: `sections=${(sections as string[]).join("+")}` });
    reply(res, 200, { ok: true, url: (out as { url: string }).url });
  }));

  router.post("/forms/revoke", raw("4kb"), authenticate, handle((req, res) => {
    const { pairing, actor } = res.locals as Locals;
    const body = exactKeys(json(req), ["locationId", "formRef"]);
    location(res, body);
    need(isStr(body.formRef, REF.form));
    const revoked = bridge.revokeForm(pairing.clinicId, body.formRef as string);
    audit.record({ actorType: "device", actor, role: "bridge", clinicId: pairing.clinicId, action: "bridge.form.revoke", target: `form:${body.formRef}`, outcome: "ok", detail: `revoked=${revoked}` });
    reply(res, 200, { ok: true, revoked });
  }));

  // ------------------------------------------------------------------ inbox (events, pulled by the laptop)

  router.get("/inbox", authenticate, handle((req, res) => {
    const { pairing, actor } = res.locals as Locals;
    for (const k of Object.keys(req.query)) if (k !== "after" && k !== "limit") fail(400, "unknown_field");
    const after = req.query.after === undefined ? "0" : req.query.after;
    const limit = req.query.limit === undefined ? "100" : req.query.limit;
    if (typeof after !== "string" || !/^\d{1,15}$/.test(after)) fail(400, "bad_value");
    if (typeof limit !== "string" || !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) fail(400, "bad_value");
    const { events, more } = store.readQueue(pairing.clinicId, Number(after), Number(limit));
    // Re-checked against the event table on the way out: anything outside it is never sent.
    const allowed = events.filter((e) => !eventProblem(e));
    if (allowed.length !== events.length) audit.record({ actorType: "system", actor: "bridge", clinicId: pairing.clinicId, action: "bridge.queue.blocked", outcome: "error", detail: `count=${events.length - allowed.length}` });
    const cursor = events.length ? String(events.at(-1)!.seq) : String(after);
    audit.record({ actorType: "device", actor, role: "bridge", clinicId: pairing.clinicId, action: "bridge.pull", target: "inbox", outcome: "ok", detail: `events=${allowed.length}` });
    reply(res, 200, { ok: true, cursor, more, events: allowed });
  }));

  router.post("/inbox/ack", raw("16kb"), authenticate, handle((req, res) => {
    const { pairing, actor } = res.locals as Locals;
    const body = exactKeys(json(req), ["locationId", "ids"]);
    location(res, body);
    need(Array.isArray(body.ids) && (body.ids as unknown[]).length <= 500 && (body.ids as unknown[]).every((id) => isStr(id, REF.event)));
    // Only the key's own clinic: an id from another clinic's queue counts as not found.
    const deleted = store.ack(pairing.clinicId, [...new Set(body.ids as string[])]);
    audit.record({ actorType: "device", actor, role: "bridge", clinicId: pairing.clinicId, action: "bridge.ack", target: "inbox", outcome: "ok", detail: `count=${deleted}` });
    reply(res, 200, { ok: true, deleted });
  }));

  router.use((_req: Request, _res: Response, next: NextFunction) => next(new BridgeError(404, "not_found")));

  // Same shape for every failure. Never echoes the body; never logs it.
  router.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let code = "internal";
    if (err instanceof BridgeError) {
      status = err.status;
      code = err.message;
    } else if ((err as { type?: string }).type === "entity.too.large") {
      status = 413;
      code = "body_too_large";
    } else if (typeof (err as { status?: number }).status === "number" && (err as { status: number }).status < 500) {
      status = 400;
      code = "bad_request";
    } else {
      console.error(`[bridge] ${req.method} ${req.path} failed (${(err as Error)?.name ?? "error"})`);
    }
    const locals = res.locals as Partial<Locals>;
    if (status !== 500 && locals.pairing && !["auth", "stale_timestamp", "replay", "rate_limited", "not_enabled"].includes(code)) {
      audit.record({ actorType: "device", actor: locals.actor ?? "bridge", role: "bridge", clinicId: locals.pairing.clinicId, action: "bridge.denied", target: `${req.method} ${req.path}`.slice(0, 80), outcome: "denied", detail: `code=${code}` });
    } else if (code === "body_too_large") {
      audit.record({ actorType: "device", actor: `bridge:${keyLabel(req)}`, role: "bridge", action: "bridge.denied", target: `${req.method} ${req.path}`.slice(0, 80), outcome: "denied", detail: `code=${code}` });
    }
    reply(res, status, { ok: false, error: code });
  });

  return router;
}
