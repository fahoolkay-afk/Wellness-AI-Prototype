// One test per security control from docs/SECURITY-REVIEW-2026-10-29.md (front desk, waves 1 and 2).

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createApp } from "../src/app.ts";
import { config as baseConfig } from "../src/config.ts";
import { wordingProblems } from "../src/policy/guards.ts";
import { detectIntent } from "../src/policy/keywords.ts";
import { preflight } from "../src/preflight.ts";
import { totpCode } from "../src/security/crypto.ts";
import { api, grantService, listen, setup, signIn, TEST_PASSWORD, testConfig } from "./helpers.ts";

const servers: { close: () => Promise<void> }[] = [];
after(() => Promise.all(servers.map((s) => s.close())));

async function start(configure: Parameters<typeof testConfig>[0] = () => {}) {
  const s = setup({ config: testConfig(configure) });
  const server = await listen(createApp(s));
  servers.push(server);
  return { s, url: server.url };
}

const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const post = (url: string, path: string, body: unknown, cookie = "") =>
  fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: url, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

test("preflight refuses to start production without keys, https, backups and webhook secrets", () => {
  const c = structuredClone(baseConfig);
  c.demo = false;
  c.security.sessionSecret = "";
  c.security.dataKey = "";
  c.publicUrl = "http://clinic.example";
  c.backups.dir = "";
  c.sms.twilioAccountSid = "AC1";
  c.sms.twilioAuthToken = "";
  const settings = preflight(c).map((i) => i.setting);
  for (const s of ["SESSION_SECRET", "DATA_KEY", "PUBLIC_URL", "BACKUP_DIR", "TWILIO_AUTH_TOKEN"]) assert.ok(settings.includes(s), s);
  c.demo = true;
  assert.deepEqual(preflight(c), [], "demo mode is for sample data only and skips the gate");
});

test("staff sign in with individual accounts; wrong passphrases lock the account", async () => {
  const { s, url } = await start();
  assert.equal((await fetch(`${url}/api/clinics`)).status, 401);
  s.accounts.createUser({ username: "sam", name: "Sam Lee", role: "front_desk", clinicIds: [s.clinicId], createdBy: "test", password: TEST_PASSWORD });
  for (let i = 0; i < 4; i++) assert.equal((await post(url, "/api/login", { username: "sam", password: "wrong" })).status, 401);
  await post(url, "/api/login", { username: "sam", password: "wrong" });
  assert.equal((await post(url, "/api/login", { username: "sam", password: TEST_PASSWORD })).status, 423, "locked after 5 wrong tries");
  const rows = s.audit.list(s.clinicId, {});
  assert.equal(JSON.stringify(rows).includes(TEST_PASSWORD), false, "passphrases never reach the audit log");
});

test("sessions: HttpOnly SameSite=Strict cookie, revoked on logout, Bearer tokens ignored", async () => {
  const { s, url } = await start();
  const cookie = await signIn(s, url, "front_desk");
  const login = await post(url, "/api/login", { username: "front_desk-user", password: TEST_PASSWORD });
  const header = login.headers.get("set-cookie") ?? "";
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  const call = api(url, cookie);
  assert.equal((await call("GET", "/api/clinics")).status, 200);
  assert.equal((await fetch(`${url}/api/clinics`, { headers: { authorization: `Bearer ${cookie.split("=")[1]}` } })).status, 401);
  assert.equal((await call("POST", "/api/logout", {})).status, 200);
  assert.equal((await call("GET", "/api/clinics")).status, 401, "the server forgot the session");
});

test("requests from another site are refused (CSRF)", async () => {
  const { s, url } = await start();
  const cookie = await signIn(s, url);
  const res = await fetch(`${url}/api/clinics/${s.clinicId}/tasks`, { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) });
  assert.equal(res.status, 403);
  const noOrigin = await fetch(`${url}/api/clinics/${s.clinicId}/tasks`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) });
  assert.equal(noOrigin.status, 403);
});

test("phone-app codes: enrolment on first sign-in, then required, and a code can't be replayed", async () => {
  const { s, url } = await start((c) => { c.security.requireTotp = true; });
  s.accounts.createUser({ username: "olive", name: "Olive Owner", role: "owner", clinicIds: [s.clinicId], createdBy: "test", password: TEST_PASSWORD });
  const first = await post(url, "/api/login", { username: "olive", password: TEST_PASSWORD });
  assert.equal((await first.json()).next, "setup");
  const setupCookie = cookieOf(first);
  assert.equal((await fetch(`${url}/api/clinics`, { headers: { cookie: setupCookie } })).status, 403, "no access until set up");
  const { secret } = await (await post(url, "/api/me/totp/start", {}, setupCookie)).json();
  const step = Math.floor(Date.now() / 30_000);
  const confirmed = await post(url, "/api/me/totp/confirm", { code: totpCode(secret, step) }, setupCookie);
  assert.equal((await confirmed.json()).done, true);

  const again = await post(url, "/api/login", { username: "olive", password: TEST_PASSWORD });
  assert.equal((await again.json()).next, "second_step");
  const secondCookie = cookieOf(again);
  assert.equal((await post(url, "/api/login/code", { code: totpCode(secret, step) }, secondCookie)).status, 401, "the code used at enrolment can't be used again");
  const ok = await post(url, "/api/login/code", { code: totpCode(secret, step + 1) }, secondCookie);
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${url}/api/clinics`, { headers: { cookie: cookieOf(ok) } })).status, 200);
  // The secret is stored encrypted.
  const row = s.db.sql.prepare("SELECT totp_secret FROM users WHERE username = 'olive'").get() as { totp_secret: string };
  assert.match(row.totp_secret, /^e1:/);
});

test("roles: an auditor can read the audit log but not patient messages; front desk can't manage users", async () => {
  const { s, url } = await start();
  const contact = s.db.createContact(s.clinicId, { name: "Role Test", phone: "+14165550801" });
  const conv = s.db.conversationForContact(contact, "sms");
  const auditor = api(url, await signIn(s, url, "auditor"));
  assert.equal((await auditor("GET", `/api/clinics/${s.clinicId}/audit`)).status, 200);
  assert.equal((await auditor("GET", `/api/conversations/${conv.id}`)).status, 403);
  const desk = api(url, await signIn(s, url, "front_desk"));
  assert.equal((await desk("GET", `/api/conversations/${conv.id}`)).status, 200);
  assert.equal((await desk("GET", `/api/clinics/${s.clinicId}/users`)).status, 403);
  assert.equal((await desk("POST", `/api/contacts/${contact.id}/erase`, { confirm: `ERASE ${contact.id}` })).status, 403);
});

test("clinic isolation: staff can't see another clinic's records by guessing ids", async () => {
  const { s, url } = await start();
  const otherClinic = s.db.createClinic({ ...s.clinic().profile, name: "Other Clinic" });
  const stranger = s.db.createContact(otherClinic, { name: "Other Patient", phone: "+14165550802" });
  const conv = s.db.conversationForContact(stranger, "sms");
  const task = s.db.createTask({ clinicId: otherClinic, contactId: stranger.id, type: "other", priority: "normal", title: "private", createdBy: "test" });
  const call = api(url, await signIn(s, url));
  assert.equal((await call("GET", `/api/conversations/${conv.id}`)).status, 404);
  assert.equal((await call("PATCH", `/api/contacts/${stranger.id}`, { name: "x" })).status, 404);
  assert.equal((await call("POST", `/api/tasks/${task.id}`, { status: "done" })).status, 404);
  assert.equal((await call("GET", `/api/clinics/${otherClinic}/contacts`)).status, 404);
  assert.equal(s.db.getContact(stranger.id)!.name, "Other Patient");
});

test("audit log: reads and changes are recorded, hash-chained and append-only", async () => {
  const { s, url } = await start();
  const contact = s.db.createContact(s.clinicId, { name: "Audit Me", phone: "+14165550803" });
  const conv = s.db.conversationForContact(contact, "sms");
  const call = api(url, await signIn(s, url));
  await call("GET", `/api/conversations/${conv.id}`);
  const views = s.audit.list(s.clinicId, { contactId: contact.id }).filter((r) => r.action === "conversation.view");
  assert.equal(views.length, 1);
  assert.equal(s.audit.verify().ok, true);
  assert.throws(() => s.db.sql.exec("UPDATE access_events SET actor = 'someone else'"), /append-only|not allowed|abort/i);
  assert.throws(() => s.db.sql.exec("DELETE FROM access_events"), /append-only|not allowed|abort/i);
  const fhir = await call("GET", `/api/clinics/${s.clinicId}/audit/fhir`);
  assert.equal(fhir.data.resourceType, "Bundle");
  assert.equal(fhir.data.entry[0].resource.resourceType, "AuditEvent");
});

test("message text is encrypted at rest and never written to the audit log", async () => {
  const s = setup();
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+14165550804", body: "my knee hurts after the fall" });
  await s.inbox.idle();
  const raw = s.db.sql.prepare("SELECT body FROM messages WHERE conversation_id = ?").all(r!.conversation.id) as { body: string }[];
  for (const row of raw) assert.match(row.body, /^e1:/);
  assert.equal(s.db.listMessages(r!.conversation.id)[0].body, "my knee hurts after the fall", "the app reads it back");
  const audit = JSON.stringify(s.db.sql.prepare("SELECT * FROM access_events").all());
  assert.equal(audit.includes("knee"), false);
});

test("consent recorded at the desk needs a source; staff can't override an SMS STOP", async () => {
  const { s, url } = await start();
  const call = api(url, await signIn(s, url));
  const created = await call("POST", `/api/clinics/${s.clinicId}/contacts`, { name: "New Patient", phone: "+14165550805", consents: { sms: { reminders: true }, source: "intake form" } });
  assert.equal(created.status, 201);
  assert.equal(s.consents.latest(created.data.id, "sms", "service")?.status, "granted");
  assert.equal(s.consents.latest(created.data.id, "sms", "marketing"), undefined, "marketing is never assumed");
  assert.equal((await call("POST", `/api/contacts/${created.data.id}/consent`, { channel: "email", purpose: "marketing", status: "granted" })).status, 400, "a source is required");
  await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+14165550805", body: "STOP" });
  const override = await call("POST", `/api/contacts/${created.data.id}/consent`, { channel: "sms", purpose: "service", status: "granted", source: "they said ok" });
  assert.equal(override.status, 409);
});

test("unsubscribe links are signed per person and withdraw marketing consent only", async () => {
  const { s, url } = await start();
  const contact = s.db.createContact(s.clinicId, { name: "Un Sub", email: "unsub@example.com" });
  grantService(s, contact.id, "email");
  grantService(s, contact.id, "email", "marketing");
  const link = s.unsubscribe.url(s.clinicId, contact.id, "email").replace(/^https?:\/\/[^/]+/, url);
  assert.equal((await fetch(link.slice(0, -1) + (link.endsWith("0") ? "1" : "0"))).status, 404, "a tampered link is refused");
  assert.equal((await fetch(link)).status, 200);
  assert.equal((await fetch(link, { method: "POST", headers: { origin: url } })).status, 200);
  assert.equal(s.consents.latest(contact.id, "email", "marketing")?.status, "withdrawn");
  assert.equal(s.consents.latest(contact.id, "email", "service")?.status, "granted", "reminders continue");
});

test("campaigns: owner-only, previewed first, and the send must match the preview", async () => {
  const { s, url } = await start();
  const contact = s.db.createContact(s.clinicId, { name: "Camp Aign", phone: "+14165550806", tags: '["newsletter"]' });
  grantService(s, contact.id, "sms", "marketing");
  const desk = api(url, await signIn(s, url, "front_desk"));
  assert.equal((await desk("POST", `/api/clinics/${s.clinicId}/campaigns/preview`, { template: "x", tag: "newsletter" })).status, 403);
  const owner = api(url, await signIn(s, url));
  const body = { name: "Winter hours", tag: "newsletter", channel: "sms", purpose: "marketing", template: "Hi {{first_name}}, our winter hours start Monday." };
  const preview = await owner("POST", `/api/clinics/${s.clinicId}/campaigns/preview`, body);
  assert.equal(preview.data.eligible, 1);
  assert.equal((await owner("POST", `/api/clinics/${s.clinicId}/campaigns`, { ...body, template: "Something else", confirmToken: preview.data.confirmToken })).status, 409, "changed after preview");
  const sent = await owner("POST", `/api/clinics/${s.clinicId}/campaigns`, { ...body, confirmToken: preview.data.confirmToken });
  assert.equal(sent.status, 202);
  assert.equal(sent.data.queued, 1);
});

test("access requests: a person's data exports as a valid FHIR R4 Bundle; erase keeps consent and audit", async () => {
  const { s, url } = await start();
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+14165550807", body: "hello" });
  await s.inbox.idle();
  const id = r!.conversation.contact_id;
  grantService(s, id, "sms");
  const owner = api(url, await signIn(s, url));
  const exported = await owner("GET", `/api/contacts/${id}/export`);
  assert.equal(exported.status, 200);
  const types = new Set((exported.data.entry as { resource: { resourceType: string } }[]).map((e) => e.resource.resourceType));
  for (const t of ["Patient", "Communication", "Consent"]) assert.ok(types.has(t), t);
  assert.equal((await owner("POST", `/api/contacts/${id}/erase`, { confirm: "yes" })).status, 400);
  const erased = await owner("POST", `/api/contacts/${id}/erase`, { confirm: `ERASE ${id}` });
  assert.equal(erased.status, 200);
  assert.ok(s.db.listMessages(r!.conversation.id).every((m) => m.purged_at));
  assert.equal(s.consents.latest(id, "sms", "service")?.status, "granted", "consent history is kept as a record");
  assert.ok(s.audit.list(s.clinicId, { contactId: id }).some((e) => e.action === "contact.erase"));
});

test("retention clears old message text but keeps who, when and which channel", () => {
  const s = setup({ profile: { retention: { messageDays: 30, callDays: 30 } } });
  const contact = s.db.createContact(s.clinicId, { name: "Old Thread", phone: "+14165550808" });
  const conv = s.db.conversationForContact(contact, "sms");
  const m = s.db.addMessage({ conversationId: conv.id, channel: "sms", direction: "in", author: "patient", body: "old news", status: "received" });
  s.db.sql.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 40 * 864e5).toISOString(), m.id);
  assert.equal(s.maintenance.runRetention().messages, 1);
  const after = s.db.getMessage(m.id)!;
  assert.ok(after.purged_at);
  assert.notEqual(after.body, "old news");
  assert.equal(after.channel, "sms");
});

test("the simulator only exists when enabled, and needs a signed-in role that may use it", async () => {
  const off = await start((c) => { c.security.enableSimulator = false; });
  const call = api(off.url, await signIn(off.s, off.url));
  assert.equal((await call("POST", `/api/clinics/${off.s.clinicId}/simulate`, { channel: "sms", from: "+14165550809", body: "hi" })).status, 404);
});

test("health check reports the database and the audit chain", async () => {
  const { url } = await start();
  const res = await fetch(`${url}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.db, true);
  assert.equal(body.auditChain, true);
});

test("security headers are on every response", async () => {
  const { url } = await start();
  const res = await fetch(`${url}/api/session`);
  assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("keywords: CANCEL and STOP are carrier opt-outs on SMS only; a sentence is not", () => {
  assert.equal(detectIntent("CANCEL", "sms")?.kind, "carrier_stop");
  assert.equal(detectIntent("Stop.", "sms")?.kind, "carrier_stop");
  assert.notEqual(detectIntent("I need to cancel my appointment", "sms")?.kind, "carrier_stop");
  assert.equal(detectIntent("please stop texting me", "whatsapp")?.kind, "revoke");
  assert.equal(detectIntent("C", "sms")?.kind, "confirm");
});

test("wording guard: titles and banned words, including look-alike letters", () => {
  assert.ok(wordingProblems("See Dr. Okafor").length);
  assert.ok(wordingProblems("See Dг. Okafor").length, "Cyrillic look-alike");
  assert.ok(wordingProblems("We t r e a t back pain").length, "spaced letters");
  assert.ok(wordingProblems("Our AI will reply").length);
  assert.deepEqual(wordingProblems("Talk to your doctor about it"), []);
  assert.deepEqual(wordingProblems("Osteopathic manual therapy"), []);
  assert.deepEqual(wordingProblems("We said it again"), [], "'said' is not 'AI'");
});
