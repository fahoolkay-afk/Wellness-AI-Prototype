// Keyword-based stand-in for the Claude receptionist, used when no
// ANTHROPIC_API_KEY is set so the product can be demoed offline. It calls the
// same tools as the real receptionist, so bookings, tasks and handoffs are real.

import type { Message } from "../types.ts";
import { addDays, localDate } from "../time.ts";
import type { Reply, Responder } from "./receptionist.ts";
import { runTool, type ToolContext } from "./tools.ts";

interface Offered {
  serviceId: string;
  slots: { start: string; when: string; practitioner_id: string; practitioner: string }[];
  chosen?: number;
}

const EMERGENCY = /\b(chest pain|can'?t breathe|trouble breathing|stroke|suicid|kill myself|self[- ]harm|unconscious|severe bleeding|overdose)\b/i;

export class DemoResponder implements Responder {
  readonly name = "demo";
  private readonly offers = new Map<number, Offered>();

  async reply(ctx: ToolContext, history: Message[]): Promise<Reply> {
    const last = history.at(-1);
    if (!last || last.author !== "patient") return { text: null, handedOff: false, toolsUsed: [] };
    const text = last.body.trim();
    const lower = text.toLowerCase();
    const p = ctx.clinic.profile;
    const first = ctx.contact.name?.split(" ")[0];
    const hi = first ? `Hi ${first}! ` : "Hi! ";
    const used: string[] = [];
    const tool = async (name: string, input: Record<string, unknown> = {}) => {
      used.push(name);
      return runTool(ctx, name, input);
    };

    if (EMERGENCY.test(text)) {
      await tool("handoff_to_staff", { reason: "Possible emergency described by patient", urgent: true });
      return { text: "If this is an emergency, please call 911 right now. For a mental-health crisis you can also call or text 988. A member of our team has been alerted.", handedOff: true, toolsUsed: used };
    }
    if (/\b(human|real person|someone|staff|manager|speak to|talk to)\b/.test(lower)) {
      await tool("handoff_to_staff", { reason: "Patient asked for a person" });
      return { text: "Of course. I've let the team know and someone will reply here shortly.", handedOff: true, toolsUsed: used };
    }

    // Waiting on a name to finish a booking.
    const offer = this.offers.get(ctx.conversation.id);
    if (offer?.chosen !== undefined && !ctx.contact.name && /^[a-z][a-z' -]+ [a-z][a-z' -]+$/i.test(text)) {
      return this.book(ctx, offer, offer.chosen, text, used);
    }
    // Picking one of the offered times.
    const pick = /^\s*(?:option\s*)?([1-3])\b/.exec(lower) ?? /\b(first|second|third)\b/.exec(lower);
    if (offer && pick) {
      const index = ["1", "first"].includes(pick[1]) ? 0 : ["2", "second"].includes(pick[1]) ? 1 : 2;
      if (offer.slots[index]) {
        if (!ctx.contact.name) {
          offer.chosen = index;
          return { text: `Great choice: ${offer.slots[index].when} with ${offer.slots[index].practitioner}. What's your full name for the booking?`, handedOff: false, toolsUsed: used };
        }
        return this.book(ctx, offer, index, undefined, used);
      }
    }

    if (/\b(cancel|reschedul|move my|change my)\b/.test(lower)) {
      const res = await tool("get_my_appointments");
      if (res.result.startsWith("No upcoming")) return { text: `${hi}I don't see any upcoming appointments under this contact. Could you tell me the name the booking is under?`, handedOff: false, toolsUsed: used };
      await tool("create_staff_task", { type: "booking", title: `Patient wants to ${lower.includes("cancel") ? "cancel" : "reschedule"} an appointment`, details: text });
      return { text: `${hi}I've got your request and the front desk will confirm the change shortly. Just a reminder that we ask for 24 hours' notice for changes.`, handedOff: false, toolsUsed: used };
    }

    const serviceId = detectService(lower);
    if (serviceId && /\b(book|appointment|available|availability|opening|slot|come in|schedule|this week|next week|tomorrow|today)\b/.test(lower)) {
      const res = await tool("find_available_times", { service_id: serviceId, ...requestedDay(lower, ctx) });
      // A clinic that books in Jane: the tool's answer is written for the assistant, so the patient gets the link in plain words.
      if (ctx.backend.kind === "jane" && p.janeBookingUrl) {
        return { text: `${hi}You can pick a time that suits you on the clinic's online booking page: ${p.janeBookingUrl} Your booking and intake form are done there. Anything else I can help with?`, handedOff: false, toolsUsed: used };
      }
      if (res.isError || !res.result.startsWith("[")) return { text: `${hi}${res.result}`, handedOff: false, toolsUsed: used };
      const slots = (JSON.parse(res.result) as Offered["slots"]).slice(0, 3);
      this.offers.set(ctx.conversation.id, { serviceId, slots });
      const service = p.services.find((s) => s.id === serviceId)!;
      const list = slots.map((s, i) => `${i + 1}) ${s.when} with ${s.practitioner}`).join("\n");
      return { text: `${hi}For ${describeService(service)}, here are the next openings:\n${list}\nReply 1, 2 or 3 to book.`, handedOff: false, toolsUsed: used };
    }
    if (/\b(price|cost|how much|fee|rate)\b/.test(lower)) {
      const services = serviceId ? p.services.filter((s) => s.id === serviceId) : p.services;
      return { text: `${hi}${services.map((s) => `${s.name}: $${s.priceCents / 100} (${s.durationMin} min)`).join("; ")}. Want me to check availability?`, handedOff: false, toolsUsed: used };
    }
    if (/\b(insurance|direct bill|blue cross|sun life|manulife|green shield|canada life|benefits)\b/.test(lower)) {
      return { text: `${hi}${p.policies.find((x) => /insur/i.test(x)) ?? "We accept most extended health plans."}`, handedOff: false, toolsUsed: used };
    }
    if (/\b(hours|open|close|closing|weekend|saturday|sunday)\b/.test(lower)) {
      return { text: `${hi}Our hours are ${p.hoursText}. We're at ${p.address}.`, handedOff: false, toolsUsed: used };
    }
    for (const f of p.faq) {
      const keyword = f.q.toLowerCase().match(/\b(parking|wear|wsib|accident)\b/)?.[1];
      if (keyword && lower.includes(keyword === "accident" ? "accident" : keyword)) return { text: `${hi}${f.a}`, handedOff: false, toolsUsed: used };
    }
    if (serviceId) {
      const service = p.services.find((s) => s.id === serviceId)!;
      return { text: `${hi}We'd start you with ${describeService(service)}. Would you like me to find a time?`, handedOff: false, toolsUsed: used };
    }
    if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(lower)) {
      return { text: `${hi}Thanks for reaching out to ${p.name}. I can help you book, answer questions about our services, or take a message for the team. What can I do for you?`, handedOff: false, toolsUsed: used };
    }

    await tool("create_staff_task", { type: "message", title: "Patient message needs a reply", details: text });
    return { text: `${hi}Thanks for your message. I've passed it to our front-desk team and someone will get back to you shortly.`, handedOff: false, toolsUsed: used };
  }

  private async book(ctx: ToolContext, offer: Offered, index: number, name: string | undefined, used: string[]): Promise<Reply> {
    const slot = offer.slots[index];
    used.push("book_appointment");
    const res = await runTool(ctx, "book_appointment", { service_id: offer.serviceId, practitioner_id: slot.practitioner_id, start: slot.start, patient_name: name });
    this.offers.delete(ctx.conversation.id);
    if (res.isError) return { text: `Sorry, ${res.result}`, handedOff: false, toolsUsed: used };
    const first = ctx.contact.name?.split(" ")[0] ?? "";
    return { text: `You're booked${first ? `, ${first}` : ""}! ${slot.when} with ${slot.practitioner}. Please arrive 10 minutes early for a first visit.`, handedOff: false, toolsUsed: used };
  }
}

function describeService(service: { name: string; durationMin: number; priceCents: number }): string {
  const length = /\bmin\b/.test(service.name) ? "" : `${service.durationMin} min, `;
  return `a ${service.name.toLowerCase()} (${length}$${service.priceCents / 100})`;
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "this saturday", "tomorrow" -> a one-day search window in clinic-local dates. */
function requestedDay(lower: string, ctx: ToolContext): { date_from?: string; date_to?: string } {
  const today = localDate(new Date(), ctx.clinic.profile.timezone);
  if (/\btomorrow\b/.test(lower)) {
    const day = addDays(today, 1);
    return { date_from: day, date_to: day };
  }
  const index = WEEKDAY_NAMES.findIndex((d) => lower.includes(d));
  if (index < 0) return {};
  const [y, m, d] = today.split("-").map(Number);
  const offset = (index - new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 7) % 7;
  const day = addDays(today, offset);
  return { date_from: day, date_to: day };
}

function detectService(lower: string): string | undefined {
  if (/\b(massage|rmt)\b/.test(lower)) return /\b90\b/.test(lower) ? "rmt-90" : "rmt-60";
  if (/\b(chiro|chiropract|adjustment)\w*/.test(lower)) return /\badjustment\b/.test(lower) ? "chiro-adjustment" : "chiro-initial";
  if (/\b(physio|back|neck|knee|shoulder|hip|ankle|pain|injur|sprain|sciatica)\w*/.test(lower)) return /\bfollow[- ]?up\b/.test(lower) ? "physio-followup" : "physio-initial";
  return undefined;
}
