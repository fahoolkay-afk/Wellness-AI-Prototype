import assert from "node:assert/strict";
import { test } from "node:test";
import { inQuietHours, renderTemplate } from "../src/automations.ts";
import { grantService, recordingFetch, setup, testConfig } from "./helpers.ts";

const HOUR = 3600_000;

function bookAt(s: ReturnType<typeof setup>, contactId: number, startMs: number, createdAgoMs: number, createdVia = "staff") {
  const appt = s.db.createAppointment({
    clinic_id: s.clinicId, contact_id: contactId, service_id: "rmt-60", practitioner_id: "pr-sofia",
    starts_at: new Date(startMs).toISOString(), ends_at: new Date(startMs + HOUR).toISOString(), created_via: createdVia,
  });
  s.db.sql.prepare("UPDATE appointments SET created_at = ? WHERE id = ?").run(new Date(Date.now() - createdAgoMs).toISOString(), appt.id);
  return appt;
}

const outbound = (s: ReturnType<typeof setup>, contactId: number) => {
  const conv = s.db.conversationForContact(s.db.getContact(contactId)!, "sms");
  return s.db.listMessages(conv.id).filter((m) => m.direction === "out");
};

test("no reminder without consent to service messages on that channel", async () => {
  const s = setup();
  const patient = s.db.createContact(s.clinicId, { name: "No Consent", phone: "+14165550011", preferred_channel: "sms" });
  bookAt(s, patient.id, Date.now() + 20 * HOUR, 3 * 24 * HOUR);
  await s.automations.tick();
  assert.equal(outbound(s, patient.id).length, 0);
});

test("24h reminders go out once, and not for last-minute bookings", async () => {
  const s = setup();
  const early = s.db.createContact(s.clinicId, { name: "Early Booker", phone: "+14165550001", preferred_channel: "sms" });
  const late = s.db.createContact(s.clinicId, { name: "Late Booker", phone: "+14165550002", preferred_channel: "sms" });
  grantService(s, early.id, "sms");
  grantService(s, late.id, "sms");
  bookAt(s, early.id, Date.now() + 20 * HOUR, 3 * 24 * HOUR);
  bookAt(s, late.id, Date.now() + 20 * HOUR, 2 * HOUR);

  await s.automations.tick();
  await s.automations.tick();
  const reminders = outbound(s, early.id);
  assert.equal(reminders.length, 1, "exactly one reminder despite two ticks");
  // A text names no service or practitioner surname (PHIPA s.30: minimum necessary on a lock screen).
  assert.match(reminders[0].body, /^Hi Early, a reminder of your appointment at Harbourfront/);
  assert.match(reminders[0].body, /Reply C to confirm or CHANGE to reschedule/);
  assert.doesNotMatch(reminders[0].body, /massage|Alvarez|cancel/i);
  assert.equal(reminders[0].purpose, "service");
  assert.equal(reminders[0].author_name, "Automation: Appointment reminder (24h)");
  assert.equal(outbound(s, late.id).length, 0);
});

test("post-visit follow-up asks for a review and promotes the patient", async () => {
  const s = setup();
  const patient = s.db.createContact(s.clinicId, { name: "Visited Today", phone: "+14165550003", stage: "booked" });
  const other = s.db.createContact(s.clinicId, { name: "Service Only", phone: "+14165550013", stage: "booked" });
  grantService(s, patient.id, "sms");
  grantService(s, patient.id, "sms", "marketing");
  grantService(s, other.id, "sms");
  bookAt(s, patient.id, Date.now() - 5 * HOUR, 5 * 24 * HOUR);
  bookAt(s, other.id, Date.now() - 5 * HOUR, 5 * 24 * HOUR);
  await s.automations.tick();
  assert.equal(outbound(s, other.id).length, 0, "a review request is marketing: reminder consent is not enough");
  const [message] = outbound(s, patient.id);
  assert.match(message.body, /review/);
  assert.match(message.body, /g\.page/);
  assert.equal(s.db.getContact(patient.id)!.stage, "active_patient");
});

test("unbooked leads get one nudge after 24h (when enabled and consented)", async () => {
  const s = setup();
  const profile = s.clinic().profile;
  profile.automations.find((a) => a.id === "lead-nurture-24h")!.enabled = true;
  s.db.updateClinicProfile(s.clinicId, profile);
  const lead = s.db.createContact(s.clinicId, { name: "Curious Lead", phone: "+14165550004" });
  grantService(s, lead.id, "sms", "marketing");
  s.db.sql.prepare("UPDATE contacts SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 30 * HOUR).toISOString(), lead.id);
  await s.automations.tick();
  await s.automations.tick();
  assert.equal(outbound(s, lead.id).length, 1);
  assert.equal(s.db.getContact(lead.id)!.stage, "contacted");
});

test("staff bookings get a confirmation; cancellations create a fill-the-gap task", async () => {
  const s = setup();
  const patient = s.db.createContact(s.clinicId, { name: "Pat Staffbook", phone: "+14165550005", preferred_channel: "sms" });
  grantService(s, patient.id, "sms");
  const appt = bookAt(s, patient.id, Date.now() + 72 * HOUR, 0, "staff:Alex");
  s.events.emit("appointment.booked", appt);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(outbound(s, patient.id)[0].body, /you're booked/);
  s.events.emit("appointment.cancelled", appt);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(s.db.listTasks(s.clinicId).some((t) => t.title.startsWith("Cancellation")));
});

test("disabled automations never run", async () => {
  const s = setup();
  const profile = s.clinic().profile;
  for (const a of profile.automations) a.enabled = false;
  s.db.updateClinicProfile(s.clinicId, profile);
  const patient = s.db.createContact(s.clinicId, { name: "Quiet", phone: "+14165550006" });
  grantService(s, patient.id, "sms");
  bookAt(s, patient.id, Date.now() + 20 * HOUR, 3 * 24 * HOUR);
  await s.automations.tick();
  assert.equal(outbound(s, patient.id).length, 0);
});

test("marketing campaigns reach only people with express consent, on approved tags", async () => {
  const twilio = recordingFetch();
  const s = setup({ fetchImpl: twilio.impl, config: testConfig((c) => { c.sms.twilioAccountSid = "AC1"; c.sms.twilioAuthToken = "tok"; }) });
  const yes = s.db.createContact(s.clinicId, { name: "Yes Please", phone: "+14165550007", tags: '["newsletter"]' });
  grantService(s, yes.id, "sms", "marketing");
  const serviceOnly = s.db.createContact(s.clinicId, { name: "Reminders Only", phone: "+14165550008", tags: '["newsletter"]' });
  grantService(s, serviceOnly.id, "sms");
  s.db.createContact(s.clinicId, { name: "Not Tagged", phone: "+14165550009" });
  const opts = { name: "Holiday hours", tag: "newsletter", channel: "sms" as const, template: "Hi {{first_name}}, we're closed Monday.", purpose: "marketing" as const };
  const preview = s.automations.preview(s.clinic(), opts);
  assert.equal(preview.matched, 2);
  assert.equal(preview.eligible, 1);
  const result = await s.automations.broadcast(s.clinic(), opts, { id: 1, name: "Owner" });
  assert.deepEqual(result, { sent: 1, skipped: 1 });
  assert.equal(twilio.calls.length, 1);
  assert.match(new URLSearchParams(twilio.calls[0].body).get("Body") ?? "", /Reply STOP to opt out\.$/, "marketing texts carry the opt-out line");

  // Clinical tags can't be targeted, and health details can't go in a campaign text.
  assert.match(s.automations.preview(s.clinic(), { ...opts, tag: "lower-back" }).problem ?? "", /approved audience tag/);
  assert.match(s.automations.preview(s.clinic(), { ...opts, template: "Book your massage therapy tune-up!" }).problem ?? "", /health details/);
});

test("quiet hours: nothing automated goes out at night, clinic time", () => {
  const s = setup({ profile: { quietHours: { start: "08:00", end: "21:00" } } });
  assert.equal(inQuietHours(s.clinic(), new Date("2026-11-03T03:00:00Z")), true, "10 pm Toronto");
  assert.equal(inQuietHours(s.clinic(), new Date("2026-11-03T16:00:00Z")), false, "11 am Toronto");
});

test("templates fill known variables and leave unknown ones visible", () => {
  const s = setup();
  const contact = s.db.createContact(s.clinicId, { name: "Ana Lima", phone: "+14165550010" });
  assert.equal(renderTemplate("Hi {{first_name}} from {{ clinic_name }} {{oops}}", s.clinic(), contact), "Hi Ana from Harbourfront Physio & Wellness {{oops}}");
  const appt = s.db.createAppointment({ clinic_id: s.clinicId, contact_id: contact.id, service_id: "rmt-60", practitioner_id: "pr-sofia", starts_at: new Date(Date.now() + 48 * HOUR).toISOString(), ends_at: new Date(Date.now() + 49 * HOUR).toISOString(), created_via: "staff" });
  assert.equal(renderTemplate("{{service}} with {{practitioner}}", s.clinic(), contact, appt, "sms"), "appointment with Sofia", "texts stay generic");
  assert.match(renderTemplate("{{service}} with {{practitioner}}", s.clinic(), contact, appt, "email"), /massage therapy.*Sofia Alvarez/i);
});

test("no fallback to another channel without consent there; WhatsApp needs a template after 24h", async () => {
  const s = setup();
  const r = await s.inbox.receive({ channel: "whatsapp", to: "wa-phone-id", from: "14165550888", body: "hi" });
  await s.inbox.idle();
  const contact = s.db.updateContact(r!.conversation.contact_id, { phone: "+14165550888" });
  grantService(s, contact.id, "whatsapp");
  const opts = { authorName: "test", purpose: "service" as const };
  const inWindow = await s.inbox.sendToContact(s.clinic(), contact, "preferred", () => "within window", opts);
  assert.ok("message" in inWindow && inWindow.message.channel === "whatsapp");
  s.db.sql.prepare("UPDATE messages SET created_at = ? WHERE direction = 'in'").run(new Date(Date.now() - 30 * HOUR).toISOString());
  const late = await s.inbox.sendToContact(s.clinic(), contact, "preferred", () => "reminder", opts);
  assert.ok("skipped" in late, "the old SMS fallback is gone: no SMS consent, no text");
  grantService(s, contact.id, "sms");
  const withSms = await s.inbox.sendToContact(s.clinic(), contact, "preferred", () => "reminder", opts);
  assert.ok("message" in withSms && withSms.message.channel === "sms", "SMS once the patient agreed to texts");
});
