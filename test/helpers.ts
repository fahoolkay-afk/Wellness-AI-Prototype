import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { config as baseConfig, type Config } from "../src/config.ts";
import { Db } from "../src/db.ts";
import type { Responder } from "../src/ai/receptionist.ts";
import { DemoResponder } from "../src/ai/demo.ts";
import { DEMO_CLINIC } from "../src/seed.ts";
import { createServices } from "../src/services.ts";
import type { Role } from "../src/security/permissions.ts";
import { Vault } from "../src/security/vault.ts";
import type { Channel, ClinicProfile } from "../src/types.ts";

export function testConfig(overrides: (c: Config) => void = () => {}): Config {
  const c = structuredClone(baseConfig);
  // Never let a developer's real credentials leak into tests.
  c.anthropic.apiKey = "";
  c.sms = { ...c.sms, twilioAccountSid: "", twilioAuthToken: "", telnyxApiKey: "", telnyxPublicKey: "" };
  c.meta = { ...c.meta, appSecret: "", whatsappToken: "", pageAccessToken: "" };
  c.email = { postmarkServerToken: "", inboundSecret: "" };
  c.elevenlabs = { toolSecret: "", webhookSecret: "" };
  c.edition = "standalone";
  c.demo = false;
  c.dbPath = ":memory:";
  c.publicUrl = "http://127.0.0.1";
  c.backups = { dir: "" };
  c.security = {
    ...c.security, sessionSecret: "test-session-secret-0123456789abcdef", dataKey: "test-data-key-0123456789abcdef0123",
    requireTotp: false, allowUnsignedWebhooks: false, enableSimulator: true, allowInternational: false,
  };
  overrides(c);
  return c;
}

/** Services on an in-memory DB with a single demo clinic and immediate AI replies. */
export function setup(opts: { config?: Config; responder?: Responder; fetchImpl?: typeof fetch; profile?: Partial<ClinicProfile> } = {}) {
  const db = new Db(":memory:", new Vault("test-data-key-0123456789abcdef0123"));
  const services = createServices(opts.config ?? testConfig(), {
    db, responder: opts.responder ?? new DemoResponder(), fetchImpl: opts.fetchImpl, replyDelayMs: 0,
  });
  // Processor agreements are recorded in tests so the AI is allowed to run outside demo mode.
  const clinicId = db.createClinic({ ...structuredClone(DEMO_CLINIC), processorAgreementsRecorded: true, quietHours: { start: "00:00", end: "24:00" }, ...opts.profile });
  db.addChannelAccount(clinicId, "sms", "+14165550100");
  db.addChannelAccount(clinicId, "voice", "+14165550100");
  db.addChannelAccount(clinicId, "whatsapp", "wa-phone-id");
  db.addChannelAccount(clinicId, "instagram", "ig-account");
  db.addChannelAccount(clinicId, "messenger", "fb-page");
  db.addChannelAccount(clinicId, "email", "frontdesk@clinic.example");
  return { ...services, clinicId, clinic: () => db.getClinic(clinicId)! };
}

/** Records that a contact agreed to service messages (reminders) on a channel, as staff would at intake. */
export function grantService(s: ReturnType<typeof setup>, contactId: number, channel: Channel, purpose: "service" | "marketing" = "service") {
  s.consents.record({ clinicId: s.clinicId, contactId, channel, purpose, status: "granted", basis: purpose === "marketing" ? "express" : "staff", source: "test intake form", by: "test" });
}

export const TEST_PASSWORD = "correct horse battery staple";

/** Creates a staff account with a known passphrase and returns a signed-in cookie for it. */
export async function signIn(s: ReturnType<typeof setup>, url: string, role: Role = "owner", username = `${role}-user`): Promise<string> {
  if (!s.accounts.findByUsername(username)) {
    s.accounts.createUser({ username, name: `Test ${role}`, role, clinicIds: [s.clinicId], createdBy: "test", password: TEST_PASSWORD });
  }
  const res = await fetch(`${url}/api/login`, {
    method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

/** JSON API call as a signed-in staff member, from the app's own origin. */
export function api(url: string, cookie: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${url}${path}`, {
      method, headers: { cookie, origin: url, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  };
}

export async function listen(app: { listen: (port: number, cb: () => void) => Server }): Promise<{ url: string; close: () => Promise<void> }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/** A fetch stub that records outbound provider calls and answers like the provider would. */
export function recordingFetch() {
  const calls: { url: string; body: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (url.includes("twilio.com")) return json({ sid: `SM${calls.length}` }, 201);
    if (url.includes("telnyx.com")) return json({ data: { id: `tx-${calls.length}` } });
    if (url.includes("graph.facebook.com") && url.includes("/messages")) return json({ messages: [{ id: `wamid.${calls.length}` }], message_id: `mid.${calls.length}` });
    if (url.includes("postmarkapp.com")) return json({ MessageID: `pm-${calls.length}`, ErrorCode: 0 });
    return json({ error: "unexpected" }, 500);
  }) as typeof fetch;
  return { calls, impl };
}

/** Next clinic-local weekday (1 = Mon ... 6 = Sat) at least two days out, as YYYY-MM-DD. */
export function nextWeekday(weekday: number, timeZone = DEMO_CLINIC.timezone): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  for (let i = 2; i < 10; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    if (date.getUTCDay() === weekday) return date.toISOString().slice(0, 10);
  }
  throw new Error("unreachable");
}
