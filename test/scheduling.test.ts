import assert from "node:assert/strict";
import { test } from "node:test";
import { BuiltinBackend } from "../src/booking/builtin.ts";
import { formatLocal, localDateTime, parseLocalDateTime, zonedToUtc } from "../src/time.ts";
import { nextWeekday, setup } from "./helpers.ts";

test("zonedToUtc handles both sides of a DST change", () => {
  // Toronto: EDT (UTC-4) before Nov 1 2026, EST (UTC-5) after.
  assert.equal(zonedToUtc("2026-10-30", "09:00", "America/Toronto").toISOString(), "2026-10-30T13:00:00.000Z");
  assert.equal(zonedToUtc("2026-11-02", "09:00", "America/Toronto").toISOString(), "2026-11-02T14:00:00.000Z");
  assert.equal(zonedToUtc("2026-07-01", "09:00", "America/Vancouver").toISOString(), "2026-07-01T16:00:00.000Z");
  assert.equal(localDateTime(new Date("2026-11-02T14:00:00Z"), "America/Toronto"), "2026-11-02T09:00");
});

test("parseLocalDateTime accepts clinic-local and absolute times", () => {
  assert.equal(parseLocalDateTime("2026-11-02T09:00", "America/Toronto")?.toISOString(), "2026-11-02T14:00:00.000Z");
  assert.equal(parseLocalDateTime("2026-11-02T14:00:00.000Z", "America/Toronto")?.toISOString(), "2026-11-02T14:00:00.000Z");
  assert.equal(parseLocalDateTime("next tuesday", "America/Toronto"), undefined);
  assert.match(formatLocal("2026-11-02T14:00:00.000Z", "America/Toronto"), /Mon, Nov 2 at 9:00\sAM/);
});

test("slots respect practitioner hours, services and existing bookings", async () => {
  const s = setup();
  const backend = new BuiltinBackend(s.db);
  const monday = nextWeekday(1);
  const slots = await backend.findSlots(s.clinic(), { serviceId: "physio-initial", dateFrom: monday, dateTo: monday, limit: 50 });
  assert.ok(slots.length > 0);
  for (const slot of slots) {
    assert.equal(slot.practitionerId, "pr-maya"); // only Maya offers physio
    const local = localDateTime(new Date(slot.start), "America/Toronto").slice(11);
    assert.ok(local >= "08:00" && local <= "15:00", `slot ${local} inside hours`);
  }
  // Sofia (massage) doesn't work Mondays.
  assert.equal((await backend.findSlots(s.clinic(), { serviceId: "rmt-60", dateFrom: monday, dateTo: monday })).length, 0);
});

test("booking prevents double-booking the same practitioner", async () => {
  const s = setup();
  const backend = new BuiltinBackend(s.db);
  const contact = s.db.createContact(s.clinicId, { name: "A Patient", phone: "+14165550001" });
  const other = s.db.createContact(s.clinicId, { name: "B Patient", phone: "+14165550002" });
  const start = zonedToUtc(nextWeekday(1), "09:00", "America/Toronto").toISOString();
  const first = await backend.book(s.clinic(), { contact, serviceId: "physio-initial", practitionerId: "pr-maya", start, createdVia: "test" });
  assert.ok(first.ok);
  const clash = await backend.book(s.clinic(), { contact: other, serviceId: "physio-followup", practitionerId: "pr-maya", start, createdVia: "test" });
  assert.equal(clash.ok, false);
  const outsideHours = await backend.book(s.clinic(), {
    contact: other, serviceId: "physio-followup", practitionerId: "pr-maya",
    start: zonedToUtc(nextWeekday(1), "12:15", "America/Toronto").toISOString(), createdVia: "test",
  });
  assert.equal(outsideHours.ok, false, "lunch break is not bookable");
  const wrongService = await backend.book(s.clinic(), { contact: other, serviceId: "rmt-60", practitionerId: "pr-maya", start, createdVia: "test" });
  assert.equal(wrongService.ok, false);
});

test("rescheduling ignores the appointment's own slot", async () => {
  const s = setup();
  const backend = new BuiltinBackend(s.db);
  const contact = s.db.createContact(s.clinicId, { name: "A Patient", phone: "+14165550001" });
  const day = nextWeekday(1);
  const booked = await backend.book(s.clinic(), { contact, serviceId: "physio-initial", practitionerId: "pr-maya", start: zonedToUtc(day, "09:00", "America/Toronto").toISOString(), createdVia: "test" });
  assert.ok(booked.ok);
  const moved = await backend.reschedule(s.clinic(), booked.appointment, zonedToUtc(day, "09:30", "America/Toronto").toISOString());
  assert.ok(moved.ok, "overlapping its own old slot is fine");
});

test("rescheduling refuses the past, last-minute times, closed hours and the wrong practitioner", async () => {
  const s = setup();
  const backend = new BuiltinBackend(s.db);
  const contact = s.db.createContact(s.clinicId, { name: "A Patient", phone: "+14165550001" });
  const day = nextWeekday(1);
  const booked = await backend.book(s.clinic(), { contact, serviceId: "physio-initial", practitionerId: "pr-maya", start: zonedToUtc(day, "09:00", "America/Toronto").toISOString(), createdVia: "test" });
  assert.ok(booked.ok);
  assert.equal((await backend.reschedule(s.clinic(), booked.appointment, new Date(Date.now() - 3600_000).toISOString())).ok, false, "past");
  assert.equal((await backend.reschedule(s.clinic(), booked.appointment, new Date(Date.now() + 5 * 60_000).toISOString())).ok, false, "too soon");
  assert.equal((await backend.reschedule(s.clinic(), booked.appointment, zonedToUtc(day, "23:00", "America/Toronto").toISOString())).ok, false, "closed");
  assert.equal((await backend.reschedule(s.clinic(), booked.appointment, zonedToUtc(day, "10:00", "America/Toronto").toISOString(), "pr-sofia")).ok, false, "Sofia doesn't offer physio");
});
