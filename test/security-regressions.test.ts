// Regression tests for the second security pass (adversarial review of the FD fixes, 29 Oct 2026).
// Each test reproduces an exploit that worked before the fix and checks it is now refused.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { runTool } from "../src/ai/tools.ts";
import { createApp } from "../src/app.ts";
import { parseEmailInbound } from "../src/channels/email.ts";
import { privacyProblems } from "../src/policy/guards.ts";
import { Accounts } from "../src/security/accounts.ts";
import { totpCode } from "../src/security/crypto.ts";
import { Vault } from "../src/security/vault.ts";
import { DEMO_CLINIC } from "../src/seed.ts";
import type { ClinicProfile } from "../src/types.ts";
import { api, grantService, listen, setup, signIn, TEST_PASSWORD, testConfig } from "./helpers.ts";

const servers: { close: () => Promise<void> }[] = [];
after(() => Promise.all(servers.map((s) => s.close())));

async function start(configure: Parameters<typeof testConfig>[0] = () => {}, profile?: Partial<ClinicProfile>) {
  const s = setup({ config: testConfig(configure), profile });
  const server = await listen(createApp(s));
  servers.push(server);
  return { s, url: server.url };
}
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const post = (url: string, path: string, body: unknown, cookie = "") =>
  fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: url, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const step = () => Math.floor(Date.now() / 30_000);

test("B1: the phone-app code step locks after repeated wrong codes, and a locked account can't finish signing in", async () => {
  const { s, url } = await start((c) => { c.security.requireTotp = true; });
  const { user } = s.accounts.createUser({ username: "vic", name: "Vic", role: "owner", clinicIds: [s.clinicId], createdBy: "t", password: TEST_PASSWORD });
  const { secret } = s.accounts.startTotpEnrolment(user.id, "x");
  assert.ok(s.accounts.confirmTotpEnrolment(user.id, totpCode(secret, step())));
  const second = cookieOf(await post(url, "/api/login", { username: "vic", password: TEST_PASSWORD }));
  for (let i = 0; i < 5; i++) await post(url, "/api/login/code", { code: String(100000 + i) }, second);
  assert.equal(s.accounts.isLocked(user.id), true, "5 wrong codes lock the account");
  const right = await post(url, "/api/login/code", { code: totpCode(secret, step() + 1) }, second);
  assert.notEqual(right.status, 200, "even the right code is refused while locked");
});

test("B2: moving codes to a new phone needs the passphrase, and the old phone keeps working until the new one is confirmed", async () => {
  const { s, url } = await start();
  const { user } = s.accounts.createUser({ username: "tom", name: "Tom", role: "owner", clinicIds: [s.clinicId], createdBy: "t", password: TEST_PASSWORD });
  const { secret } = s.accounts.startTotpEnrolment(user.id, "x");
  s.accounts.confirmTotpEnrolment(user.id, totpCode(secret, step()));
  const l = await post(url, "/api/login", { username: "tom", password: TEST_PASSWORD });
  const full = cookieOf(await post(url, "/api/login/code", { code: totpCode(secret, step() + 1) }, cookieOf(l)));
  assert.equal((await post(url, "/api/me/totp/start", {}, full)).status, 403, "a borrowed session alone can't do it");
  assert.equal((await post(url, "/api/me/totp/start", { current: TEST_PASSWORD }, full)).status, 200);
  const again = await post(url, "/api/login", { username: "tom", password: TEST_PASSWORD });
  assert.equal((await again.json()).next, "second_step", "codes stay on until the new phone is confirmed");
});

test("B3: an owner can't reset someone who also works at a clinic they don't manage", async () => {
  const { s, url } = await start();
  const clinicB = s.db.createClinic({ ...structuredClone(DEMO_CLINIC), name: "Clinic B" });
  s.accounts.createUser({ username: "multi", name: "Multi Owner", role: "owner", clinicIds: [s.clinicId, clinicB], createdBy: "t", password: TEST_PASSWORD });
  const ownerA = api(url, await signIn(s, url, "owner", "owner-a"));
  const multiId = s.accounts.findByUsername("multi")!.id;
  assert.equal((await ownerA("POST", `/api/users/${multiId}/reset`, {})).status, 403);
  assert.equal((await ownerA("POST", `/api/users/${multiId}/disable`, {})).status, 403);
});

test("B4: one campaign confirmation sends once, even if submitted several times at once", async () => {
  const { s, url } = await start();
  const c = s.db.createContact(s.clinicId, { name: "Rep Lay", email: "rep@example.com", tags: '["newsletter"]' });
  grantService(s, c.id, "email", "marketing");
  const owner = api(url, await signIn(s, url));
  const body = { name: "News", tag: "newsletter", channel: "email", purpose: "marketing", template: "Hi {{first_name}}, winter hours." };
  const p = await owner("POST", `/api/clinics/${s.clinicId}/campaigns/preview`, body);
  const results = await Promise.all([1, 2, 3].map(() => owner("POST", `/api/clinics/${s.clinicId}/campaigns`, { ...body, confirmToken: p.data.confirmToken })));
  assert.deepEqual(results.map((r) => r.status).sort(), [202, 409, 409]);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(s.db.campaignMessagesSince(s.clinicId, new Date(Date.now() - 3600_000).toISOString()), 1);
});

test("B5: STOP from a number covers every patient record that shares it", async () => {
  const { s } = await start();
  const a = s.db.createContact(s.clinicId, { name: "Parent", phone: "+14165550222" });
  const b = s.db.createContact(s.clinicId, { name: "Child", phone: "+14165550222" });
  grantService(s, a.id, "sms");
  grantService(s, b.id, "sms");
  await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+14165550222", body: "STOP" });
  await s.inbox.idle();
  const out = await s.inbox.sendToContact(s.clinic(), s.db.getContact(b.id)!, "sms", () => "Reminder: appointment tomorrow at 10.", { authorName: "t", purpose: "service" });
  assert.ok("skipped" in out, "no text to a number that texted STOP");
  await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+14165550222", body: "START" });
  await s.inbox.idle();
  assert.equal(s.consents.check(b.id, "sms", "service").ok, true, "START lifts it again");
});

test("B6: consent belongs to the address; a new phone number needs a new yes", async () => {
  const { s, url } = await start();
  const c = s.db.createContact(s.clinicId, { name: "Old Number", phone: "+14165550333" });
  grantService(s, c.id, "sms", "marketing");
  const desk = api(url, await signIn(s, url, "front_desk"));
  assert.equal((await desk("PATCH", `/api/contacts/${c.id}`, { phone: "+14165550444" })).status, 200);
  assert.equal(s.consents.check(c.id, "sms", "marketing").ok, false);
  assert.equal(s.consents.summary(c.id).sms.marketing, "none");
});

test("B7: event funnels wait out quiet hours, then send", async () => {
  const automation = { id: "tagmk", name: "Tag promo", enabled: true, trigger: { type: "tag_added" as const, tag: "vip" }, actions: [{ type: "send_message" as const, channel: "sms" as const, purpose: "marketing" as const, template: "Hi {{first_name}}, a promo." }] };
  const { s, url } = await start(() => {}, { quietHours: { start: "00:00", end: "00:00" }, automations: [automation] });
  const c = s.db.createContact(s.clinicId, { name: "Night Owl", phone: "+14165550555" });
  grantService(s, c.id, "sms", "marketing");
  const desk = api(url, await signIn(s, url, "front_desk"));
  assert.equal((await desk("PATCH", `/api/contacts/${c.id}`, { tags: ["vip"] })).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  const sent = () => s.db.listMessages(s.db.conversationForContact(s.db.getContact(c.id)!, "sms").id).filter((m) => m.direction === "out" && m.status !== "failed").length;
  assert.equal(sent(), 0, "held during quiet hours");
  const profile = s.clinic().profile;
  s.db.updateClinicProfile(s.clinicId, { ...profile, quietHours: { start: "00:00", end: "24:00" } });
  await s.automations.tick();
  assert.equal(sent(), 1, "sent once quiet hours are over");
});

test("B8: email never proves who is writing, whatever its headers say", () => {
  const m = parseEmailInbound({ FromFull: { Email: "victim@gmail.com" }, To: "frontdesk@clinic.example", TextBody: "cancel my appointment",
    Headers: [{ Name: "Authentication-Results", Value: "attacker.example; dmarc=pass" }] });
  assert.equal(m!.senderVerified, false);
});

test("B9: a phone-app secret that can't be decrypted fails closed", () => {
  const s = setup();
  const acc1 = new Accounts(s.db.sql, new Vault("key-one-0123456789abcdef0123456789"), { idleMinutes: 15, sessionHours: 8, requireTotp: true });
  const { user } = acc1.createUser({ username: "zed", name: "Zed", role: "owner", clinicIds: [s.clinicId], createdBy: "t", password: TEST_PASSWORD });
  const { secret } = acc1.startTotpEnrolment(user.id, "x");
  acc1.confirmTotpEnrolment(user.id, totpCode(secret, step() - 1));
  const acc2 = new Accounts(s.db.sql, new Vault("key-two-DIFFERENT-0123456789abcdef"), { idleMinutes: 15, sessionHours: 8, requireTotp: true });
  assert.equal(acc2.checkCode(user.id, totpCode("[unreadable: this text failed its integrity check]", step() + 1)), false);
  assert.equal(acc2.checkCode(user.id, totpCode(secret, step() + 1)), false);
});

test("B10: task titles and attention reasons are encrypted, and erase clears them", async () => {
  const { s, url } = await start();
  const c = s.db.createContact(s.clinicId, { name: "Plain Text", phone: "+14165550666" });
  const conv = s.db.conversationForContact(c, "sms");
  const ctx = { db: s.db, events: s.events, backend: s.backends.forClinic(s.clinic()), clinic: s.clinic(), contact: c, conversation: conv, channel: "sms" as const, actor: "ai:sms", identityVerified: true };
  await runTool({ ...ctx }, "handoff_to_staff", { reason: "Patient reports chest pain after knee surgery", urgent: true });
  await runTool({ ...ctx }, "create_staff_task", { title: "Call back about test results", details: "x" });
  const raw = () => JSON.stringify([s.db.sql.prepare("SELECT attention_reason FROM conversations WHERE id = ?").get(conv.id), s.db.sql.prepare("SELECT title, details FROM tasks WHERE contact_id = ?").all(c.id)]);
  assert.doesNotMatch(raw(), /chest pain|test results/, "nothing readable at rest");
  assert.ok(s.db.listTasks(s.clinicId, "all", c.id).some((t) => t.title.includes("test results")), "the app still reads it");
  const owner = api(url, await signIn(s, url));
  assert.equal((await owner("POST", `/api/contacts/${c.id}/erase`, { confirm: `ERASE ${c.id}` })).status, 200);
  assert.equal(s.db.getConversation(conv.id)!.attention_reason, null);
  assert.ok(s.db.listTasks(s.clinicId, "all", c.id).every((t) => !/chest|test results/.test(t.title)));
});

test("G1: the privacy check catches job titles, short forms and plurals, without flagging everyday words", () => {
  const clinic = { id: 1, name: "X", profile: structuredClone(DEMO_CLINIC) };
  for (const t of ["Your physiotherapist visit is Tue 10am", "Your chiro visit is Tue", "Your back is booked Tue", "Your physiotherapists will see you", "Your concussions follow-up", "Your pelvic-floor visit"]) {
    assert.ok(privacyProblems(t, "sms", clinic).length, t);
  }
  for (const t of ["We'll get back to you soon", "Hi Priya, a reminder of your appointment on Thu at 2:30 PM with Maya.", "We're closed Monday."]) {
    assert.deepEqual(privacyProblems(t, "sms", clinic), [], t);
  }
});

test("staff messages to someone who last wrote weeks ago are treated as the clinic starting contact", async () => {
  const { s } = await start();
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+14165550777", body: "hi" });
  await s.inbox.idle();
  s.db.sql.prepare("UPDATE messages SET created_at = ? WHERE direction = 'in'").run(new Date(Date.now() - 30 * 864e5).toISOString());
  s.db.sql.prepare("DELETE FROM consents").run();
  await assert.rejects(s.inbox.staffReply(r!.conversation.id, "Hello again", { staffName: "Alex", staffUserId: 1 }), /consent/i);
});

test("marketing on WhatsApp carries an opt-out line (CASL s.11)", async () => {
  const sent: string[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => { sent.push(String(init?.body)); return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }); }) as typeof fetch;
  const s = setup({ fetchImpl, config: testConfig((c) => { c.meta.whatsappToken = "tok"; }) });
  const r = await s.inbox.receive({ channel: "whatsapp", to: "wa-phone-id", from: "14165550888", body: "hi" });
  await s.inbox.idle();
  grantService(s, r!.conversation.contact_id, "whatsapp", "marketing");
  sent.length = 0;
  await s.inbox.sendToContact(s.clinic(), s.db.getContact(r!.conversation.contact_id)!, "whatsapp", () => "Winter hours start Monday.", { authorName: "t", purpose: "marketing" });
  assert.match(sent.join(""), /Reply STOP to opt out/);
});
