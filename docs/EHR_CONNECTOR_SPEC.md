# EHR Connector Spec (v1)

This is the contract between the **Front Desk** app (inbox + AI receptionist) and an
EHRM in the **EHR-connected edition** (`EDITION=ehr`). Build these endpoints into the
EHRM and the front desk will use the EHRM as the source of truth for patients,
availability and appointments.

The reference implementation is `src/ehr-mock.ts` (`npm run ehr:mock`). The client
side is `src/booking/ehr.ts`. `test/ehr.test.ts` runs the full flow against the mock;
point it at a staging EHRM to use it as a conformance test.

## Two editions, one codebase

| | Standalone (`EDITION=standalone`) | EHR-connected (`EDITION=ehr`) |
|---|---|---|
| For | Partner clinics on any (or no) practice software | Clinics running our EHRM |
| Patients | Stored in the front desk's own CRM | EHRM patient records (linked by `external_id`) |
| Availability and booking | Built-in calendar (or Jane App link-out) | EHRM `/availability` and `/appointments` |
| Appointments made by staff elsewhere | Entered in the front desk calendar | Pushed by the EHRM via webhook |
| Conversation history | Front desk only | Also logged to the patient chart |
| Reminders, follow-ups, automations | Front desk | Front desk (from the mirrored appointments) |

Everything else (the inbox, all channels, the AI receptionist, the voice agent,
automations, broadcasts) is identical in both editions.

## Conventions

- **Base URL**: `EHR_BASE_URL`, e.g. `https://ehr.example.com/api/frontdesk/v1/`.
- **Auth**: `Authorization: Bearer <EHR_API_KEY>`. Use one key per front-desk deployment and support rotation.
- **Location**: every request carries `X-Location-Id: <clinic profile ehrLocationId>`. Multi-location EHRMs scope everything to it.
- **Times**: ISO 8601 UTC (`2026-11-03T15:00:00.000Z`). Date-only params (`from`, `to`) are clinic-local `YYYY-MM-DD`.
- **IDs**: opaque strings. `serviceId` and `practitionerId` must match the ids in the clinic profile; in a later version the front desk will sync them from `GET /catalog`.
- **Errors**: JSON `{ "error": "human readable message" }`. Status codes matter:
  - `409`: slot no longer available. The AI offers other times.
  - other `4xx`: the message is shown to the AI and staff, so make it readable.
  - `5xx` or timeout (default 8 s): the AI apologizes, takes details and creates a staff task.
- **Idempotency**: `POST /appointments` includes `idempotencyKey`. Return the original appointment for a repeated key instead of creating a duplicate.

## Endpoints the EHRM implements

### `GET /patients/lookup?phone=`
Find a patient by E.164 phone (`+14165550123`). Phone only: an email address typed into a chat proves
nothing about who is writing, so the front desk never looks patients up by email.
```json
{ "patient": { "id": "pat_123", "firstName": "Priya", "lastName": "Sharma", "phone": "+14165550123", "email": "priya@example.com" } }
```
Return `{ "patient": null }` when there is no match. Only return a patient on an exact match; never guess.

### `POST /patients`
Creates a patient when the lookup finds nobody. Body:
```json
{ "firstName": "Priya", "lastName": "Sharma", "phone": "+14165550123", "email": null, "source": "front-desk-ai" }
```
Response `201`: `{ "patient": { ...same shape as lookup } }`. The EHRM may flag these as "new, unverified" until intake is completed.

### `GET /availability`
Query: `serviceId` (required), `from` (required, local date), `to`, `practitionerId`, `timeOfDay` (`morning|afternoon|evening|any`), `limit`.
```json
{ "slots": [ { "practitionerId": "pr-maya", "serviceId": "physio-initial", "start": "2026-11-03T14:00:00.000Z", "end": "2026-11-03T15:00:00.000Z" } ] }
```
Apply all EHRM rules here (practitioner schedules, breaks, room or equipment limits, online-booking restrictions, minimum notice). The front desk only offers what this returns.

### `POST /appointments`
```json
{ "patientId": "pat_123", "serviceId": "physio-initial", "practitionerId": "pr-maya",
  "start": "2026-11-03T14:00:00.000Z", "notes": "Lower back pain, first visit", "source": "ai:whatsapp",
  "idempotencyKey": "1:42:pr-maya:2026-11-03T14:00:00.000Z" }
```
Response `201`: `{ "appointment": Appointment }`. Return `409` if the slot was taken.

`Appointment`:
```json
{ "id": "apt_789", "patientId": "pat_123", "serviceId": "physio-initial", "practitionerId": "pr-maya",
  "start": "2026-11-03T14:00:00.000Z", "end": "2026-11-03T15:00:00.000Z",
  "status": "booked", "notes": "..." }
```
`status` is one of `booked | cancelled | completed | no_show`.

### `PATCH /appointments/{id}`
Reschedule: `{ "start": "...", "practitionerId": "pr-maya" }`. Response: `{ "appointment": Appointment }`. Return `409` if the new time is unavailable.

### `POST /appointments/{id}/cancel`
`{ "reason": "Patient is sick" }`. Response: `{ "appointment": Appointment }` with `status: "cancelled"`. Apply the EHRM's late-cancellation fee logic here.

### `GET /patients/{id}/appointments?upcoming=true`
`{ "appointments": [Appointment, ...] }`, soonest first.

### `POST /patients/{id}/communications`
Logs each message to the patient chart (both directions, all channels):
```json
{ "channel": "whatsapp", "direction": "in", "body": "Can I move my appointment?", "occurredAt": "2026-11-01T18:22:05.000Z" }
```
Response `201`. This is best effort: failures are logged and never block messaging.

## Webhooks the EHRM sends to the front desk

`POST {FRONT_DESK_URL}/webhooks/ehr` with three headers:

| Header | Value |
|---|---|
| `X-EHR-Key-Id` | the key id printed by `npm run cli -- pair-ehr <clinicId> <locationId>` |
| `X-EHR-Timestamp` | Unix seconds when you signed |
| `X-EHR-Signature` | `sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" using that key's secret>` |

Each clinic location has its own key. The front desk picks the clinic from the key, not from the body,
refuses a body whose `locationId` doesn't match the key, refuses timestamps more than 5 minutes old,
and applies each event `id` once (replays are acknowledged and ignored).

Send these when something changes on the EHRM side (staff booked at the desk, a practitioner
cancelled, a visit was marked complete), so reminders and follow-ups stay correct:

```json
{ "id": "evt_01J9ZK3", "type": "appointment.created", "locationId": "loc-harbourfront",
  "appointment": { ...Appointment },
  "patient": { "id": "pat_123", "firstName": "Priya", "lastName": "Sharma", "phone": "+14165550123", "email": null } }
```
- `type`: `appointment.created | appointment.updated | appointment.cancelled | appointment.completed | patient.updated`
- `id`: unique per event (6 to 100 characters of letters, digits, `.`, `:`, `_`, `-`). Reuse it on retries.
- A phone or email change in `patient.updated` waits for staff approval in the front desk before it is used.
- Include `patient` whenever the front desk might not know them yet (always is simplest).
- Retry on non-2xx with backoff. The front desk upserts by id, so redelivery is safe.

## Planned for v2

- `GET /catalog`: services, practitioners and hours, so the clinic profile syncs automatically.
- Staff single sign-on from the EHRM into the front desk.
- Embedding: the EHRM opens a patient's front-desk thread in an iframe or side panel using a signed link.
- Waitlist: `POST /waitlist` so the AI can offer cancellation slots to waiting patients.
- Intake forms and payment links sent through the patient's messaging channel.

## Security notes

- The front desk stores only what it needs to message and book: name, phone, email, social ids, appointment times and the conversation. Clinical notes stay in the EHRM.
- Use TLS everywhere, rotate keys, and restrict the API key to these endpoints.
- Keep the EHRM and the front desk in the same data region (Canada for Canadian clinics) where provincial law or clinic policy requires it.
