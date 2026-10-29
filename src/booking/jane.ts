// Jane App does not expose an open booking API to third parties, so for Jane
// clinics the receptionist answers questions and sends the clinic's Jane online
// booking link instead of booking directly. If Jane grants partner API access,
// implement it here behind the same PracticeBackend interface.

import type { Db } from "../db.ts";
import type { Appointment, Clinic, Contact } from "../types.ts";
import type { BookingResult, PracticeBackend, Slot } from "./backend.ts";

export class JaneLinkBackend implements PracticeBackend {
  readonly kind = "jane" as const;
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  private handoff(clinic: Clinic): BookingResult {
    return {
      ok: false,
      reason: "This clinic books through Jane App. Send the patient the online booking link; staff can also book for them.",
      bookingUrl: clinic.profile.janeBookingUrl,
    };
  }

  async findSlots(): Promise<Slot[]> {
    return [];
  }

  async book(clinic: Clinic): Promise<BookingResult> {
    return this.handoff(clinic);
  }

  async cancel(clinic: Clinic): Promise<BookingResult> {
    return this.handoff(clinic);
  }

  async reschedule(clinic: Clinic): Promise<BookingResult> {
    return this.handoff(clinic);
  }

  async upcoming(_clinic: Clinic, contact: Contact): Promise<Appointment[]> {
    // Appointments staff entered here manually (or imported) are still visible.
    return this.db.contactAppointments(contact.id, true).reverse();
  }
}
