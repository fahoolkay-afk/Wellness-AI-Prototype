// The PracticeBackend is the seam between the two editions:
//
//   - Standalone edition: BuiltinBackend - this app's own calendar and patient records.
//   - EHR-connected edition: EhrBackend - the clinic's EHRM is the source of truth for
//     patients, availability and appointments; see docs/EHR_CONNECTOR_SPEC.md.
//
// The AI receptionist, voice agent tools and staff UI only ever talk to this interface.

import type { Appointment, Clinic, Contact } from "../types.ts";

export interface Slot {
  practitionerId: string;
  practitionerName: string;
  serviceId: string;
  /** UTC ISO start/end. */
  start: string;
  end: string;
  /** Clinic-local display string, e.g. "Tue, Nov 4 at 2:30 PM". */
  label: string;
}

export interface SlotQuery {
  serviceId: string;
  /** Clinic-local "YYYY-MM-DD". */
  dateFrom: string;
  dateTo?: string;
  practitionerId?: string;
  timeOfDay?: "morning" | "afternoon" | "evening" | "any";
  limit?: number;
}

export interface BookingRequest {
  contact: Contact;
  serviceId: string;
  practitionerId: string;
  /** UTC ISO start. */
  start: string;
  notes?: string;
  createdVia: string;
}

export type BookingResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; reason: string; bookingUrl?: string };

export interface PracticeBackend {
  readonly kind: "builtin" | "ehr" | "jane";
  findSlots(clinic: Clinic, query: SlotQuery): Promise<Slot[]>;
  book(clinic: Clinic, request: BookingRequest): Promise<BookingResult>;
  cancel(clinic: Clinic, appointment: Appointment, reason?: string): Promise<BookingResult>;
  reschedule(clinic: Clinic, appointment: Appointment, newStart: string, practitionerId?: string): Promise<BookingResult>;
  /** Upcoming appointments for a patient. */
  upcoming(clinic: Clinic, contact: Contact): Promise<Appointment[]>;
  /** Called when a contact is created or updated so the EHR can link or create the patient record. */
  syncContact?(clinic: Clinic, contact: Contact): Promise<void>;
}

export function serviceOf(clinic: Clinic, serviceId: string) {
  return clinic.profile.services.find((s) => s.id === serviceId);
}

export function practitionerOf(clinic: Clinic, practitionerId: string) {
  return clinic.profile.practitioners.find((p) => p.id === practitionerId);
}
