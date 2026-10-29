import type { Db } from "../db.ts";
import type { Appointment, Clinic, Contact } from "../types.ts";
import { addDays, formatLocal, localDate, weekdayOf, zonedToUtc } from "../time.ts";
import { practitionerOf, serviceOf, type BookingRequest, type BookingResult, type PracticeBackend, type Slot, type SlotQuery } from "./backend.ts";

/** Minimum notice for online/AI bookings. */
const MIN_LEAD_MS = 2 * 60 * 60 * 1000;
const MAX_SLOTS_PER_DAY = 3;

/** Standalone edition: this app's own calendar is the source of truth. */
export class BuiltinBackend implements PracticeBackend {
  readonly kind = "builtin" as const;
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async findSlots(clinic: Clinic, query: SlotQuery): Promise<Slot[]> {
    const service = serviceOf(clinic, query.serviceId);
    if (!service) return [];
    const tz = clinic.profile.timezone;
    const limit = query.limit ?? 6;
    const dateTo = query.dateTo ?? addDays(query.dateFrom, 13);
    const practitioners = clinic.profile.practitioners.filter(
      (p) => p.services.includes(service.id) && (!query.practitionerId || p.id === query.practitionerId),
    );
    const earliest = Date.now() + MIN_LEAD_MS;
    const step = Math.min(30, service.durationMin) * 60_000;
    const slots: Slot[] = [];

    for (let date = query.dateFrom; date <= dateTo && slots.length < limit; date = addDays(date, 1)) {
      const dayStart = zonedToUtc(date, "00:00", tz).toISOString();
      const dayEnd = zonedToUtc(addDays(date, 1), "00:00", tz).toISOString();
      const daySlots: Slot[] = [];
      for (const practitioner of practitioners) {
        const busy = this.db.appointmentsBetween(clinic.id, dayStart, dayEnd, practitioner.id)
          .map((a) => [Date.parse(a.starts_at), Date.parse(a.ends_at)] as const);
        for (const [open, close] of practitioner.hours[weekdayOf(date)] ?? []) {
          const closeMs = zonedToUtc(date, close, tz).getTime();
          for (let start = zonedToUtc(date, open, tz).getTime(); start + service.durationMin * 60_000 <= closeMs; start += step) {
            const end = start + service.durationMin * 60_000;
            if (start < earliest) continue;
            if (busy.some(([b0, b1]) => start < b1 && end > b0)) continue;
            if (!matchesTimeOfDay(new Date(start), tz, query.timeOfDay)) continue;
            daySlots.push({
              practitionerId: practitioner.id,
              practitionerName: practitioner.name,
              serviceId: service.id,
              start: new Date(start).toISOString(),
              end: new Date(end).toISOString(),
              label: formatLocal(new Date(start), tz),
            });
          }
        }
      }
      // Spread suggestions across the day instead of offering three back-to-back slots.
      daySlots.sort((a, b) => a.start.localeCompare(b.start));
      slots.push(...spread(daySlots, MAX_SLOTS_PER_DAY));
    }
    return slots.slice(0, limit);
  }

  async book(clinic: Clinic, req: BookingRequest): Promise<BookingResult> {
    const service = serviceOf(clinic, req.serviceId);
    const practitioner = practitionerOf(clinic, req.practitionerId);
    if (!service) return { ok: false, reason: `Unknown service "${req.serviceId}".` };
    if (!practitioner || !practitioner.services.includes(service.id)) {
      return { ok: false, reason: `That practitioner does not offer ${service.name}.` };
    }
    const start = new Date(req.start);
    const end = new Date(start.getTime() + service.durationMin * 60_000);
    if (!(await this.isOpenSlot(clinic, practitioner.id, start, end))) {
      return { ok: false, reason: "That time is no longer available. Please offer the patient other times." };
    }
    return this.db.transaction(() => {
      // Re-check inside the transaction so two simultaneous bookings can't take the same slot.
      if (this.db.appointmentsBetween(clinic.id, start.toISOString(), end.toISOString(), practitioner.id).length) {
        return { ok: false, reason: "That time was just taken. Please offer the patient other times." } as const;
      }
      const appointment = this.db.createAppointment({
        clinic_id: clinic.id, contact_id: req.contact.id, service_id: service.id, practitioner_id: practitioner.id,
        starts_at: start.toISOString(), ends_at: end.toISOString(), notes: req.notes ?? null, created_via: req.createdVia,
      });
      return { ok: true, appointment } as const;
    });
  }

  async cancel(_clinic: Clinic, appointment: Appointment, reason?: string): Promise<BookingResult> {
    const notes = reason ? [appointment.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n") : appointment.notes;
    return { ok: true, appointment: this.db.updateAppointment(appointment.id, { status: "cancelled", notes }) };
  }

  async reschedule(clinic: Clinic, appointment: Appointment, newStart: string, practitionerId?: string): Promise<BookingResult> {
    const service = serviceOf(clinic, appointment.service_id);
    if (!service) return { ok: false, reason: "The original service no longer exists." };
    const pid = practitionerId ?? appointment.practitioner_id;
    const start = new Date(newStart);
    const end = new Date(start.getTime() + service.durationMin * 60_000);
    // Ignore the appointment being moved when checking for conflicts.
    const conflicts = this.db.appointmentsBetween(clinic.id, start.toISOString(), end.toISOString(), pid)
      .filter((a) => a.id !== appointment.id);
    if (conflicts.length || !(await this.isWithinHours(clinic, pid, start, end))) {
      return { ok: false, reason: "That new time is not available. Please offer the patient other times." };
    }
    return {
      ok: true,
      appointment: this.db.updateAppointment(appointment.id, {
        starts_at: start.toISOString(), ends_at: end.toISOString(), practitioner_id: pid, reminder_sent_at: null,
      }),
    };
  }

  async upcoming(_clinic: Clinic, contact: Contact): Promise<Appointment[]> {
    return this.db.contactAppointments(contact.id, true).reverse();
  }

  private async isOpenSlot(clinic: Clinic, practitionerId: string, start: Date, end: Date): Promise<boolean> {
    if (start.getTime() < Date.now()) return false;
    if (!(await this.isWithinHours(clinic, practitionerId, start, end))) return false;
    return this.db.appointmentsBetween(clinic.id, start.toISOString(), end.toISOString(), practitionerId).length === 0;
  }

  private async isWithinHours(clinic: Clinic, practitionerId: string, start: Date, end: Date): Promise<boolean> {
    const practitioner = practitionerOf(clinic, practitionerId);
    if (!practitioner) return false;
    const tz = clinic.profile.timezone;
    const date = localDate(start, tz);
    return (practitioner.hours[weekdayOf(date)] ?? []).some(([open, close]) =>
      start >= zonedToUtc(date, open, tz) && end <= zonedToUtc(date, close, tz));
  }
}

function matchesTimeOfDay(date: Date, timeZone: string, timeOfDay: SlotQuery["timeOfDay"]): boolean {
  if (!timeOfDay || timeOfDay === "any") return true;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(date));
  if (timeOfDay === "morning") return hour < 12;
  if (timeOfDay === "afternoon") return hour >= 12 && hour < 17;
  return hour >= 17;
}

function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))]);
}
