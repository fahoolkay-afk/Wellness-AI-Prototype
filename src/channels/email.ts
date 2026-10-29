// The clinic's general inbox. Inbound mail arrives as a Postmark-format inbound
// webhook; outbound goes through Postmark's API. Any provider with an inbound
// webhook can be swapped in by changing these two functions.

import type { Config } from "../config.ts";
import type { InboundMessage } from "../types.ts";
import type { SendResult } from "./index.ts";

interface PostmarkInbound {
  FromFull?: { Email?: string; Name?: string };
  From?: string;
  FromName?: string;
  OriginalRecipient?: string;
  To?: string;
  ToFull?: { Email?: string }[];
  Subject?: string;
  TextBody?: string;
  StrippedTextReply?: string;
  MessageID?: string;
}

export function parseEmailInbound(p: PostmarkInbound): InboundMessage | undefined {
  const from = p.FromFull?.Email ?? p.From;
  const to = p.OriginalRecipient ?? p.ToFull?.[0]?.Email ?? p.To;
  if (!from || !to) return undefined;
  return {
    channel: "email", from: from.toLowerCase(), to: to.toLowerCase(), fromName: p.FromFull?.Name || p.FromName,
    subject: p.Subject ?? "", body: (p.StrippedTextReply || p.TextBody || "").trim(), externalId: p.MessageID,
  };
}

export async function sendEmail(config: Config, from: string, to: string, subject: string, body: string, fetchImpl = fetch): Promise<SendResult> {
  if (!config.email.postmarkServerToken) return { status: "simulated" };
  const res = await fetchImpl("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "x-postmark-server-token": config.email.postmarkServerToken, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: body, MessageStream: "outbound" }),
  });
  const data = (await res.json()) as { MessageID?: string; Message?: string; ErrorCode?: number };
  if (!res.ok || data.ErrorCode) throw new Error(`Postmark: ${data.Message ?? res.status}`);
  return { status: "sent", externalId: data.MessageID };
}
