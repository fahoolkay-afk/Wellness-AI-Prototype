import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { Channel, Clinic, Contact } from "../types.ts";
import { sendEmail } from "./email.ts";
import { sendPageMessage, sendWhatsApp } from "./meta.ts";
import { sendSms } from "./sms.ts";

export interface SendResult {
  /** "simulated" means the channel has no credentials configured; nothing left the building. */
  status: "sent" | "simulated";
  externalId?: string;
}

export class ChannelError extends Error {}

/** Where a contact can be reached on each channel, if at all. */
export function reachableChannels(contact: Contact): Channel[] {
  const out: Channel[] = [];
  if (contact.whatsapp_id) out.push("whatsapp");
  if (contact.phone) out.push("sms");
  if (contact.messenger_id) out.push("messenger");
  if (contact.instagram_id) out.push("instagram");
  if (contact.email) out.push("email");
  return out;
}

/** Picks the channel for an outbound message: requested, else preferred, else first reachable. */
export function pickChannel(contact: Contact, requested?: Channel | "preferred"): Channel | undefined {
  const reachable = reachableChannels(contact);
  // Calls can't be "replied" to; follow up by text instead.
  const want = requested === "voice" ? "sms" : requested;
  if (want && want !== "preferred") return reachable.includes(want) ? want : undefined;
  const preferred = contact.preferred_channel === "voice" ? "sms" : contact.preferred_channel;
  if (preferred && reachable.includes(preferred)) return preferred;
  return reachable[0];
}

export class Channels {
  private readonly db: Db;
  private readonly config: Config;
  private readonly fetchImpl: typeof fetch;

  constructor(db: Db, config: Config, fetchImpl: typeof fetch = fetch) {
    this.db = db;
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async send(clinic: Clinic, contact: Contact, channel: Channel, body: string, subject?: string): Promise<SendResult> {
    const from = this.db.channelAddress(clinic.id, channel === "voice" ? "sms" : channel);
    if (!from) throw new ChannelError(`${clinic.name} has no ${channel} account connected`);
    switch (channel) {
      case "voice":
      case "sms":
        if (!contact.phone) throw new ChannelError("Contact has no phone number");
        if (contact.opted_out) throw new ChannelError("Contact opted out of SMS (texted STOP)");
        return sendSms(this.config, from, contact.phone, body, this.fetchImpl);
      case "whatsapp":
        if (!contact.whatsapp_id) throw new ChannelError("Contact has no WhatsApp");
        return sendWhatsApp(this.config, from, contact.whatsapp_id, body, this.fetchImpl);
      case "messenger":
        if (!contact.messenger_id) throw new ChannelError("Contact has no Messenger id");
        return sendPageMessage(this.config, contact.messenger_id, body, this.fetchImpl);
      case "instagram":
        if (!contact.instagram_id) throw new ChannelError("Contact has no Instagram id");
        return sendPageMessage(this.config, contact.instagram_id, body, this.fetchImpl);
      case "email":
        if (!contact.email) throw new ChannelError("Contact has no email address");
        return sendEmail(this.config, `${clinic.name} <${from}>`, contact.email, subject || `Message from ${clinic.name}`, body, this.fetchImpl);
    }
  }

  /** Which channels have live credentials (vs. simulated). */
  status(): Record<Channel, "live" | "simulated"> {
    const c = this.config;
    const smsLive = c.sms.provider === "telnyx" ? !!c.sms.telnyxApiKey : !!(c.sms.twilioAccountSid && c.sms.twilioAuthToken);
    return {
      sms: smsLive ? "live" : "simulated",
      whatsapp: c.meta.whatsappToken ? "live" : "simulated",
      messenger: c.meta.pageAccessToken ? "live" : "simulated",
      instagram: c.meta.pageAccessToken ? "live" : "simulated",
      email: c.email.postmarkServerToken ? "live" : "simulated",
      voice: c.elevenlabs.toolSecret ? "live" : "simulated",
    };
  }
}
