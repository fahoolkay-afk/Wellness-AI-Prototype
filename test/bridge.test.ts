// The EHRM bridge (docs/INTEGRATION-CONTRACT.md): every control on the front desk side.
// Synthetic data only.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.ts";
import { runTool } from "../src/ai/tools.ts";
import { signRequest } from "../src/bridge/auth.ts";
import { eventProblem } from "../src/bridge/events.ts";
import { changeRequestToFhir, deliveryToCommunication, releaseToCommunicationRequest } from "../src/bridge/fhir.ts";
import { DISCLOSURE_PLACEHOLDER, PASSED_TO_CLINIC } from "../src/bridge/service.ts";
import { toFhirConsent } from "../src/consent.ts";
import { randomToken } from "../src/security/crypto.ts";
import { api, grantService, listen, recordingFetch, setup, signIn, testConfig } from "./helpers.ts";

const servers: { close: () => Promise<void> }[] = [];
after(() => Promise.all(servers.map((s) => s.close())));

const ref = (p: string) => `${p}_${randomToken(16).slice(0, 22)}`;
const inDays = (d: number, h = 0) => new Date(Date.now() + d * 864e5 + h * 3600_000).toISOString();
const PHONE = "+14165550123";

type Opts = Parameters<typeof setup>[0] & { configure?: Parameters<typeof testConfig>[0] };

async function bridgeSetup(opts: Opts = {}) {
  const s = setup({ ...opts, config: opts.config ?? testConfig(opts.configure) });
  const { keyId, secret } = s.bridge.store.pair(s.clinicId, "loc_1");
  const server = await listen(createApp(s));
  servers.push(server);
  const url = server.url;

  async function call(method: string, path: string, body?: unknown, o: { key?: string; secret?: string; nonce?: string; ts?: number; raw?: string; sign?: boolean; headers?: Record<string, string> } = {}) {
    const raw = o.raw ?? (body === undefined ? "" : JSON.stringify(body));
    const nonce = o.nonce ?? randomToken(24);
    const sig = signRequest(o.secret ?? secret, method, path, nonce, raw, o.ts);
    const headers: Record<string, string> = o.sign === false ? {} : {
      "x-bridge-key-id": o.key ?? keyId, "x-bridge-nonce": nonce, "x-bridge-timestamp": sig.timestamp, "x-bridge-signature": sig.signature,
    };
    if (method !== "GET") headers["content-type"] = "application/json";
    const res = await fetch(`${url}${path}`, { method, headers: { ...headers, ...o.headers }, body: method === "GET" ? undefined : raw });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, text, headers: res.headers, nonce };
  }

  const fact = (over: Record<string, unknown> = {}) => ({
    appointmentRef: ref("apt"), version: 1, patientRef: ref("pt"), start: inDays(2), end: inDays(2, 1),
    status: "booked", practitionerName: "Sam", firstName: "Alex", ...over,
  });
  const item = (over: Record<string, unknown> = {}, consentOver: Record<string, unknown> = {}) => {
    const channel = (over.channel as string) ?? "sms";
    const purpose = (over.purpose as string) ?? "service";
    return {
      releaseRef: ref("rel"), patientRef: ref("pt"), channel, purpose, to: PHONE, firstName: "Alex", subject: null,
      text: "Hi Alex, a reminder of your visit on Tuesday at 2:00 PM with Sam. Reply C to confirm or CHANGE to ask for a new time.",
      consent: { channel, purpose, status: "granted", express: true, givenBy: "patient", recordedAt: inDays(-5), textVersion: `${channel}.care.v1`, ...consentOver },
      releasedBy: "Sam", releasedAt: inDays(0, -1), ...over,
    };
  };
  const push = (appointments: unknown[]) => call("POST", "/bridge/v1/appointments", { locationId: "loc_1", appointments });
  const outbox = (items: unknown[]) => call("POST", "/bridge/v1/outbox", { locationId: "loc_1", items });
  const pull = (q = "") => call("GET", `/bridge/v1/inbox${q}`);
  return { s, url, keyId, secret, call, fact, item, push, outbox, pull };
}

const auditRows = (s: ReturnType<typeof setup>) => s.db.sql.prepare("SELECT * FROM access_events ORDER BY id").all() as Record<string, unknown>[];

// ------------------------------------------------------------------ authentication

test("bridge: unsigned, tampered, stale, replayed and unknown-key requests are refused and audited", async () => {
  const b = await bridgeSetup();
  const unsigned = await b.call("GET", "/bridge/v1/inbox", undefined, { sign: false });
  assert.equal(unsigned.status, 401);
  assert.deepEqual(unsigned.data, { ok: false, error: "auth" });
  assert.equal(unsigned.headers.get("x-bridge-signature"), null, "nothing is signed for an unauthenticated caller");

  assert.equal((await b.call("GET", "/bridge/v1/inbox", undefined, { secret: "wrong-secret" })).data.error, "auth");
  assert.equal((await b.call("GET", "/bridge/v1/inbox", undefined, { key: "brk_nope" })).data.error, "auth");
  assert.equal((await b.call("GET", "/bridge/v1/inbox", undefined, { nonce: "short" })).data.error, "auth");
  const stale = await b.call("GET", "/bridge/v1/inbox", undefined, { ts: Math.floor(Date.now() / 1000) - 600 });
  assert.equal(stale.status, 401);
  assert.equal(stale.data.error, "stale_timestamp");

  // Body changed after signing.
  const body = JSON.stringify({ locationId: "loc_1", ids: [] });
  const nonce = randomToken(24);
  const sig = signRequest(b.secret, "POST", "/bridge/v1/inbox/ack", nonce, body);
  const tampered = await fetch(`${b.url}/bridge/v1/inbox/ack`, {
    method: "POST", body: body.replace("[]", '["evt_aaaaaaaaaaaaaaaaaaaaaa"]'),
    headers: { "content-type": "application/json", "x-bridge-key-id": b.keyId, "x-bridge-nonce": nonce, "x-bridge-timestamp": sig.timestamp, "x-bridge-signature": sig.signature },
  });
  assert.equal(tampered.status, 401);

  // A signature for one endpoint cannot be used on another.
  const n2 = randomToken(24);
  const s2 = signRequest(b.secret, "GET", "/bridge/v1/inbox", n2, "");
  const moved = await fetch(`${b.url}/bridge/v1/inbox?after=5`, { headers: { "x-bridge-key-id": b.keyId, "x-bridge-nonce": n2, "x-bridge-timestamp": s2.timestamp, "x-bridge-signature": s2.signature } });
  assert.equal(moved.status, 401);

  // Replay: the same signed request twice.
  const first = await b.call("GET", "/bridge/v1/inbox", undefined, { nonce: "replay-nonce-0123456789abc" });
  assert.equal(first.status, 200);
  const again = await b.call("GET", "/bridge/v1/inbox", undefined, { nonce: "replay-nonce-0123456789abc" });
  assert.equal(again.status, 409);
  assert.equal(again.data.error, "replay");

  const denied = auditRows(b.s).filter((r) => r.action === "bridge.denied");
  assert.ok(denied.length >= 7);
  assert.ok(denied.every((r) => r.actor_type === "device" && /^code=/.test(String(r.detail))));
});

test("bridge: every response to an authenticated request is signed over the request nonce", async () => {
  const b = await bridgeSetup();
  const res = await b.pull();
  assert.equal(res.status, 200);
  const ts = res.headers.get("x-bridge-timestamp")!;
  const expected = `sha256=${createHmac("sha256", b.secret).update(`${ts}.res.${res.nonce}\n${res.text}`).digest("hex")}`;
  assert.equal(res.headers.get("x-bridge-signature"), expected);
  // The "res." label: a request signature over the same bytes would not match.
  assert.notEqual(signRequest(b.secret, "GET", "/bridge/v1/inbox", res.nonce, res.text, Number(ts)).signature, expected);
  const err = await b.call("POST", "/bridge/v1/inbox/ack", { locationId: "loc_1", ids: [], extra: 1 });
  assert.equal(err.status, 400);
  assert.ok(err.headers.get("x-bridge-signature"), "refusals after authentication are signed too");
});

test("bridge: rate limit per key", async () => {
  const b = await bridgeSetup();
  const results = [];
  for (let i = 0; i < 62; i++) results.push((await b.pull()).status);
  assert.equal(results.filter((s) => s === 429).length, 2);
});

test("bridge: wrong clinic and wrong location are refused; a key reads and acks only its own clinic", async () => {
  const a = await bridgeSetup();
  // A second clinic on the same server with its own key.
  const clinicB = a.s.db.createClinic({ ...a.s.clinic().profile, name: "Second Clinic" });
  const keyB = a.s.bridge.store.pair(clinicB, "loc_b");
  const contact = a.s.db.createContact(a.s.clinicId, { name: "Alex Test", phone: PHONE, external_id: ref("pt") });
  a.s.bridge.withdrawn(a.s.clinicId, contact.id, "sms", ["service"], "staff", "contact");
  const own = await a.pull();
  assert.equal(own.data.events.length, 1);

  const asB = await a.call("GET", "/bridge/v1/inbox", undefined, { key: keyB.keyId, secret: keyB.secret });
  assert.equal(asB.status, 200);
  assert.equal(asB.data.events.length, 0, "clinic B's key sees nothing of clinic A");
  const ackB = await a.call("POST", "/bridge/v1/inbox/ack", { locationId: "loc_b", ids: [own.data.events[0].id] }, { key: keyB.keyId, secret: keyB.secret });
  assert.equal(ackB.data.deleted, 0, "an id from another clinic's queue counts as not found");
  assert.equal((await a.pull()).data.events.length, 1);

  const wrongLoc = await a.call("POST", "/bridge/v1/inbox/ack", { locationId: "loc_b", ids: [] });
  assert.equal(wrongLoc.status, 403);
  assert.equal(wrongLoc.data.error, "wrong_location");

  // Re-pairing kills the old key.
  const repaired = a.s.bridge.store.pair(a.s.clinicId, "loc_1");
  assert.equal((await a.pull()).data.error, "auth");
  assert.equal((await a.call("GET", "/bridge/v1/inbox", undefined, { key: repaired.keyId, secret: repaired.secret })).status, 200);
});

test("bridge: old EHR key refused on /bridge/v1, bridge key refused on /webhooks/ehr, and /webhooks/ehr shut for bridge clinics", async () => {
  const b = await bridgeSetup({ configure: (c) => { c.edition = "ehr"; c.ehr = { baseUrl: "http://127.0.0.1:9", apiKey: "k", timeoutMs: 1000 }; } });
  b.s.db.setEhrIntegration(b.s.clinicId, "loc_1", "ehr_key_1", "ehr-secret-1");
  assert.equal((await b.call("GET", "/bridge/v1/inbox", undefined, { key: "ehr_key_1", secret: "ehr-secret-1" })).data.error, "auth");

  const ehrPost = (keyId: string, secret: string) => {
    const body = JSON.stringify({ id: "evt-123456", type: "appointment.created", locationId: "loc_1", appointment: { id: "a1", patientId: "p1", serviceId: "s", practitionerId: "p", start: inDays(2), end: inDays(2, 1), status: "booked" }, patient: { id: "p1", firstName: "Alex", lastName: "Test", phone: PHONE } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", secret).update(`${ts}.`).update(body).digest("hex");
    return fetch(`${b.url}/webhooks/ehr`, { method: "POST", body, headers: { "content-type": "application/json", "x-ehr-key-id": keyId, "x-ehr-timestamp": ts, "x-ehr-signature": `sha256=${sig}` } });
  };
  assert.equal((await ehrPost(b.keyId, b.secret)).status, 403, "the bridge key does not open the old webhook");
  assert.equal((await ehrPost("ehr_key_1", "ehr-secret-1")).status, 403, "the old webhook refuses a bridge clinic");
  assert.equal(b.s.db.findContactByExternalId(b.s.clinicId, "p1"), undefined, "nothing was applied");
  assert.ok(auditRows(b.s).some((r) => r.action === "ehr.webhook.denied"));
});

test("bridge: oversize body, unknown fields and bad values are refused", async () => {
  const b = await bridgeSetup();
  const big = await b.call("POST", "/bridge/v1/inbox/ack", undefined, { raw: JSON.stringify({ locationId: "loc_1", ids: [], pad: "x".repeat(20_000) }) });
  assert.equal(big.status, 413);
  assert.equal(big.data.error, "body_too_large");
  assert.equal((await b.push([{ ...b.fact(), notes: "reception note" }])).data.error, "unknown_field");
  assert.equal((await b.push([{ ...b.fact(), serviceName: "x" }])).data.error, "unknown_field");
  assert.equal((await b.call("POST", "/bridge/v1/appointments", { locationId: "loc_1", appointments: [b.fact()], clinicId: 2 })).data.error, "unknown_field");
  assert.equal((await b.outbox([{ ...b.item(), planCard: "..." }])).data.error, "unknown_field");
  assert.equal((await b.outbox([b.item({}, { email: "x" })])).data.error, "unknown_field");
  assert.equal((await b.pull("?after=abc")).status, 400);
  assert.equal((await b.pull("?limit=0")).status, 400);
  assert.equal((await b.pull("?limit=101")).status, 400);
  assert.equal((await b.pull("?clinic=2")).data.error, "unknown_field");
  assert.equal((await b.call("POST", "/bridge/v1/inbox/ack", undefined, { raw: "{not json" })).data.error, "bad_json");
  assert.equal((await b.call("POST", "/bridge/v1/inbox/ack", { locationId: "loc_1", ids: ["1 OR 1=1"] })).data.error, "bad_value");
  assert.equal((await b.push(Array.from({ length: 201 }, () => b.fact()))).data.error, "too_many_items");
});

// ------------------------------------------------------------------ appointments mirror

test("bridge: reminder facts are minimum fields, future booked/cancelled only, and fire no automation", async () => {
  const b = await bridgeSetup();
  for (const status of ["fulfilled", "noshow", "arrived"]) assert.equal((await b.push([b.fact({ status })])).data.error, "bad_status", status);
  assert.equal((await b.push([b.fact({ start: inDays(-1), end: inDays(-1, 1) })])).data.error, "out_of_window", "past visits never cross");
  assert.equal((await b.push([b.fact({ start: inDays(61), end: inDays(61, 1) })])).data.error, "out_of_window");
  assert.equal((await b.push([b.fact({ practitionerName: "Dr Sam" })])).data.error, "bad_value", "the wording guard runs on names");
  assert.equal((await b.push([b.fact({ firstName: "Alex; drop table" })])).data.error, "bad_value");

  const f = b.fact();
  const ok = await b.push([f]);
  assert.deepEqual(ok.data, { ok: true, applied: 1, duplicate: 0 });
  assert.equal((await b.push([f])).data.duplicate, 1, "same ref and version applies once");
  const mirror = b.s.bridge.store.getAppointment(b.s.clinicId, f.appointmentRef)!;
  assert.equal(mirror.first_name, "Alex");
  const raw = b.s.db.sql.prepare("SELECT * FROM bridge_appointments").get() as Record<string, unknown>;
  assert.ok(String(raw.first_name).startsWith("e1:"), "first name sealed at rest");
  assert.deepEqual(Object.keys(raw).sort(), ["appointment_ref", "clinic_id", "confirm_relayed_at", "ends_at", "first_name", "patient_ref", "practitioner_name", "starts_at", "status", "updated_at", "version"]);
  assert.equal((b.s.db.sql.prepare("SELECT COUNT(*) n FROM appointments").get() as { n: number }).n, 0, "nothing in the clinic calendar, so no reminder automation can fire");
  assert.equal((b.s.db.sql.prepare("SELECT COUNT(*) n FROM automation_runs").get() as { n: number }).n, 0);

  // A lower version is refused; a removed item deletes the mirror.
  assert.equal((await b.push([{ ...f, version: 3, status: "cancelled" }])).data.applied, 1);
  assert.equal((await b.push([{ ...f, version: 2 }])).data.duplicate, 1);
  assert.equal(b.s.bridge.store.getAppointment(b.s.clinicId, f.appointmentRef)!.status, "cancelled");
  assert.ok(auditRows(b.s).some((r) => r.detail === "code=stale_version"));
  assert.equal((await b.push([{ appointmentRef: f.appointmentRef, version: 4, removed: true }])).data.applied, 1);
  assert.equal(b.s.bridge.store.getAppointment(b.s.clinicId, f.appointmentRef), undefined);
  assert.equal((await b.push([{ appointmentRef: f.appointmentRef, version: 5, removed: true, status: "fulfilled" }])).data.error, "unknown_field", "a removal carries no outcome");
});

// ------------------------------------------------------------------ outbox

test("bridge: a released reminder is sent on exactly its channel; the consent fact is evidence, not a standing grant", async () => {
  const fetcher = recordingFetch();
  const b = await bridgeSetup({ fetchImpl: fetcher.impl, configure: (c) => { c.sms.twilioAccountSid = "AC1"; c.sms.twilioAuthToken = "tok"; c.publicUrl = "https://clinic.example"; } });
  const f = b.fact();
  await b.push([f]);
  const it = b.item({ patientRef: f.patientRef, appointmentRef: f.appointmentRef });
  const res = await b.outbox([it]);
  assert.deepEqual(res.data, { ok: true, results: [{ releaseRef: it.releaseRef, result: "accepted", code: null }] });
  assert.equal(fetcher.calls.filter((c) => c.url.includes("twilio.com")).length, 1, "sent once, by SMS");
  const contact = b.s.db.findContactByExternalId(b.s.clinicId, it.patientRef)!;
  assert.equal(contact.phone, PHONE);
  assert.equal(contact.email, null, "only the one address for the released channel");
  const conv = b.s.db.conversationForContact(contact, "sms");
  const msg = b.s.db.listMessages(conv.id).at(-1)!;
  assert.equal(msg.body, it.text);
  assert.equal(msg.status, "sent");
  assert.equal(msg.author_name, "Released in the EHRM by Sam");

  // The same release twice is applied once, and the repeat is told the outcome recorded the first time.
  assert.deepEqual((await b.outbox([it])).data.results[0], { releaseRef: it.releaseRef, result: "accepted", code: null });
  assert.equal(fetcher.calls.filter((c) => c.url.includes("twilio.com")).length, 1);

  // Evidence on the item only: the cloud ledger holds no grant, so no cloud sender can use it.
  assert.ok(!b.s.consents.history(contact.id).some((r) => r.basis === "ehr" || r.status === "granted"));
  assert.equal(b.s.consents.check(contact.id, "sms", "service").ok, false);
  const campaign = await b.s.inbox.sendToContact(b.s.clinic(), contact, "sms", () => "Hi Alex, spring hours update.", { authorName: "Campaign", purpose: "service" });
  assert.ok("skipped" in campaign && /use_ehrm_release/.test(campaign.skipped));
  b.s.bridge.store.unpair(b.s.clinicId);
  const afterUnpair = await b.s.inbox.sendToContact(b.s.clinic(), contact, "sms", () => "Hi Alex, spring hours update.", { authorName: "Campaign", purpose: "service" });
  assert.ok("skipped" in afterUnpair && /No consent/.test(afterUnpair.skipped), "even with the bridge off, the carried fact grants nothing");

});

test("bridge: delivery status goes back on the next pull (send result, then carrier receipt)", async () => {
  const fetcher = recordingFetch();
  const b = await bridgeSetup({ fetchImpl: fetcher.impl, configure: (c) => { c.sms.twilioAccountSid = "AC1"; c.sms.twilioAuthToken = "tok"; c.publicUrl = "https://clinic.example"; } });
  const it = b.item();
  await b.outbox([it]);
  const contact = b.s.db.findContactByExternalId(b.s.clinicId, it.patientRef)!;
  const msg = b.s.db.listMessages(b.s.db.conversationForContact(contact, "sms").id).at(-1)!;
  // Signed Twilio status callback.
  const params = { MessageSid: msg.external_id!, MessageStatus: "delivered" };
  const data = "https://clinic.example/webhooks/twilio/status" + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
  const sig = createHmac("sha1", "tok").update(data).digest("base64");
  assert.equal((await fetch(`${b.url}/webhooks/twilio/status`, { method: "POST", body: new URLSearchParams(params), headers: { "x-twilio-signature": sig } })).status, 204);
  const events = (await b.pull()).data.events.filter((e: any) => e.type === "delivery.status");
  assert.deepEqual(events.map((e: any) => [e.releaseRef, e.status, e.code]), [[it.releaseRef, "sent", null], [it.releaseRef, "delivered", null]]);
  assert.ok(events[1].seq > events[0].seq, "per-item increasing seq");
  for (const e of events) assert.equal(eventProblem(e), undefined);
});

test("bridge: consent fact must match channel and purpose exactly; marketing needs express; newer cloud withdrawal wins", async () => {
  const b = await bridgeSetup();
  const results = async (it: ReturnType<typeof b.item>) => (await b.outbox([it])).data.results[0];
  assert.equal((await results(b.item({}, { channel: "email" }))).code, "consent_mismatch", "email consent does not cover SMS (N5)");
  assert.equal((await results(b.item({}, { purpose: "marketing" }))).code, "consent_mismatch");
  assert.equal((await results(b.item({ purpose: "marketing" }, { express: false }))).code, "consent_missing");
  assert.equal((await results(b.item({}, { status: "withdrawn" }))).code, "consent_missing");
  assert.equal((await results(b.item({}, { recordedAt: inDays(2) }))).code, "consent_missing", "a fact from the future is not consent");

  // The patient texted STOP to the cloud: a carrier STOP stands whatever the EHRM says.
  const patientRef = ref("pt");
  const contact = b.s.db.createContact(b.s.clinicId, { name: "Alex", phone: PHONE, external_id: patientRef });
  b.s.consents.withdraw(b.s.clinicId, contact.id, "sms", "patient texted STOP", "keyword", "patient");
  const refusedItem = b.item({ patientRef }, { recordedAt: inDays(0, -0.5) });
  assert.equal((await results(refusedItem)).code, "consent_withdrawn");
  // The laptop never got that answer and pushes again: it must hear "refused", never "accepted" or a bare duplicate.
  assert.deepEqual((await b.outbox([refusedItem])).data.results[0], { releaseRef: refusedItem.releaseRef, result: "refused", code: "consent_withdrawn" });

  // Email: a withdrawal newer than the EHRM fact wins; an older one gives way to the newer fact.
  const ref2 = ref("pt");
  const c2 = b.s.db.createContact(b.s.clinicId, { name: "Sky", email: "sky@example.test", external_id: ref2 });
  b.s.consents.record({ clinicId: b.s.clinicId, contactId: c2.id, channel: "email", purpose: "service", status: "withdrawn", basis: "staff", source: "asked", by: "staff" });
  const emailItem = (recordedAt: string) => b.item({ patientRef: ref2, channel: "email", to: "sky@example.test", subject: "Your visit" }, { recordedAt });
  assert.equal((await results(emailItem(inDays(-5)))).code, "consent_withdrawn");
  assert.equal((await results(emailItem(new Date(Date.now() + 30_000).toISOString()))).result, "accepted");
});

test("bridge: pinned wording guard on body and subject, links, staleness, channel and privacy checks", async () => {
  const b = await bridgeSetup({ profile: { wordingRules: [] } });
  const code = async (it: ReturnType<typeof b.item>) => (await b.outbox([it])).data.results[0].code;
  const email = (over: Record<string, unknown>) => b.item({ channel: "email", to: "alex@example.test", subject: "Your visit", ...over });
  assert.equal(await code(email({ subject: "Your treatment plan" })), "wording", "banned word in the subject");
  assert.equal(await code(email({ subject: "Message from Dr. Sam" })), "wording");
  assert.equal(await code(b.item({ text: "Hi Alex, our AI assistant booked you." })), "wording", "a clinic setting cannot loosen the guard for bridge items");
  assert.equal(await code(b.item({ text: `Hi Alex. ${DISCLOSURE_PLACEHOLDER}` })), "wording", "the disclosure placeholder is blocked from patient text");
  assert.equal(await code(b.item({ text: "Your exercises: http://127.0.0.1:8787/x/abc123" })), "link_not_allowed");
  assert.equal(await code(b.item({ text: "See https://example.org/x/tok" })), "link_not_allowed");
  assert.equal(await code(b.item({ text: "Open http://localhost/plan" })), "link_not_allowed");
  assert.equal(await code(b.item({ text: "Book at https://evil.example.net/book" })), "link_not_allowed");
  assert.equal(await code(b.item({ text: `Book at ${b.s.clinic().profile.website}` })), null);
  assert.equal(await code(b.item({ releasedAt: inDays(-8) })), "stale_release");
  assert.equal(await code(b.item({ appointmentRef: ref("apt") })), "stale_release", "a visit the cloud does not hold as booked");
  assert.equal(await code(b.item({ channel: "voice" })), "channel_not_allowed");
  assert.equal(await code(b.item({ channel: "messenger", to: "psid-1" })), "channel_not_allowed");
  assert.equal(await code(b.item({ text: "Hi Alex, your physio visit for your sore back is Tuesday." })), "privacy");
  const sub = await b.outbox([b.item({ subject: "Hello" })]);
  assert.equal(sub.data.error, "bad_value", "a subject is for email only");
});

test("bridge: a cancelled or moved visit holds its reminder (stale_release)", async () => {
  const b = await bridgeSetup();
  const f = b.fact();
  await b.push([f]);
  await b.push([{ ...f, version: 2, status: "cancelled" }]);
  assert.equal((await b.outbox([b.item({ patientRef: f.patientRef, appointmentRef: f.appointmentRef })])).data.results[0].code, "stale_release");
});

test("bridge: WhatsApp needs the 24-hour window; addresses are never overwritten or merged", async () => {
  const b = await bridgeSetup();
  const wa = (over: Record<string, unknown> = {}) => b.item({ channel: "whatsapp", to: PHONE, ...over });
  assert.equal((await b.outbox([wa()])).data.results[0].code, "window_closed");

  // Flow A: the patient wrote on WhatsApp, so the confirmation lands in that thread inside the window.
  await b.s.inbox.receive({ channel: "whatsapp", to: "wa-phone-id", from: "14165550199", body: "hi, can I book next week?", externalId: "wamid.flowA" });
  await b.s.inbox.idle();
  const it = wa({ to: "+14165550199" });
  assert.equal((await b.outbox([it])).data.results[0].result, "accepted");
  const linked = b.s.db.findContactByExternalId(b.s.clinicId, it.patientRef)!;
  assert.equal(linked.whatsapp_id, "14165550199", "the one unlinked thread on that address is linked to the ref");
  assert.ok(b.s.db.listMessages(b.s.db.conversationForContact(linked, "whatsapp").id).some((m) => m.body === it.text));

  // Address changed on the laptop: never overwritten; staff confirm a proposal first.
  const changed = await b.outbox([b.item({ patientRef: it.patientRef, channel: "sms", to: "+14165550177" })]);
  assert.equal(changed.data.results[0].code, "address_pending_review");
  assert.equal(b.s.db.getContact(linked.id)!.phone, "+14165550199");
  assert.equal(b.s.db.listProposals(linked.id)[0].value, "+14165550177");

  // A sibling with another patientRef on the same phone gets a contact of their own.
  const sibling = await b.outbox([b.item({ to: "+14165550199" })]);
  assert.equal(sibling.data.results[0].result, "accepted");
  const rows = b.s.bridge.store.contactsWithAddress(b.s.clinicId, "sms", "+14165550199");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].external_id, rows[1].external_id);
});

test("bridge: quiet hours hold a release, which goes out after every check runs again", async () => {
  const b = await bridgeSetup({ profile: { quietHours: { start: "24:00", end: "24:00" } } });
  const it = b.item();
  assert.equal((await b.outbox([it])).data.results[0].result, "accepted");
  const contact = b.s.db.findContactByExternalId(b.s.clinicId, it.patientRef)!;
  const conv = b.s.db.conversationForContact(contact, "sms");
  assert.equal(b.s.db.listMessages(conv.id).length, 0, "nothing sent during quiet hours");
  await b.s.bridge.tick();
  assert.equal(b.s.db.listMessages(conv.id).length, 0, "still quiet");
  b.s.db.updateClinicProfile(b.s.clinicId, { ...b.s.clinic().profile, quietHours: { start: "00:00", end: "24:00" } });
  // The patient texted STOP overnight: the held item is not sent.
  b.s.consents.withdraw(b.s.clinicId, contact.id, "sms", "STOP", "keyword", "patient");
  await b.s.bridge.tick();
  assert.equal(b.s.db.listMessages(conv.id).length, 0);
  const status = (await b.pull()).data.events.find((e: any) => e.type === "delivery.status");
  assert.deepEqual([status.status, status.code], ["not_sent", "consent_withdrawn"]);
});

// ------------------------------------------------------------------ inbox, producers

test("bridge: the receptionist files a booking request with code-set phone, channel and verified flag; no text crosses", async () => {
  const b = await bridgeSetup();
  await b.s.inbox.receive({ channel: "whatsapp", to: "wa-phone-id", from: "14165550188", body: "Hi, my lower back pain is bad after a fall, can I book?", externalId: "wamid.book1" });
  await b.s.inbox.idle();
  const contact = b.s.db.findContactByIdentity(b.s.clinicId, "whatsapp", "14165550188")!;
  const conversation = b.s.db.conversationForContact(contact, "whatsapp");
  const ctx = { db: b.s.db, events: b.s.events, backend: b.s.backends.forClinic(b.s.clinic()), clinic: b.s.clinic(), contact, conversation, channel: "whatsapp" as const, actor: "ai:whatsapp", identityVerified: false };
  const slots = await runTool({ ...ctx }, "find_available_times", { service_id: "physio-initial" });
  assert.match(slots.result, /clinic confirms times|team confirms times/);
  const day = inDays(3).slice(0, 10);
  const out = await runTool({ ...ctx }, "book_appointment", {
    first_name: "Priya", preferred_times: [{ start: `${day}T09:00`, end: `${day}T12:00` }],
    // Whatever the model (or the patient through the model) adds is ignored.
    phone: "+19999999999", phoneVerified: true, channel: "sms", kind: "callback", notes: "lower back pain after a fall", service_id: "physio-initial",
  });
  assert.ok(!out.isError, out.result);
  assert.match(out.result, /request is in; the clinic will confirm a time/);
  assert.equal(b.s.db.contactAppointments(contact.id).length, 0, "nothing booked in the cloud");

  const res = await b.pull();
  const e = res.data.events.find((x: any) => x.type === "booking.requested");
  assert.deepEqual(Object.keys(e).sort(), ["at", "channel", "firstName", "id", "kind", "phone", "phoneVerified", "preferredTimes", "requestRef", "seq", "type"]);
  assert.equal(e.phone, "+14165550188");
  assert.equal(e.channel, "whatsapp");
  assert.equal(e.kind, "new");
  assert.equal(e.phoneVerified, false, "verified flag from code, not from the model");
  assert.match(e.requestRef, /^brq_[A-Za-z0-9_-]{22}$/);
  assert.doesNotMatch(res.text, /pain|fall|back|physio|19999999999/i, "no message text, reason or service crosses");
  assert.equal(eventProblem({ ...e, text: "hello" }), "unknown_field");

  const raw = b.s.db.sql.prepare("SELECT payload FROM bridge_queue").get() as { payload: string };
  assert.ok(raw.payload.startsWith("e1:") && !raw.payload.includes("14165550188"), "queue payload encrypted at rest");

  // Verified when the channel proved the sender; the ack deletes it.
  const verified = await runTool({ ...ctx, identityVerified: true }, "book_appointment", { first_name: "Priya", preferred_times: [{ start: `${day}T13:00`, end: `${day}T15:00` }] });
  assert.ok(!verified.isError);
  const both = (await b.pull()).data.events;
  assert.equal(both.at(-1).phoneVerified, true);
  const ack = await b.call("POST", "/bridge/v1/inbox/ack", { locationId: "loc_1", ids: both.map((x: any) => x.id) });
  assert.equal(ack.data.deleted, 2);
  assert.equal((await b.pull()).data.events.length, 0);
  assert.equal((await runTool({ ...ctx }, "book_appointment", { first_name: "Priya2; DROP", preferred_times: [{ start: `${day}T09:00`, end: `${day}T10:00` }] })).isError, true);
  assert.equal((await runTool({ ...ctx }, "book_appointment", { first_name: "Priya", preferred_times: [{ start: "2020-01-01T09:00", end: "2020-01-01T10:00" }] })).isError, true, "past times refused");
});

test("bridge: staff file a booking request by hand; staff and the receptionist cannot start a conversation", async () => {
  const b = await bridgeSetup();
  const cookie = await signIn(b.s, b.url, "front_desk");
  const call = api(b.url, cookie);
  await b.s.inbox.receive({ channel: "sms", to: "+14165550100", from: PHONE, body: "can I come in thursday?", externalId: "SMflow1" });
  await b.s.inbox.idle();
  const contact = b.s.db.findContactByIdentity(b.s.clinicId, "sms", PHONE)!;
  const conv = b.s.db.conversationForContact(contact, "sms");
  const day = inDays(3).slice(0, 10);
  const filed = await call("POST", `/api/conversations/${conv.id}/booking-request`, { firstName: "Alex", preferredTimes: [{ start: `${day}T09:00`, end: `${day}T11:00` }] });
  assert.equal(filed.status, 201, JSON.stringify(filed.data));
  assert.equal((await b.pull()).data.events.filter((e: any) => e.type === "booking.requested").length, 1);

  // A reply inside 24 hours is allowed; starting a conversation is not.
  assert.equal((await call("POST", `/api/conversations/${conv.id}/reply`, { body: "Thanks, we have passed this on." })).status, 200);
  const other = b.s.db.createContact(b.s.clinicId, { name: "Sam Quiet", phone: "+14165550166" });
  grantService(b.s, other.id, "sms");
  const otherConv = b.s.db.conversationForContact(other, "sms");
  const started = await call("POST", `/api/conversations/${otherConv.id}/reply`, { body: "Hi Sam, time for a visit?" });
  assert.equal(started.status, 400);
  assert.match(started.data.error, /use_ehrm_release/);

  // Cloud automations and campaigns are off; the cloud calendar is not used.
  const owner = api(b.url, await signIn(b.s, b.url, "owner"));
  assert.equal((await owner("POST", `/api/clinics/${b.s.clinicId}/campaigns`, { name: "x", template: "Hi", purpose: "marketing" })).status, 409);
  assert.equal((await owner("POST", `/api/clinics/${b.s.clinicId}/appointments`, { contactId: other.id, start: `${day}T09:00`, serviceId: "x", practitionerId: "y" })).status, 409);
  const before = b.s.db.listMessages(otherConv.id).length;
  await b.s.automations.tick();
  assert.equal(b.s.db.listMessages(otherConv.id).length, before);
});

test("bridge: STOP relays a withdrawal for every patient linked to the number; C and CHANGE relay only on an unambiguous match", async () => {
  const b = await bridgeSetup();
  // Two patients (parent and child) on one phone, each with their own reminder.
  const f1 = b.fact();
  const f2 = b.fact({ firstName: "Robin" });
  await b.push([f1, f2]);
  const it1 = b.item({ patientRef: f1.patientRef, appointmentRef: f1.appointmentRef });
  await b.outbox([it1]);

  // C with exactly one item delivered to this phone in 48 hours -> confirmed relayed, fixed reply.
  await b.s.inbox.receive({ channel: "sms", to: "+14165550100", from: PHONE, body: "C", externalId: "SMc1" });
  await b.s.inbox.idle();
  let events = (await b.pull()).data.events;
  const confirmed = events.filter((e: any) => e.type === "appointment.confirmed");
  assert.deepEqual(confirmed.map((e: any) => e.appointmentRef), [f1.appointmentRef]);
  const contact = b.s.db.findContactByExternalId(b.s.clinicId, f1.patientRef)!;
  const thread = b.s.db.listMessages(b.s.db.conversationForContact(contact, "sms").id);
  assert.equal(thread.at(-1)!.body, PASSED_TO_CLINIC);
  assert.ok(!thread.some((m) => /confirmed for/i.test(m.body)), "never 'you're confirmed'");
  assert.ok(b.s.bridge.store.getAppointment(b.s.clinicId, f1.appointmentRef)!.confirm_relayed_at);

  // The second reminder to the same phone makes a reply ambiguous: nothing is queued; staff triage.
  await b.outbox([b.item({ patientRef: f2.patientRef, appointmentRef: f2.appointmentRef, firstName: "Robin", text: "Hi Robin, a reminder of your visit on Tuesday at 3:00 PM with Sam. Reply C to confirm or CHANGE to ask for a new time." })]);
  const beforeCount = (await b.pull()).data.events.length;
  await b.s.inbox.receive({ channel: "sms", to: "+14165550100", from: PHONE, body: "CHANGE", externalId: "SMc2" });
  await b.s.inbox.receive({ channel: "sms", to: "+14165550100", from: PHONE, body: "C", externalId: "SMc3" });
  await b.s.inbox.idle();
  events = (await b.pull()).data.events;
  assert.equal(events.filter((e: any) => e.type.startsWith("appointment.")).length, confirmed.length, "no new appointment event on an ambiguous reply");
  assert.ok(events.length >= beforeCount);

  // STOP: carrier rule wins; both patients on that number, both purposes.
  await b.s.inbox.receive({ channel: "sms", to: "+14165550100", from: PHONE, body: "STOP", externalId: "SMstop" });
  await b.s.inbox.idle();
  const withdrawn = (await b.pull()).data.events.filter((e: any) => e.type === "consent.withdrawn");
  assert.equal(withdrawn.length, 4);
  assert.deepEqual(new Set(withdrawn.map((e: any) => e.patientRef)), new Set([f1.patientRef, f2.patientRef]));
  assert.ok(withdrawn.every((e: any) => e.channel === "sms" && e.via === "carrier_stop"));
  assert.deepEqual(new Set(withdrawn.map((e: any) => e.purpose)), new Set(["service", "marketing"]));
  for (const e of withdrawn) assert.equal(eventProblem(e), undefined);
});

test("bridge: no name, number or text in any bridge audit row", async () => {
  const b = await bridgeSetup();
  const f = b.fact({ firstName: "Zephyrine" });
  await b.push([f]);
  await b.outbox([b.item({ patientRef: f.patientRef, appointmentRef: f.appointmentRef, firstName: "Zephyrine", text: "Hi Zephyrine, a reminder of your visit on Tuesday at 2:00 PM with Sam." })]);
  await b.outbox([b.item({ text: "Hi there, your treatment is ready." })]);
  await b.pull();
  await b.s.inbox.receive({ channel: "sms", to: "+14165550100", from: PHONE, body: "STOP", externalId: "SMa1" });
  await b.s.inbox.idle();
  const rows = auditRows(b.s).filter((r) => String(r.action).startsWith("bridge.") || r.actor_type === "device");
  assert.ok(rows.length >= 5);
  const all = JSON.stringify(rows);
  for (const bad of ["Zephyrine", "4165550123", "reminder of your visit", "treatment", "Sam"]) assert.ok(!all.includes(bad), `audit leaked ${bad}`);
  assert.equal(b.s.audit.verify().ok, true, "hash chain intact");
});

// ------------------------------------------------------------------ retention, unpair, FHIR

test("bridge: retention purges mirror rows a day after the visit and un-acked events after 14 days; unpair deletes everything", async () => {
  const b = await bridgeSetup();
  const f = b.fact();
  await b.push([f]);
  const contact = b.s.db.createContact(b.s.clinicId, { name: "Alex", phone: PHONE, external_id: ref("pt") });
  b.s.bridge.withdrawn(b.s.clinicId, contact.id, "sms", ["service"], "staff", "contact");
  b.s.maintenance.runRetention(new Date(Date.now() + 3 * 864e5 + 3600_000));
  assert.equal(b.s.bridge.store.getAppointment(b.s.clinicId, f.appointmentRef), undefined, "gone a day after the visit");
  assert.equal((await b.pull()).data.events.length, 1);
  b.s.maintenance.runRetention(new Date(Date.now() + 15 * 864e5));
  assert.equal((await b.pull()).data.events.length, 0);
  assert.ok(auditRows(b.s).some((r) => r.action === "bridge.queue.expired" && r.detail === "count=1"));

  await b.push([b.fact()]);
  const counts = b.s.bridge.store.unpair(b.s.clinicId);
  assert.equal(counts.appointments, 1);
  assert.equal((await b.pull()).data.error, "auth", "the key is revoked");
  assert.equal(b.s.bridge.enabled(b.s.clinicId), false);
});

test("bridge: FHIR shapes (withdrawn consent, delivery status mapping, change request)", () => {
  const withdrawn = toFhirConsent({ id: 1, clinic_id: 1, contact_id: 2, channel: "sms", purpose: "service", status: "withdrawn", basis: "keyword", source: "STOP", text_version: null, address: null, recorded_by: "patient", recorded_at: inDays(0) });
  assert.equal(withdrawn.status, "inactive");
  assert.equal((withdrawn.provision as { type: string }).type, "permit", "no double negative");
  assert.equal(deliveryToCommunication("rel_x", { result: "accepted" }).status, "in-progress");
  assert.equal(deliveryToCommunication("rel_x", { status: "sent" }).status, "in-progress");
  assert.equal(deliveryToCommunication("rel_x", { status: "delivered" }).status, "completed");
  const failed = deliveryToCommunication("rel_x", { status: "failed", code: "undelivered" });
  assert.equal(failed.status, "not-done");
  assert.deepEqual(failed.basedOn, [{ reference: "CommunicationRequest/rel_x" }]);
  assert.equal(deliveryToCommunication("rel_x", { result: "refused", code: "consent_missing" }).status, "not-done");
  const change = changeRequestToFhir({ id: "evt_1", appointmentRef: "apt_1", intent: "cancel" });
  assert.equal(change.resourceType, "Communication");
  assert.equal("payload" in change, false);
  const req = releaseToCommunicationRequest({ releaseRef: "rel_1", patientRef: "pt_1", channel: "whatsapp", purpose: "service", text: "Hi", releasedBy: "Sam", releasedAt: inDays(0) }, "waiting");
  assert.deepEqual(req.medium, [{ coding: [{ system: "urn:ehrm:channel", code: "whatsapp" }] }]);
  assert.equal(req.status, "active");
});

test("bridge: the receptionist's cancel and reschedule only pass a request to the clinic, on an unambiguous match", async () => {
  const b = await bridgeSetup();
  const f = b.fact();
  await b.push([f]);
  const it = b.item({ patientRef: f.patientRef, appointmentRef: f.appointmentRef });
  await b.outbox([it]);
  const contact = b.s.db.findContactByExternalId(b.s.clinicId, f.patientRef)!;
  const ctx = { db: b.s.db, events: b.s.events, backend: b.s.backends.forClinic(b.s.clinic()), clinic: b.s.clinic(), contact, conversation: b.s.db.conversationForContact(contact, "sms"), channel: "sms" as const, actor: "ai:sms", identityVerified: true };
  const moved = await runTool({ ...ctx }, "reschedule_appointment", { appointment_id: 1, new_start: inDays(4) });
  assert.ok(!moved.isError, moved.result);
  const e = (await b.pull()).data.events.find((x: any) => x.type === "appointment.change_requested");
  assert.deepEqual([e.appointmentRef, e.intent, e.channel], [f.appointmentRef, "change", "sms"]);
  assert.equal(b.s.bridge.store.getAppointment(b.s.clinicId, f.appointmentRef)!.status, "booked", "nothing moved in the cloud");
  const stranger = b.s.db.createContact(b.s.clinicId, { name: "Other", phone: "+14165550144" });
  const none = await runTool({ ...ctx, contact: stranger, conversation: b.s.db.conversationForContact(stranger, "sms") }, "cancel_appointment", {});
  assert.equal(none.isError, true);
});

test("bridge: failed requests don't use up the clinic's own budget, so the key id alone can't lock the laptop out", async () => {
  const b = await bridgeSetup();
  // 19 forged requests (just under the per-address failure limit) ...
  for (let i = 0; i < 19; i++) assert.equal((await b.call("GET", "/bridge/v1/inbox", undefined, { secret: "wrong-secret" })).status, 401);
  // ... then 45 genuine pulls all succeed. Before the fix the forged ones counted against the key's 60 a minute.
  for (let i = 0; i < 45; i++) assert.equal((await b.pull()).status, 200, `genuine pull ${i + 1}`);
  // The forging address itself is cut off after 20 failures.
  await b.call("GET", "/bridge/v1/inbox", undefined, { secret: "wrong-secret" });
  assert.equal((await b.call("GET", "/bridge/v1/inbox", undefined, { secret: "wrong-secret" })).status, 429);
});

test("bridge: a booking request's first name is one word, so it can't carry a phrase", async () => {
  const { FIRST_NAME_RE, eventProblem } = await import("../src/bridge/events.ts");
  assert.equal(FIRST_NAME_RE.test("Chest pain on warfarin"), false);
  assert.equal(FIRST_NAME_RE.test("Anne-Marie"), true);
  assert.equal(FIRST_NAME_RE.test("O'Neil"), true);
  const ev = { id: "evt_" + "a".repeat(22), seq: 1, type: "booking.requested", at: new Date().toISOString(), requestRef: ref("brq"), kind: "new", channel: "whatsapp", phone: PHONE, phoneVerified: true, preferredTimes: [] };
  assert.equal(eventProblem({ ...ev, firstName: "Chest pain on warfarin" }), "bad_firstName");
  assert.notEqual(eventProblem({ ...ev, firstName: "Alex" }), "bad_firstName");
});

test("bridge: a call summary keeps no health detail in the cloud, and the phone assistant only takes requests", async () => {
  const b = await bridgeSetup();
  b.s.voice.postCall({ type: "post_call_transcription", data: {
    conversation_id: "conv-bridge-1", status: "done",
    transcript: [{ role: "agent", message: "How can I help?" }, { role: "user", message: "I have numbness in my leg and take blood thinners." }],
    metadata: { call_duration_secs: 75, phone_call: { external_number: PHONE, agent_number: "+14165550100" } },
    analysis: { transcript_summary: "Caller has left leg numbness, on blood thinners, wants a visit.", call_successful: "success" },
  } });
  const [call] = b.s.db.listCalls(b.s.clinicId);
  assert.doesNotMatch(call.summary ?? "", /numbness|blood thinner/i);
  const conv = b.s.db.conversationForContact(b.s.db.getContact(call.contact_id!)!, "voice");
  assert.doesNotMatch(JSON.stringify(b.s.db.listMessages(conv.id)), /numbness|blood thinner/i);
  assert.match(String(b.s.voice.agentConfig(b.s.clinic(), "https://clinic.example").prompt), /can't book, move or cancel/);
});
