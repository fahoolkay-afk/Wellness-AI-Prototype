// Consent per person, per channel, per purpose. One table, append-only history: the latest row wins.
//
//   service   - reminders, confirmations, booking follow-ups. Sent only on a channel the patient used with
//               the clinic themselves, or one staff/the EHRM recorded consent for. Never "fall back" to a
//               channel the patient didn't agree to.
//   marketing - campaigns, recalls, review requests, re-engagement. Express consent only (PHIPA s.33 for
//               using health information in marketing; CASL s.6 and s.10 for the message itself).
//
// A withdrawal on a channel ("STOP", "unsubscribe", "please stop texting me") stops everything on that
// channel. Shaped so it exports directly as a FHIR R4 Consent resource.

import type { DatabaseSync } from "node:sqlite";
import type { Channel } from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY,
  clinic_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  basis TEXT NOT NULL,
  source TEXT NOT NULL,
  text_version TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS consents_contact ON consents(contact_id, channel, purpose, id);
`;

export type ConsentPurpose = "service" | "marketing";
export type ConsentStatus = "granted" | "withdrawn";
/**
 * inbound: the patient contacted the clinic on this channel. staff: recorded by staff (e.g. intake form).
 * express: the patient explicitly agreed to marketing. keyword/link: STOP/START or an unsubscribe link.
 * ehr: synced from the clinic's records system.
 */
export type ConsentBasis = "inbound" | "staff" | "express" | "keyword" | "link" | "ehr";

export interface ConsentRow {
  id: number;
  clinic_id: number;
  contact_id: number;
  channel: Channel;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  basis: ConsentBasis;
  source: string;
  text_version: string | null;
  recorded_by: string;
  recorded_at: string;
}

export type SendPurpose = "reply" | ConsentPurpose;

export class Consents {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(SCHEMA);
  }

  record(c: { clinicId: number; contactId: number; channel: Channel; purpose: ConsentPurpose; status: ConsentStatus; basis: ConsentBasis; source: string; textVersion?: string | null; by: string }): void {
    this.db.prepare(
      `INSERT INTO consents (clinic_id, contact_id, channel, purpose, status, basis, source, text_version, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(c.clinicId, c.contactId, c.channel, c.purpose, c.status, c.basis, c.source.slice(0, 200), c.textVersion ?? null, c.by);
  }

  latest(contactId: number, channel: Channel, purpose: ConsentPurpose): ConsentRow | undefined {
    return this.db.prepare(
      "SELECT * FROM consents WHERE contact_id = ? AND channel = ? AND purpose = ? ORDER BY id DESC LIMIT 1",
    ).get(contactId, channel, purpose) as ConsentRow | undefined;
  }

  history(contactId: number): ConsentRow[] {
    return this.db.prepare("SELECT * FROM consents WHERE contact_id = ? ORDER BY id").all(contactId) as unknown as ConsentRow[];
  }

  /** Records that the patient reached out on this channel (implied consent for service replies on it). */
  noteInbound(clinicId: number, contactId: number, channel: Channel): void {
    const current = this.latest(contactId, channel, "service");
    // An SMS STOP is lifted only by START (carrier rule); other channels re-open when the patient writes again.
    if (current?.status === "withdrawn" && channel === "sms") return;
    if (current?.status === "granted") return;
    this.record({ clinicId, contactId, channel, purpose: "service", status: "granted", basis: "inbound", source: `patient messaged on ${channel}`, by: "system" });
  }

  withdraw(clinicId: number, contactId: number, channel: Channel, source: string, basis: ConsentBasis, by: string): void {
    for (const purpose of ["service", "marketing"] as const) {
      if (this.latest(contactId, channel, purpose)?.status === "withdrawn") continue;
      this.record({ clinicId, contactId, channel, purpose, status: "withdrawn", basis, source, by });
    }
  }

  /**
   * May the clinic send this kind of message on this channel?
   * reply: answering a message the patient just sent (allowed unless they stopped this channel).
   */
  check(contactId: number, channel: Channel, purpose: SendPurpose): { ok: true } | { ok: false; reason: string } {
    const service = this.latest(contactId, channel, "service");
    if (service?.status === "withdrawn") return { ok: false, reason: `Patient opted out of ${channel} messages` };
    if (purpose === "reply") return { ok: true };
    if (purpose === "service") {
      return service?.status === "granted" ? { ok: true } : { ok: false, reason: `No consent on record to send ${channel} reminders to this patient` };
    }
    const marketing = this.latest(contactId, channel, "marketing");
    if (marketing?.status === "granted" && marketing.basis === "express") return { ok: true };
    return { ok: false, reason: `No express marketing consent for ${channel}` };
  }

  /** Current state per channel, for the staff panel. */
  summary(contactId: number): Record<string, { service: ConsentStatus | "none"; marketing: ConsentStatus | "none"; since?: string }> {
    const out: Record<string, { service: ConsentStatus | "none"; marketing: ConsentStatus | "none"; since?: string }> = {};
    for (const ch of ["sms", "whatsapp", "email", "messenger", "instagram"] as Channel[]) {
      const s = this.latest(contactId, ch, "service");
      const m = this.latest(contactId, ch, "marketing");
      out[ch] = { service: s?.status ?? "none", marketing: m?.status ?? "none", since: s?.recorded_at };
    }
    return out;
  }
}

/** FHIR R4 Consent for one channel/purpose row (http://hl7.org/fhir/R4/consent.html). */
export function toFhirConsent(row: ConsentRow): Record<string, unknown> {
  return {
    resourceType: "Consent",
    id: `consent-${row.id}`,
    status: row.status === "granted" ? "active" : "inactive",
    scope: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: "patient-privacy" }] },
    category: [{ coding: [{ system: "http://loinc.org", code: "59284-0", display: "Consent Document" }] }],
    patient: { reference: `Patient/contact-${row.contact_id}` },
    dateTime: row.recorded_at,
    policyRule: { coding: [{ system: "urn:frontdesk:consent-basis", code: row.basis }] },
    provision: {
      type: row.status === "granted" ? "permit" : "deny",
      purpose: [{ system: "urn:frontdesk:purpose", code: row.purpose }],
      action: [{ coding: [{ system: "urn:frontdesk:channel", code: row.channel }] }],
    },
    ...(row.text_version ? { extension: [{ url: "urn:frontdesk:consent-text-version", valueString: row.text_version }] } : {}),
  };
}
