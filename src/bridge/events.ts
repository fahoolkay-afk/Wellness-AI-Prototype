// The only events the front desk may queue for the EHRM, and the only keys each may carry
// (docs/INTEGRATION-CONTRACT.md section 4.4). Every string key has a fixed pattern or code list: there is
// no key that can hold message text, a transcript, a summary or a "reason for visit". The laptop runs the
// same table as its own allow-list. PHIPA s.30 (minimum necessary).

export const REF = {
  appointment: /^apt_[A-Za-z0-9_-]{22,64}$/,
  patient: /^pt_[A-Za-z0-9_-]{22,64}$/,
  release: /^rel_[A-Za-z0-9_-]{22,64}$/,
  request: /^brq_[A-Za-z0-9_-]{22}$/,
  event: /^evt_[A-Za-z0-9_-]{22}$/,
  form: /^frm_[A-Za-z0-9_-]{22}$/,
  formKey: /^fk_[A-Za-z0-9_-]{16}$/,
} as const;

/** First names and practitioner display names: letters, spaces, hyphen, apostrophe, max 40. */
export const NAME_RE = /^\p{L}[\p{L} '’-]{0,39}$/u;
/** A booking request's first name: one word, optionally with a hyphen or apostrophe part ("Anne-Marie", "O'Neil"). No spaces, so it can't carry a phrase. */
export const FIRST_NAME_RE = /^\p{L}{1,30}(?:['’-]\p{L}{1,30})?$/u;
export const E164_RE = /^\+[1-9]\d{7,14}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export const BOOKING_CHANNELS = ["sms", "whatsapp", "voice", "email", "messenger", "instagram", "web"] as const;
/** Service codes a booking request may carry (v1.2). The EHRM maps them to its own service list. */
export const SERVICE_CODES = ["initial", "treatment", "followup"] as const;
/** A sealed patient form (v1.2 section 12.2): ciphertext only, fixed shapes, so nothing readable can ride along. */
const B64U = /^[A-Za-z0-9_-]+$/;
export const SEALED_CT_MAX = 65_536;
export function sealedProblem(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return true;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "ct,epk,iv,keyId,v") return true;
  return o.v !== 1 || typeof o.keyId !== "string" || !REF.formKey.test(o.keyId)
    || typeof o.epk !== "string" || o.epk.length !== 87 || !B64U.test(o.epk)
    || typeof o.iv !== "string" || o.iv.length !== 16 || !B64U.test(o.iv)
    || typeof o.ct !== "string" || o.ct.length < 24 || o.ct.length > SEALED_CT_MAX || !B64U.test(o.ct);
}
export const CONSENT_CHANNELS = ["sms", "email", "whatsapp"] as const;
export const WITHDRAW_VIA = ["carrier_stop", "keyword", "unsubscribe_link", "staff"] as const;
export const DELIVERY_STATUSES = ["sent", "delivered", "failed", "not_sent"] as const;
/** Refusal codes (outbox) plus send and carrier outcome codes. Nothing else can appear in a status event. */
export const DELIVERY_CODES = [
  "consent_missing", "consent_withdrawn", "consent_mismatch", "wording", "privacy", "window_closed", "address_pending_review",
  "rate_capped", "channel_not_allowed", "link_not_allowed", "stale_release", "simulated", "send_failed", "undelivered", "carrier_failed",
] as const;
export type DeliveryCode = (typeof DELIVERY_CODES)[number];

type Check = (v: unknown) => boolean;
const str = (re: RegExp): Check => (v) => typeof v === "string" && re.test(v);
const oneOf = (list: readonly string[]): Check => (v) => typeof v === "string" && list.includes(v);
const iso: Check = (v) => typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
const bool: Check = (v) => typeof v === "boolean";
const nullable = (c: Check): Check => (v) => v === null || c(v);
const interval: Check = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Object.keys(o).every((k) => k === "start" || k === "end") && iso(o.start) && iso(o.end) && Date.parse(o.end as string) > Date.parse(o.start as string);
};
const intervals: Check = (v) => Array.isArray(v) && v.length >= 1 && v.length <= 3 && v.every(interval);

/** Keys every event has. `seq` is the queue position, added when the event is read. */
const COMMON: Record<string, Check> = { id: str(REF.event), type: (v) => typeof v === "string", at: iso };

export const EVENT_TYPES = {
  "booking.requested": {
    requestRef: str(REF.request), kind: oneOf(["new", "callback"]), channel: oneOf(BOOKING_CHANNELS),
    firstName: str(FIRST_NAME_RE), phone: str(E164_RE), phoneVerified: bool, preferredTimes: intervals,
    // v1.2: what the patient asked for, whether they say they have been before, and whether they ticked "you may text me
    // about this booking" on the website (false from every other producer). Codes only.
    service: nullable(oneOf(SERVICE_CODES)), returning: bool, textConsent: bool,
  },
  "appointment.confirmed": { appointmentRef: str(REF.appointment), channel: oneOf(BOOKING_CHANNELS) },
  "appointment.change_requested": { appointmentRef: str(REF.appointment), intent: oneOf(["change", "cancel"]), channel: oneOf(BOOKING_CHANNELS) },
  "consent.withdrawn": { patientRef: str(REF.patient), channel: oneOf(CONSENT_CHANNELS), purpose: oneOf(["service", "marketing"]), via: oneOf(WITHDRAW_VIA) },
  "delivery.status": { releaseRef: str(REF.release), status: oneOf(DELIVERY_STATUSES), code: nullable(oneOf(DELIVERY_CODES)) },
  "form.submitted": { formRef: str(REF.form), sealed: (v) => !sealedProblem(v) },
} as const satisfies Record<string, Record<string, Check>>;

export type EventType = keyof typeof EVENT_TYPES;
export type BridgeEvent = { id: string; type: EventType; at: string; seq?: number } & Record<string, unknown>;

/** Exact key set and value check for one event. Returns a code, or undefined when the event is allowed. */
export function eventProblem(e: Record<string, unknown>): string | undefined {
  const fields = EVENT_TYPES[e.type as EventType] as Record<string, Check> | undefined;
  if (!fields) return "bad_event";
  const allowed: Record<string, Check> = { ...COMMON, ...fields };
  for (const key of Object.keys(e)) if (key !== "seq" && !allowed[key]) return "unknown_field";
  for (const [key, check] of Object.entries(allowed)) if (!check(e[key])) return `bad_${key}`;
  return undefined;
}
