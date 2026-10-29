// GoHighLevel-style workflows: a trigger (event or timer) followed by actions.
// Each automation runs at most once per subject (appointment, contact...),
// enforced by the automation_runs table, so restarts and overlapping ticks are safe.

import { practitionerOf, serviceOf } from "./booking/backend.ts";
import { parseTags, type Db } from "./db.ts";
import type { Events } from "./events.ts";
import type { Inbox } from "./inbox.ts";
import type { Appointment, Automation, AutomationAction, Channel, Clinic, Contact, Stage } from "./types.ts";
import { formatLocal } from "./time.ts";

const HOUR = 3600_000;
/** Timer triggers only look this far back, so enabling an automation doesn't message old patients. */
const LOOKBACK = 7 * 24 * HOUR;

export class Automations {
  private readonly db: Db;
  private readonly events: Events;
  private readonly inbox: Inbox;
  private timer?: NodeJS.Timeout;

  constructor(db: Db, events: Events, inbox: Inbox) {
    this.db = db;
    this.events = events;
    this.inbox = inbox;
    events.on("contact.created", (c) => this.fireEvent(c.clinic_id, "contact_created", `contact:${c.id}`, c));
    events.on("contact.tagged", (c, tag) => this.fireEvent(c.clinic_id, "tag_added", `contact:${c.id}:${tag}`, c, undefined, tag));
    events.on("appointment.booked", (a) => this.fireForAppointment("appointment_booked", a));
    events.on("appointment.cancelled", (a) => this.fireForAppointment("appointment_cancelled", a));
  }

  start(intervalMs: number): void {
    this.timer = setInterval(() => this.tick().catch((err) => console.error("[automations] tick", err)), intervalMs);
    this.timer.unref();
    void this.tick().catch((err) => console.error("[automations] tick", err));
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private async fireForAppointment(type: "appointment_booked" | "appointment_cancelled", appt: Appointment): Promise<void> {
    const contact = this.db.getContact(appt.contact_id);
    if (contact) await this.fireEvent(appt.clinic_id, type, `appt:${appt.id}`, contact, appt);
  }

  private async fireEvent(clinicId: number, type: Automation["trigger"]["type"], subject: string, contact: Contact, appt?: Appointment, tag?: string): Promise<void> {
    const clinic = this.db.getClinic(clinicId);
    if (!clinic) return;
    for (const automation of clinic.profile.automations) {
      if (!automation.enabled || automation.trigger.type !== type) continue;
      if (automation.trigger.type === "tag_added" && automation.trigger.tag !== tag) continue;
      await this.run(clinic, automation, subject, contact, appt);
    }
  }

  /** Evaluates timer-based triggers for every clinic. */
  async tick(now = new Date()): Promise<void> {
    const t = now.getTime();
    const iso = (ms: number) => new Date(ms).toISOString();
    for (const clinic of this.db.listClinics()) {
      for (const automation of clinic.profile.automations) {
        if (!automation.enabled) continue;
        const trigger = automation.trigger;
        switch (trigger.type) {
          case "appointment_upcoming": {
            for (const appt of this.db.appointmentsStartingBetween(clinic.id, iso(t), iso(t + trigger.hours * HOUR))) {
              // Booked inside the reminder window: the booking confirmation already covered it.
              if (Date.parse(appt.created_at) > Date.parse(appt.starts_at) - trigger.hours * HOUR) continue;
              const contact = this.db.getContact(appt.contact_id);
              if (contact) await this.run(clinic, automation, `appt:${appt.id}:${appt.starts_at}`, contact, appt);
            }
            break;
          }
          case "appointment_completed": {
            const until = t - trigger.hours * HOUR;
            // Post-visit messages say "today", so only visits from the last day qualify.
            for (const appt of this.db.appointmentsEndedBetween(clinic.id, iso(until - 24 * HOUR), iso(until))) {
              const contact = this.db.getContact(appt.contact_id);
              if (contact) await this.run(clinic, automation, `appt:${appt.id}`, contact, appt);
            }
            break;
          }
          case "lead_not_booked": {
            const until = t - trigger.hours * HOUR;
            for (const contact of this.db.unbookedLeads(clinic.id, iso(until - LOOKBACK), iso(until))) {
              await this.run(clinic, automation, `contact:${contact.id}`, contact);
            }
            break;
          }
          case "patient_lapsed": {
            for (const contact of this.db.lapsedPatients(clinic.id, iso(t - trigger.days * 24 * HOUR))) {
              await this.run(clinic, automation, `contact:${contact.id}:${contact.last_visit}`, contact);
            }
            break;
          }
        }
      }
    }
  }

  private async run(clinic: Clinic, automation: Automation, subject: string, contact: Contact, appt?: Appointment): Promise<void> {
    if (!this.db.claimAutomationRun(clinic.id, automation.id, subject)) return;
    for (const action of automation.actions) {
      try {
        contact = await this.act(clinic, automation, action, contact, appt);
      } catch (err) {
        console.error(`[automations] ${automation.id} ${action.type}`, err);
      }
    }
    this.events.emit("changed", { clinicId: clinic.id, kind: "automation" });
  }

  private async act(clinic: Clinic, automation: Automation, action: AutomationAction, contact: Contact, appt?: Appointment): Promise<Contact> {
    switch (action.type) {
      case "send_message":
        // The AI already confirmed in the chat it booked from; a second confirmation there is noise.
        // Phone and staff bookings still get the written confirmation.
        if (automation.trigger.type === "appointment_booked" && appt && /^ai:(?!voice)/.test(appt.created_via)) return contact;
        await this.inbox.sendToContact(clinic, contact, action.channel, renderTemplate(action.template, clinic, contact, appt), {
          authorName: `Automation: ${automation.name}`, subject: action.subject ?? automation.name,
        });
        return this.db.getContact(contact.id)!;
      case "add_tag":
        return addTag(this.db, this.events, contact, action.tag);
      case "set_stage":
        return this.db.updateContact(contact.id, { stage: action.stage });
      case "create_task":
        this.db.createTask({
          clinicId: clinic.id, contactId: contact.id, type: action.taskType ?? "other",
          title: `${action.title}${contact.name ? ` (${contact.name})` : ""}`,
          details: appt ? `Appointment #${appt.id} on ${formatLocal(appt.starts_at, clinic.profile.timezone)}` : null,
          createdBy: `automation:${automation.id}`,
        });
        return contact;
    }
  }

  /** One-off message to every contact matching a tag and/or stage. Skips SMS opt-outs. */
  async broadcast(clinic: Clinic, opts: { tag?: string; stage?: Stage; channel: Channel | "preferred"; template: string; subject?: string; name: string }): Promise<{ sent: number; skipped: number }> {
    const contacts = this.db.listContacts(clinic.id, { tag: opts.tag, stage: opts.stage });
    let sent = 0;
    let skipped = 0;
    for (const contact of contacts) {
      const message = await this.inbox.sendToContact(clinic, contact, opts.channel, renderTemplate(opts.template, clinic, contact), {
        authorName: `Broadcast: ${opts.name}`, subject: opts.subject,
      });
      if (message && message.status !== "failed") sent++;
      else skipped++;
    }
    return { sent, skipped };
  }
}

export function addTag(db: Db, events: Events, contact: Contact, tag: string): Contact {
  const tags = parseTags(contact);
  if (tags.includes(tag)) return contact;
  const updated = db.updateContact(contact.id, { tags: JSON.stringify([...tags, tag]) });
  events.emit("contact.tagged", updated, tag);
  return updated;
}

export function renderTemplate(template: string, clinic: Clinic, contact: Contact, appt?: Appointment): string {
  const p = clinic.profile;
  const vars: Record<string, string> = {
    first_name: contact.name?.split(" ")[0] ?? "there",
    name: contact.name ?? "",
    clinic_name: p.name,
    clinic_phone: p.phone,
    review_url: p.reviewUrl ?? p.website,
    booking_url: p.bookingProvider === "jane" && p.janeBookingUrl ? p.janeBookingUrl : p.website,
    appointment_time: appt ? formatLocal(appt.starts_at, p.timezone) : "",
    service: appt ? serviceOf(clinic, appt.service_id)?.name ?? appt.service_id : "",
    practitioner: appt ? practitionerOf(clinic, appt.practitioner_id)?.name ?? "" : "",
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}
