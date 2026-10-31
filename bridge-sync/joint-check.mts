// Bridge joint check: proves the front desk (cloud) and the records system (EHRM, clinic laptop) still agree.
// The same file lives in both projects (bridge-sync/). Run it from either side with both folders on disk:
//
//   FD_DIR=/path/to/front-desk EH_DIR=/path/to/ehrm/roles-demo node bridge-sync/joint-check.mts
//
// Part 1 compares the two allow-lists (event types and keys, id patterns, codes, name and phone rules) and the contract
// fingerprint in CONTRACT.lock.json. Part 2 starts both apps in memory (no files, ports chosen by the system, never 8787),
// links them, and runs the v1.2 flow end to end over real signed HTTP. Synthetic people only. Prints codes and counts,
// never a passphrase, token or secret. Exit code 0 = in sync.
import { readFileSync, existsSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FD_DIR = process.env.FD_DIR, EH_DIR = process.env.EH_DIR;
if (!FD_DIR || !EH_DIR || !existsSync(join(FD_DIR, "src/bridge/events.ts")) || !existsSync(join(EH_DIR, "bridge.mjs"))) {
  console.error("Set FD_DIR (front desk project) and EH_DIR (EHRM roles-demo folder)."); process.exit(2);
}
const results: [string, boolean, string][] = [];
const check = (id: string, ok: boolean, detail = "") => { results.push([id, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  " + detail : ""}`); };

// ---------------- part 1: the contract and the two allow-lists
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const lock = JSON.parse(readFileSync(join(HERE, "CONTRACT.lock.json"), "utf8"));
check("J1 contract fingerprint", sha(join(HERE, "INTEGRATION-CONTRACT.md")) === lock.contractSha256, `contract ${lock.contractVersion}`);
const fdContract = join(FD_DIR, "docs/INTEGRATION-CONTRACT.md");
check("J2 front desk copy of the contract is the locked one", existsSync(fdContract) && sha(fdContract) === lock.contractSha256);
const ehKit = join(EH_DIR, "bridge-sync/CONTRACT.lock.json");
check("J3 both projects carry the same lock", existsSync(ehKit) && existsSync(join(FD_DIR, "bridge-sync/CONTRACT.lock.json"))
  && readFileSync(ehKit, "utf8") === readFileSync(join(FD_DIR, "bridge-sync/CONTRACT.lock.json"), "utf8"));

const F = await import(join(FD_DIR, "src/bridge/events.ts"));
const E = await import(join(EH_DIR, "bridge.mjs"));
const src = (o: Record<string, RegExp>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.source]));
check("J4 id patterns match", JSON.stringify(src(F.REF)) === JSON.stringify(src(E.REF)));
check("J5 name and phone rules match", F.NAME_RE.source === E.NAME_RE.source && F.FIRST_NAME_RE.source === E.FIRST_NAME_RE.source && F.E164_RE.source === E.E164_RE.source);
check("J6 service codes match", JSON.stringify([...F.SERVICE_CODES]) === JSON.stringify([...E.SERVICE_CODES]));
const keysOf = (t: Record<string, Record<string, unknown>>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Object.keys(v).sort()]));
check("J7 event types and their keys match", JSON.stringify(keysOf(F.EVENT_TYPES)) === JSON.stringify(keysOf(E.EVENT_TYPES)), Object.keys(F.EVENT_TYPES).join(", "));
check("J8 lock lists the same event types", JSON.stringify(Object.keys(F.EVENT_TYPES).sort()) === JSON.stringify([...lock.eventTypes].sort()));
check("J9 lock lists the laptop's capabilities", JSON.stringify(Object.keys(E.BRIDGE_CAPABILITIES).sort()) === JSON.stringify([...lock.capabilities].sort()));
// every booking channel the front desk can produce must be accepted by the laptop, and the same bad event refused by both
const sample = (channel: string) => ({ id: "evt_" + "a".repeat(22), type: "booking.requested", at: new Date().toISOString(), seq: 1, requestRef: "brq_" + "b".repeat(22), kind: "new", channel,
  firstName: "Maya", phone: "+14165550155", phoneVerified: false, preferredTimes: [{ start: new Date(Date.now() + 864e5).toISOString(), end: new Date(Date.now() + 90e6).toISOString() }], service: "initial", returning: false, textConsent: true });
const chans = [...F.BOOKING_CHANNELS];
check("J10 the laptop accepts every booking channel the front desk sends", chans.every((c) => !E.eventProblem(sample(c))), chans.join(","));
const bad = { ...sample("web"), reason: "neck pain" };
check("J11 both refuse an event carrying an extra key", !!F.eventProblem(bad) && !!E.eventProblem(bad));

// ---------------- part 2: both apps live, linked over signed HTTP
const CLOUD = "https://frontdesk.clinic-cloud.ca";
const { config: baseConfig } = await import(join(FD_DIR, "src/config.ts"));
const { createServices } = await import(join(FD_DIR, "src/services.ts"));
const { createApp: fdApp } = await import(join(FD_DIR, "src/app.ts"));
const { seedDemo } = await import(join(FD_DIR, "src/seed.ts"));
const { createApp: ehApp } = await import(join(EH_DIR, "server.mjs"));
const SEED = JSON.parse(readFileSync(join(EH_DIR, "seed.json"), "utf8"));

const c = structuredClone(baseConfig);
Object.assign(c, { demo: true, dbPath: ":memory:", port: 0, publicUrl: CLOUD });
c.anthropic.apiKey = "";
c.sms = { ...c.sms, twilioAccountSid: "", twilioAuthToken: "", telnyxApiKey: "", telnyxPublicKey: "" };
c.meta = { ...c.meta, appSecret: "", whatsappToken: "", pageAccessToken: "" };
c.email = { postmarkServerToken: "", inboundSecret: "" };
c.security = { ...c.security, sessionSecret: "joint-check-session-secret-0123456789", dataKey: "joint-check-data-key-0123456789abcdef", requireTotp: false, enableSimulator: true };
const fd = createServices(c, { replyDelayMs: 50 });
const clinicId = seedDemo(fd.db, { consents: fd.consents, accounts: fd.accounts });
fd.db.updateClinicProfile(clinicId, { ...fd.db.getClinic(clinicId).profile, quietHours: { start: "00:00", end: "24:00" } });
const { keyId, secret } = fd.bridge.store.pair(clinicId, "loc_1");
const fdServer = fdApp(fd).listen(0, "127.0.0.1");
await new Promise((r) => fdServer.once("listening", r));
const FD = `http://127.0.0.1:${(fdServer.address() as any).port}`;
const bridgeFetch = (url: string, init: RequestInit) => fetch(String(url).replace(CLOUD, FD), init);
const eh = ehApp({ dbPath: ":memory:", bridgeInDemo: true, bridgeFetch, bridgeIntervalMs: 3600e3, bridgePushOnRelease: false });
const EB = `http://127.0.0.1:${await eh.listen(0)}`;
async function ec(method: string, p: string, { token, body }: { token?: string; body?: unknown } = {}) {
  const h: Record<string, string> = {};
  if (body !== undefined) h["content-type"] = "application/json";
  if (token) h.authorization = "Bearer " + token;
  const r = await fetch(EB + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d: any = {}; try { d = JSON.parse(t); } catch { d = {}; }
  return { status: r.status, data: d };
}
const pass = (u: string) => SEED.users.find((y: any) => y.username === u).passphrase;
const login = async (u: string) => (await ec("POST", "/api/login", { body: { username: u, passphrase: pass(u), attest: true } })).data.token as string;
let failed = false;
try {
  const T = { owner: await login("owner"), desk: await login("desk"), prac: await login("prac_a") };
  for (const cap of Object.keys(E.BRIDGE_CAPABILITIES)) await ec("POST", "/api/devices", { token: T.owner, body: { capability: cap } });
  const cfg = await ec("PUT", "/api/bridge/config", { token: T.owner, body: { baseUrl: CLOUD, keyId, secret, locationId: "loc_1", passphrase: pass("owner") } });
  const en = await ec("POST", "/api/bridge/enable", { token: T.owner });
  check("J12 laptop links to the front desk", cfg.status === 200 && en.status === 200, `config ${cfg.status} enable ${en.status}`);

  // website request crosses with its v1.2 fields
  const day = new Date(Date.now() + 2 * 864e5).toLocaleDateString("en-CA");
  const wb = await fetch(`${FD}/public/book/${clinicId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: "Maya", phone: "416 555 0155", service: "initial", returning: false, textConsent: true, website: "", times: [{ day, from: "09:00", to: "12:00" }] }) });
  await eh.bridge.tick();
  const reqs = (await ec("GET", "/api/booking-requests", { token: T.desk })).data;
  const r = (reqs || []).find((x: any) => x.contact_name === "Maya");
  check("J13 website request reaches the laptop with service, returning and text yes", wb.status < 300 && !!r && r.channel === "web" && r.service === "Initial assessment" && r.returning === false && r.text_consent === true, `web ${wb.status}`);

  // register, book, secure link by text: pushed, re-checked and sent by the front desk
  const reg = await ec("POST", `/api/booking-requests/${r.id}/register`, { token: T.desk, body: {} });
  const pid = reg.data.id;
  let appt = 0;
  for (let k = 0; k < 72 && !appt; k++) { const t = Math.ceil((Date.now() + (26 + k) * 3600e3) / 3600e3) * 3600e3; const cv = await ec("POST", `/api/booking-requests/${r.id}/convert`, { token: T.desk, body: { practitioner_username: "prac_a", starts_at: t, outside_hours_reason: "joint check" } }); if (cv.status === 201) appt = cv.data.id; }
  const send = await ec("POST", `/api/patients/${pid}/forms`, { token: T.desk, body: { via: "sms", sections: ["details", "intake"] } });
  await eh.bridge.tick();
  const contact = fd.db.findContactByIdentity(clinicId, "sms", "+14165550155");
  const bodies = contact ? fd.db.listMessages(fd.db.conversationForContact(contact, "sms").id).map((m: any) => m.body as string) : [];
  const link = bodies.join(" ").match(/https:\/\/frontdesk\.clinic-cloud\.ca\/f\/[A-Za-z0-9_-]+/)?.[0];
  check("J14 registered, booked, and the secure link went out by text", reg.status === 201 && appt > 0 && send.status < 300 && !!link, `register ${reg.status} book ${appt > 0} link ${!!link}`);

  // the patient's browser seals the answers with the laptop's key; only the laptop opens them
  const local = link!.replace(CLOUD, FD);
  const meta: any = await (await fetch(`${local}/meta`)).json();
  const subtle = webcrypto.subtle, enc = new TextEncoder();
  const clinicKey = await subtle.importKey("raw", Buffer.from(meta.publicKey, "base64url"), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const shared = await subtle.deriveBits({ name: "ECDH", public: clinicKey }, eph.privateKey, 256);
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode(meta.formRef), info: enc.encode(lock.formCrypto.hkdfInfo) }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const answers = { v: 1, details: { family_name: "Chen", dob: "1988-02-20", insurer: "Sun Life" }, intake: { reason: "Stiff neck after long days at the computer", red_flags: { rf1: false, rf2: false, rf3: true }, consent_assessment: true, consent_cancellation: true, signature_name: "Maya Chen" } };
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`${meta.formRef}|${meta.keyId}`) }, key, enc.encode(JSON.stringify(answers)));
  const sealed = { v: 1, keyId: meta.keyId, epk: Buffer.from(await subtle.exportKey("raw", eph.publicKey)).toString("base64url"), iv: Buffer.from(iv).toString("base64url"), ct: Buffer.from(ct).toString("base64url") };
  const sub = await fetch(local, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sealed) });
  await eh.bridge.tick();
  const forms = (await ec("GET", "/api/forms", { token: T.desk })).data;
  const f = Array.isArray(forms) ? forms[0] : null;
  const acc = f ? await ec("POST", `/api/forms/${f.id}/accept`, { token: T.desk, body: { fields: f.fields.map((x: any) => x.field) } }) : { status: 0, data: {} };
  const after = (await ec("GET", `/api/patients/${pid}/contact`, { token: T.desk })).data;
  const intake = eh.db.prepare("SELECT appointment_id, red_flags FROM intake_submissions WHERE patient_id=?").get(pid);
  check("J15 sealed form opened only on the laptop, details kept, intake on the visit with its safety flag",
    sub.status === 200 && acc.status === 200 && after.family_name === "Chen" && intake?.appointment_id === appt && intake?.red_flags === '["rf3"]', `submit ${sub.status} accept ${acc.status}`);

  // a released confirmation: pushed by the laptop, re-checked and sent by the front desk, delivery status back
  await ec("POST", `/api/patients/${pid}/consent`, { token: T.desk, body: { field: "sms", value: true } });
  const prop = await ec("POST", `/api/patients/${pid}/outreach`, { token: T.prac, body: { template: "booking_confirmed", channel: "sms", appointment_id: appt } });
  const rel = prop.data?.id ? await ec("POST", `/api/outreach/${prop.data.id}/release`, { token: T.prac, body: {} }) : { status: 0 };
  await eh.bridge.tick(); await new Promise((res) => setTimeout(res, 300)); await eh.bridge.tick();
  const row = prop.data?.id ? eh.db.prepare("SELECT status, pushed_at, delivery_status FROM outreach WHERE id=?").get(prop.data.id) : null;
  // with no live carrier the front desk reports not_sent / simulated; with one it reports sent or delivered
  check("J16 released confirmation pushed, sent, and its delivery status came back", !!row?.pushed_at && !!row?.delivery_status, `propose ${prop.status} release ${rel.status} delivery ${row?.delivery_status ?? "none"}`);

  // the appointment fact is mirrored in the cloud without service or notes
  const mirrorRows = fd.db.sql.prepare("SELECT first_name, status FROM bridge_appointments WHERE clinic_id=?").all(clinicId);
  const cols = fd.db.sql.prepare("PRAGMA table_info(bridge_appointments)").all().map((x: any) => x.name);
  check("J17 appointment facts mirrored in the front desk, with no column for service or notes", mirrorRows.length > 0 && !cols.some((n: string) => /service|note|reason/.test(n)), `${mirrorRows.length} mirrored`);
} catch (e) {
  failed = true; console.error("joint check stopped:", (e as Error).message);
} finally {
  fdServer.closeAllConnections?.(); fdServer.close(); await eh.close?.(); fd.bridge.stop?.();
}
const bad2 = results.filter((x) => !x[1]);
console.log(`\n${results.length - bad2.length}/${results.length} passed${bad2.length || failed ? " — NOT in sync" : " — in sync"}`);
process.exit(bad2.length || failed ? 1 : 0);
