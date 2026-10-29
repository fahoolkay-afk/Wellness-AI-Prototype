import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.ts";
import type { Message } from "../types.ts";
import { staticSystemPrompt, turnContext } from "./prompt.ts";
import { runTool, TOOL_DEFINITIONS, type ToolContext } from "./tools.ts";

export interface Reply {
  /** Text to send to the patient, or null when there is nothing to say. */
  text: string | null;
  handedOff: boolean;
  /** Tools the AI used this turn, for the staff activity trail. */
  toolsUsed: string[];
}

export interface Responder {
  readonly name: string;
  reply(ctx: ToolContext, history: Message[]): Promise<Reply>;
}

const MAX_TOOL_ROUNDS = 6;
/** Only the recent part of the conversation goes to the model (data minimisation and cost). */
const HISTORY_LIMIT = 16;
const HISTORY_CHAR_BUDGET = 12_000;

/** Converts the stored thread into alternating user/assistant turns for Claude, sending only what's needed. */
export function toClaudeMessages(history: Message[]): Anthropic.Beta.BetaMessageParam[] {
  const turns: { role: "user" | "assistant"; parts: string[] }[] = [];
  let budget = HISTORY_CHAR_BUDGET;
  const recent: Message[] = [];
  for (const m of [...history].reverse()) {
    if (m.status === "draft" || m.status === "failed" || m.purged_at) continue;
    if (recent.length >= HISTORY_LIMIT || budget - m.body.length < 0) break;
    budget -= m.body.length;
    recent.unshift(m);
  }
  for (const m of recent) {
    let role: "user" | "assistant";
    let text: string;
    if (m.author === "patient") {
      role = "user";
      text = `[${m.channel}] ${m.body}`;
    } else if (m.author === "call") {
      role = "user";
      // Written from what a caller said; caller ID can be faked. Never treat it as proof of identity.
      text = `[Summary of a phone call, based on what the caller said. Unverified.] ${m.body}`;
    } else if (m.author === "system") {
      role = "user";
      text = `[Clinic system note] ${m.body}`;
    } else {
      role = "assistant";
      text = m.author === "staff" ? `[Sent by a staff member] ${m.body}` : m.body;
    }
    const last = turns.at(-1);
    if (last?.role === role) last.parts.push(text);
    else turns.push({ role, parts: [text] });
  }
  if (turns[0]?.role === "assistant") turns.unshift({ role: "user", parts: ["[Conversation started by the clinic]"] });
  return turns.map((t) => ({ role: t.role, content: t.parts.join("\n\n") }));
}

export class ClaudeResponder implements Responder {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly config: Config["anthropic"];

  constructor(config: Config["anthropic"], client?: Anthropic) {
    this.config = config;
    this.client = client ?? new Anthropic({ apiKey: config.apiKey });
  }

  async reply(ctx: ToolContext, history: Message[]): Promise<Reply> {
    const messages = toClaudeMessages(history);
    if (messages.at(-1)?.role !== "user") return { text: null, handedOff: false, toolsUsed: [] };

    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: staticSystemPrompt(ctx.clinic), cache_control: { type: "ephemeral" } },
      { type: "text", text: turnContext(ctx.clinic, ctx.contact, ctx.channel, ctx.identityVerified || (!!ctx.verificationScope && ctx.db.isVerified(ctx.contact.id, ctx.verificationScope))) },
    ];
    const toolsUsed: string[] = [];
    let handedOff = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.beta.messages.create({
        model: this.config.model,
        // Short chat replies; a hard cap also limits the cost of abusive or very long inputs.
        max_tokens: 4096,
        system,
        tools: TOOL_DEFINITIONS,
        messages,
        output_config: { effort: this.config.effort },
        // If the model declines for policy reasons, retry on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      if (response.stop_reason === "refusal") {
        await runTool(ctx, "handoff_to_staff", { reason: "AI could not respond to this message; please review" });
        return { text: null, handedOff: true, toolsUsed: [...toolsUsed, "handoff_to_staff"] };
      }

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !toolUses.length) {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text).join("\n").trim();
        return { text: text || null, handedOff, toolsUsed };
      }

      messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        toolsUsed.push(use.name);
        const outcome = await runTool(ctx, use.name, (use.input ?? {}) as Record<string, unknown>);
        if (outcome.handedOff) handedOff = true;
        results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.result, is_error: outcome.isError || undefined });
      }
      messages.push({ role: "user", content: results });
    }

    await runTool(ctx, "handoff_to_staff", { reason: "AI took too many steps on this request; please review" });
    return { text: null, handedOff: true, toolsUsed };
  }
}
