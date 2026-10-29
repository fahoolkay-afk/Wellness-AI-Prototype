// Recognising opt-outs, opt-ins and appointment confirmations in patient messages.

/** Whole-message SMS keywords that carriers (and Twilio/Telnyx) treat as an opt-out. We must honour them. */
const CARRIER_STOP = new Set(["stop", "stopall", "stop all", "unsubscribe", "cancel", "end", "quit", "optout", "opt out", "revoke", "arret", "arrêt"]);
const CARRIER_START = new Set(["start", "unstop", "yes start", "resume"]);

const clean = (body: string) => body.normalize("NFKC").trim().toLowerCase().replace(/[!.?,;:'"\s]+$/g, "").replace(/^[\s"']+/, "").replace(/\s+/g, " ");

export type KeywordIntent =
  | { kind: "carrier_stop"; word: string }
  | { kind: "carrier_start" }
  | { kind: "revoke" }
  | { kind: "confirm" }
  | { kind: "change" };

/** Natural-language withdrawals ("please stop texting me", "unsubscribe me", "remove me from your list"). */
const REVOKE_PATTERNS = [
  /\b(stop|quit|cease)\b[^.?!]{0,30}\b(text|texting|messag|email|emailing|contact|contacting|whatsapp|sending)/,
  /\bunsubscribe\b/,
  /\bopt(ing)?[\s-]?out\b/,
  /\b(do not|don'?t|dont)\s+(text|message|email|contact|whatsapp)\s+me\b/,
  /\bremove me\b/,
  /\bno more (texts|messages|emails|reminders)\b/,
  /\btake me off\b/,
];

/**
 * Classifies a message. `channel` matters: on SMS a bare carrier keyword is a legal opt-out even when the
 * patient may have meant something else (e.g. CANCEL), so it is reported separately.
 */
export function detectIntent(body: string, channel: string): KeywordIntent | undefined {
  const text = clean(body);
  if (!text) return undefined;
  if (channel === "sms" && CARRIER_STOP.has(text)) return { kind: "carrier_stop", word: text };
  if (CARRIER_START.has(text)) return { kind: "carrier_start" };
  if (channel !== "sms" && (text === "stop" || text === "unsubscribe" || text === "stop all")) return { kind: "revoke" };
  if (REVOKE_PATTERNS.some((re) => re.test(text))) return { kind: "revoke" };
  if (/^(c|confirm|confirmed|yes|y|yes please|ok|okay|see you then)$/.test(text)) return { kind: "confirm" };
  if (/^(change|reschedule|r)$/.test(text)) return { kind: "change" };
  return undefined;
}
