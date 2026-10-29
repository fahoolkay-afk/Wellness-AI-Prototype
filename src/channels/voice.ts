// Phone calls are answered by an ElevenLabs Agents voice agent. ElevenLabs owns
// the real-time audio; this app supplies caller context, executes the agent's
// tools (the same ones the text receptionist uses), and files the call
// transcript and summary into the patient's thread afterwards.
//
//   POST /webhooks/elevenlabs/init        conversation-initiation webhook (caller context)
//   POST /webhooks/elevenlabs/tools/:name server tools (booking, messages, handoff)
//   POST /webhooks/elevenlabs/post-call   post-call transcription webhook
//   GET  /api/voice/agent-config          agent prompt + tool definitions to configure in ElevenLabs

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Backends } from "../booking/index.ts";
import type { Db } from "../db.ts";
import { normalizePhone } from "../db.ts";
import type { Events } from "../events.ts";
import type { Inbox } from "../inbox.ts";
import { clinicKnowledge } from "../ai/prompt.ts";
import { runTool, TOOL_DEFINITIONS, type ToolOutcome } from "../ai/tools.ts";
import type { Clinic } from "../types.ts";
import { formatLocal, localDate } from "../time.ts";

/** ElevenLabs-Signature: t=<unix>,v0=<hex HMAC-SHA256 of "<t>.<raw body>">. */
export function verifyElevenLabsSignature(secret: string, rawBody: Buffer, header: string | undefined, toleranceS = 1800): boolean {
  if (!header) return false;
  const fields = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(fields.t);
  if (!t || !fields.v0 || Math.abs(Date.now() / 1000 - t) > toleranceS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody.toString("utf8")}`).digest();
  const given = Buffer.from(fields.v0, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export class Voice {
  private readonly db: Db;
  private readonly inbox: Inbox;
  private readonly backends: Backends;
  private readonly events: Events;

  constructor(db: Db, inbox: Inbox, backends: Backends, events: Events) {
    this.db = db;
    this.inbox = inbox;
    this.backends = backends;
    this.events = events;
  }

  /** The clinic that owns the dialled number, or the only clinic in a single-clinic deployment. */
  clinicForNumber(calledNumber: string | undefined): Clinic | undefined {
    const id = calledNumber ? this.db.clinicForAddress("voice", normalizePhone(calledNumber)) : undefined;
    if (id) return this.db.getClinic(id);
    const clinics = this.db.listClinics();
    return clinics.length === 1 ? clinics[0] : undefined;
  }

  /** Dynamic variables for the start of a call so the agent can greet known patients by name. */
  initiation(body: { caller_id?: string; called_number?: string }) {
    const clinic = this.clinicForNumber(body.called_number);
    const caller = body.caller_id ? normalizePhone(body.caller_id) : undefined;
    const contact = clinic && caller ? this.db.findContactByIdentity(clinic.id, "voice", caller) : undefined;
    const tz = clinic?.profile.timezone ?? "America/Toronto";
    return {
      type: "conversation_initiation_client_data",
      dynamic_variables: {
        clinic_name: clinic?.name ?? "the clinic",
        patient_name: contact?.name ?? "",
        patient_known: contact ? "yes" : "no",
        current_time: formatLocal(new Date(), tz),
        today: localDate(new Date(), tz),
      },
    };
  }

  /** Runs a front-desk tool on behalf of the voice agent. */
  async tool(name: string, body: Record<string, unknown>): Promise<ToolOutcome> {
    const { caller_phone, called_number, ...input } = body;
    const clinic = this.clinicForNumber(typeof called_number === "string" ? called_number : undefined);
    if (!clinic) return { result: "Clinic not found for this number.", isError: true };
    if (typeof caller_phone !== "string" || !caller_phone.trim()) {
      return { result: "Caller number unavailable. Take the caller's name and number and create a staff task.", isError: true };
    }
    const { contact } = this.inbox.findOrCreateContact(clinic, "voice", caller_phone);
    const conversation = this.db.conversationForContact(contact, "voice");
    return runTool({
      db: this.db, events: this.events, backend: this.backends.forClinic(clinic), clinic, contact, conversation,
      channel: "voice", actor: "ai:voice",
    }, name, input);
  }

  /** Files a finished call into the patient's thread and the call log. */
  postCall(payload: PostCallPayload): void {
    const data = payload.data;
    if (payload.type !== "post_call_transcription" || !data) return;
    const phone = data.metadata?.phone_call?.external_number ?? data.conversation_initiation_client_data?.dynamic_variables?.system__caller_id;
    const called = data.metadata?.phone_call?.agent_number ?? data.conversation_initiation_client_data?.dynamic_variables?.system__called_number;
    const clinic = this.clinicForNumber(called);
    if (!clinic) return;
    const contact = phone ? this.inbox.findOrCreateContact(clinic, "voice", phone).contact : undefined;
    const conversation = contact ? this.db.conversationForContact(contact, "voice") : undefined;
    const transcript = (data.transcript ?? [])
      .filter((t) => t.message)
      .map((t) => `${t.role === "agent" ? "Receptionist" : "Caller"}: ${t.message}`).join("\n");
    const summary = data.analysis?.transcript_summary ?? "Call completed.";
    const duration = data.metadata?.call_duration_secs ?? null;
    this.db.upsertCall({
      clinic_id: clinic.id, contact_id: contact?.id ?? null, conversation_id: conversation?.id ?? null,
      external_id: data.conversation_id ?? null, from_number: phone ?? null, duration_s: duration, summary, transcript,
      outcome: data.analysis?.call_successful ?? data.status ?? null,
    });
    if (conversation) {
      const length = duration ? ` (${Math.floor(duration / 60)}m ${duration % 60}s)` : "";
      this.db.addMessage({
        conversationId: conversation.id, channel: "voice", direction: "in", author: "system",
        body: `📞 Call answered by AI receptionist${length}\nSummary: ${summary}`, status: "received",
        externalId: data.conversation_id ? `call:${data.conversation_id}` : null,
      });
    }
    this.events.emit("changed", { clinicId: clinic.id, kind: "call" });
  }

  /** Agent prompt and server-tool definitions to paste into (or sync with) the ElevenLabs agent. */
  agentConfig(clinic: Clinic, publicUrl: string) {
    const prompt = `You are the friendly virtual receptionist answering the phone for {{clinic_name}}. The current time is {{current_time}}. ${
      "If {{patient_known}} is yes, the caller is {{patient_name}}; greet them by first name."}

Keep every reply to one or two short spoken sentences. Ask one question at a time. Read times the way people say them ("Thursday at two thirty"). Never read out ids or URLs.

You can: answer questions about the clinic from the information below; check availability and book, reschedule or cancel appointments with your tools; take a message or callback request for staff (create_staff_task) with the caller's name, the reason and the best time to call back; and transfer to staff with handoff_to_staff when the caller asks for a person.

You are not a clinician: never diagnose or give medical advice. If the caller describes an emergency, tell them to hang up and call 911 now (or call or text 988 for a mental-health crisis), then use handoff_to_staff with urgent true. Only discuss the caller's own appointments.

Before ending, confirm what you did ("You're booked for..." or "I've passed your message to the team...").

${clinicKnowledge(clinic)}`;

    const tools = TOOL_DEFINITIONS.map((t) => ({
      type: "webhook",
      name: t.name,
      description: t.description,
      api_schema: {
        url: `${publicUrl.replace(/\/$/, "")}/webhooks/elevenlabs/tools/${t.name}`,
        method: "POST",
        request_headers: { "x-tool-secret": "<ELEVENLABS_TOOL_SECRET>" },
        request_body_schema: {
          ...t.input_schema,
          properties: {
            ...(t.input_schema.properties ?? {}),
            caller_phone: { type: "string", description: "Caller's phone number", dynamic_variable: "system__caller_id" },
            called_number: { type: "string", description: "Clinic number dialled", dynamic_variable: "system__called_number" },
          },
        },
      },
    }));

    return {
      name: `${clinic.name} receptionist`,
      first_message: "Thanks for calling {{clinic_name}}, this is the virtual receptionist. How can I help you today?",
      prompt,
      tools,
      webhooks: {
        conversation_initiation: `${publicUrl.replace(/\/$/, "")}/webhooks/elevenlabs/init`,
        post_call: `${publicUrl.replace(/\/$/, "")}/webhooks/elevenlabs/post-call`,
      },
    };
  }
}

export interface PostCallPayload {
  type?: string;
  data?: {
    conversation_id?: string;
    status?: string;
    transcript?: { role?: string; message?: string | null }[];
    metadata?: { call_duration_secs?: number; phone_call?: { external_number?: string; agent_number?: string } };
    analysis?: { transcript_summary?: string; call_successful?: string };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, string> };
  };
}
