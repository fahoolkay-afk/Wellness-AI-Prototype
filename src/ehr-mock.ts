// A stand-in EHRM implementing docs/EHR_CONNECTOR_SPEC.md, for developing and
// testing the EHR-connected edition before the real EHRM exists.
//
//   npm run ehr:mock                     -> http://localhost:4000
//   EDITION=ehr EHR_BASE_URL=http://localhost:4000 EHR_API_KEY=dev-ehr-key npm start
//
// It keeps its own in-memory data and reuses the built-in scheduler for availability.

import express, { type NextFunction, type Request, type Response } from "express";
import { createHmac } from "node:crypto";
import { BuiltinBackend } from "./booking/builtin.ts";
import { Db } from "./db.ts";
import { DEMO_CLINIC } from "./seed.ts";
import type { Appointment, ClinicProfile, Contact } from "./types.ts";
import { parseLocalDateTime } from "./time.ts";

const toPatient = (c: Contact) => {
  const [firstName, ...rest] = (c.name ?? "").split(" ");
  return { id: c.external_id!, firstName: firstName || null, lastName: rest.join(" ") || null, phone: c.phone, email: c.email };
};

export function createMockEhr(opts: { apiKey: string; locations?: Record<string, ClinicProfile>; webhookUrl?: string; webhookSecret?: string }) {
  const db = new Db(":memory:");
  const backend = new BuiltinBackend(db);
  const locations = new Map<string, number>();
  for (const [locationId, profile] of Object.entries(opts.locations ?? { "loc-harbourfront": DEMO_CLINIC })) {
    locations.set(locationId, db.createClinic(profile));
  }
  const communications: { patientId: string; channel: string; direction: string; body: string; occurredAt: string }[] = [];
  const idempotency = new Map<string, Appointment>();

  const app = express();
  app.use(express.json());

  const toAppt = (a: Appointment) => {
    const contact = db.getContact(a.contact_id)!;
    return {
      id: a.external_ref!, patientId: contact.external_id!, serviceId: a.service_id, practitionerId: a.practitioner_id,
      start: a.starts_at, end: a.ends_at, status: a.status, notes: a.notes,
    };
  };

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/admin")) return next();
    if (req.get("authorization") !== `Bearer ${opts.apiKey}`) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }
    const clinicId = locations.get(req.get("x-location-id") ?? "");
    if (!clinicId) {
      res.status(404).json({ error: "Unknown location" });
      return;
    }
    res.locals.clinic = db.getClinic(clinicId);
    next();
  });

  const patient = (res: Response, id: string) => {
    const contact = db.findContactByExternalId(res.locals.clinic.id, id);
    if (!contact) throw Object.assign(new Error("Patient not found"), { status: 404 });
    return contact;
  };
  const appointment = (res: Response, id: string) => {
    const appt = db.findAppointmentByExternalRef(res.locals.clinic.id, id);
    if (!appt) throw Object.assign(new Error("Appointment not found"), { status: 404 });
    return appt;
  };

  app.get("/patients/lookup", (req, res) => {
    const clinicId = res.locals.clinic.id;
    const byPhone = req.query.phone ? db.findContactByIdentity(clinicId, "sms", String(req.query.phone)) : undefined;
    const byEmail = req.query.email ? db.findContactByIdentity(clinicId, "email", String(req.query.email)) : undefined;
    const found = byPhone ?? byEmail;
    res.json({ patient: found ? toPatient(found) : null });
  });

  app.post("/patients", (req, res) => {
    const b = req.body ?? {};
    const contact = db.createContact(res.locals.clinic.id, {
      name: [b.firstName, b.lastName].filter(Boolean).join(" ") || null, phone: b.phone ?? null, email: b.email ?? null,
    });
    const updated = db.updateContact(contact.id, { external_id: `pat_${contact.id}` });
    res.status(201).json({ patient: toPatient(updated) });
  });

  app.get("/availability", async (req, res) => {
    const slots = await backend.findSlots(res.locals.clinic, {
      serviceId: String(req.query.serviceId ?? ""), dateFrom: String(req.query.from ?? ""),
      dateTo: req.query.to ? String(req.query.to) : undefined,
      practitionerId: req.query.practitionerId ? String(req.query.practitionerId) : undefined,
      timeOfDay: req.query.timeOfDay as "morning" | "afternoon" | "evening" | "any" | undefined,
      limit: Number(req.query.limit ?? 6),
    });
    res.json({ slots: slots.map(({ practitionerId, serviceId, start, end }) => ({ practitionerId, serviceId, start, end })) });
  });

  app.post("/appointments", async (req, res) => {
    const b = req.body ?? {};
    if (b.idempotencyKey && idempotency.has(b.idempotencyKey)) {
      res.status(200).json({ appointment: toAppt(db.getAppointment(idempotency.get(b.idempotencyKey)!.id)!) });
      return;
    }
    const contact = patient(res, String(b.patientId));
    const start = parseLocalDateTime(String(b.start ?? ""), res.locals.clinic.profile.timezone);
    if (!start) {
      res.status(400).json({ error: "Invalid start" });
      return;
    }
    const result = await backend.book(res.locals.clinic, {
      contact, serviceId: b.serviceId, practitionerId: b.practitionerId, start: start.toISOString(), notes: b.notes, createdVia: b.source ?? "api",
    });
    if (!result.ok) {
      res.status(409).json({ error: result.reason });
      return;
    }
    db.sql.prepare("UPDATE appointments SET external_ref = ? WHERE id = ?").run(`apt_${result.appointment.id}`, result.appointment.id);
    const saved = db.getAppointment(result.appointment.id)!;
    if (b.idempotencyKey) idempotency.set(b.idempotencyKey, saved);
    res.status(201).json({ appointment: toAppt(saved) });
  });

  app.patch("/appointments/:id", async (req, res) => {
    const appt = appointment(res, req.params.id);
    const start = parseLocalDateTime(String(req.body?.start ?? ""), res.locals.clinic.profile.timezone);
    if (!start) {
      res.status(400).json({ error: "Invalid start" });
      return;
    }
    const result = await backend.reschedule(res.locals.clinic, appt, start.toISOString(), req.body?.practitionerId);
    if (!result.ok) {
      res.status(409).json({ error: result.reason });
      return;
    }
    res.json({ appointment: toAppt(result.appointment) });
  });

  app.post("/appointments/:id/cancel", async (req, res) => {
    const appt = appointment(res, req.params.id);
    const result = await backend.cancel(res.locals.clinic, appt, req.body?.reason ?? undefined);
    res.json({ appointment: toAppt(result.ok ? result.appointment : appt) });
  });

  app.get("/patients/:id/appointments", (req, res) => {
    const contact = patient(res, req.params.id);
    const appts = db.contactAppointments(contact.id, req.query.upcoming === "true").reverse();
    res.json({ appointments: appts.map(toAppt) });
  });

  app.post("/patients/:id/communications", (req, res) => {
    patient(res, req.params.id);
    communications.push({ patientId: req.params.id, ...req.body });
    res.status(201).json({ ok: true });
  });

  // Mock-only: simulate staff booking inside the EHR, which notifies the front desk by webhook.
  app.post("/admin/appointments", async (req, res) => {
    const clinicId = locations.get(String(req.body?.locationId ?? "loc-harbourfront"))!;
    const clinic = db.getClinic(clinicId)!;
    const b = req.body ?? {};
    const contact = db.createContact(clinic.id, { name: b.patientName ?? "EHR Patient", phone: b.phone ?? null, email: b.email ?? null });
    const withId = db.updateContact(contact.id, { external_id: `pat_${contact.id}` });
    const result = await backend.book(clinic, { contact: withId, serviceId: b.serviceId, practitionerId: b.practitionerId, start: b.start, createdVia: "ehr-staff" });
    if (!result.ok) {
      res.status(409).json({ error: result.reason });
      return;
    }
    db.sql.prepare("UPDATE appointments SET external_ref = ? WHERE id = ?").run(`apt_${result.appointment.id}`, result.appointment.id);
    const event = { type: "appointment.created", locationId: req.body?.locationId ?? "loc-harbourfront", appointment: toAppt(db.getAppointment(result.appointment.id)!), patient: toPatient(withId) };
    if (opts.webhookUrl) {
      const body = JSON.stringify(event);
      const signature = `sha256=${createHmac("sha256", opts.webhookSecret ?? "").update(body).digest("hex")}`;
      await fetch(opts.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-ehr-signature": signature }, body })
        .catch((err) => console.error("[ehr-mock] webhook failed", err));
    }
    res.status(201).json(event);
  });

  app.get("/admin/communications", (_req, res) => {
    res.json(communications);
  });

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return { app, db, communications };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.EHR_MOCK_PORT ?? 4000);
  const { app } = createMockEhr({
    apiKey: process.env.EHR_API_KEY ?? "dev-ehr-key",
    webhookUrl: process.env.FRONT_DESK_WEBHOOK_URL ?? "http://localhost:3000/webhooks/ehr",
    webhookSecret: process.env.EHR_WEBHOOK_SECRET ?? "",
  });
  app.listen(port, () => console.log(`Mock EHR listening on http://localhost:${port} (API key: ${process.env.EHR_API_KEY ?? "dev-ehr-key"})`));
}
