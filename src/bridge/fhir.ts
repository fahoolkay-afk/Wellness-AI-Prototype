// FHIR R4 shapes for what crosses the bridge (docs/INTEGRATION-CONTRACT.md sections 3 and 4). The wire format
// is the compact allow-listed JSON; these mappings say what each item means in FHIR terms, for export and for
// the laptop's records. FHIR is the shape of the data, not a security control.

import type { DeliveryCode } from "./events.ts";

const OUTREACH_CLASS = "urn:ehrm:outreach-class";
const CHANNEL = "urn:ehrm:channel";
const REQUEST_KIND = "urn:frontdesk:request";

/** booking.requested -> Appointment (proposed) with requestedPeriod and a contained minimal Patient. */
export function bookingRequestToFhir(e: { requestRef: string; firstName: string; phone: string; preferredTimes: { start: string; end: string }[] }): Record<string, unknown> {
  return {
    resourceType: "Appointment", id: e.requestRef, status: "proposed",
    contained: [{ resourceType: "Patient", id: "p", name: [{ given: [e.firstName] }], telecom: [{ system: "phone", value: e.phone }] }],
    requestedPeriod: e.preferredTimes.map((t) => ({ start: t.start, end: t.end })),
    participant: [{ actor: { reference: "#p" }, status: "needs-action" }],
  };
}

/** A reminder fact -> Appointment. The patient is an opaque reference; the practitioner a display name only. */
export function appointmentFactToFhir(a: { appointmentRef: string; patientRef: string; start: string; end: string; status: "booked" | "cancelled"; practitionerName: string }): Record<string, unknown> {
  return {
    resourceType: "Appointment", id: a.appointmentRef, status: a.status, start: a.start, end: a.end,
    participant: [
      { actor: { reference: `Patient/${a.patientRef}` }, status: "accepted" },
      { actor: { display: a.practitionerName }, status: "accepted" },
    ],
  };
}

/** A released outbox item -> CommunicationRequest. */
export function releaseToCommunicationRequest(i: { releaseRef: string; patientRef: string; channel: "sms" | "email" | "whatsapp"; purpose: "service" | "marketing"; text: string; releasedBy: string; releasedAt: string }, state: "waiting" | "done" | "refused"): Record<string, unknown> {
  return {
    resourceType: "CommunicationRequest", id: i.releaseRef,
    status: state === "waiting" ? "active" : state === "done" ? "completed" : "revoked",
    category: [{ coding: [{ system: OUTREACH_CLASS, code: i.purpose === "marketing" ? "marketing" : "care" }] }],
    // R4 has a standard code for written email only; SMS and WhatsApp use a clinic-local code system.
    medium: [{ coding: [i.channel === "email"
      ? { system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationMode", code: "EMAILWRIT" }
      : { system: CHANNEL, code: i.channel }] }],
    subject: { reference: `Patient/${i.patientRef}` },
    payload: [{ contentString: i.text }],
    authoredOn: i.releasedAt,
    requester: { display: i.releasedBy },
  };
}

/**
 * Front desk result or carrier status -> Communication. "completed" only when the carrier confirmed delivery;
 * accepted or sent is "in-progress" (shown on the laptop as "sent to the front desk").
 */
export function deliveryToCommunication(releaseRef: string, s: { result?: "accepted" | "refused"; status?: "sent" | "delivered" | "failed" | "not_sent"; code?: DeliveryCode | null }): Record<string, unknown> {
  const done = s.status === "delivered";
  const notDone = s.result === "refused" || s.status === "failed" || s.status === "not_sent";
  return {
    resourceType: "Communication", id: `${releaseRef}-delivery`,
    status: done ? "completed" : notDone ? "not-done" : "in-progress",
    ...(notDone && s.code ? { statusReason: { coding: [{ system: "urn:frontdesk:delivery-code", code: s.code }] } } : {}),
    basedOn: [{ reference: `CommunicationRequest/${releaseRef}` }],
  };
}

/** appointment.confirmed -> AppointmentResponse. Identity rests on the number on file (open decision 4). */
export function confirmToFhir(e: { id: string; appointmentRef: string; patientRef?: string }): Record<string, unknown> {
  return {
    resourceType: "AppointmentResponse", id: e.id, appointment: { reference: `Appointment/${e.appointmentRef}` },
    participantStatus: "accepted", ...(e.patientRef ? { actor: { reference: `Patient/${e.patientRef}` } } : {}),
    comment: "Patient replied from the address on file; identity rests on that address.",
  };
}

/** appointment.change_requested -> Communication from the patient about the appointment, with no payload text. */
export function changeRequestToFhir(e: { id: string; appointmentRef: string; intent: "change" | "cancel" }): Record<string, unknown> {
  return {
    resourceType: "Communication", id: e.id, status: "completed",
    category: [{ coding: [{ system: REQUEST_KIND, code: e.intent }] }],
    about: [{ reference: `Appointment/${e.appointmentRef}` }],
  };
}
