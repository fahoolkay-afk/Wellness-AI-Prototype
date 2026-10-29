// GoHighLevel-style workflows: a trigger (event or timer) followed by actions.
// Each automation runs at most once per subject (appointment, contact...),
// enforced by the automation_runs table, so restarts and overlapping ticks are safe.

import { practitionerOf, serviceOf } from "./booking/backend.ts";
import { parseTags, type Db } from "./db.ts";
import type { Events } from "./events.ts";
import type { Inbox } from "./inbox.ts";
import { reachableChannels } from "./channels/index.ts";
import { privacyProblems } from "./policy/guards.ts";
import type { Appointment, Automation, AutomationAction, Channel, Clinic, Contact, Stage } from "./types.ts";
import { formatLocal, localDateTime } from "./time.ts";

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
      // Quiet hours: a funnel that sends a message waits for the morning (the next tick after quiet hours end).
      if (automation.actions.some((a) => a.type === "send_message") && inQuietHours(clinic, new Date())) {
        this.db.deferAutomation(clinic.id, automation.id, subject, contact.id, appt?.id ?? null);
        continue;
      }
      await this.run(clinic, automation, subject, contact, appt);
    }
  }

  /** Runs event funnels that were held back during quiet hours. */
  private async releaseDeferred(clinic: Clinic): Promise<void> {
    for (const d of this.db.takeDeferredAutomations(clinic.id)) {
      const automation = clinic.profile.automations.find((a) => a.id === d.automation_id && a.enabled);
      const contact = this.db.getContact(d.contact_id);
      const appt = d.appointment_id ? this.db.getAppointment(d.appointment_id) : undefined;
      // A booking that was cancelled overnight no longer gets its confirmation.
      if (!automation || !contact || (appt && automation.trigger.type === "appointment_booked" && appt.status !== "booked")) continue;
      await this.run(clinic, automation, d.subject, contact, appt);
    }
  }

  /** Evaluates timer-based triggers for every clinic. Nothing the clinic starts goes out during quiet hours. */
  async tick(now = new Date()): Promise<void> {
    const t = now.getTime();
    const iso = (ms: number) => new Date(ms).toISOString();
    for (const clinic of this.db.listClinics()) {
      if (inQuietHours(clinic, now)) continue;
      await this.releaseDeferred(clinic);
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
      case "send_message": {
        // The AI already confirmed in the chat it booked from; a second confirmation there is noise.
        // Phone and staff bookings still get the written confirmation.
        if (automation.trigger.type === "appointment_booked" && appt && /^ai:(?!voice)/.test(appt.created_via)) return contact;
        const outcome = await this.inbox.sendToContact(clinic, contact, action.channel, (channel) => renderTemplate(action.template, clinic, contact, appt, channel), {
          authorName: `Automation: ${automation.name}`, subject: action.subject ?? automation.name, purpose: action.purpose ?? "service",
        });
        if ("skipped" in outcome) console.info(`[automations] ${automation.id} skipped contact ${contact.id}: ${outcome.skipped}`);
        return this.db.getContact(contact.id)!;
      }
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

  /**
   * Who a campaign would reach, without sending: counts per channel and why the rest are skipped.
   * Audiences are limited to pipeline stage and the clinic's approved (non-clinical) audience tags.
   */
  preview(clinic: Clinic, opts: CampaignOptions): CampaignPreview {
    const audienceProblem = campaignProblem(clinic, opts);
    if (audienceProblem) return { matched: 0, eligible: 0, byChannel: {}, skipped: {}, problem: audienceProblem };
    const contacts = this.db.listContacts(clinic.id, { tag: opts.tag, stage: opts.stage });
    const byChannel: Record<string, number> = {};
    const skipped: Record<string, number> = {};
    for (const contact of contacts) {
      const choice = this.chooseChannel(clinic, contact, opts);
      if ("channel" in choice) byChannel[choice.channel] = (byChannel[choice.channel] ?? 0) + 1;
      else skipped[choice.skipped] = (skipped[choice.skipped] ?? 0) + 1;
    }
    const eligible = Object.values(byChannel).reduce((a, b) => a + b, 0);
    return { matched: contacts.length, eligible, byChannel, skipped };
  }

  private chooseChannel(clinic: Clinic, contact: Contact, opts: CampaignOptions): { channel: Channel } | { skipped: string } {
    const reachable = reachableChannels(contact);
    const order = opts.channel === "preferred"
      ? [contact.preferred_channel, ...reachable].filter((c, i, a): c is Channel => !!c && c !== "voice" && a.indexOf(c) === i && reachable.includes(c as Channel))
      : reachable.includes(opts.channel) ? [opts.channel] : [];
    if (!order.length) return { skipped: "no address on that channel" };
    const conv = this.db.conversationForContact(contact, order[0]);
    let reason = "no consent";
    for (const channel of order) {
      const problem = this.inbox.sendProblem(clinic, contact, conv.id, channel, renderTemplate(opts.template, clinic, contact, undefined, channel), { purpose: opts.purpose });
      if (!problem) return { channel };
      reason = problem.replace(/ for \w+$/, "").replace(/ on (sms|whatsapp|email|messenger|instagram)\b.*$/, "");
    }
    return { skipped: reason };
  }

  /** Sends a campaign (owner only, confirmed in the app first). Attributed to the person who sent it. */
  async broadcast(clinic: Clinic, opts: CampaignOptions, staff: { id: number; name: string }): Promise<{ sent: number; skipped: number }> {
    const problem = campaignProblem(clinic, opts);
    if (problem) throw new Error(problem);
    if (inQuietHours(clinic, new Date())) throw new Error("It's quiet hours for this clinic. Schedule the campaign for the daytime.");
    const contacts = this.db.listContacts(clinic.id, { tag: opts.tag, stage: opts.stage });
    let sent = 0;
    let skipped = 0;
    for (const contact of contacts) {
      const outcome = await this.inbox.sendToContact(clinic, contact, opts.channel, (channel) => renderTemplate(opts.template, clinic, contact, undefined, channel), {
        authorName: `Campaign "${opts.name}" by ${staff.name}`, subject: opts.subject, purpose: opts.purpose, staffUserId: staff.id,
      });
      if ("message" in outcome && outcome.message.status !== "failed") sent++;
      else skipped++;
    }
    return { sent, skipped };
  }
}

export interface CampaignOptions {
  name: string;
  tag?: string;
  stage?: Stage;
  channel: Channel | "preferred";
  template: string;
  subject?: string;
  /** marketing (express consent) or service (only to patients with a booking, e.g. a closure notice). */
  purpose: "service" | "marketing";
}

export interface CampaignPreview {
  matched: number;
  eligible: number;
  byChannel: Record<string, number>;
  skipped: Record<string, number>;
  problem?: string;
}

function campaignProblem(clinic: Clinic, opts: CampaignOptions): string | undefined {
  if (!opts.template.trim()) return "The message is empty.";
  if (opts.tag && !(clinic.profile.audienceTags ?? []).includes(opts.tag)) {
    return `"${opts.tag}" isn't an approved audience tag. Campaigns can't target clinical tags; the owner can approve non-clinical tags in Settings.`;
  }
  if (opts.purpose === "service" && opts.stage !== "booked") return "Service notices can only go to patients with a booking. Use a marketing campaign for everyone else.";
  for (const channel of ["sms", "whatsapp"] as Channel[]) {
    const privacy = privacyProblems(opts.template, channel, clinic);
    if (privacy.length && opts.channel !== "email") return `The message names health details (${privacy.join(", ")}). Keep campaigns general.`;
  }
  return undefined;
}

/** Quiet hours in clinic-local time (default 21:00 to 08:00). */
export function inQuietHours(clinic: Clinic, now: Date): boolean {
  const { start, end } = clinic.profile.quietHours ?? { start: "08:00", end: "21:00" };
  const hhmm = localDateTime(now, clinic.profile.timezone).slice(11);
  return hhmm < start || hhmm >= end;
}

export function addTag(db: Db, events: Events, contact: Contact, tag: string): Contact {
  const tags = parseTags(contact);
  if (tags.includes(tag)) return contact;
  const updated = db.updateContact(contact.id, { tags: JSON.stringify([...tags, tag]) });
  events.emit("contact.tagged", updated, tag);
  return updated;
}

/**
 * Fills a template. On SMS, WhatsApp, Messenger and Instagram the service is shown as "appointment" and the
 * practitioner by first name only, so lock screens and shared phones don't reveal the type of care.
 */
export function renderTemplate(template: string, clinic: Clinic, contact: Contact, appt?: Appointment, channel: Channel = "email"): string {
  const p = clinic.profile;
  const detailed = channel === "email";
  const practitionerName = appt ? practitionerOf(clinic, appt.practitioner_id)?.name ?? "" : "";
  const vars: Record<string, string> = {
    first_name: contact.name?.split(" ")[0] ?? "there",
    name: contact.name ?? "",
    clinic_name: p.name,
    clinic_phone: p.phone,
    review_url: p.reviewUrl ?? p.website,
    booking_url: p.bookingProvider === "jane" && p.janeBookingUrl ? p.janeBookingUrl : p.website,
    appointment_time: appt ? formatLocal(appt.starts_at, p.timezone) : "",
    service: appt ? (detailed ? serviceOf(clinic, appt.service_id)?.name ?? "appointment" : "appointment") : "",
    practitioner: detailed ? practitionerName : practitionerName.split(" ")[0] ?? "",
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}
