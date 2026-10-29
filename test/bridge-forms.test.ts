// v1.2 (docs/INTEGRATION-CONTRACT.md section 12): website booking and sealed patient forms, front desk side.
// Synthetic data only.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { webcrypto } from "node:crypto";
import { createApp } from "../src/app.ts";
import { signRequest } from "../src/bridge/auth.ts";
import { eventProblem } from "../src/bridge/events.ts";
import { linkProblem } from "../src/bridge/service.ts";
import { randomToken } from "../src/security/crypto.ts";
import { listen, setup, testConfig } from "./helpers.ts";

const servers: { close: () => Promise<void> }[] = [];
after(() => Promise.all(servers.map((s) => s.close())));
const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const PUBLIC = "https://frontdesk.example.ca";

async function rig() {
  const s = setup({ config: testConfig((c) => { c.publicUrl = PUBLIC; }) });
  const { keyId, secret } = s.bridge.store.pair(s.clinicId, "loc_1");
  const server = await listen(createApp(s));
  servers.push(server);
  const url = server.url;
  async function signed(method: string, path: string, body?: unknown) {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const nonce = randomToken(24);
    const sig = signRequest(secret, method, path, nonce, raw);
    const headers: Record<string, string> = { "x-bridge-key-id": keyId, "x-bridge-nonce": nonce, "x-bridge-timestamp": sig.timestamp, "x-bridge-signature": sig.signature };
    if (method !== "GET") headers["content-type"] = "application/json";
    const res = await fetch(`${url}${path}`, { method, headers, body: method === "GET" ? undefined : raw });
    return { status: res.status, data: await res.json().catch(() => ({})) as any };
  }
  const plain = async (method: string, path: string, body?: unknown, ip?: string) => {
    const res = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, text: await res.clone().text(), data: await res.json().catch(() => ({})) as any, headers: res.headers };
  };
  const pull = async () => (await signed("GET", "/bridge/v1/inbox")).data.events as any[];
  return { s, url, signed, plain, pull };
}

const day = (d: number) => new Date(Date.now() + d * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
const booking = (over: Record<string, unknown> = {}) => ({
  firstName: "Lena", phone: "416 555 0142", service: "initial", returning: false, textConsent: true, website: "",
  times: [{ day: day(2), from: "09:00", to: "12:00" }], ...over,
});

test("website booking: only first name, phone, service, times and the text tick cross; the rest is refused", async () => {
  const r = await rig();
  assert.equal((await r.plain("GET", `/public/book/${r.s.clinicId}`)).data.services.length, 3);
  const ok = await r.plain("POST", `/public/book/${r.s.clinicId}`, booking());
  assert.equal(ok.status, 200, ok.text);
  const [e] = (await r.pull()).filter((x) => x.type === "booking.requested");
  assert.equal(eventProblem(e), undefined);
  assert.deepEqual(Object.keys(e).sort(), ["at", "channel", "firstName", "id", "kind", "phone", "phoneVerified", "preferredTimes", "requestRef", "returning", "seq", "service", "textConsent", "type"]);
  assert.equal(e.channel, "web");
  assert.equal(e.service, "initial");
  assert.equal(e.textConsent, true);
  assert.equal(e.phone, "+14165550142");
  assert.equal(e.phoneVerified, false, "a website number is not verified");
  // The text tick is the contact's own SMS consent, with the version of the words they saw.
  const contact = r.s.db.findContactByIdentity(r.s.clinicId, "sms", "+14165550142")!;
  const consent = r.s.db.sql.prepare("SELECT * FROM consents WHERE contact_id = ? AND channel = 'sms'").get(contact.id) as any;
  assert.equal(consent.status, "granted");
  assert.equal(consent.text_version, "web-text-v1");
  // A staff note in the thread, never an inbound message (no reply window opens).
  const note = r.s.db.listMessages(r.s.db.conversationForContact(contact, "sms").id).find((m) => m.body.startsWith("Booking request from the website"))!;
  assert.equal(note.direction, "out");
  assert.equal(note.author, "system");

  for (const bad of [
    booking({ lastName: "Ortiz" }), booking({ reason: "lower back" }), booking({ firstName: "Lena lower back" }), booking({ phone: "+44 20 7946 0000" }),
    booking({ service: "massage" }), booking({ times: [] }), booking({ times: [{ day: day(90), from: "09:00", to: "10:00" }] }), booking({ website: "spam.example" }),
  ]) {
    const res = await r.plain("POST", `/public/book/${r.s.clinicId}`, bad);
    assert.ok(res.status >= 400 && res.status < 500, `refused: ${JSON.stringify(bad).slice(0, 80)} -> ${res.status}`);
  }
  // Two a day per phone.
  assert.equal((await r.plain("POST", `/public/book/${r.s.clinicId}`, booking())).status, 200);
  assert.equal((await r.plain("POST", `/public/book/${r.s.clinicId}`, booking())).status, 429);
  // Not a bridge clinic: no booking page.
  r.s.bridge.store.unpair(r.s.clinicId);
  assert.equal((await r.plain("GET", `/book/${r.s.clinicId}`)).status, 404);
});

async function laptopKey() {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = Buffer.from(await subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  return { pair, pub, keyId: `fk_${randomToken(12).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16).padEnd(16, "a")}` };
}

/** The same steps as public/form.js. */
async function seal(meta: { publicKey: string; keyId: string; formRef: string }, answers: unknown) {
  const curve = { name: "ECDH", namedCurve: "P-256" } as const;
  const clinicKey = await subtle.importKey("raw", Buffer.from(meta.publicKey, "base64url"), curve, false, []);
  const eph = await subtle.generateKey(curve, true, ["deriveBits"]);
  const shared = await subtle.deriveBits({ name: "ECDH", public: clinicKey }, eph.privateKey, 256);
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode(meta.formRef), info: enc.encode("frontdesk-form-v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`${meta.formRef}|${meta.keyId}`) }, key, enc.encode(JSON.stringify(answers)));
  return { v: 1, keyId: meta.keyId, epk: Buffer.from(await subtle.exportKey("raw", eph.publicKey)).toString("base64url"), iv: Buffer.from(iv).toString("base64url"), ct: Buffer.from(ct).toString("base64url") };
}

async function open(pair: CryptoKeyPair, formRef: string, keyId: string, sealed: { epk: string; iv: string; ct: string }) {
  const curve = { name: "ECDH", namedCurve: "P-256" } as const;
  const epk = await subtle.importKey("raw", Buffer.from(sealed.epk, "base64url"), curve, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: epk }, pair.privateKey, 256);
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode(formRef), info: enc.encode("frontdesk-form-v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(sealed.iv, "base64url"), additionalData: enc.encode(`${formRef}|${keyId}`) }, key, Buffer.from(sealed.ct, "base64url"));
  return JSON.parse(new TextDecoder().decode(pt));
}

test("sealed form: the laptop's key, a one-time link, ciphertext only in the cloud, and only the laptop can open it", async () => {
  const r = await rig();
  const k = await laptopKey();
  assert.equal((await r.signed("PUT", "/bridge/v1/form-key", { locationId: "loc_1", keyId: k.keyId, publicKey: "x".repeat(87) })).status, 400, "not a P-256 point");
  assert.equal((await r.signed("PUT", "/bridge/v1/form-key", { locationId: "loc_1", keyId: k.keyId, publicKey: k.pub })).status, 200);
  const formRef = `frm_${"a".repeat(22)}`;
  const expiresAt = new Date(Date.now() + 7 * 864e5).toISOString();
  assert.equal((await r.signed("POST", "/bridge/v1/forms", { locationId: "loc_1", formRef, firstName: "Lena", sections: ["details", "intake", "notes"], expiresAt })).status, 400);
  assert.equal((await r.signed("POST", "/bridge/v1/forms", { locationId: "loc_1", formRef, firstName: "Lena", sections: ["details"], expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() })).status, 400, "at most 14 days");
  const inv = await r.signed("POST", "/bridge/v1/forms", { locationId: "loc_1", formRef, firstName: "Lena", sections: ["details", "intake"], expiresAt });
  assert.equal(inv.status, 200);
  const url = new URL(inv.data.url);
  assert.equal(url.origin, PUBLIC);
  const token = url.pathname.split("/")[2];
  // The token is never stored, only its hash.
  assert.equal((r.s.db.sql.prepare("SELECT COUNT(*) n FROM bridge_forms WHERE token_hash = ?").get(token) as any).n, 0);

  const page = await r.plain("GET", `/f/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("cache-control") ?? "", /no-store/);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const meta = (await r.plain("GET", `/f/${token}/meta`)).data;
  assert.deepEqual(Object.keys(meta).sort(), ["clinicName", "expiresAt", "firstName", "formRef", "keyId", "publicKey", "sections"]);
  assert.equal(meta.firstName, "Lena");

  const answers = { v: 1, details: { family_name: "Ortiz", dob: "1990-04-12" }, intake: { reason: "Sore lower back for three weeks", consent_assessment: true, consent_cancellation: true, signature_name: "Lena Ortiz", red_flags: { rf1: false } } };
  const sealed = await seal(meta, answers);
  assert.equal((await r.plain("POST", `/f/${token}`, { ...sealed, note: "hi" })).status, 400, "unknown keys refused");
  assert.equal((await r.plain("POST", `/f/${token}`, { ...sealed, ct: "plain text answers" })).status, 400, "not ciphertext");
  assert.equal((await r.plain("POST", `/f/${token}`, sealed)).status, 200);
  assert.equal((await r.plain("POST", `/f/${token}`, sealed)).status, 410, "single use");
  assert.equal((await r.plain("GET", `/f/${token}/meta`)).status, 410);

  // What the cloud holds and sends: no readable answer anywhere.
  const dump = JSON.stringify(r.s.db.sql.prepare("SELECT * FROM bridge_queue").all()) + JSON.stringify(r.s.db.sql.prepare("SELECT * FROM access_events").all());
  for (const word of ["Ortiz", "1990-04-12", "lower back", "three weeks"]) assert.ok(!dump.includes(word), `the cloud never holds "${word}"`);
  const [ev] = (await r.pull()).filter((e) => e.type === "form.submitted");
  assert.equal(eventProblem(ev), undefined);
  assert.deepEqual(Object.keys(ev.sealed).sort(), ["ct", "epk", "iv", "keyId", "v"]);
  assert.ok(!JSON.stringify(ev).includes("Ortiz"));
  // Only the laptop's private key opens it.
  assert.deepEqual(await open(k.pair, formRef, k.keyId, ev.sealed), answers);
  const other = await laptopKey();
  await assert.rejects(open(other.pair, formRef, k.keyId, ev.sealed));
  await assert.rejects(open(k.pair, `frm_${"b".repeat(22)}`, k.keyId, ev.sealed), "bound to its form");

  // A revoked or unknown link gives nothing away.
  const ref2 = `frm_${"c".repeat(22)}`;
  const inv2 = await r.signed("POST", "/bridge/v1/forms", { locationId: "loc_1", formRef: ref2, firstName: "Noah", sections: ["details"], expiresAt });
  await r.signed("POST", "/bridge/v1/forms/revoke", { locationId: "loc_1", formRef: ref2 });
  assert.equal((await r.plain("GET", `${new URL(inv2.data.url).pathname}/meta`)).status, 410);
  assert.equal((await r.plain("GET", `/f/${randomToken(32)}/meta`)).status, 404);
});

test("released messages may link to the front desk's own one-time form path, and nothing else on that host", () => {
  const r = setup({ config: testConfig((c) => { c.publicUrl = PUBLIC; }) });
  const clinic = r.db.getClinic(r.clinicId)!;
  const tok = "A".repeat(43);
  assert.equal(linkProblem(clinic, `Hi Lena, your secure link: ${PUBLIC}/f/${tok} It works once.`), false);
  assert.equal(linkProblem(clinic, `See ${PUBLIC}/api/conversations`), true);
  assert.equal(linkProblem(clinic, `See ${PUBLIC}/f/${tok}/meta`), true);
  assert.equal(linkProblem(clinic, `See https://evil.example/f/${tok}`), true);
});
