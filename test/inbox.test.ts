import assert from "node:assert/strict";
import { test } from "node:test";
import { grantService, recordingFetch, setup, testConfig } from "./helpers.ts";

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

test("STOP withdraws SMS consent and blocks every further text until START", async () => {
  const fetch = recordingFetch();
  const s = setup({ config: testConfig((c) => { c.sms.twilioAccountSid = "AC1"; c.sms.twilioAuthToken = "tok"; }), fetchImpl: fetch.impl });
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "STOP" });
  await s.inbox.idle();
  const contact = s.db.getContact(r!.conversation.contact_id)!;
  assert.equal(s.consents.latest(contact.id, "sms", "service")?.status, "withdrawn");
  assert.equal(fetch.calls.length, 0, "no AI reply to STOP (the carrier sends its own confirmation)");
  const sent = await s.inbox.sendToContact(s.clinic(), contact, "sms", () => "Reminder", { authorName: "test", purpose: "service" });
  assert.ok("skipped" in sent);
  await assert.rejects(s.inbox.staffReply(r!.conversation.id, "Are you sure?", { staffName: "Alex", staffUserId: 1 }), /opted out|withdrawn|START/i, "not even staff can text after STOP");
  // Writing again does not undo STOP on SMS; only START does.
  await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "what time do you open?" });
  await s.inbox.idle();
  assert.equal(fetch.calls.length, 0);
  await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "START" });
  await s.inbox.idle();
  assert.equal(s.consents.latest(contact.id, "sms", "service")?.status, "granted");
});

test("CANCEL is a carrier opt-out word: texts stop, and staff get an urgent call-back task", async () => {
  const fetch = recordingFetch();
  const s = setup({ config: testConfig((c) => { c.sms.twilioAccountSid = "AC1"; c.sms.twilioAuthToken = "tok"; }), fetchImpl: fetch.impl });
  const contact = s.db.createContact(s.clinicId, { name: "Cam Cancel", phone: "+19055550143" });
  grantService(s, contact.id, "sms");
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550143", body: "Cancel" });
  await s.inbox.idle();
  assert.equal(s.consents.latest(contact.id, "sms", "service")?.status, "withdrawn");
  assert.equal(fetch.calls.length, 0, "no reply: the number has opted out");
  const task = s.db.listTasks(s.clinicId).find((t) => t.title.startsWith("Patient texted CANCEL"));
  assert.ok(task);
  assert.equal(task.priority, "urgent");
  assert.equal(s.db.getConversation(r!.conversation.id)!.needs_attention, 1);
  // A sentence that merely mentions cancelling goes to the receptionist as normal.
  const other = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550144", body: "I need to cancel my appointment" });
  await s.inbox.idle();
  assert.equal(s.consents.latest(other!.conversation.contact_id, "sms", "service")?.status === "withdrawn", false);
});

test("'please stop messaging me' on WhatsApp withdraws consent and sends one confirmation", async () => {
  const s = setup();
  const r = await s.inbox.receive({ channel: "whatsapp", to: "wa-phone-id", from: "14165550199", body: "Please stop messaging me" });
  await s.inbox.idle();
  await new Promise((done) => setTimeout(done, 10));
  const contactId = r!.conversation.contact_id;
  assert.equal(s.consents.latest(contactId, "whatsapp", "service")?.status, "withdrawn");
  assert.equal(s.consents.latest(contactId, "whatsapp", "marketing")?.status, "withdrawn");
  const out = s.db.listMessages(r!.conversation.id).filter((m) => m.direction === "out" && m.status === "simulated");
  assert.equal(out.length, 1, "exactly one message to the patient (the rest are staff notes)");
  assert.match(out[0].body, /won't get any more messages/);
});

test("C confirms the next appointment", async () => {
  const s = setup();
  const contact = s.db.createContact(s.clinicId, { name: "Cee Confirm", phone: "+19055550145" });
  const appt = s.db.createAppointment({ clinic_id: s.clinicId, contact_id: contact.id, service_id: "rmt-60", practitioner_id: "pr-sofia", starts_at: new Date(Date.now() + 20 * 3600_000).toISOString(), ends_at: new Date(Date.now() + 21 * 3600_000).toISOString(), created_via: "staff" });
  await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550145", body: "C" });
  await s.inbox.idle();
  await new Promise((done) => setTimeout(done, 10));
  assert.ok(s.db.getAppointment(appt.id)!.confirmed_at);
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
  const sent = await s.inbox.approveDraft(draft.id, { name: "Alex", id: 1 }, "Yes! Underground parking off Lower Simcoe St.");
  assert.equal(sent.status, "sent");
  assert.equal(sent.author, "staff", "an edited draft is attributed to the editor");
  assert.equal(fetch.calls.length, 1);
  assert.ok(fetch.calls[0].url.includes("postmarkapp.com"));
});

test("a staff reply pauses the AI on that thread", async () => {
  const s = setup();
  const r = await s.inbox.receive({ channel: "instagram", to: "ig-account", from: "ig-77", body: "hi" });
  await s.inbox.idle();
  await s.inbox.staffReply(r!.conversation.id, "Hi! This is Alex at the front desk.", { staffName: "Alex", staffUserId: 1 });
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
  const message = await s.inbox.deliver(s.clinic(), contact, conversation.id, "sms", "hello", { author: "staff", purpose: "reply" });
  assert.equal(message.status, "failed");
  assert.match(message.error ?? "", /no phone/i);
  assert.equal(s.db.getConversation(conversation.id)!.needs_attention, 1);
});

test("outbound wording guard: banned titles and words never reach a patient", async () => {
  const s = setup();
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550146", body: "hi" });
  await s.inbox.idle();
  await assert.rejects(s.inbox.staffReply(r!.conversation.id, "Dr. Chen can see you Tuesday", { staffName: "Alex", staffUserId: 1 }), /wording/);
  await assert.rejects(s.inbox.staffReply(r!.conversation.id, "We can tr\u200Beat that", { staffName: "Alex", staffUserId: 1 }), /wording/, "zero-width tricks are caught");
  const ok = await s.inbox.staffReply(r!.conversation.id, "Maya can see you Tuesday at 2", { staffName: "Alex", staffUserId: 1 });
  assert.equal(ok.status, "simulated");
});

test("a reminder text naming a service is blocked by the privacy check (minimum necessary)", async () => {
  const s = setup();
  const contact = s.db.createContact(s.clinicId, { name: "Priv Acy", phone: "+19055550147" });
  grantService(s, contact.id, "sms");
  const conv = s.db.conversationForContact(contact, "sms");
  const blocked = await s.inbox.deliver(s.clinic(), contact, conv.id, "sms", "Reminder: your massage therapy for your lower back is tomorrow", { author: "system", purpose: "service" });
  assert.equal(blocked.status, "failed");
  assert.match(blocked.error ?? "", /health|privacy|details/i);
});

test("texts to numbers outside North America are refused unless enabled", async () => {
  const s = setup();
  const contact = s.db.createContact(s.clinicId, { name: "Abroad", phone: "+442071234567" });
  const conv = s.db.conversationForContact(contact, "sms");
  const message = await s.inbox.deliver(s.clinic(), contact, conv.id, "sms", "hello", { author: "staff", purpose: "reply" });
  assert.equal(message.status, "failed");
});
