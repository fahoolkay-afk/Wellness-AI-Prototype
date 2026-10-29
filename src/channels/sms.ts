// SMS via Twilio or Telnyx (pick with SMS_PROVIDER). Both are wired up so the
// cheaper carrier can be chosen per deployment without touching the app.

import { createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import type { Config } from "../config.ts";
import type { InboundMessage } from "../types.ts";
import { normalizePhone } from "../db.ts";
import type { SendResult } from "./index.ts";

export async function sendSms(config: Config, from: string, to: string, body: string, fetchImpl = fetch): Promise<SendResult> {
  const sms = config.sms;
  if (sms.provider === "telnyx") {
    if (!sms.telnyxApiKey) return { status: "simulated" };
    const res = await fetchImpl("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${sms.telnyxApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, text: body, messaging_profile_id: sms.telnyxMessagingProfileId || undefined }),
    });
    const data = (await res.json()) as { data?: { id?: string }; errors?: { detail?: string }[] };
    if (!res.ok) throw new Error(`Telnyx: ${data.errors?.[0]?.detail ?? res.status}`);
    return { status: "sent", externalId: data.data?.id };
  }
  if (!sms.twilioAccountSid || !sms.twilioAuthToken) return { status: "simulated" };
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sms.twilioAccountSid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sms.twilioAccountSid}:${sms.twilioAuthToken}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  });
  const data = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio: ${data.message ?? res.status}`);
  return { status: "sent", externalId: data.sid };
}

/** Twilio signs HMAC-SHA1(authToken, fullUrl + sorted(key+value)) in X-Twilio-Signature. */
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function parseTwilioInbound(params: Record<string, string>): InboundMessage | undefined {
  if (!params.From || !params.To) return undefined;
  return {
    channel: "sms", from: normalizePhone(params.From), to: normalizePhone(params.To),
    body: params.Body ?? "", externalId: params.MessageSid,
  };
}

/** Telnyx signs `${timestamp}|${rawBody}` with Ed25519 (telnyx-signature-ed25519 / telnyx-timestamp headers). */
export function verifyTelnyxSignature(publicKeyBase64: string, rawBody: Buffer, signature: string | undefined, timestamp: string | undefined): boolean {
  if (!signature || !timestamp) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = createPublicKey({
    // Wrap the raw 32-byte key in an SPKI header so node:crypto can load it.
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyBase64, "base64")]),
    format: "der", type: "spki",
  });
  return verify(null, Buffer.concat([Buffer.from(`${timestamp}|`), rawBody]), key, Buffer.from(signature, "base64"));
}

interface TelnyxEvent {
  data?: { event_type?: string; payload?: { id?: string; text?: string; from?: { phone_number?: string }; to?: { phone_number?: string }[] } };
}

export function parseTelnyxInbound(event: TelnyxEvent): InboundMessage | undefined {
  const payload = event.data?.payload;
  if (event.data?.event_type !== "message.received" || !payload?.from?.phone_number || !payload.to?.[0]?.phone_number) return undefined;
  return {
    channel: "sms", from: normalizePhone(payload.from.phone_number), to: normalizePhone(payload.to[0].phone_number),
    body: payload.text ?? "", externalId: payload.id,
  };
}

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "arret", "arrêt"]);
const START_WORDS = new Set(["start", "unstop"]);

/** Carrier opt-out keywords; only a message consisting of just the keyword counts. */
export function optOutKeyword(body: string): "stop" | "start" | undefined {
  const word = body.trim().toLowerCase();
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  return undefined;
}
