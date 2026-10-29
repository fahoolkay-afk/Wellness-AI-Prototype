// Front-desk tools shared by the text receptionist (Claude tool use) and the
// voice agent (ElevenLabs server tools call /webhooks/elevenlabs/tools/:name).

import type Anthropic from "@anthropic-ai/sdk";
import type { PracticeBackend } from "../booking/backend.ts";
import { practitionerOf, serviceOf } from "../booking/backend.ts";
import type { Db } from "../db.ts";
import { normalizePhone } from "../db.ts";
import type { Events } from "../events.ts";
import { sha256 } from "../security/crypto.ts";
import { randomInt } from "node:crypto";
import type { Channel, Clinic, Contact, Conversation, TaskType } from "../types.ts";
import { formatLocal, localDate, parseLocalDateTime } from "../time.ts";

export interface ToolContext {
  db: Db;
  events: Events;
  backend: PracticeBackend;
  clinic: Clinic;
  contact: Contact;
  conversation: Conversation;
  channel: Channel;
  /** Recorded in created_via / created_by, e.g. "ai:whatsapp". */
  actor: string;
  /**
   * True when the channel proved who is writing (SMS/WhatsApp/Messenger/Instagram ids, DMARC-verified email)
   * or a one-time code was confirmed. Caller ID and unverified email are NOT proof: until verified, the AI
   * may offer times, book new visits and take messages, but not reveal or change existing appointments.
   */
  identityVerified?: boolean;
  /** Where a one-time code check is remembered: a call id for voice, the conversation for text. */
  verificationScope?: string;
  /** Sends a one-time code to the phone or email already on file. Returns where it went, or undefined. */
  sendCode?: (code: string) => Promise<string | undefined>;
  /** Booking changes made in this turn (one allowed per turn). */
  bookingChanges?: number;
}

/** Most future appointments the AI may hold for one person (prank and spam protection). */
const MAX_FUTURE_AI_BOOKINGS = 2;
const MAX_FUTURE_AI_BOOKINGS_SOCIAL_ONLY = 1;
const MAX_AI_BOOKINGS_PER_CLINIC_HOUR = 20;

export interface ToolOutcome {
  /** Text handed back to the model. */
  result: string;
  isError?: boolean;
  /** Set when the AI handed the conversation to staff. */
  handedOff?: boolean;
}

type Schema = Anthropic.Tool["input_schema"];
const obj = (properties: Record<string, unknown>, required: string[] = []): Schema => ({
  type: "object", properties, required, additionalProperties: false,
});

const TASK_TYPES: TaskType[] = ["callback", "message", "booking", "billing", "insurance", "records", "other"];

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "find_available_times",
    description: "Look up open appointment times for a service. Always call this before offering times; never invent availability. Returns up to 6 options spread across days.",
    input_schema: obj({
      service_id: { type: "string", description: "Service id from the clinic's service list." },
      date_from: { type: "string", description: "Earliest clinic-local date, YYYY-MM-DD. Defaults to today." },
      date_to: { type: "string", description: "Latest clinic-local date, YYYY-MM-DD. Defaults to two weeks after date_from." },
      practitioner_id: { type: "string", description: "Only this practitioner, if the patient asked for someone specific." },
      time_of_day: { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
    }, ["service_id"]),
  },
  {
    name: "book_appointment",
    description: "Book an appointment for this patient in a slot returned by find_available_times. Only book after the patient has clearly confirmed the service, practitioner and time, and you have their full name.",
    input_schema: obj({
      service_id: { type: "string" },
      practitioner_id: { type: "string" },
      start: { type: "string", description: "The slot's start exactly as returned by find_available_times (UTC ISO)." },
      patient_name: { type: "string", description: "Patient's full name, if not already on file." },
      notes: { type: "string", description: "Short booking note for the practitioner (reason for visit as the patient described it, insurance/claim type). No diagnoses." },
    }, ["service_id", "practitioner_id", "start"]),
  },
  {
    name: "get_my_appointments",
    description: "List this patient's upcoming appointments (ids, times, services). Needs a verified identity: if the result says verification is needed, offer send_verification_code.",
    input_schema: obj({}),
  },
  {
    name: "cancel_appointment",
    description: "Cancel one of this patient's upcoming appointments after they confirm. Mention the clinic's cancellation policy if it applies.",
    input_schema: obj({
      appointment_id: { type: "integer" },
      reason: { type: "string" },
    }, ["appointment_id"]),
  },
  {
    name: "reschedule_appointment",
    description: "Move one of this patient's upcoming appointments to a new slot from find_available_times, after they confirm.",
    input_schema: obj({
      appointment_id: { type: "integer" },
      new_start: { type: "string", description: "New slot start exactly as returned by find_available_times." },
      practitioner_id: { type: "string", description: "Only if changing practitioner." },
    }, ["appointment_id", "new_start"]),
  },
  {
    name: "update_patient_details",
    description: "Save the patient's name. A new phone number or email is passed to staff to confirm before the clinic uses it; tell the patient a team member will confirm the change.",
    input_schema: obj({
      name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
    }),
  },
  {
    name: "send_verification_code",
    description: "Send a 6-digit code to the phone number or email the clinic already has on file for this patient, to confirm who they are before discussing or changing existing appointments. Never read the code out yourself.",
    input_schema: obj({}),
  },
  {
    name: "check_verification_code",
    description: "Check the 6-digit code the patient read back to you.",
    input_schema: obj({ code: { type: "string" } }, ["code"]),
  },
  {
    name: "create_staff_task",
    description: "Leave a task for front-desk staff: a callback, a message for a practitioner, a billing, insurance or records request, or anything you cannot complete yourself. Tell the patient a team member will follow up.",
    input_schema: obj({
      type: { type: "string", enum: TASK_TYPES },
      priority: { type: "string", enum: ["low", "normal", "urgent"] },
      title: { type: "string", description: "One line, e.g. 'Call back Tom about MVA claim billing'." },
      details: { type: "string", description: "Everything staff need so they don't have to re-ask the patient." },
    }, ["type", "title"]),
  },
  {
    name: "handoff_to_staff",
    description: "Pause the AI on this conversation and flag it for a human: the patient asks for a person, is upset, describes a clinical concern needing a practitioner's judgement, or the request is outside what you can do. After calling it, send one short message saying a team member will reply.",
    input_schema: obj({
      reason: { type: "string" },
      urgent: { type: "boolean" },
    }, ["reason"]),
  },
];

export async function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "find_available_times": return await findTimes(ctx, input);
      case "book_appointment": return await book(ctx, input);
      case "get_my_appointments": return await myAppointments(ctx);
      case "cancel_appointment": return await cancel(ctx, input);
      case "reschedule_appointment": return await reschedule(ctx, input);
      case "update_patient_details": return updateDetails(ctx, input);
      case "send_verification_code": return await sendCode(ctx);
      case "check_verification_code": return checkCode(ctx, input);
      case "create_staff_task": return createTask(ctx, input);
      case "handoff_to_staff": return handoff(ctx, input);
      default: return { result: `Unknown tool ${name}`, isError: true };
    }
  } catch (err) {
    console.error(`[tool ${name}]`, err);
    return { result: `The ${name} tool failed: ${(err as Error).message}. Apologize, take the patient's details and create a staff task instead.`, isError: true };
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function findTimes(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  const { clinic, backend } = ctx;
  if (backend.kind === "jane") {
    return { result: `This clinic books online through Jane App. Send the patient this link to pick a time: ${clinic.profile.janeBookingUrl ?? "(no booking link configured; create a booking task)"}` };
  }
  const serviceId = str(input.service_id) ?? "";
  if (!serviceOf(clinic, serviceId)) {
    return { result: `Unknown service_id "${serviceId}". Valid ids: ${clinic.profile.services.map((s) => s.id).join(", ")}`, isError: true };
  }
  const slots = await backend.findSlots(clinic, {
    serviceId,
    dateFrom: str(input.date_from) ?? localDate(new Date(), clinic.profile.timezone),
    dateTo: str(input.date_to),
    practitionerId: str(input.practitioner_id),
    timeOfDay: str(input.time_of_day) as "morning" | "afternoon" | "evening" | "any" | undefined,
  });
  if (!slots.length) return { result: "No open times in that range. Try a wider date range, another practitioner, or offer to add them to the waitlist with a staff task." };
  return { result: JSON.stringify(slots.map((s) => ({ start: s.start, when: s.label, practitioner_id: s.practitionerId, practitioner: s.practitionerName }))) };
}

const NEEDS_VERIFICATION: ToolOutcome = {
  result: "For privacy, existing appointments can only be shared or changed once we confirm who this is. Offer to send a one-time code to the number or email on file (send_verification_code), or take a message for staff.",
  isError: true,
};

function verified(ctx: ToolContext): boolean {
  if (ctx.identityVerified) return true;
  return !!ctx.verificationScope && ctx.db.isVerified(ctx.contact.id, ctx.verificationScope);
}

function oneChangePerTurn(ctx: ToolContext): ToolOutcome | undefined {
  if ((ctx.bookingChanges ?? 0) >= 1) return { result: "Only one booking change can be made per message. Confirm this one with the patient first.", isError: true };
  ctx.bookingChanges = (ctx.bookingChanges ?? 0) + 1;
  return undefined;
}

function staffPaused(ctx: ToolContext): ToolOutcome | undefined {
  const conv = ctx.db.getConversation(ctx.conversation.id);
  if (conv && !conv.ai_enabled) return { result: "A team member has taken over this patient's conversation. Don't change bookings; take a message instead.", isError: true };
  return undefined;
}

async function book(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  const { clinic, db, events } = ctx;
  const blocked = staffPaused(ctx);
  if (blocked) return blocked;
  const socialOnly = !ctx.contact.phone && !ctx.contact.email && !ctx.contact.whatsapp_id;
  const cap = socialOnly ? MAX_FUTURE_AI_BOOKINGS_SOCIAL_ONLY : MAX_FUTURE_AI_BOOKINGS;
  if (db.futureAiBookings(ctx.contact.id) >= cap) {
    return { result: `This patient already has ${cap === 1 ? "an upcoming booking" : "upcoming bookings"} made here. For more, create a booking task for staff.`, isError: true };
  }
  if (db.aiBookingsSince(clinic.id, new Date(Date.now() - 3600_000).toISOString()) >= MAX_AI_BOOKINGS_PER_CLINIC_HOUR) {
    db.createTask({ clinicId: clinic.id, type: "booking", priority: "urgent", title: "Unusual number of AI bookings in the last hour: please review", createdBy: "system" });
    return { result: "Booking is busy right now. Take the patient's details and create a booking task for staff.", isError: true };
  }
  const limit = oneChangePerTurn(ctx);
  if (limit) return limit;
  const name = str(input.patient_name);
  if (name && !ctx.contact.name) ctx.contact = db.updateContact(ctx.contact.id, { name });
  if (!ctx.contact.name) return { result: "Ask the patient for their full name before booking.", isError: true };
  const start = parseLocalDateTime(str(input.start) ?? "", clinic.profile.timezone);
  if (!start) return { result: "Invalid start time; use a start value from find_available_times.", isError: true };
  const result = await ctx.backend.book(clinic, {
    contact: ctx.contact, serviceId: str(input.service_id) ?? "", practitionerId: str(input.practitioner_id) ?? "",
    start: start.toISOString(), notes: str(input.notes), createdVia: ctx.actor,
  });
  if (!result.ok) return { result: result.reason + (result.bookingUrl ? ` Booking link: ${result.bookingUrl}` : ""), isError: true };
  events.emit("appointment.booked", result.appointment);
  events.emit("changed", { clinicId: clinic.id, kind: "appointment", id: result.appointment.id });
  const followUp = ctx.channel === "voice" ? " A text confirmation will be sent to the caller automatically." : "";
  return { result: `Booked. ${describeAppointment(ctx, result.appointment)}. Confirm the details to the patient.${followUp}` };
}

async function myAppointments(ctx: ToolContext): Promise<ToolOutcome> {
  if (!verified(ctx)) return NEEDS_VERIFICATION;
  const appts = await ctx.backend.upcoming(ctx.clinic, ctx.contact);
  if (!appts.length) return { result: "No upcoming appointments on file for this patient." };
  return { result: JSON.stringify(appts.map((a) => ({ appointment_id: a.id, description: describeAppointment(ctx, a) }))) };
}

async function ownAppointment(ctx: ToolContext, id: unknown) {
  const appt = typeof id === "number" ? ctx.db.getAppointment(id) : undefined;
  // Patients can only change their own bookings.
  if (!appt || appt.contact_id !== ctx.contact.id || appt.status !== "booked") return undefined;
  return appt;
}

async function cancel(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  if (!verified(ctx)) return NEEDS_VERIFICATION;
  const blocked = staffPaused(ctx) ?? oneChangePerTurn(ctx);
  if (blocked) return blocked;
  const appt = await ownAppointment(ctx, input.appointment_id);
  if (!appt) return { result: "No matching upcoming appointment for this patient. Call get_my_appointments first.", isError: true };
  const result = await ctx.backend.cancel(ctx.clinic, appt, str(input.reason));
  if (!result.ok) return { result: result.reason, isError: true };
  ctx.events.emit("appointment.cancelled", result.appointment);
  ctx.events.emit("changed", { clinicId: ctx.clinic.id, kind: "appointment", id: appt.id });
  const lateNotice = Date.parse(appt.starts_at) - Date.now() < 24 * 3600_000;
  return { result: `Cancelled ${describeAppointment(ctx, appt)}.${lateNotice ? " This is inside the 24-hour window, so the late-cancellation policy may apply; staff will review." : ""}` };
}

async function reschedule(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  if (!verified(ctx)) return NEEDS_VERIFICATION;
  const blocked = staffPaused(ctx) ?? oneChangePerTurn(ctx);
  if (blocked) return blocked;
  const appt = await ownAppointment(ctx, input.appointment_id);
  if (!appt) return { result: "No matching upcoming appointment for this patient. Call get_my_appointments first.", isError: true };
  const start = parseLocalDateTime(str(input.new_start) ?? "", ctx.clinic.profile.timezone);
  if (!start) return { result: "Invalid new_start; use a start value from find_available_times.", isError: true };
  const result = await ctx.backend.reschedule(ctx.clinic, appt, start.toISOString(), str(input.practitioner_id));
  if (!result.ok) return { result: result.reason, isError: true };
  ctx.events.emit("appointment.rescheduled", result.appointment);
  ctx.events.emit("changed", { clinicId: ctx.clinic.id, kind: "appointment", id: appt.id });
  return { result: `Rescheduled to ${describeAppointment(ctx, result.appointment)}.` };
}

function updateDetails(ctx: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const parts: string[] = [];
  const name = str(input.name);
  if (name && !ctx.contact.name) {
    ctx.contact = ctx.db.updateContact(ctx.contact.id, { name: name.slice(0, 80) });
    parts.push("Name saved.");
  }
  // Delivery addresses are never changed by the AI: a stranger could otherwise redirect a patient's messages.
  const email = str(input.email);
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { result: "That email address looks invalid; ask the patient to re-check it.", isError: true };
    ctx.db.proposeContactChange(ctx.clinic.id, ctx.contact.id, "email", email.toLowerCase(), ctx.actor);
    parts.push("New email passed to staff to confirm.");
  }
  const phone = str(input.phone);
  if (phone) {
    ctx.db.proposeContactChange(ctx.clinic.id, ctx.contact.id, "phone", normalizePhone(phone), ctx.actor);
    parts.push("New phone number passed to staff to confirm.");
  }
  if (email || phone) {
    ctx.db.createTask({
      clinicId: ctx.clinic.id, contactId: ctx.contact.id, conversationId: ctx.conversation.id, type: "records",
      title: "Confirm a contact detail change the patient asked for", details: "Review and approve it in the patient panel.", createdBy: ctx.actor,
    });
  }
  ctx.events.emit("changed", { clinicId: ctx.clinic.id, kind: "contact", id: ctx.contact.id });
  return { result: parts.join(" ") || "Nothing to save." };
}

async function sendCode(ctx: ToolContext): Promise<ToolOutcome> {
  if (!ctx.sendCode || !ctx.verificationScope) return { result: "Codes can't be sent here. Take a message for staff instead.", isError: true };
  if (ctx.db.recentVerificationCount(ctx.contact.id, new Date(Date.now() - 3600_000).toISOString()) >= 3) {
    return { result: "Too many codes requested. Take a message for staff instead.", isError: true };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const sentTo = await ctx.sendCode(code);
  if (!sentTo) return { result: "There's no phone number or email on file to send a code to. Take a message for staff instead.", isError: true };
  ctx.db.createVerification(ctx.clinic.id, ctx.contact.id, ctx.verificationScope, sha256(code));
  return { result: `Code sent to the ${sentTo} on file. Ask the patient to read it back.` };
}

function checkCode(ctx: ToolContext, input: Record<string, unknown>): ToolOutcome {
  if (!ctx.verificationScope) return { result: "No code was sent.", isError: true };
  const code = (str(input.code) ?? "").replace(/\D/g, "");
  const outcome = ctx.db.checkVerification(ctx.contact.id, ctx.verificationScope, sha256(code));
  if (outcome === "ok") {
    ctx.identityVerified = true;
    return { result: "Verified. You can now look up and change this patient's appointments." };
  }
  if (outcome === "wrong") return { result: "That code doesn't match. They can try again.", isError: true };
  return { result: "The code expired or was tried too many times. Offer to send a new one, or take a message.", isError: true };
}

function createTask(ctx: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const type = TASK_TYPES.includes(input.type as TaskType) ? (input.type as TaskType) : "other";
  const priority = (["low", "normal", "urgent"] as const).find((p) => p === input.priority) ?? "normal";
  const task = ctx.db.createTask({
    clinicId: ctx.clinic.id, contactId: ctx.contact.id, conversationId: ctx.conversation.id, type, priority,
    title: str(input.title) ?? "Follow up with patient", details: str(input.details), createdBy: ctx.actor,
  });
  ctx.events.emit("changed", { clinicId: ctx.clinic.id, kind: "task", id: task.id });
  return { result: `Task #${task.id} created for the front desk.` };
}

function handoff(ctx: ToolContext, input: Record<string, unknown>): ToolOutcome {
  const reason = str(input.reason) ?? "Patient needs a team member";
  // A phone handoff flags the thread but leaves the text receptionist on; a text handoff pauses it.
  ctx.db.updateConversation(ctx.conversation.id, ctx.channel === "voice"
    ? { needs_attention: 1, attention_reason: reason }
    : { ai_enabled: 0, needs_attention: 1, attention_reason: reason, paused_by: "AI handoff" });
  if (input.urgent) {
    ctx.db.createTask({
      clinicId: ctx.clinic.id, contactId: ctx.contact.id, conversationId: ctx.conversation.id, type: "message",
      priority: "urgent", title: `Urgent: ${reason}`, createdBy: ctx.actor,
    });
  }
  ctx.events.emit("changed", { clinicId: ctx.clinic.id, kind: "conversation", id: ctx.conversation.id });
  return { result: "Conversation flagged for staff and the AI is paused. Send one short message telling the patient a team member will reply soon.", handedOff: true };
}

function describeAppointment(ctx: ToolContext, a: { id: number; service_id: string; practitioner_id: string; starts_at: string }): string {
  const service = serviceOf(ctx.clinic, a.service_id)?.name ?? a.service_id;
  const practitioner = practitionerOf(ctx.clinic, a.practitioner_id)?.name ?? a.practitioner_id;
  return `#${a.id}: ${service} with ${practitioner} on ${formatLocal(a.starts_at, ctx.clinic.profile.timezone)}`;
}
