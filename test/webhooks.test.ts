import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { createApp } from "../src/app.ts";
import { verifyTelnyxSignature } from "../src/channels/sms.ts";
import { listen, setup, testConfig } from "./helpers.ts";

const servers: { close: () => Promise<void> }[] = [];
after(() => Promise.all(servers.map((s) => s.close())));

async function start(configure: Parameters<typeof testConfig>[0]) {
  const s = setup({ config: testConfig(configure) });
  const server = await listen(createApp(s));
  servers.push(server);
  return { s, url: server.url };
}

test("Twilio webhooks require a valid signature", async () => {
  const { s, url } = await start((c) => { c.sms.twilioAuthToken = "twilio-token"; c.publicUrl = "https://clinic.example"; });
  const params = { From: "+19055550142", To: "+14165550100", Body: "Is there parking?", MessageSid: "SM123" };
  const data = "https://clinic.example/webhooks/twilio/sms" + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
  const signature = createHmac("sha1", "twilio-token").update(data).digest("base64");

  const bad = await fetch(`${url}/webhooks/twilio/sms`, { method: "POST", body: new URLSearchParams(params), headers: { "x-twilio-signature": "nope" } });
  assert.equal(bad.status, 403);
  const good = await fetch(`${url}/webhooks/twilio/sms`, { method: "POST", body: new URLSearchParams(params), headers: { "x-twilio-signature": signature } });
  assert.equal(good.status, 200);
  assert.match(await good.text(), /<Response>/);
  await s.inbox.idle();
  assert.ok(s.db.findContactByIdentity(s.clinicId, "sms", "+19055550142"));
});

test("Meta webhooks: verification handshake, signatures, and all three channels", async () => {
  const { s, url } = await start((c) => { c.meta.appSecret = "meta-secret"; c.meta.verifyToken = "vt"; });
  const challenge = await fetch(`${url}/webhooks/meta?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42`);
  assert.equal(await challenge.text(), "42");
  assert.equal((await fetch(`${url}/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`)).status, 403);

  const post = (payload: unknown, secret = "meta-secret") => {
    const body = JSON.stringify(payload);
    return fetch(`${url}/webhooks/meta`, {
      method: "POST", body,
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
    });
  };
  const whatsapp = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "wa-phone-id" }, contacts: [{ wa_id: "14165550123", profile: { name: "Priya" } }], messages: [{ from: "14165550123", id: "wamid.1", type: "text", text: { body: "hi there" } }] } }] }],
  };
  assert.equal((await post(whatsapp, "wrong")).status, 403);
  assert.equal((await post(whatsapp)).status, 200);
  assert.equal((await post({ object: "page", entry: [{ id: "fb-page", messaging: [{ sender: { id: "psid-1" }, recipient: { id: "fb-page" }, message: { mid: "m1", text: "hello from messenger" } }] }] })).status, 200);
  assert.equal((await post({ object: "instagram", entry: [{ id: "ig-account", messaging: [{ sender: { id: "igsid-1" }, recipient: { id: "ig-account" }, message: { mid: "m2", text: "hello from IG" } }, { sender: { id: "ig-account" }, recipient: { id: "igsid-1" }, message: { mid: "m3", text: "echo", is_echo: true } }] }] })).status, 200);
  await s.inbox.idle();
  assert.equal(s.db.findContactByIdentity(s.clinicId, "whatsapp", "14165550123")?.name, "Priya");
  assert.ok(s.db.findContactByIdentity(s.clinicId, "messenger", "psid-1"));
  assert.ok(s.db.findContactByIdentity(s.clinicId, "instagram", "igsid-1"));
  assert.equal(s.db.findContactByIdentity(s.clinicId, "instagram", "ig-account"), undefined, "echoes of our own messages are ignored");
});

test("Telnyx Ed25519 signatures verify", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const body = Buffer.from('{"data":{}}');
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(null, Buffer.concat([Buffer.from(`${ts}|`), body]), privateKey).toString("base64");
  assert.equal(verifyTelnyxSignature(raw, body, sig, ts), true);
  assert.equal(verifyTelnyxSignature(raw, Buffer.from('{"data":{"x":1}}'), sig, ts), false);
});

test("ElevenLabs voice: caller context, tools and post-call filing", async () => {
  const { s, url } = await start((c) => { c.elevenlabs.toolSecret = "tool-secret"; c.elevenlabs.webhookSecret = "el-secret"; });
  s.db.createContact(s.clinicId, { name: "Maria Gomez", phone: "+14165550111" });

  const init = await fetch(`${url}/webhooks/elevenlabs/init`, { method: "POST", headers: { "content-type": "application/json", "x-tool-secret": "tool-secret" }, body: JSON.stringify({ caller_id: "+14165550111", called_number: "+14165550100" }) });
  const ctx = await init.json();
  assert.equal(ctx.dynamic_variables.clinic_name, "Harbourfront Physio & Wellness");
  assert.equal(JSON.stringify(ctx).includes("Maria"), false, "caller ID can be spoofed, so the agent is not told whose number it is");

  const unauth = await fetch(`${url}/webhooks/elevenlabs/tools/create_staff_task`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unauth.status, 403);
  const task = await fetch(`${url}/webhooks/elevenlabs/tools/create_staff_task`, {
    method: "POST", headers: { "content-type": "application/json", "x-tool-secret": "tool-secret" },
    body: JSON.stringify({ caller_phone: "+14165550111", called_number: "+14165550100", type: "callback", title: "Call Maria back about receipts" }),
  });
  assert.match((await task.json()).result, /Task #\d+ created/);
  assert.ok(s.db.listTasks(s.clinicId).some((t) => t.created_by === "ai:voice" && t.type === "callback"));

  const payload = JSON.stringify({
    type: "post_call_transcription",
    data: {
      conversation_id: "conv_1", status: "done",
      transcript: [{ role: "agent", message: "Thanks for calling!" }, { role: "user", message: "I need receipts" }],
      metadata: { call_duration_secs: 95, phone_call: { external_number: "+14165550111", agent_number: "+14165550100" } },
      analysis: { transcript_summary: "Maria asked for receipts; callback task created.", call_successful: "success" },
    },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v0=${createHmac("sha256", "el-secret").update(`${t}.${payload}`).digest("hex")}`;
  assert.equal((await fetch(`${url}/webhooks/elevenlabs/post-call`, { method: "POST", headers: { "content-type": "application/json", "elevenlabs-signature": "t=1,v0=00" }, body: payload })).status, 403);
  assert.equal((await fetch(`${url}/webhooks/elevenlabs/post-call`, { method: "POST", headers: { "content-type": "application/json", "elevenlabs-signature": sig }, body: payload })).status, 200);
  const [call] = s.db.listCalls(s.clinicId);
  assert.equal(call.contact_name, "Maria Gomez");
  assert.equal(call.duration_s, 95);
  assert.equal(call.direction, "inbound", "who called whom: the patient called the clinic");
  assert.equal(call.from_number, "+14165550111");
  assert.equal(call.to_number, "+14165550100");
  assert.equal(call.handled_by, "assistant");
  assert.match(call.transcript ?? "", /Caller: I need receipts/);
  // Redelivery of the same call is filed once.
  await fetch(`${url}/webhooks/elevenlabs/post-call`, { method: "POST", headers: { "content-type": "application/json", "elevenlabs-signature": sig }, body: payload });
  assert.equal(s.db.listCalls(s.clinicId).length, 1);
  // Transcripts are encrypted at rest.
  const stored = s.db.sql.prepare("SELECT transcript FROM calls").get() as { transcript: string };
  assert.match(stored.transcript, /^e1:/);
});

test("webhook routes don't exist unless their secret is configured (fail closed)", async () => {
  const { url } = await start(() => {});
  for (const path of ["/webhooks/email", "/webhooks/twilio/sms", "/webhooks/meta", "/webhooks/elevenlabs/post-call", "/webhooks/elevenlabs/tools/create_staff_task"]) {
    const res = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: "{}" });
    assert.equal(res.status, 404, path);
  }
});

test("Postmark inbound needs the secret as Basic auth, never in the URL", async () => {
  const { s, url } = await start((c) => { c.email.inboundSecret = "a-very-long-inbound-secret-value"; });
  const body = JSON.stringify({ From: "pat@example.com", FromName: "Pat", To: "frontdesk@clinic.example", Subject: "Hi", TextBody: "Is there parking?", MessageID: "pm-1", Headers: [] });
  const send = (auth?: string) => fetch(`${url}/webhooks/email`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body });
  assert.equal((await send()).status, 403);
  assert.equal((await fetch(`${url}/webhooks/email?secret=a-very-long-inbound-secret-value`, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 403);
  assert.equal((await send(`Basic ${Buffer.from("inbound:a-very-long-inbound-secret-value").toString("base64")}`)).status, 200);
  await s.inbox.idle();
  const contact = s.db.findContactByIdentity(s.clinicId, "email", "pat@example.com")!;
  const [message] = s.db.listMessages(s.db.conversationForContact(contact, "email").id);
  assert.equal(message.sender_verified, 0, "no DMARC pass: the sender is not treated as proven");
});
