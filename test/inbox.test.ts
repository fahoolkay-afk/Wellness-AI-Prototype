import assert from "node:assert/strict";
import { test } from "node:test";
import { recordingFetch, setup, testConfig } from "./helpers.ts";

test("an SMS from a new patient creates a contact, a thread and an AI reply", async () => {
  const s = setup();
  const result = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "(905) 555-0142", body: "Hi, how much is a 60 min massage?", externalId: "SM1" });
  assert.ok(result);
  await s.inbox.idle();
  const contact = s.db.getContact(result.conversation.contact_id)!;
  assert.equal(contact.phone, "+19055550142");
  assert.equal(contact.stage, "new_lead");
  const messages = s.db.listMessages(result.conversation.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].author, "ai");
  assert.equal(messages[1].status, "simulated");
  assert.match(messages[1].body, /\$130/);
});

test("webhook retries with the same provider id are ignored", async () => {
  const s = setup();
  await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "hello", externalId: "SM-dup" });
  const again = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "hello", externalId: "SM-dup" });
  assert.equal(again, undefined);
});

test("messages to an unknown clinic address are dropped", async () => {
  const s = setup();
  assert.equal(await s.inbox.receive({ channel: "sms", to: "+18005550000", from: "+19055550142", body: "hi" }), undefined);
});

test("WhatsApp and SMS from the same number land in one patient thread", async () => {
  const s = setup();
  const a = await s.inbox.receive({ channel: "whatsapp", to: "wa-phone-id", from: "14165550177", fromName: "Lee Park", body: "hello" });
  const b = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+14165550177", body: "also texting" });
  await s.inbox.idle();
  assert.equal(a!.conversation.id, b!.conversation.id);
  const contact = s.db.getContact(a!.conversation.contact_id)!;
  assert.equal(contact.name, "Lee Park");
  assert.equal(contact.whatsapp_id, "14165550177");
  assert.equal(contact.preferred_channel, "sms", "replies follow the channel the patient used last");
});

test("STOP opts the patient out and blocks further SMS", async () => {
  const fetch = recordingFetch();
  const s = setup({ config: testConfig((c) => { c.sms.twilioAccountSid = "AC1"; c.sms.twilioAuthToken = "tok"; }), fetchImpl: fetch.impl });
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "STOP" });
  await s.inbox.idle();
  const contact = s.db.getContact(r!.conversation.contact_id)!;
  assert.equal(contact.opted_out, 1);
  assert.equal(fetch.calls.length, 0, "no AI reply to STOP");
  const sent = await s.inbox.sendToContact(s.clinic(), contact, "sms", "Reminder", { authorName: "test" });
  assert.equal(sent, undefined);
  assert.equal(fetch.calls.length, 0);
});

test("live SMS replies go out through Twilio, or Telnyx when selected", async () => {
  for (const provider of ["twilio", "telnyx"] as const) {
    const fetch = recordingFetch();
    const s = setup({
      config: testConfig((c) => {
        c.sms.provider = provider;
        c.sms.twilioAccountSid = "AC1";
        c.sms.twilioAuthToken = "tok";
        c.sms.telnyxApiKey = "KEY";
      }),
      fetchImpl: fetch.impl,
    });
    await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "what are your hours?" });
    await s.inbox.idle();
    assert.equal(fetch.calls.length, 1);
    assert.ok(fetch.calls[0].url.includes(provider === "twilio" ? "api.twilio.com" : "api.telnyx.com"));
    assert.ok(fetch.calls[0].body.includes("19055550142"));
  }
});

test("email is drafted for staff approval by default, then sent on approval", async () => {
  const fetch = recordingFetch();
  const s = setup({ config: testConfig((c) => { c.email.postmarkServerToken = "pm"; }), fetchImpl: fetch.impl });
  const r = await s.inbox.receive({ channel: "email", to: "frontdesk@clinic.example", from: "pat@example.com", subject: "Parking", body: "Is there parking?" });
  await s.inbox.idle();
  const draft = s.db.listMessages(r!.conversation.id).find((m) => m.status === "draft")!;
  assert.ok(draft);
  assert.equal(draft.subject, "Re: Parking");
  assert.equal(fetch.calls.length, 0, "nothing sent before approval");
  assert.equal(s.db.getConversation(r!.conversation.id)!.needs_attention, 1);
  const sent = await s.inbox.approveDraft(draft.id, "Alex", "Yes! Underground parking off Lower Simcoe St.");
  assert.equal(sent.status, "sent");
  assert.equal(sent.author, "staff", "an edited draft is attributed to the editor");
  assert.equal(fetch.calls.length, 1);
  assert.ok(fetch.calls[0].url.includes("postmarkapp.com"));
});

test("a staff reply pauses the AI on that thread", async () => {
  const s = setup();
  const r = await s.inbox.receive({ channel: "instagram", to: "ig-account", from: "ig-77", body: "hi" });
  await s.inbox.idle();
  await s.inbox.staffReply(r!.conversation.id, "Hi! This is Alex at the front desk.", { staffName: "Alex" });
  assert.equal(s.db.getConversation(r!.conversation.id)!.ai_enabled, 0);
  await s.inbox.receive({ channel: "instagram", to: "ig-account", from: "ig-77", body: "great, thanks" });
  await s.inbox.idle();
  const last = s.db.listMessages(r!.conversation.id).at(-1)!;
  assert.equal(last.author, "patient", "AI stays quiet once a human has taken over");
});

test("asking for a person hands off to staff", async () => {
  const s = setup();
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "Can I talk to a real person?" });
  await s.inbox.idle();
  const conversation = s.db.getConversation(r!.conversation.id)!;
  assert.equal(conversation.ai_enabled, 0);
  assert.equal(conversation.needs_attention, 1);
});

test("emergencies get 911 guidance and an urgent task", async () => {
  const s = setup();
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "I have chest pain and my arm is numb" });
  await s.inbox.idle();
  const reply = s.db.listMessages(r!.conversation.id).at(-1)!;
  assert.match(reply.body, /911/);
  assert.ok(s.db.listTasks(s.clinicId).some((t) => t.priority === "urgent"));
});

test("a failed send is recorded and flagged, not thrown", async () => {
  const s = setup();
  const contact = s.db.createContact(s.clinicId, { name: "No Channels" });
  const conversation = s.db.conversationForContact(contact, "sms");
  const message = await s.inbox.deliver(s.clinic(), contact, conversation.id, "sms", "hello", { author: "staff" });
  assert.equal(message.status, "failed");
  assert.match(message.error ?? "", /no phone/i);
  assert.equal(s.db.getConversation(conversation.id)!.needs_attention, 1);
});
