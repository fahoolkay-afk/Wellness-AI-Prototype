import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeResponder, toClaudeMessages } from "../src/ai/receptionist.ts";
import { staticSystemPrompt } from "../src/ai/prompt.ts";
import type { Message } from "../src/types.ts";
import { zonedToUtc } from "../src/time.ts";
import { nextWeekday, setup, testConfig } from "./helpers.ts";

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;

/** A scripted stand-in for the Anthropic client: returns canned responses and records requests. */
function fakeClaude(script: (params: CreateParams, call: number) => Partial<Anthropic.Beta.BetaMessage>) {
  const requests: CreateParams[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: CreateParams) => {
          requests.push(structuredClone(params));
          return { id: `msg_${requests.length}`, type: "message", role: "assistant", model: params.model, stop_reason: "end_turn", content: [], ...script(params, requests.length) };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

test("toClaudeMessages alternates roles and labels staff and system notes", () => {
  const base = { conversation_id: 1, channel: "sms", direction: "in", author_name: null, subject: null, status: "received", external_id: null, error: null, created_at: "" } as const;
  const history: Message[] = [
    { ...base, id: 1, author: "ai", direction: "out", body: "Reminder: tomorrow at 9", status: "sent" },
    { ...base, id: 2, author: "patient", body: "thanks" },
    { ...base, id: 3, author: "patient", body: "can I move it?" },
    { ...base, id: 4, author: "staff", author_name: "Alex", direction: "out", body: "Sure", status: "sent" },
    { ...base, id: 5, author: "ai", direction: "out", body: "draft", status: "draft" },
    { ...base, id: 6, author: "system", body: "Call summary" },
  ];
  const messages = toClaudeMessages(history);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.match(String(messages[2].content), /thanks[\s\S]*can I move it/);
  assert.match(String(messages[3].content), /staff member Alex/);
  assert.match(String(messages[4].content), /system note/);
  assert.ok(!JSON.stringify(messages).includes("draft"));
});

test("the receptionist books through tools and replies on the patient's channel", async () => {
  const day = nextWeekday(2); // Tuesday: Sofia works 10-19
  const start = zonedToUtc(day, "10:00", "America/Toronto").toISOString();
  const { client, requests } = fakeClaude((params, call) => {
    if (call === 1) {
      return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "find_available_times", input: { service_id: "rmt-60", date_from: day, date_to: day }, caller: { type: "direct" } } as Anthropic.Beta.BetaToolUseBlock] };
    }
    if (call === 2) {
      const last = params.messages.at(-1)!;
      assert.ok(JSON.stringify(last.content).includes(start), "slot list was returned to the model");
      return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_2", name: "book_appointment", input: { service_id: "rmt-60", practitioner_id: "pr-sofia", start, patient_name: "Sam Rivera" }, caller: { type: "direct" } } as Anthropic.Beta.BetaToolUseBlock] };
    }
    return { stop_reason: "end_turn", content: [{ type: "text", text: "You're booked with Sofia, Sam!", citations: null }] };
  });
  const config = testConfig((c) => { c.anthropic.apiKey = "test"; });
  const s = setup({ config, responder: new ClaudeResponder(config.anthropic, client) });
  const r = await s.inbox.receive({ channel: "whatsapp", to: "wa-phone-id", from: "14165550199", body: "massage tuesday morning please, I'm Sam Rivera" });
  await s.inbox.idle();

  const appts = s.db.contactAppointments(r!.conversation.contact_id);
  assert.equal(appts.length, 1);
  assert.equal(appts[0].starts_at, start);
  assert.equal(appts[0].created_via, "ai:whatsapp");
  assert.equal(s.db.getContact(r!.conversation.contact_id)!.stage, "booked", "booking automation moved the pipeline stage");
  const messages = s.db.listMessages(r!.conversation.id);
  assert.equal(messages.at(-1)!.body, "You're booked with Sofia, Sam!");
  assert.equal(messages.filter((m) => m.direction === "out").length, 1, "no duplicate automated confirmation in chat");

  const first = requests[0];
  assert.equal(first.model, "claude-opus-5-5");
  assert.equal(first.fallbacks, "default");
  assert.deepEqual(first.betas, ["server-side-fallback-2026-07-01"]);
  const system = first.system as Anthropic.Beta.BetaTextBlockParam[];
  assert.equal(system[0].text, staticSystemPrompt(s.clinic()), "stable prefix is cacheable");
  assert.ok(system[0].cache_control);
  assert.match(system[1].text, /WhatsApp/);
});

test("a refusal hands the conversation to staff without replying", async () => {
  const { client } = fakeClaude(() => ({ stop_reason: "refusal", content: [] }));
  const config = testConfig((c) => { c.anthropic.apiKey = "test"; });
  const s = setup({ config, responder: new ClaudeResponder(config.anthropic, client) });
  const r = await s.inbox.receive({ channel: "sms", to: "+14165550100", from: "+19055550142", body: "..." });
  await s.inbox.idle();
  assert.equal(s.db.listMessages(r!.conversation.id).length, 1);
  assert.equal(s.db.getConversation(r!.conversation.id)!.needs_attention, 1);
});

test("patients cannot cancel someone else's appointment", async () => {
  const s = setup();
  const owner = s.db.createContact(s.clinicId, { name: "Owner", phone: "+14165550001" });
  const appt = s.db.createAppointment({ clinic_id: s.clinicId, contact_id: owner.id, service_id: "rmt-60", practitioner_id: "pr-sofia", starts_at: zonedToUtc(nextWeekday(2), "10:00", "America/Toronto").toISOString(), ends_at: zonedToUtc(nextWeekday(2), "11:00", "America/Toronto").toISOString(), created_via: "test" });
  const intruder = s.db.createContact(s.clinicId, { name: "Intruder", phone: "+14165550002" });
  const { runTool } = await import("../src/ai/tools.ts");
  const outcome = await runTool({
    db: s.db, events: s.events, backend: s.backends.forClinic(s.clinic()), clinic: s.clinic(), contact: intruder,
    conversation: s.db.conversationForContact(intruder, "sms"), channel: "sms", actor: "ai:sms",
  }, "cancel_appointment", { appointment_id: appt.id });
  assert.equal(outcome.isError, true);
  assert.equal(s.db.getAppointment(appt.id)!.status, "booked");
});
