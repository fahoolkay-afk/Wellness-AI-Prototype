// The narrow surface the rest of the front desk uses to talk to the bridge. Kept import-free so the inbox,
// the receptionist tools and the routes can depend on it without import cycles.

import type { Db } from "../db.ts";
import type { Channel, Clinic, Contact } from "../types.ts";

export type WithdrawVia = "carrier_stop" | "keyword" | "unsubscribe_link" | "staff";
export type ReplyIntent = "confirm" | "change" | "cancel";

/** Fixed text sent inside the patient's own conversation when a reply was relayed. Never "you're confirmed". */
export const PASSED_TO_CLINIC = "Thanks, we've passed this to the clinic.";

export interface BridgeHooks {
  /** Bridge mode: the EHRM owns reminders and outreach for this clinic. */
  enabled(clinicId: number): boolean;
  /** In bridge mode, may staff or the receptionist answer in this conversation on this channel right now? */
  replyAllowed(conversationId: number, channel: Channel): boolean;
  /** Relays a withdrawal to the EHRM (queued as consent.withdrawn events). */
  withdrawn(clinicId: number, contactId: number, channel: Channel, purposes: ("service" | "marketing")[], via: WithdrawVia, scope: "address" | "contact"): void;
  /** C / CHANGE replies: queued only on an unambiguous 48-hour match. */
  replyKeyword(clinic: Clinic, contact: Contact, channel: Channel, address: string, intent: ReplyIntent): "queued" | "no_match";
  /** Files a booking request (minimum fields). Phone, channel, kind and verified flag are set by code. */
  fileBookingRequest(args: {
    clinic: Clinic; contact: Contact; conversationId: number; channel: Channel; firstName: string | undefined;
    preferredTimes: unknown; verified: boolean; actor: string; service?: string | null;
  }): { ok: true; requestRef: string } | { ok: false; code: string; message: string };
}

const REGISTRY = new WeakMap<Db, BridgeHooks>();

export function registerBridge(db: Db, hooks: BridgeHooks): void {
  REGISTRY.set(db, hooks);
}

/** The bridge for this database, when bridge mode is on for the clinic. */
export function bridgeFor(db: Db, clinicId: number): BridgeHooks | undefined {
  const b = REGISTRY.get(db);
  return b?.enabled(clinicId) ? b : undefined;
}
