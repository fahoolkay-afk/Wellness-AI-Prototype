// WhatsApp Cloud API, Facebook Messenger and Instagram DMs, direct to Meta's
// Graph API (no Twilio markup). All three share one webhook endpoint, signed
// with the Meta app secret.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "../config.ts";
import type { InboundMessage } from "../types.ts";
import type { SendResult } from "./index.ts";

export function verifyMetaSignature(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface MetaWebhook {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: { from?: string; id?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
      };
    }[];
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: { type?: string }[] };
    }[];
  }[];
}

export function parseMetaWebhook(payload: MetaWebhook): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    if (payload.object === "whatsapp_business_account") {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;
        for (const msg of value?.messages ?? []) {
          if (!msg.from) continue;
          const body = msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title
            ?? `[${msg.type ?? "unsupported"} message]`;
          const name = value?.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
          out.push({ channel: "whatsapp", to: phoneNumberId, from: msg.from, fromName: name, body, externalId: msg.id });
        }
      }
    } else if (payload.object === "page" || payload.object === "instagram") {
      const channel = payload.object === "page" ? "messenger" : "instagram";
      for (const event of entry.messaging ?? []) {
        const message = event.message;
        if (!message || message.is_echo || !event.sender?.id) continue;
        const body = message.text ?? (message.attachments?.length ? `[${message.attachments[0].type ?? "attachment"}]` : "");
        if (!body) continue;
        out.push({ channel, to: event.recipient?.id ?? entry.id ?? "", from: event.sender.id, body, externalId: message.mid });
      }
    }
  }
  return out;
}

export async function sendWhatsApp(config: Config, phoneNumberId: string, to: string, body: string, fetchImpl = fetch): Promise<SendResult> {
  if (!config.meta.whatsappToken) return { status: "simulated" };
  const res = await fetchImpl(`https://graph.facebook.com/${config.meta.graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.meta.whatsappToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body, preview_url: true } }),
  });
  const data = (await res.json()) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok) {
    // 131047: outside the 24h customer-service window; a pre-approved template is required.
    if (data.error?.code === 131047) throw new Error("WhatsApp 24-hour window closed: an approved template message is required");
    throw new Error(`WhatsApp: ${data.error?.message ?? res.status}`);
  }
  return { status: "sent", externalId: data.messages?.[0]?.id };
}

/** Messenger and Instagram DMs both send through the Page's Send API. */
export async function sendPageMessage(config: Config, recipientId: string, body: string, fetchImpl = fetch): Promise<SendResult> {
  if (!config.meta.pageAccessToken) return { status: "simulated" };
  const url = `https://graph.facebook.com/${config.meta.graphVersion}/me/messages?access_token=${encodeURIComponent(config.meta.pageAccessToken)}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: body } }),
  });
  const data = (await res.json()) as { message_id?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(`Meta Send API: ${data.error?.message ?? res.status}`);
  return { status: "sent", externalId: data.message_id };
}
