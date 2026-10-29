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

/** North American Numbering Plan (+1): Canada, the US and some Caribbean nations. */
export function isNanp(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") && /^1[2-9]\d{2}[2-9]\d{6}$/.test(digits);
}

export class Channels {
  private readonly db: Db;
  private readonly config: Config;
  private readonly fetchImpl: typeof fetch;
  private readonly unsubscribeUrl: (clinicId: number, contactId: number, channel: Channel) => string;

  constructor(db: Db, config: Config, unsubscribeUrl: (clinicId: number, contactId: number, channel: Channel) => string, fetchImpl: typeof fetch = fetch) {
    this.db = db;
    this.config = config;
    this.unsubscribeUrl = unsubscribeUrl;
    this.fetchImpl = fetchImpl;
  }

  async send(clinic: Clinic, contact: Contact, channel: Channel, body: string, opts: { subject?: string; purpose: "service" | "marketing" }): Promise<SendResult> {
    const from = this.db.channelAddress(clinic.id, channel === "voice" ? "sms" : channel);
    if (!from) throw new ChannelError(`${clinic.name} has no ${channel} account connected`);
    switch (channel) {
      case "voice":
      case "sms":
        if (!contact.phone) throw new ChannelError("Patient has no phone number");
        if (!this.config.security.allowInternational && !isNanp(contact.phone)) throw new ChannelError("Texts outside North America are switched off");
        return sendSms(this.config, from, contact.phone, opts.purpose === "marketing" ? `${body}\nReply STOP to opt out.` : body, this.fetchImpl);
      case "whatsapp":
        if (!contact.whatsapp_id) throw new ChannelError("Patient has no WhatsApp");
        return sendWhatsApp(this.config, from, contact.whatsapp_id, body, this.fetchImpl);
      case "messenger":
        if (!contact.messenger_id) throw new ChannelError("Patient has no Messenger id");
        return sendPageMessage(this.config, contact.messenger_id, body, this.fetchImpl);
      case "instagram":
        if (!contact.instagram_id) throw new ChannelError("Patient has no Instagram id");
        return sendPageMessage(this.config, contact.instagram_id, body, this.fetchImpl);
      case "email": {
        if (!contact.email) throw new ChannelError("Patient has no email address");
        const marketing = opts.purpose === "marketing";
        const unsubscribe = marketing ? this.unsubscribeUrl(clinic.id, contact.id, "email") : undefined;
        return sendEmail(this.config, `${clinic.name} <${from}>`, contact.email, opts.subject || `Message from ${clinic.name}`, body, {
          unsubscribeUrl: unsubscribe,
          // CASL identification: who sent it, how to reach them, how to stop.
          footer: marketing ? `${clinic.profile.name}, ${clinic.profile.address}. ${clinic.profile.phone}. Unsubscribe: ${unsubscribe}` : undefined,
        }, this.fetchImpl);
      }
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
