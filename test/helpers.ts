import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { config as baseConfig, type Config } from "../src/config.ts";
import { Db } from "../src/db.ts";
import type { Responder } from "../src/ai/receptionist.ts";
import { DemoResponder } from "../src/ai/demo.ts";
import { DEMO_CLINIC } from "../src/seed.ts";
import { createServices } from "../src/services.ts";
import type { ClinicProfile } from "../src/types.ts";

export function testConfig(overrides: (c: Config) => void = () => {}): Config {
  const c = structuredClone(baseConfig);
  // Never let a developer's real credentials leak into tests.
  c.anthropic.apiKey = "";
  c.sms = { ...c.sms, twilioAccountSid: "", twilioAuthToken: "", telnyxApiKey: "", telnyxPublicKey: "" };
  c.meta = { ...c.meta, appSecret: "", whatsappToken: "", pageAccessToken: "" };
  c.email = { postmarkServerToken: "", inboundSecret: "" };
  c.elevenlabs = { toolSecret: "", webhookSecret: "" };
  c.edition = "standalone";
  c.staffPassword = "test-pw";
  c.sessionSecret = "test-secret";
  overrides(c);
  return c;
}

/** Services on an in-memory DB with a single demo clinic and immediate AI replies. */
export function setup(opts: { config?: Config; responder?: Responder; fetchImpl?: typeof fetch; profile?: Partial<ClinicProfile> } = {}) {
  const db = new Db(":memory:");
  const services = createServices(opts.config ?? testConfig(), {
    db, responder: opts.responder ?? new DemoResponder(), fetchImpl: opts.fetchImpl, replyDelayMs: 0,
  });
  const clinicId = db.createClinic({ ...structuredClone(DEMO_CLINIC), ...opts.profile });
  db.addChannelAccount(clinicId, "sms", "+14165550100");
  db.addChannelAccount(clinicId, "voice", "+14165550100");
  db.addChannelAccount(clinicId, "whatsapp", "wa-phone-id");
  db.addChannelAccount(clinicId, "instagram", "ig-account");
  db.addChannelAccount(clinicId, "messenger", "fb-page");
  db.addChannelAccount(clinicId, "email", "frontdesk@clinic.example");
  return { ...services, clinicId, clinic: () => db.getClinic(clinicId)! };
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
