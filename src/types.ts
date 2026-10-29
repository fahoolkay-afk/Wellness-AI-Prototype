export type Channel = "sms" | "whatsapp" | "messenger" | "instagram" | "email" | "voice";

export const CHANNELS: Channel[] = ["sms", "whatsapp", "messenger", "instagram", "email", "voice"];

/** How the AI behaves on a channel: reply on its own, draft for staff approval, or stay silent. */
export type AiMode = "auto" | "draft" | "off";

export type MessageAuthor = "patient" | "ai" | "staff" | "system" | "call";
/** reply: an answer to the patient; service: reminders and confirmations; marketing: campaigns and recalls. */
export type MessagePurpose = "reply" | "service" | "marketing";
export type MessageStatus = "received" | "sent" | "simulated" | "draft" | "failed";

export interface Practitioner {
  id: string;
  name: string;
  title: string;
  /** Service ids this practitioner offers. */
  services: string[];
  /** Weekday (mon..sun) -> list of [start, end] "HH:MM" ranges in clinic local time. */
  hours: Record<string, [string, string][]>;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  description: string;
}

export interface ClinicProfile {
  name: string;
  type: string;
  timezone: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Front-desk opening hours shown to patients, e.g. "Mon-Fri 8am-7pm". */
  hoursText: string;
  services: Service[];
  practitioners: Practitioner[];
  policies: string[];
  faq: { q: string; a: string }[];
  /** "builtin" uses this app's calendar; "jane" hands off to the clinic's Jane App booking site. */
  bookingProvider: "builtin" | "jane";
  janeBookingUrl?: string;
  /** EHR-connected edition: this clinic's location id in the EHRM. */
  ehrLocationId?: string;
  reviewUrl?: string;
  /** Which wording rules apply (see src/policy/guards.ts). Missing = all of them. */
  wordingRules?: string[];
  /** Tags staff may use to pick a campaign audience. Clinical tags are never allowed. */
  audienceTags?: string[];
  /** Days to keep message text and call text in the cloud before it is cleared (metadata stays). */
  retention?: { messageDays: number; callDays: number };
  /** Set once the clinic has signed agreements with the AI and voice processors (PHIPA s.17, O. Reg. 329/04). */
  processorAgreementsRecorded?: boolean;
  /** Quiet hours for automated and campaign messages, clinic-local "HH:MM". */
  quietHours?: { start: string; end: string };
  aiModes: Record<Channel, AiMode>;
  automations: Automation[];
}

/** Patient pipeline (GoHighLevel-style opportunity stages, tuned for clinics). */
export const STAGES = ["new_lead", "contacted", "booked", "active_patient", "lapsed"] as const;
export type Stage = (typeof STAGES)[number];

export type AutomationTrigger =
  | { type: "contact_created" }
  | { type: "appointment_booked" }
  | { type: "appointment_cancelled" }
  /** Fires `hours` before the appointment starts. */
  | { type: "appointment_upcoming"; hours: number }
  /** Fires `hours` after the appointment ends. */
  | { type: "appointment_completed"; hours: number }
  /** Fires when a lead has had no booking `hours` after first contact. */
  | { type: "lead_not_booked"; hours: number }
  /** Fires when an active patient has had no visit for `days`. */
  | { type: "patient_lapsed"; days: number }
  | { type: "tag_added"; tag: string };

export type AutomationAction =
  /**
   * `template` supports {{first_name}}, {{clinic_name}}, {{appointment_time}}, {{practitioner}} (first name),
   * {{review_url}}, {{booking_url}}. {{service}} is shown only in email; other channels say "appointment".
   * `purpose` decides the consent needed: service (reminders) or marketing (express consent only).
   */
  | { type: "send_message"; channel: "preferred" | Channel; template: string; subject?: string; purpose: "service" | "marketing" }
  | { type: "add_tag"; tag: string }
  | { type: "set_stage"; stage: Stage }
  | { type: "create_task"; title: string; taskType?: TaskType };

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
}

export interface Clinic {
  id: number;
  name: string;
  profile: ClinicProfile;
}

export interface Contact {
  id: number;
  clinic_id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  whatsapp_id: string | null;
  messenger_id: string | null;
  instagram_id: string | null;
  notes: string | null;
  /** JSON array of tags, e.g. ["new-patient","massage"]. */
  tags: string;
  stage: Stage;
  /** Set when the patient texts STOP; no marketing or automated messages are sent. */
  opted_out: number;
  preferred_channel: Channel | null;
  /** Patient id in the external EHRM (EHR-connected edition). */
  external_id: string | null;
  created_at: string;
}

export interface Conversation {
  id: number;
  clinic_id: number;
  contact_id: number;
  ai_enabled: number;
  needs_attention: number;
  attention_reason: string | null;
  last_channel: Channel;
  last_message_at: string;
  unread: number;
  status: "open" | "closed";
  paused_by: string | null;
}

export interface Message {
  id: number;
  conversation_id: number;
  channel: Channel;
  direction: "in" | "out";
  author: MessageAuthor;
  author_name: string | null;
  body: string;
  subject: string | null;
  status: MessageStatus;
  external_id: string | null;
  error: string | null;
  created_at: string;
  purpose: MessagePurpose | null;
  sender_verified: number;
  simulated: number;
  staff_user_id: number | null;
  purged_at: string | null;
}

export interface Appointment {
  id: number;
  clinic_id: number;
  contact_id: number;
  service_id: string;
  practitioner_id: string;
  starts_at: string;
  ends_at: string;
  status: "booked" | "cancelled" | "completed" | "no_show";
  notes: string | null;
  created_via: string;
  reminder_sent_at: string | null;
  followup_sent_at: string | null;
  external_ref: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export type TaskType = "callback" | "message" | "booking" | "billing" | "insurance" | "records" | "other";

export interface Task {
  id: number;
  clinic_id: number;
  contact_id: number | null;
  conversation_id: number | null;
  type: TaskType;
  priority: "low" | "normal" | "urgent";
  title: string;
  details: string | null;
  status: "open" | "done";
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

export interface Call {
  id: number;
  clinic_id: number;
  contact_id: number | null;
  conversation_id: number | null;
  external_id: string | null;
  from_number: string | null;
  duration_s: number | null;
  summary: string | null;
  transcript: string | null;
  outcome: string | null;
  /** inbound: patient called the clinic. outbound: the clinic called the patient. */
  direction: "inbound" | "outbound";
  /** The number that was dialled (the clinic's line for inbound calls, the patient's for outbound). */
  to_number: string | null;
  /** "assistant" for the voice agent, otherwise the staff member's name. */
  handled_by: string | null;
  created_at: string;
}

/** A normalized inbound message from any channel adapter. */
export interface InboundMessage {
  channel: Channel;
  /** The clinic-side address it arrived on (phone number, page id, inbox address...). */
  to: string;
  /** The patient-side address to reply to. */
  from: string;
  fromName?: string;
  body: string;
  subject?: string;
  externalId?: string;
  /** False when the channel couldn't authenticate the sender (e.g. email without DMARC pass). */
  senderVerified?: boolean;
  /** Injected by the staff test console; never changes consent or reaches the EHR. */
  simulated?: boolean;
}
