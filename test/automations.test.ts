import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTemplate } from "../src/automations.ts";
import { setup } from "./helpers.ts";

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

test("24h reminders go out once, and not for last-minute bookings", async () => {
  const s = setup();
  const early = s.db.createContact(s.clinicId, { name: "Early Booker", phone: "+14165550001", preferred_channel: "sms" });
  const late = s.db.createContact(s.clinicId, { name: "Late Booker", phone: "+14165550002", preferred_channel: "sms" });
  bookAt(s, early.id, Date.now() + 20 * HOUR, 3 * 24 * HOUR);
  bookAt(s, late.id, Date.now() + 20 * HOUR, 2 * HOUR);

  await s.automations.tick();
  await s.automations.tick();
  const reminders = outbound(s, early.id);
  assert.equal(reminders.length, 1, "exactly one reminder despite two ticks");
  assert.match(reminders[0].body, /^Reminder: Registered massage therapy \(60 min\) with Sofia Alvarez tomorrow/);
  assert.equal(reminders[0].author_name, "Automation: Appointment reminder (24h)");
  assert.equal(outbound(s, late.id).length, 0);
});

test("post-visit follow-up asks for a review and promotes the patient", async () => {
  const s = setup();
  const patient = s.db.createContact(s.clinicId, { name: "Visited Today", phone: "+14165550003", stage: "booked" });
  bookAt(s, patient.id, Date.now() - 5 * HOUR, 5 * 24 * HOUR);
  await s.automations.tick();
  const [message] = outbound(s, patient.id);
  assert.match(message.body, /review/);
  assert.match(message.body, /g\.page/);
  assert.equal(s.db.getContact(patient.id)!.stage, "active_patient");
});

test("unbooked leads get one nudge after 24h", async () => {
  const s = setup();
  const lead = s.db.createContact(s.clinicId, { name: "Curious Lead", phone: "+14165550004" });
  s.db.sql.prepare("UPDATE contacts SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 30 * HOUR).toISOString(), lead.id);
  await s.automations.tick();
  await s.automations.tick();
  assert.equal(outbound(s, lead.id).length, 1);
  assert.equal(s.db.getContact(lead.id)!.stage, "contacted");
});

test("staff bookings get a confirmation; cancellations create a fill-the-gap task", async () => {
  const s = setup();
  const patient = s.db.createContact(s.clinicId, { name: "Pat Staffbook", phone: "+14165550005", preferred_channel: "sms" });
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
  bookAt(s, patient.id, Date.now() + 20 * HOUR, 3 * 24 * HOUR);
  await s.automations.tick();
  assert.equal(outbound(s, patient.id).length, 0);
});

test("broadcasts skip opted-out contacts", async () => {
  const s = setup();
  s.db.createContact(s.clinicId, { name: "Yes Please", phone: "+14165550007", tags: '["vip"]' });
  const out = s.db.createContact(s.clinicId, { name: "No Thanks", phone: "+14165550008", tags: '["vip"]' });
  s.db.updateContact(out.id, { opted_out: 1 });
  s.db.createContact(s.clinicId, { name: "Not Tagged", phone: "+14165550009" });
  const result = await s.automations.broadcast(s.clinic(), { name: "Holiday hours", tag: "vip", channel: "sms", template: "Hi {{first_name}}, we're closed Monday." });
  assert.deepEqual(result, { sent: 1, skipped: 1 });
});

test("templates fill known variables and leave unknown ones visible", () => {
  const s = setup();
  const contact = s.db.createContact(s.clinicId, { name: "Ana Lima", phone: "+14165550010" });
  assert.equal(renderTemplate("Hi {{first_name}} from {{ clinic_name }} {{oops}}", s.clinic(), contact), "Hi Ana from Harbourfront Physio & Wellness {{oops}}");
});

test("automated messages fall back to SMS once the WhatsApp 24h window has closed", async () => {
  const s = setup();
  const r = await s.inbox.receive({ channel: "whatsapp", to: "wa-phone-id", from: "14165550888", body: "hi" });
  await s.inbox.idle();
  const contact = s.db.getContact(r!.conversation.contact_id)!;
  const inWindow = await s.inbox.sendToContact(s.clinic(), contact, "preferred", "within window", { authorName: "test" });
  assert.equal(inWindow!.channel, "whatsapp");
  s.db.sql.prepare("UPDATE messages SET created_at = ? WHERE direction = 'in'").run(new Date(Date.now() - 30 * HOUR).toISOString());
  const late = await s.inbox.sendToContact(s.clinic(), contact, "preferred", "reminder", { authorName: "test" });
  assert.equal(late!.channel, "sms");
});
