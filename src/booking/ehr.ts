// EHR-connected edition. The clinic's EHRM owns patients, availability and
// appointments; this backend calls the REST contract in docs/EHR_CONNECTOR_SPEC.md
// and mirrors appointments locally (by external_ref) so reminders, follow-ups
// and the staff calendar keep working without extra round-trips.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "../db.ts";
import type { Appointment, Channel, Clinic, Contact } from "../types.ts";
import { formatLocal } from "../time.ts";
import { practitionerOf, type BookingRequest, type BookingResult, type PracticeBackend, type Slot, type SlotQuery } from "./backend.ts";

export interface EhrPatient {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
}

export interface EhrAppointment {
  id: string;
  patientId: string;
  serviceId: string;
  practitionerId: string;
  start: string;
  end: string;
  status: "booked" | "cancelled" | "completed" | "no_show";
  notes?: string | null;
}

export class EhrError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface EhrClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Thin typed client for the EHR connector contract. */
export class EhrClient {
  private readonly opts: EhrClientOptions;

  constructor(opts: EhrClientOptions) {
    this.opts = opts;
  }

  async request<T>(locationId: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await (this.opts.fetchImpl ?? fetch)(new URL(path.replace(/^\//, ""), this.opts.baseUrl.replace(/\/?$/, "/")), {
      method,
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        "x-location-id": locationId,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new EhrError(res.status, data?.error ?? `EHR ${method} ${path} failed with ${res.status}`);
    return data as T;
  }
}

export class EhrBackend implements PracticeBackend {
  readonly kind = "ehr" as const;
  private readonly db: Db;
  private readonly client: EhrClient;

  constructor(db: Db, client: EhrClient) {
    this.db = db;
    this.client = client;
  }

  private location(clinic: Clinic): string {
    return clinic.profile.ehrLocationId ?? String(clinic.id);
  }

  /** Finds or creates the EHR patient for a contact and stores the link. */
  async ensurePatient(clinic: Clinic, contact: Contact): Promise<string> {
    if (contact.external_id) return contact.external_id;
    const loc = this.location(clinic);
    const params = new URLSearchParams();
    if (contact.phone) params.set("phone", contact.phone);
    if (contact.email) params.set("email", contact.email);
    let patient: EhrPatient | null = null;
    if ([...params.keys()].length) {
      patient = (await this.client.request<{ patient: EhrPatient | null }>(loc, "GET", `/patients/lookup?${params}`)).patient;
    }
    if (!patient) {
      const [firstName, ...rest] = (contact.name ?? "").trim().split(/\s+/);
      patient = (await this.client.request<{ patient: EhrPatient }>(loc, "POST", "/patients", {
        firstName: firstName || null, lastName: rest.join(" ") || null, phone: contact.phone, email: contact.email,
        source: "front-desk-ai",
      })).patient;
    }
    this.db.updateContact(contact.id, { external_id: patient.id });
    return patient.id;
  }

  async syncContact(clinic: Clinic, contact: Contact): Promise<void> {
    await this.ensurePatient(clinic, contact);
  }

  async findSlots(clinic: Clinic, query: SlotQuery): Promise<Slot[]> {
    const params = new URLSearchParams({ serviceId: query.serviceId, from: query.dateFrom });
    if (query.dateTo) params.set("to", query.dateTo);
    if (query.practitionerId) params.set("practitionerId", query.practitionerId);
    if (query.timeOfDay) params.set("timeOfDay", query.timeOfDay);
    params.set("limit", String(query.limit ?? 6));
    const { slots } = await this.client.request<{ slots: Omit<Slot, "label" | "practitionerName">[] }>(
      this.location(clinic), "GET", `/availability?${params}`,
    );
    return slots.map((s) => ({
      ...s,
      practitionerName: practitionerOf(clinic, s.practitionerId)?.name ?? s.practitionerId,
      label: formatLocal(s.start, clinic.profile.timezone),
    }));
  }

  async book(clinic: Clinic, req: BookingRequest): Promise<BookingResult> {
    try {
      const patientId = await this.ensurePatient(clinic, req.contact);
      const { appointment } = await this.client.request<{ appointment: EhrAppointment }>(this.location(clinic), "POST", "/appointments", {
        patientId, serviceId: req.serviceId, practitionerId: req.practitionerId, start: req.start, notes: req.notes ?? null,
        source: req.createdVia,
        // Lets the EHR deduplicate retries of the same booking.
        idempotencyKey: `${clinic.id}:${req.contact.id}:${req.practitionerId}:${req.start}`,
      });
      return { ok: true, appointment: this.mirror(clinic, appointment, req.contact.id, req.createdVia) };
    } catch (err) {
      return ehrFailure(err);
    }
  }

  async cancel(clinic: Clinic, appointment: Appointment, reason?: string): Promise<BookingResult> {
    if (!appointment.external_ref) return { ok: false, reason: "This appointment is not linked to the EHR." };
    try {
      const { appointment: updated } = await this.client.request<{ appointment: EhrAppointment }>(
        this.location(clinic), "POST", `/appointments/${encodeURIComponent(appointment.external_ref)}/cancel`, { reason: reason ?? null },
      );
      return { ok: true, appointment: this.mirror(clinic, updated, appointment.contact_id, appointment.created_via) };
    } catch (err) {
      return ehrFailure(err);
    }
  }

  async reschedule(clinic: Clinic, appointment: Appointment, newStart: string, practitionerId?: string): Promise<BookingResult> {
    if (!appointment.external_ref) return { ok: false, reason: "This appointment is not linked to the EHR." };
    try {
      const { appointment: updated } = await this.client.request<{ appointment: EhrAppointment }>(
        this.location(clinic), "PATCH", `/appointments/${encodeURIComponent(appointment.external_ref)}`,
        { start: newStart, practitionerId: practitionerId ?? appointment.practitioner_id },
      );
      const mirrored = this.mirror(clinic, updated, appointment.contact_id, appointment.created_via);
      return { ok: true, appointment: this.db.updateAppointment(mirrored.id, { reminder_sent_at: null }) };
    } catch (err) {
      return ehrFailure(err);
    }
  }

  async upcoming(clinic: Clinic, contact: Contact): Promise<Appointment[]> {
    const patientId = await this.ensurePatient(clinic, contact);
    const { appointments } = await this.client.request<{ appointments: EhrAppointment[] }>(
      this.location(clinic), "GET", `/patients/${encodeURIComponent(patientId)}/appointments?upcoming=true`,
    );
    return appointments.map((a) => this.mirror(clinic, a, contact.id, "ehr"));
  }

  /** Logs a conversation or call summary to the patient's chart (best effort). */
  async logCommunication(clinic: Clinic, contact: Contact, entry: { channel: Channel; direction: "in" | "out"; body: string; occurredAt: string }): Promise<void> {
    if (!contact.external_id) return;
    await this.client.request(this.location(clinic), "POST", `/patients/${encodeURIComponent(contact.external_id)}/communications`, entry);
  }

  /** Upserts the local mirror of an EHR appointment. */
  mirror(clinic: Clinic, a: EhrAppointment, contactId: number, createdVia: string): Appointment {
    const existing = this.db.findAppointmentByExternalRef(clinic.id, a.id);
    if (existing) {
      return this.db.updateAppointment(existing.id, {
        starts_at: new Date(a.start).toISOString(), ends_at: new Date(a.end).toISOString(), status: a.status,
        practitioner_id: a.practitionerId, service_id: a.serviceId, notes: a.notes ?? existing.notes,
      });
    }
    const created = this.db.createAppointment({
      clinic_id: clinic.id, contact_id: contactId, service_id: a.serviceId, practitioner_id: a.practitionerId,
      starts_at: new Date(a.start).toISOString(), ends_at: new Date(a.end).toISOString(), notes: a.notes ?? null,
      created_via: createdVia, external_ref: a.id,
    });
    return a.status === "booked" ? created : this.db.updateAppointment(created.id, { status: a.status });
  }
}

function ehrFailure(err: unknown): BookingResult {
  if (err instanceof EhrError && err.status === 409) {
    return { ok: false, reason: "That time is no longer available. Please offer the patient other times." };
  }
  if (err instanceof EhrError && err.status < 500) return { ok: false, reason: err.message };
  console.error("[ehr]", err);
  return { ok: false, reason: "The clinic's scheduling system is unavailable right now. Take the patient's details and create a staff task to book them." };
}

/** Verifies `X-EHR-Signature: sha256=<hex HMAC of raw body>` on EHR webhooks. */
export function verifyEhrSignature(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
