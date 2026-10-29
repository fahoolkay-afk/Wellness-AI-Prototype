// End-to-end test of the EHR-connected edition against the mock EHR server.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.ts";
import { runTool } from "../src/ai/tools.ts";
import { createMockEhr } from "../src/ehr-mock.ts";
import { zonedToUtc } from "../src/time.ts";
import { listen, nextWeekday, setup, testConfig } from "./helpers.ts";

const servers: { close: () => Promise<void> }[] = [];
after(() => Promise.all(servers.map((s) => s.close())));

async function ehrSetup() {
  const mock = createMockEhr({ apiKey: "ehr-key" });
  const ehrServer = await listen(mock.app);
  servers.push(ehrServer);
  const s = setup({
    config: testConfig((c) => {
      c.edition = "ehr";
      c.ehr = { baseUrl: ehrServer.url, apiKey: "ehr-key", webhookSecret: "ehr-hook", timeoutMs: 5000 };
    }),
  });
  return { s, mock };
}

test("the AI books into the EHR, which stays the source of truth", async () => {
  const { s, mock } = await ehrSetup();
  assert.equal(s.backends.forClinic(s.clinic()).kind, "ehr");
  const contact = s.db.createContact(s.clinicId, { name: "Jordan Lee", phone: "+14165550222" });
  const ctx = {
    db: s.db, events: s.events, backend: s.backends.forClinic(s.clinic()), clinic: s.clinic(), contact,
    conversation: s.db.conversationForContact(contact, "sms"), channel: "sms" as const, actor: "ai:sms",
  };
  const day = nextWeekday(4);
  const found = await runTool(ctx, "find_available_times", { service_id: "rmt-60", date_from: day, date_to: day });
  const slots = JSON.parse(found.result);
  assert.ok(slots.length > 0, "availability comes from the EHR");

  const booked = await runTool(ctx, "book_appointment", { service_id: "rmt-60", practitioner_id: slots[0].practitioner_id, start: slots[0].start });
  assert.ok(!booked.isError, booked.result);

  const local = s.db.contactAppointments(contact.id)[0];
  assert.match(local.external_ref ?? "", /^apt_/, "local row mirrors the EHR appointment");
  const linked = s.db.getContact(contact.id)!;
  assert.match(linked.external_id ?? "", /^pat_/, "contact linked to an EHR patient");
  const ehrAppts = mock.db.contactAppointments(mock.db.findContactByExternalId(1, linked.external_id!)!.id);
  assert.equal(ehrAppts.length, 1);
  assert.equal(ehrAppts[0].starts_at, slots[0].start);

  // The EHR rejects a double-booking; the AI is told to offer other times.
  const other = s.db.createContact(s.clinicId, { name: "Second Person", phone: "+14165550333" });
  const clash = await runTool({ ...ctx, contact: other, conversation: s.db.conversationForContact(other, "sms") }, "book_appointment", { service_id: "rmt-60", practitioner_id: slots[0].practitioner_id, start: slots[0].start });
  assert.equal(clash.isError, true);
  assert.match(clash.result, /no longer available/);

  // Reschedule and cancel go through the EHR too.
  const upcoming = JSON.parse((await runTool(ctx, "get_my_appointments", {})).result);
  const moved = await runTool(ctx, "reschedule_appointment", { appointment_id: upcoming[0].appointment_id, new_start: zonedToUtc(day, "16:00", "America/Toronto").toISOString() });
  assert.ok(!moved.isError, moved.result);
  const cancelled = await runTool(ctx, "cancel_appointment", { appointment_id: upcoming[0].appointment_id });
  assert.ok(!cancelled.isError, cancelled.result);
  assert.equal(mock.db.findAppointmentByExternalRef(1, local.external_ref!)!.status, "cancelled");
});

test("a new patient's messages are linked to an EHR patient and logged to the chart", async () => {
  const { s, mock } = await ehrSetup();
  await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+14165550444", body: "what are your hours?" });
  await s.inbox.idle();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(mock.communications.map((c) => c.direction), ["in", "out"], "the very first message is logged too");
  assert.match(s.db.findContactByIdentity(s.clinicId, "sms", "+14165550444")!.external_id ?? "", /^pat_/);
});

test("appointments made inside the EHR sync in by signed webhook", async () => {
  const { s } = await ehrSetup();
  const app = await listen(createApp(s));
  servers.push(app);
  const start = zonedToUtc(nextWeekday(1), "09:00", "America/Toronto").toISOString();
  const event = JSON.stringify({
    type: "appointment.created", locationId: "loc-harbourfront",
    appointment: { id: "apt_900", patientId: "pat_900", serviceId: "physio-initial", practitionerId: "pr-maya", start, end: new Date(Date.parse(start) + 3600_000).toISOString(), status: "booked" },
    patient: { id: "pat_900", firstName: "Ehr", lastName: "Booked", phone: "+14165550555" },
  });
  const post = (signature: string) => fetch(`${app.url}/webhooks/ehr`, { method: "POST", headers: { "content-type": "application/json", "x-ehr-signature": signature }, body: event });
  assert.equal((await post("sha256=00")).status, 403);
  assert.equal((await post(`sha256=${createHmac("sha256", "ehr-hook").update(event).digest("hex")}`)).status, 200);
  await new Promise((r) => setTimeout(r, 20));
  const contact = s.db.findContactByExternalId(s.clinicId, "pat_900")!;
  assert.equal(contact.name, "Ehr Booked");
  assert.equal(s.db.findAppointmentByExternalRef(s.clinicId, "apt_900")?.status, "booked");
  const conv = s.db.conversationForContact(contact, "sms");
  assert.match(s.db.listMessages(conv.id).at(-1)?.body ?? "", /you're booked/, "booking confirmation automation ran");
});
