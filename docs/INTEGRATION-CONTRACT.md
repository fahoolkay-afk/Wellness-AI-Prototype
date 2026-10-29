# Front desk, records system and brain: how they connect

Integration contract v1.1, 2026-10-29 (v1 plus the fixes from the adversarial privacy and security review, listed in section 11). Written for the clinic owner and for the two build teams (front desk team, records team).

This document replaces the direction rules in `docs/EHR_CONNECTOR_SPEC.md`. That spec assumed the cloud calls the records system. It does not. Read it only for the webhook signing scheme, which is reused here.

Every item is marked:

- **BUILT-NOW**: built in this round, with tests, by two engineers in one sitting.
- **LATER**: designed here, not built. Nothing BUILT-NOW depends on it.

The three systems stay separate applications. They share no database, no login, no code and no network listener. The only thing joining them is the bridge described below.

---

## 1. The picture

```
   PATIENT  (WhatsApp, SMS, email, Messenger, Instagram, phone)
      |  ^
      v  |
+--------------------------------------------------------------+
| FRONT DESK  (cloud, Wellness-AI-Prototype)                   |
|  inbox, voice agent, CRM.  Keeps message and call text for   |
|  the clinic's retention period. Never connects to the laptop.|
|                                                              |
|  /bridge/v1/appointments   <-- reminder facts (min. fields)  |
|  /bridge/v1/outbox         <-- released messages, 1 by 1     |
|  /bridge/v1/inbox          --> events, pulled by the laptop  |
|  /bridge/v1/inbox/ack      <-- "applied, delete them"        |
+--------------------------------------------------------------+
        ^   ^                         |
        |   |  HTTPS, signed,         |  response bodies only,
        |   |  started by the laptop  |  signed too: codes, ids,
        |   |  (outbound only,        |  times, first name, phone
        |   |   no redirects)         |  + "verified" yes/no
        |   |                         v
========|===|===========  INTERNET / CLINIC FIREWALL  ==========
        |   |      (nothing on the internet can open a connection
        |   |       to the laptop; there is no port, no tunnel)
+-------+---+--------------------------------------------------+
| EHRM RECORDS SYSTEM  (clinic laptop, 127.0.0.1 only)         |
|   bridge.mjs: outbound-only client, off by default,          |
|   owner-enabled, one device capability per job               |
|                                                              |
|   patients, appointments, consent, outreach (release),       |
|   booking_requests, audit (hash-chained)                     |
|                                                              |
|   ##################  BRAIN WALL (N4)  ##################    |
|   #  buildExportPayload -> doorman -> brain-case/2        #   |
|   #  codes only.  Reads cases, pain_points, scores,       #   |
|   #  case_token, sheet codes.  NEVER reads outreach,      #   |
|   #  booking_requests, bridge tables, hep_logs.           #   |
|   #  BRAIN: brain-plan/1 -> Gate 2 sign -> card + email   #   |
|   #  DRAFT (stay on the laptop; "nothing sent")           #   |
|   ########################################################   |
+--------------------------------------------------------------+
            Jane (legal record): copied by hand. No arrow. (N1)
            Reach, MedConsult: no arrow. Not connected.
```

What crosses each arrow:

| Arrow | Who starts it | What crosses | What never crosses |
|---|---|---|---|
| Laptop -> `POST /bridge/v1/appointments` | Laptop | for future visits only: opaque appointment ref, opaque patient ref, start, end, status (`booked` or `cancelled` only), practitioner display name, patient first name; or a bare "remove this ref" | service name, notes, reception note, fee, insurer, cancel reason, last name, DOB, age or minor flag, whether the patient came, did not come or arrived (`fulfilled`, `noshow`, `arrived`), past visits |
| Laptop -> `POST /bridge/v1/outbox` | Laptop | one released message: release ref, patient ref, channel, purpose, final text, subject (email only), first name, the one delivery address for that channel, consent fact for that channel and purpose, released-by display name, released-at | the plan card, the email draft body, the `/x/<token>` exercise link, any other address of the patient, anything not released, anything released before the bridge was switched on or released without a named send channel |
| Laptop <- `GET /bridge/v1/inbox` response (signed by the front desk; the laptop refuses an unsigned or redirected response) | Laptop (it pulls) | events as codes: booking request (first name, phone, verified flag, preferred times, kind), confirm, change/cancel request, consent withdrawal, delivery status | message text, call transcripts, call summaries, voice notes, AI replies, "reason for visit", service or visit type |
| Laptop -> `POST /bridge/v1/inbox/ack` | Laptop | event ids it applied | nothing else |
| Anything -> brain | nobody | only codes typed by the practitioner on the coded sheet | everything from the cloud, all of it, always |

---

## 2. Roles of the three systems

| System | Owns | Does not own |
|---|---|---|
| Front desk (cloud) | Talking to patients on every channel. Carrier and Meta rules (STOP, 24-hour window). Call handling, transcripts, recordings. Its own send-time consent check. Delivery status. | Reminders and outreach (EHRM owns them). Starting any conversation with a patient: in bridge mode staff and the receptionist may only answer a patient who wrote or called first (section 4.1). Appointment truth. Any clinical record. Any standing consent grant (the EHRM's consent fact is used for one item only). |
| EHRM (laptop) | Patients, appointments, the schedule. Consent of record. Every business-initiated message: a practitioner releases it one by one. Booking request inbox. Audit of record. | Talking to patients directly on cloud channels. Any listening network port. |
| Brain (inside EHRM) | Deterministic exercise plan from codes. Gate 1 (signed note) and Gate 2 (signed plan) cannot be skipped. | Any input from the bridge. Any sending. |

---

## 3. Flows

Each step names: **system**, **endpoint or function**, **fields**, **consent checked**, **audit row**, **FHIR R4 shape**.

### Flow A. Patient asks to book on WhatsApp

1. **Front desk.** Meta webhook delivers the inbound WhatsApp message. `Inbox` stores the text encrypted (`messages`), records `consents.noteInbound(whatsapp, service, basis inbound)`. Consent: none needed to receive. Audit: existing inbound row (ids only). FHIR: none. *(existing)*
2. **Front desk.** Staff (or the AI receptionist, only where the clinic already has it switched on) gathers: preferred times, first name, and confirms the number is the patient's. A reply inside the 24-hour window is a reply, checked by `Inbox.sendProblem`. **BUILT-NOW change:** for a clinic in bridge mode, `book_appointment` in `src/ai/tools.ts` no longer books. It files a booking request and says "your request is in; the clinic will confirm a time." The tool stops asking for "reason for visit", service type, age, date of birth or insurance. This reduces what the AI can do; it does not depend on Gate 0. The receptionist's tool arguments can only supply first name and preferred times: `phoneVerified`, `channel`, `kind` and the phone number are set by front desk code from the conversation record, never from what the model (or the patient, through the model) says. **BUILT-NOW:** a staff action in the inbox, `POST /api/conversations/:id/booking-request` (staff session), does the same by hand.
3. **Front desk.** Writes one row to `bridge_queue` (new table): `type=booking.requested`. Fields: `eventId`, `requestRef` (random, `brq_` + 22 chars), `kind` (`new`), `firstName` (max 40), `phone` (E.164) or `whatsappId`, `phoneVerified` (true only if `sender_verified` or an OTP check passed), `preferredTimes` (up to 3 ISO intervals), `channel` (`whatsapp`). No service or visit type (a service name such as "concussion" or "pelvic health" is health information; the desk asks on the laptop when it converts). No slot is held. No text from the conversation. The queue row's payload is encrypted at rest with the front desk vault, like message text. Consent: none (it is the patient's own request). Audit: `bridge.queue.add` target `conversation:<id>`, outcome ok, no name or number. FHIR: `Appointment` with `status: "proposed"`, `requestedPeriod[]`, and a contained `Patient` holding `name[0].given[0]` and one `telecom`.
4. **EHRM.** `bridge.mjs` tick (every 60 s when enabled) calls `GET /bridge/v1/inbox?after=<cursor>`. Device capability `bridge.pull_inbox`. Audit: `bridge.pull` reason `events=<n>` actor_type `device`.
5. **EHRM.** Applies the event through the same insert logic as `POST /api/booking-requests`, called internally with `source='cloud_receptionist'`, `external_ref=<requestRef>` (the unique `(source, external_ref)` index makes it apply once), contact fields encrypted, note empty. It is a plain function call with `actor = { type: 'device', id, capability }`: the bridge never goes through the HTTP route, never builds a staff session or cookie, and never borrows a user id (N3). Device capability `booking_request.insert`. Consent: none. Audit: `booking_request.create` actor_type `device`, counts and ids only. FHIR: none locally.
6. **EHRM.** `POST /bridge/v1/inbox/ack` with the event ids it has finished with, sent only after its own database write has committed. An event that was refused on the laptop (unknown ref, wrong shape, rate cap) is acked too, with a local audit row naming the refusal code; an event that failed for a temporary reason (database busy) is not acked and comes back on the next pull. Front desk deletes acked rows. Audit on both sides: `bridge.ack` with `count`.
7. **EHRM, staff.** Desk converts the request with the existing `POST /api/booking-requests/:id/convert` (staff session, `schedule.write`, `bookingCheck`). Nothing new.
8. **EHRM.** The new appointment is pushed as reminder facts (Flow B step 2), so the front desk knows the time.
9. **EHRM, practitioner.** The confirmation message is an outreach proposal with template `booking_confirmed` (BUILT-NOW template), channel `whatsapp`, purpose `service`. It is released one by one (Flow B steps 3 to 8). Until it is released, the patient hears nothing from the business. The front desk shows staff "request sent to the clinic, waiting for release."

Decline: the existing decline route. A decline message, if any, is also a released outreach item. **LATER:** a `booking.request_closed` status event back to the front desk so the conversation shows "handled".

### Flow B. Appointment reminder owned by the EHRM

1. **EHRM.** An appointment is booked, moved or cancelled. Nothing is sent.
2. **EHRM -> Front desk.** `bridge.mjs` pushes changed appointments to `POST /bridge/v1/appointments`. Capability `appointments.push_facts`. Fields per item: `appointmentRef`, `patientRef`, `start`, `end`, `status` (`booked|cancelled` only), `practitionerName` (display name, e.g. "Sam"), `firstName`, `version` (integer). Only visits that start in the future (up to 60 days ahead) are pushed. When a visit ends, is marked arrived, fulfilled or no-show, or is deleted, the laptop sends `{ appointmentRef, version, removed: true }` and the front desk deletes its mirror row: whether a patient came or did not come is never told to the cloud. No service, no notes, no fee. Consent: none (no message is sent). Audit EHRM: `bridge.push_appointments` reason `count=<n>`. Audit front desk: `bridge.appointments.upsert` per appointment, ids only. FHIR: `Appointment` (`status`, `start`, `end`, `participant[]` with `actor.display` for the practitioner and an opaque reference for the patient). Front desk stores it with `service_id=NULL`, `notes=NULL`, `created_via='bridge'`, and fires **no** automation (bridge-mode clinics have reminders, follow-ups, recall and campaigns switched off, BUILT-NOW).
3. **EHRM, practitioner.** Proposes a reminder with the existing `POST /api/patients/:id/outreach`, template `appt_reminder` (BUILT-NOW: "Hi {first_name}, a reminder of your visit on {day} at {time} with {practitioner}. Reply C to confirm or CHANGE to ask for a new time."), new field `channel` (`sms|email|whatsapp`), class `care`. The purpose (`service` or `marketing`) comes from the template's class, never from a free choice on the form. Runs unchanged `guardPatientFacing(claimWords)` and `guardClinical` over the body **and** the email subject. Consent: `outreachConsentNeeds` extended per channel (sms -> `consent_sms`, email -> `consent_email`, whatsapp -> new `consent_whatsapp`). WhatsApp marketing consent never counts (N5). **Minors (BUILT-NOW, laptop only):** if the patient is under 16 on the EHRM record, or has a substitute decision-maker on file, a cloud channel item can only be proposed when the consent row records who gave it (the capable patient or the substitute decision-maker) and the address on file belongs to that person; otherwise it is refused `minor_review`. Purpose `marketing` is refused for anyone under 18. The age itself never leaves the laptop. Audit: existing `outreach.propose`.
4. **EHRM, practitioner.** Releases with the existing `POST /api/outreach/:id/release`. Consent re-checked for that channel. **BUILT-NOW change:** for an item with a cloud `channel`, the release screen names the channel and the masked address ("will be sent by WhatsApp to +1 613 ••• 0100") and the release record stores `release_mode='send'`; the audit reason says "released for sending by <channel>", not "nothing sent". An item released before this change, or released with no channel (print and in-clinic use), keeps `release_mode='record'` and can never be pushed: releasing under "nothing sent" wording is not consent to send. Audit: existing `outreach.release`. **LATER (owner decision):** whether the desk may release reminders, or whether a fixed pre-approved reminder template counts as release. Until decided, only the proposing practitioner releases, one by one.
5. **EHRM.** `bridge.mjs` selects `outreach` rows with `status='released' AND release_mode='send' AND channel IS NOT NULL AND pushed_at IS NULL AND released_at >= bridge_enabled_at`. At push time it re-checks: channel consent for that exact channel and purpose still granted, guard still passes on body and subject, minors rule still passes, body has no `/x/`, no `127.0.0.1`, no `localhost`, no private-network host, no URL outside the clinic's allow-list; the address on file is the same one shown at release; the release is less than 7 days old; for an item tied to an appointment, the appointment is still `booked`, still in the future and its `version` is the one current at release (a reminder released for a visit that has since moved or been cancelled is never sent). Any failure: row gets `delivery_status='held'` with a code (`consent_missing`, `wording`, `minor_review`, `address_changed`, `stale_release`, `link_not_allowed`), nothing is sent, and the practitioner must propose and release again. `pushed_at` is set in the same transaction as the push result, and a restored or copied database never resets it. Capability `outreach.push_released`.
6. **EHRM -> Front desk.** `POST /bridge/v1/outbox` with the item (fields in section 4). Audit EHRM: `bridge.push_released` target `outreach:<id>`, no text, no address. FHIR: `CommunicationRequest` (`status: active` while waiting, then `completed` once a `Communication` exists or `revoked` if refused or held; `category` from a clinic-local code system `urn:ehrm:outreach-class` with codes `care|marketing`, not an HL7 code; `medium` = v3 `ParticipationMode` `EMAILWRIT` for email and a clinic-local code `urn:ehrm:channel#sms|whatsapp` for the others, because R4 has no standard code for them; `payload[0].contentString` = released text; `subject` opaque; `authoredOn` = released-at; `requester.display` = released-by, taken from the signed release record, never settable by the bridge).
7. **Front desk.** For each item: verify; claim `releaseRef` once; match the contact by `patientRef` (`external_id`, unique per clinic), else create one with first name and that one address. Never merge two `patientRef`s into one contact because they share a phone or email (a parent's phone is often on a child's file); each gets its own contact and thread. If the stored address for that `patientRef` differs, do not overwrite: create a contact proposal and refuse the item `address_pending_review`. **Send-time consent check:** the carried consent fact must have exactly the item's `channel` and `purpose`, `status: granted`, a `recordedAt` not in the future, and, for `purpose=marketing`, `express: true`; then the front desk ledger and its suppression lists (carrier STOP, unsubscribes, Meta opt-outs) must hold no withdrawal for that address, channel and purpose newer than `recordedAt` (withdrawal wins). The fact is stored as evidence attached to this one release, with basis `ehr`; it is **not** written as a standing grant in the cloud consent ledger, so no other cloud sender (campaign, funnel, follow-up, a later bridge-off clinic) can ever rely on it. Then call `Inbox.sendProblem` with **`DEFAULT_WORDING_RULES` pinned** (a clinic setting cannot loosen it) over body and subject, and the channel fixed (no fallback to another channel, N5). If it passes, `Inbox.deliver` on exactly that channel. If the provider queues and retries, the retry re-runs the consent check first. Never edits text: refuses instead. Cloud staff cannot edit, forward or re-send a bridge item. Audit: `bridge.outbox.deliver` or `bridge.outbox.refuse` target `release:<releaseRef>` with a reason code, no address, no text.
8. **Front desk -> EHRM.** Result per item in the response (`accepted` or `refused` + code). `accepted` means "handed to the sending service", never "delivered": the EHRM shows it as "sent to the front desk". Later statuses are queued as `delivery.status` events with a per-item increasing `seq`; the laptop ignores a status older than the one it holds. FHIR `Communication` mapping, fixed: refused at the front desk -> `not-done` with `statusReason` = refusal code; accepted or `sent` -> `in-progress`; `delivered` -> `completed`; `failed` or `undelivered` -> `not-done` with the carrier code. `completed` is never used for anything the carrier has not confirmed as delivered. `basedOn: CommunicationRequest/<releaseRef>`.
9. **EHRM.** Pulls the status event, writes `outreach.delivery_status` and `delivery_at`. Capability `outreach.write_status`. Audit: `bridge.status` target `outreach:<id>`.

WhatsApp outside the 24-hour window needs an approved Meta template. BUILT-NOW: refused with code `window_closed`; the practitioner sees it and may release on another channel with its own consent. **LATER:** Meta template mapping.

### Flow C. Patient replies C, CHANGE, STOP or CANCEL

1. **Front desk.** Inbound reply. `Inbox.handleKeywords` runs first, as today.
   - **STOP / CANCEL on SMS** (carrier keywords): carrier rule wins. The front desk withdraws SMS consent at once and sends only the carrier-required acknowledgement. Queue two `consent.withdrawn` events (`channel=sms`, one with `purpose=service`, one with `purpose=marketing`) for **every** `patientRef` linked to that number in that clinic (a shared family phone withdraws for all of them). It is never read as "cancel my appointment" (existing ambiguity task kept for staff).
   - **Generic revoke on WhatsApp/email/etc.:** withdraw that channel; queue `consent.withdrawn` for that channel, both purposes, every linked `patientRef`.
   - **Unsubscribe link:** withdraw marketing; queue `consent.withdrawn` (`purpose=marketing`).
   - **C / confirm:** a reply is tied to an appointment only when exactly one bridge item was delivered to that exact address and channel in the last 48 hours and it carried an `appointmentRef`. Then queue `appointment.confirmed` with that `appointmentRef`, and mark the mirror "confirmation sent to the clinic" (not "confirmed": the laptop may refuse, and its next push is the truth). If two patients share the address, or nothing matches, no event is queued and staff triage it. Any automatic answer to the patient is a fixed reply inside the open conversation, "Thanks, we've passed this to the clinic.", never "you're confirmed".
   - **CHANGE** (and "cancel my appointment" on a non-SMS channel, or after staff triage): same matching rule; queue `appointment.change_requested` with `intent=change|cancel`. Nothing is cancelled automatically.
   Audit: `bridge.queue.add` with type and ids. FHIR: `Consent` via the existing `toFhirConsent`, which for a withdrawn row is fixed this round to emit `status: inactive` with the original `provision.type: permit` (the permission is no longer in force); v1 emitted `inactive` plus `deny`, a double negative that a reader can take as "the refusal is inactive", that is, as permission. Confirm: `AppointmentResponse` with `participantStatus: accepted` and `actor` = the opaque patient reference, plus a note that identity rests on the number on file (open decision 4). Change/cancel: **not** an `AppointmentResponse` (`tentative` means "tentatively accepted", which a cancel request is not); it is a `Communication` from the patient with `about: Appointment/<ref>`, a clinic-local category code `urn:frontdesk:request#change|cancel`, and no payload text.
2. **EHRM.** Pulls (Flow A step 4). Applies:
   - `appointment.confirmed`: same state logic as portal confirm, `confirmed_via='bridge'`. Refusals are the same as staff `setStatus` (`already_set`, `cancelled`, `no_show`, `already_arrived`, `not_future`); a refusal is acked and logged, not retried. Capability `visit.confirm_by_patient`. Audit `schedule.confirm` actor_type `device`, reason "by patient reply".
   - `appointment.change_requested`: a `booking_requests` row with new columns `kind` (`change|cancel`) and `appointment_id`, `source='cloud_receptionist'`, `external_ref=<eventId>`. Desk handles it with existing routes. Capability `booking_request.insert`.
   - `consent.withdrawn`: `recordConsent` withdraw for that field (`consent_sms`, `consent_email`, `consent_whatsapp`, or the marketing channel field) with method `patient_reply`. Withdrawing marketing cascades as today. Capability `consent.withdraw_relay`. This capability can only withdraw, never grant. Audit: existing consent audit, actor_type `device`.
3. **EHRM.** Ack. Front desk deletes the events.

Identity: a "C" from the number on file is treated as the patient for confirm only. Cancelling an appointment on a reply is never automatic (open decision 4).

### Flow D. Brain plan signed, then a "plan ready" note

1. **EHRM, brain.** Gate 1 (signed note) and Gate 2 (`POST /api/brain/plans/:id/sign`) unchanged. Card and email draft stay on the laptop, encrypted, "nothing sent". Signing creates no outreach row, no queue row, nothing (N6).
2. **EHRM, practitioner.** The card and the email draft are clinical (findings, history cautions, red-flag actions). They fail `guardClinical` and must not reach the cloud. So the email draft itself is **never** released to the cloud. Instead, the practitioner may propose template `plan_ready` (BUILT-NOW, fits the existing outreach path): "Hi {first_name}, your exercise plan from today is ready. Pick up your printed card at the desk or ask us at your next visit. {practitioner}". Proposal allowed only if the same practitioner has a signed plan for the patient (new nullable `outreach.plan_id`, checked against `brain_plans` signed by that user). The link is one-way: outreach reads only "is there a plan signed by this user for this patient"; nothing in `brain.mjs`, the doorman or `buildExportPayload` reads `outreach`, and `plan_id` itself never crosses to the cloud. The template text names no condition and no body part. Same guards, same per-channel consent, same one-by-one release (signing the plan releases nothing, N6).
3. **EHRM -> Front desk -> patient.** Same outbox path as Flow B steps 5 to 9.
4. **Exercise link.** The `/x/<token>` link opens only on the clinic computer (`publicBase` is `127.0.0.1`) and the token is a bearer key to clinical content. **NOT BUILT.** Push-time and cloud-side checks refuse any body containing `/x/` or a loopback address. The `hep_nudge` template cannot be released on a cloud channel. To make it phone-reachable needs an owner custody decision (open decision 5) and a `delivery_ref` that is not the token. **LATER.**
5. **Adherence.** If ever: fixed quick-reply buttons only (done / skipped / score 0-10). The cloud keeps `{deliveryRef, code}`. The laptop pulls with its own capability `hep.log_relay` into `hepLog(via='whatsapp')`. Free text is never parsed into codes. `buildExportPayload` and `flagsForCase` never read `hep_logs`, so it cannot reach the brain. **LATER.** It never becomes a doorman key or an automatic flag.
6. Brain-derived patient content stays off for real records until Ryan re-signs `brain-recipes.sig.json`.

### Flow E. A phone call to the voice agent

1. **Front desk.** Call comes in (ElevenLabs agent, Twilio number). Opening line includes the disclosure placeholder (see open decision 1). Call record in `calls`: from/to number, direction, duration, outcome, handled_by, summary and full transcript, encrypted at rest. ElevenLabs is an agent/processor under PHIPA s.17. *(existing)*
2. **Front desk, stays in the cloud:** transcript, summary, recording (if any), voice message in the thread. Purged after the call retention (default 30 days, `purgeOlderThan`). Never queued, never pushed, never in audit rows, never in application logs or error reports. **BUILT-NOW for bridge clinics:** the call summary is limited to the administrative outcome (booking request, callback, question answered, other) and must not restate symptoms or history; anything clinical the caller says lives only in the encrypted transcript until purge. Copies held by ElevenLabs and Twilio follow the same 30 days or less (their retention settings are part of open decision 3; until confirmed, call recording stays off).
   No outbound calls: in bridge mode the voice agent only answers. Calling a patient is business-initiated and needs the `voice` purpose and a release (LATER).
3. **Front desk -> EHRM (via pull):** only one of
   - `booking.requested` with `kind=new` (same as Flow A step 3, `channel=voice`). **BUILT-NOW** (same tool).
   - `booking.requested` with `kind=callback`: first name, phone, `phoneVerified=false` unless an OTP passed, preferred callback window. **LATER** (needs a separate voice tool; until then staff use the inbox action from Flow A step 2).
   No transcript text, no summary, no "reason".
4. **Front desk staff view.** The calls screen shows who called whom (from/to, direction), duration, outcome, handled_by, summary and transcript, for staff with the right role, until purge. *(existing plus the in-progress `direction/to_number/handled_by` work in the working tree.)*
5. **Consent.** Today calls are transcribed on notice only. New purposes `voice`, `call_recording`, `transcription` are **LATER** (front desk `ConsentPurpose` and EHRM `CONSENT_TEXTS`). Until they exist, the bridge never treats voice as a sending channel: `channel=voice` is refused in `/bridge/v1/outbox`.

---

## 4. The bridge: exact HTTP contract (BUILT-NOW)

### 4.1 Where it lives

- **Front desk:** new router `src/bridge/` mounted at `/bridge/v1` in every edition, active per clinic only when `clinic_integrations.bridge_enabled = 1`. It does not use `/api` sessions (N3) and does not require `EDITION=ehr`. `EhrClient` and `logCommunication` are switched off for bridge clinics; `logCommunication` is a no-op when bridge mode is on (it pushes message bodies into the chart). **`/webhooks/ehr` refuses (403, audited) every request for a bridge clinic**: that older route accepts last name, email and full appointment objects and fires automations, so leaving it open next to the bridge would be a second, wider door.
- **Front desk, bridge mode also means (BUILT-NOW):** reminders, follow-ups, recall, campaigns, funnel auto-messages and voice outbound calls are off; staff and the AI receptionist can send only a reply inside a conversation the patient started (WhatsApp: inside Meta's 24-hour window; SMS and email: within 24 hours of the patient's last inbound message). Starting a new conversation, or writing after that, is refused with `use_ehrm_release`: the practitioner proposes and releases it in the EHRM. Request and body logging is off for `/bridge/v1` (only method, path, status, duration and key id are logged).
- **EHRM:** new module `bridge.mjs` in `roles-demo`. Outbound HTTPS only (`fetch` with `redirect: 'error'`, so a response can never bounce the laptop to another host, including its own `127.0.0.1` server), never listens, no new route reachable from outside (the server stays `127.0.0.1`, `allowedHosts` stays unset, N7). Off by default. Started inside the server process only when the owner has enabled it. Zero npm dependencies. It refuses any response that is not `200` JSON, larger than 1 MB, unsigned or wrongly signed (4.3), or that has an unknown key (same allow-lists as 4.4, checked again on the laptop). Its error log and `GET /api/bridge/status` hold codes only, never a response body (bodies carry names and phone numbers).

### 4.2 Pairing and keys

- **Front desk:** extend `clinic_integrations` with its **own** bridge key: `bridge_key_id`, `bridge_secret` (sealed by the vault), `bridge_location_id`, `bridge_enabled INTEGER DEFAULT 0`, `bridge_paired_at`. The bridge never reuses `ehr_key_id` / `ehr_secret`: a key that also opened `/webhooks/ehr` would let one leaked secret use the wider route. CLI: `npm run cli -- pair-bridge <clinicId> <locationId>` prints key id and secret once, sets `bridge_enabled=1`. One paired laptop per clinic: pairing again replaces and kills the old key. `bridge_key_id` is unique across all clinics, and every bridge table row carries `clinic_id` taken from the key, never from the request. `unpair-bridge` wipes the secret (revocation) and deletes that clinic's mirrored appointments, queue, nonces and claims, with one audit row of counts. Pair and unpair are audited.
- **EHRM:** owner-only routes (permission `devices.manage`):
  - `PUT /api/bridge/config` `{ baseUrl, keyId, secret, locationId }`. `baseUrl` must be `https://`, a host name (not an IP literal, not `localhost`, not a private-network name), no user/password, no query. Secret sealed with the EHRM key (same at-rest scheme as other secrets), never returned, never logged. Changing any field needs the owner to re-enter their passphrase (step-up), switches the bridge **off**, and shows the old and new host side by side; the owner must enable it again. This stops a stolen owner session from quietly pointing released messages and appointment facts at another server. Audit `bridge.configure` (host only, no secret).
  - `POST /api/bridge/enable` / `POST /api/bridge/disable`. Disabled is the default. Enable records `bridge_enabled_at`; nothing released before that moment is ever pushed (Flow B step 5).
  - `GET /api/bridge/status`: enabled, last tick, counts, last error code. No secrets.
- **Device capabilities (EHRM, P1).** `devices` gains `capability TEXT`, `created_by`, `created_at`, `last_used_at`, `rate_per_hour`. Owner issues one row per capability with `POST /api/devices` (`devices.manage`); only `sha256(token)` is stored; the token is sealed into the bridge config; `POST /api/devices/:id/revoke` revokes. `bridge.mjs` calls `authorizeDevice(capability, token)` (same lookup as `kioskCheckin`) before each job; a revoked capability stops that job only. `authenticate()` keeps refusing `x-device-token` as a session. Capabilities:

| Capability | Lets the bridge | Never lets it |
|---|---|---|
| `appointments.push_facts` | read minimum appointment facts and push them | read notes, fees, insurer, service names |
| `outreach.push_released` | read `status='released' AND release_mode='send'` outreach rows and push them | read proposed/discarded/record-only rows, release anything, change `released_by` |
| `outreach.write_status` | set delivery status on an outreach row | change text or status |
| `bridge.pull_inbox` | pull and ack the cloud queue | apply anything by itself |
| `booking_request.insert` | insert a booking/change/cancel request | convert or decline |
| `visit.confirm_by_patient` | confirm a future booked visit | cancel, move, or touch clinical data |
| `consent.withdraw_relay` | withdraw a channel or marketing consent | grant or re-grant consent |

  Each use writes an audit row with `actor_type='device'`, `role='bridge'`, the device id and the capability. Rate limit per capability per hour (default 120); over the limit, the job stops until the next hour and logs one `denied` row. No capability can sign a note, sign a plan, release outreach, grant consent, convert or decline a booking request, read `cases`, `visit_sheets`, `intake_submissions`, `brain_plans` content or `hep_logs`, or call anything in `brain.mjs`, `day1.mjs` or `visit.mjs`; `authorizeDevice` refuses any capability name not in this table.

### 4.3 Signing (both directions are requests from the laptop)

Headers on every request:

```
X-Bridge-Key-Id:    <bridge_key_id>
X-Bridge-Timestamp: <unix seconds>
X-Bridge-Nonce:     <22-64 chars [A-Za-z0-9_-]>
X-Bridge-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.req.<METHOD> <path?query>\n<nonce>\n<raw body>")>
Content-Type:       application/json   (POST only)
```

- Reuses `verifyEhrSignature` exactly: the front desk passes `Buffer.concat(["req.", methodLine, nonceLine, rawBody])` as the body argument, so the `"<ts>."` prefix, the 5-minute window and the constant-time compare are the same code. `<path?query>` is the full original URL path including `/bridge/v1` (Express `req.originalUrl`), so a signature for one endpoint cannot be used on another.
- **Responses are signed too (BUILT-NOW).** Every bridge response carries `X-Bridge-Timestamp` and `X-Bridge-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.res.<request nonce>\n<raw body>")>`. The `req.` / `res.` labels keep a request signature from ever passing as a response signature. The laptop checks it before reading the body and refuses anything else. Without this, anyone able to sit in the middle of the clinic's internet connection (a managed firewall that inspects HTTPS, a wrong certificate) could hand the laptop fake confirmations or booking requests. TLS 1.2 or newer, certificate checked (Node default; never switched off).
- Nonce stored in `bridge_nonces(clinic_id, nonce, seen_at)` for 10 minutes; a repeat is `409 replay`. The laptop keeps the nonces it sent for the same 10 minutes and refuses a response that echoes one it did not send or already used.
- Every item also has an id applied once (`releaseRef`, `appointmentRef:version`, event ids), using the `claimEhrEvent` pattern in a `bridge_claims` table keyed by `(clinic_id, id)`. A lower `version` than the one stored is refused `stale_version`.
- `locationId` in the body must match the key's location. `GET /bridge/v1/inbox` has no body: it returns only the queue of the clinic that owns the key; there is no clinic or location parameter to change. `after` must be digits and `limit` 1 to 100, else `400`.
- Rate limit per key: 60 requests per minute, `429` above.
- Any failure returns the same shape `{ "ok": false, "error": "<code>" }`, and an audit row `bridge.denied` with the code (no body).
- Front desk audit: new `actorType: "device"` in `src/security/audit.ts`, actor `bridge:<keyId>`.

### 4.4 Bodies (strict allow-lists: any unknown key is `400 unknown_field`)

**`POST /bridge/v1/appointments`** (cap 64 KB, max 200 items)

```json
{ "locationId": "loc_1",
  "appointments": [
    { "appointmentRef": "apt_8Jd...", "version": 3, "patientRef": "pt_Q2x...",
      "start": "2026-11-03T14:00:00-05:00", "end": "2026-11-03T14:45:00-05:00",
      "status": "booked", "practitionerName": "Sam", "firstName": "Alex" },
    { "appointmentRef": "apt_3Kq...", "version": 5, "removed": true } ] }
```

`status` in `booked|cancelled`. A `removed` item has only `appointmentRef`, `version`, `removed`. `start` must be in the future and at most 60 days ahead, else `400 out_of_window`. `practitionerName` and `firstName` max 40 chars, letters, spaces, hyphen, apostrophe; no "Dr." (guard runs). Response: `{ "ok": true, "applied": n, "duplicate": n }`.

**`POST /bridge/v1/outbox`** (cap 64 KB, max 50 items)

```json
{ "locationId": "loc_1",
  "items": [
    { "releaseRef": "rel_7fK...", "patientRef": "pt_Q2x...", "appointmentRef": "apt_8Jd...",
      "channel": "whatsapp", "purpose": "service",
      "to": "+16135550100", "firstName": "Alex",
      "subject": null, "text": "Hi Alex, a reminder of your visit ...",
      "consent": { "channel": "whatsapp", "purpose": "service", "status": "granted",
                   "express": true, "givenBy": "patient",
                   "recordedAt": "2026-10-20T10:00:00Z", "textVersion": "whatsapp.care.v1" },
      "releasedBy": "Sam", "releasedAt": "2026-10-29T09:12:00Z" } ] }
```

- `channel` in `sms|email|whatsapp` (`voice`, `messenger`, `instagram` refused for now). `purpose` in `service|marketing`. `to` is the one address for that channel (E.164 phone, email, or WhatsApp id). `subject` only for email, max 120. `text` 1 to 1000 chars, no `/x/`, no loopback or private-network host, links only to hosts on the clinic allow-list. `appointmentRef` optional; when present it must be a ref the front desk holds as `booked` and in the future, else refused `stale_release`. `consent.channel` and `consent.purpose` must equal the item's; `consent.express` must be `true` for `marketing`; `consent.givenBy` in `patient|substitute_decision_maker` (who gave it, not their name). `releasedAt` older than 7 days is refused `stale_release`. `subject` and `text` both go through the pinned wording guard.
- Response per item: `{ "releaseRef": "...", "result": "accepted" | "refused" | "duplicate", "code": "consent_missing" | "consent_withdrawn" | "consent_mismatch" | "wording" | "privacy" | "window_closed" | "address_pending_review" | "rate_capped" | "channel_not_allowed" | "link_not_allowed" | "stale_release" | null }`. `accepted` means handed to the sending service, not delivered.

**`GET /bridge/v1/inbox?after=<cursor>&limit=<1-100>`**

```json
{ "ok": true, "cursor": "1284", "more": false,
  "events": [
    { "id": "evt_...", "seq": 1283, "type": "booking.requested", "at": "2026-10-29T09:00:00Z",
      "requestRef": "brq_...", "kind": "new", "channel": "whatsapp",
      "firstName": "Alex", "phone": "+16135550100", "phoneVerified": true,
      "preferredTimes": [ { "start": "...", "end": "..." } ] },
    { "id": "evt_...", "seq": 1284, "type": "appointment.confirmed", "at": "...",
      "appointmentRef": "apt_8Jd...", "channel": "sms" },
    { "id": "evt_...", "seq": 1285, "type": "appointment.change_requested", "at": "...",
      "appointmentRef": "apt_8Jd...", "intent": "change", "channel": "whatsapp" },
    { "id": "evt_...", "seq": 1286, "type": "consent.withdrawn", "at": "...",
      "patientRef": "pt_Q2x...", "channel": "sms", "purpose": "service", "via": "carrier_stop" },
    { "id": "evt_...", "seq": 1287, "type": "delivery.status", "at": "...",
      "releaseRef": "rel_7fK...", "status": "failed", "code": "undelivered" } ] }
```

Event types and their only allowed keys are fixed in one table in `src/bridge/events.ts`; nothing else can be queued, and no key can hold free text (every string key has a fixed pattern or code list; `firstName` max 40 letters, spaces, hyphen, apostrophe). `via` in `carrier_stop|keyword|unsubscribe_link|staff`. `status` in `sent|delivered|failed|not_sent`; the laptop keeps the status with the highest `seq` per `releaseRef`. The laptop runs the same table as its own allow-list and refuses (acks and logs `bad_event`) anything outside it.

**`POST /bridge/v1/inbox/ack`** (cap 16 KB, max 500 ids)

```json
{ "locationId": "loc_1", "ids": ["evt_...", "evt_..."] }
```

Front desk deletes those rows, only rows of the key's own clinic (an id from another clinic's queue counts as not found). Response `{ "ok": true, "deleted": n }`.

### 4.5 Opaque refs

`patientRef`, `appointmentRef`, `releaseRef` are random ids (at least 128 bits) minted on the laptop and kept in a new EHRM table `bridge_refs(ref, kind, local_id, created_at)`. The cloud never sees an EHRM row id, a `case_token`, a hep token, a brain id or a `plan_id`. A ref is never derived from a name, health card, phone or row id. On the cloud, refs are unique per `clinic_id`, so the same ref string in two clinics can never match across them. Unknown refs in pulled events are acked and logged as `unknown_ref`; an event whose ref is of the wrong kind (a `releaseRef` used as a `patientRef`) is refused the same way.

---

## 5. What never crosses

1. Call transcripts, call summaries, recordings, voice notes. (Cloud only, then purged.)
2. Message bodies from any channel into the EHRM. `logCommunication` is off in bridge mode.
3. Anything from the cloud into `brain-case/2`, the doorman allow-list, `cases`, `visit_sheets`, `intake_submissions` or `flagsForCase` (N4).
4. Reason for visit, appointment notes, reception notes, cancel reasons, chief complaint, codes, SOAP text, red flags, history.
5. The brain plan, the patient card, the email draft body.
6. The `/x/<token>` exercise link or any hep token.
7. Service names, fees, insurer, invoices, last name, DOB.
8. Any other address of the patient than the one for the released channel.
9. Staff sessions, passwords, PINs, TOTP secrets for a bot (N3). A device token is never a session.
10. Any connection into the laptop (N7). No tunnel, no port forward, no `0.0.0.0`.
11. Message text, names or phone numbers in any audit row or bridge log (N8). Ids, codes, counts only.
12. Anything to or from Jane (N1). Anything to or from Reach or MedConsult.
13. A plan signature as a release (N6). A pre-checked box or bulk "release all". A release made under the old "nothing sent" wording, or with no send channel.
14. Whether a patient came, did not come, or arrived; past visits; service or visit type; age, date of birth or a "minor" flag; `plan_id`.
15. A response the laptop has not verified (unsigned, redirected, over 1 MB, unknown key).
16. The old `ehr_key_id` / `ehr_secret`. The bridge has its own key; `/webhooks/ehr` is closed for bridge clinics.
17. Anything the front desk could treat as a standing consent grant. The EHRM's consent fact covers one released item only.

---

## 6. Consent

| Purpose | Recorded where, by whom | Withdrawn by | Checked when | Status |
|---|---|---|---|---|
| SMS care (`consent_sms`) | EHRM, staff/portal (existing) | EHRM staff, portal, STOP relayed from cloud | propose, release, push (EHRM); send (cloud) | BUILT-NOW: push and cloud checks |
| Email care (`consent_email`) | EHRM (existing) | as above | as above | BUILT-NOW |
| WhatsApp care (`consent_whatsapp`, new) | EHRM, staff or portal, with `CONSENT_TEXTS` wording `whatsapp.care.v1` | EHRM, portal, cloud revoke relayed | propose, release, push, send | BUILT-NOW |
| Marketing per channel (existing `*.marketing`, express, s.33) | EHRM, written method | any channel, unsubscribe link | as above; purpose `marketing` | BUILT-NOW (checks only) |
| Inbound reply consent (`inbound`) | Cloud, automatic on patient message | n/a | cloud only, replies inside the window | existing |
| `voice` (calling the patient) | EHRM and cloud | both | before any outbound call | LATER |
| `call_recording`, `transcription` | Cloud at call start (spoken), mirrored to EHRM as a Consent fact | caller, staff | at call start | LATER (today: notice only) |
| `brain_export` | EHRM only | EHRM | export and sign | unchanged, never crosses |
| Minors and substitute decision-makers | EHRM: the consent row records `given_by` (capable patient or substitute decision-maker) | the person who gave it | propose, release, push (laptop only; age never crosses) | BUILT-NOW: `minor_review` hold; marketing refused under 18. Policy is open decision 7 |

Rules: consent for one channel never authorises another (N5). The cloud keeps the EHRM's consent fact as evidence on that one released item (basis `ehr`), never as a standing grant in its ledger; a newer cloud withdrawal always wins and is relayed back. A withdrawal made in the EHRM needs no relay because nothing is sent without a fresh fact from the laptop. Marketing (s.33) needs express consent recorded in writing in the EHRM and is checked on the laptop and again at the cloud (`express: true`). Front desk `ConsentPurpose` stays `service|marketing` this round; channel is already a separate key there. The new purposes `voice`, `call_recording` and `transcription` stay LATER; until they exist nothing that needs them is switched on (no outbound calls, no recording, transcription on notice only), and when built each is recorded, withdrawable and checked at use, like the others.

---

## 7. Retention (PHIPA s.13)

| Data | Where | Kept |
|---|---|---|
| Message text (inbound and released outbound) | Cloud, encrypted | Clinic retention period (default 180 days), then `purgeOlderThan` |
| Call transcript, summary | Cloud, encrypted | Call retention (default 30 days) |
| Copies at ElevenLabs, Twilio, Meta, email provider | Processors | No longer than the cloud's own period; settings confirmed under open decision 3 (until then: call recording off) |
| `bridge_queue` events (encrypted) | Cloud | Deleted on ack. Un-acked events deleted after 14 days with one audit row `bridge.queue.expired count=n` |
| `bridge_nonces` | Cloud | 10 minutes |
| `bridge_claims` (applied ids) | Cloud | 30 days (a re-push after that is still stopped by the 7-day release age limit and `pushed_at`) |
| Mirrored appointments (bridge) | Cloud | Deleted when the laptop sends `removed`, and in any case 1 day after the visit's end by the daily `purgeOlderThan` run (BUILT-NOW, not LATER: without it the cloud would build up a visit history) |
| Bridge-created contacts (first name, one address) | Cloud | Deleted when they have no mirrored appointment and no message left after purge |
| Consent evidence on released items | Cloud | Same as the message it belongs to |
| Contact proposals (changed address) | Cloud | 30 days, or until staff decide |
| Everything bridge-related for a clinic | Cloud | Deleted at `unpair-bridge` (one audit row of counts) |
| Outreach rows, booking requests, consent events, audit | EHRM | As today (no-delete triggers; legal evidence) |
| Audit rows (both sides) | Both | Append-only, hash-chained, ids and codes only; kept as legal evidence |
| Bridge config secret | EHRM sealed; cloud vault | Until unpaired or re-paired |

---

## 8. Safeguards and audit summary (PHIPA s.10.1, s.12, s.17, s.30)

- s.12: separate HMAC key per clinic (not the old EHR key), signed requests **and** signed responses, 5-minute window, nonce and per-item once, no redirects, rate limits, encrypted at rest both sides (including the cloud queue), one capability per device, revocable, owner step-up and auto-disable on any config change.
- s.17: the cloud operator and ElevenLabs, Twilio and Meta act as agents/processors; agreements are open decision 3.
- s.30: allow-listed bodies on both sides, unknown keys refused, no free-text keys, first name only, one address only, future visits only, `booked`/`cancelled` only, no service type.
- s.10.1: every bridge request, refusal, pairing, config change, ack and purge is an audit row on both sides, hash-chained and append-only, ids, codes and counts only (no names, numbers, addresses or text). FHIR `AuditEvent` export of these rows uses the existing exporters, with the agent typed as a device, never as a person.
- FHIR is the shape of the data. It is not a security control.

---

## 9. Build list

### BUILT-NOW, front desk team (`/home/user/Wellness-AI-Prototype`)

1. `clinic_integrations` bridge columns with a separate `bridge_key_id` / `bridge_secret`, `pair-bridge` / `unpair-bridge` CLI (re-pair kills the old key; unpair deletes the clinic's bridge data); `/webhooks/ehr` refuses bridge clinics.
2. `src/bridge/auth.ts`: headers, `verifyEhrSignature` reuse with `req.`/`res.` labels and `originalUrl`, response signing, nonce table, claims table keyed by clinic, per-key rate limit, `actorType: "device"`, no body logging.
3. `POST /bridge/v1/appointments`: minimum-field mirror, `booked`/`cancelled` and `removed` only, future window, no notes, no service, no automations; daily purge 1 day after the visit.
4. `POST /bridge/v1/outbox`: allow-list, link check, exact channel+purpose consent check at send time (evidence on the item, not a standing grant), `express` for marketing, `stale_release` check, address-change proposal, no contact merge by shared address, `sendProblem` with `DEFAULT_WORDING_RULES` pinned over body and subject, channel fixed, `deliver`.
5. `bridge_queue` (encrypted payload), `GET /bridge/v1/inbox`, `POST /bridge/v1/inbox/ack`, 14-day expiry, all scoped to the key's clinic.
6. Producers: booking request (staff inbox action and the bridge-mode `book_appointment` swap, with verified flag, phone, channel and kind set by code), confirm and change/cancel request (only on an unambiguous 48-hour match; fixed "passed to the clinic" reply), consent withdrawal (STOP, revoke, unsubscribe; both purposes, every linked patient), delivery status (send result, Twilio SMS callback; FHIR mapping as Flow B step 8).
7. Bridge mode switches off: cloud reminders, follow-ups, recall, campaigns, funnel auto-messages, outbound calls, `logCommunication`, `EhrClient`; staff and receptionist sends limited to replies (`use_ehrm_release`); call summaries limited to the administrative outcome.
8. `toFhirConsent`: a withdrawn row exports `status: inactive` with the original `permit` provision.
9. Tests in `test/bridge.test.ts`, including: unsigned or replayed request refused; response signature present; key from clinic A cannot read or ack clinic B's queue; old EHR key refused on `/bridge/v1` and bridge key refused on `/webhooks/ehr`; `fulfilled`/`noshow` and past visits refused; consent fact for another channel or purpose refused; a cloud withdrawal newer than the fact wins; the carried fact does not let a cloud campaign send; banned words in subject refused; staff cannot start a new conversation in bridge mode; no name, number or text in any bridge audit row. `npm test` and `npx tsc --noEmit` clean.

### BUILT-NOW, records team (`/home/user/ehrm/ecosystem/code/roles-demo`)

1. `devices` capability columns, owner-only issue and revoke, `authorizeDevice` (unknown capability names refused); `authenticate()` refusal kept.
2. `bridge.mjs` (outbound only, `redirect: 'error'`, response signature and allow-list checked, 1 MB cap, codes-only error log, injected `fetch` for tests), owner config/enable/disable/status routes with step-up and auto-disable on change, `https` host-name-only `baseUrl`, sealed secret, off by default, `bridge_enabled_at`.
3. `bridge_refs` table (random 128-bit refs).
4. `outreach.channel`, `release_mode`, `pushed_at`, `delivery_status`, `delivery_at`, `plan_id`; subject and body added to the encrypted columns (closes TR gap 4); consent check per channel and purpose at propose, release and push; push-time checks for release age, appointment version, address, minors.
5. Templates `appt_reminder`, `booking_confirmed`, `plan_ready` (pass the unchanged guards on body and subject).
6. `consent_whatsapp` with `CONSENT_TEXTS` wording and version; `given_by` on consent rows; `minor_review` hold.
7. Apply events: booking request insert (`booking_requests.kind`, `appointment_id`), patient confirm (`confirmed_via='bridge'`), consent withdrawal relay, delivery status (highest `seq` wins); ack only after commit; all as a device actor through function calls, never through a staff route.
8. Tests in the RV style (`DB_PATH=:memory:`, a port other than 8787), including: device token refused as session; brain export payload byte-for-byte unchanged after every bridge event type; plan signing creates no outreach; body with `/x/` held; a row released before enable, or with `release_mode='record'`, is never pushed; a reminder whose visit moved is held `stale_release`; redirect and unsigned response refused; no bridge capability can sign, release, grant consent or read brain tables; no text, name or number in any bridge audit row. Full `npm test`; entry in `CHANGES-2026-10-29.md`. No frozen file touched, no package added.

### LATER

Desk release of reminders (owner decision); Meta template mapping and Meta/email delivery statuses; voice callback tool; `voice`, `call_recording`, `transcription` purposes; `booking.request_closed` back-event; phone-reachable exercise link; adherence quick replies; follow-up visit flow; Gate 0 and AI disclosure wording.

---

## 10. Open decisions for the owner

1. **AI disclosure wording.** The guards ban the word "AI" in patient-facing text, and the voice agent opening line says "virtual assistant". Placeholder: `[[DISCLOSURE-WORDING: pending owner and counsel; guard unchanged]]`. Until decided, nothing in the bridge depends on Gate 0, no guard is loosened, no clinic setting can switch the `ai` rule off for bridge items, and no template or released text may contain the placeholder (it is refused like any other banned wording). This contract does not pre-decide the outcome; whatever owner and counsel choose is added as its own reviewed change to the shared guards, never as a copied, looser guard.
2. **Relay hosting region.** Where the front desk (and so `bridge_queue`, message and transcript text) is hosted. Recommendation: Canada. ElevenLabs and Meta processing locations to be confirmed.
3. **Agreements in the subcontractor setting.** Who is the health information custodian at each clinic, and agent agreements (s.17) covering the front desk operator, ElevenLabs, Twilio, Meta, and the clinic owner's use of the EHRM next to Jane.
4. **Identity of callers and repliers.** Whether caller ID or a reply from the number on file is enough to confirm, and what is needed to cancel or discuss an appointment (today: confirm only; cancel and change go to the desk).
5. **Exercise link exposure.** Keep it clinic-computer and printed-card only, or decide custody of a phone-reachable exercise page. Cloud hosting conflicts with "cloud keeps no clinical data"; exposing the laptop is forbidden (N7).
6. **Reminder release.** Whether the desk may release reminders, and whether a fixed reminder template may ever count as a release.
7. **Minors and substitute decision-makers.** The age line for `minor_review` (16 is a placeholder; PHIPA has no fixed age, capacity is judged per person), who may receive messages about a child, and whether the voice agent and WhatsApp receptionist may take booking requests from or for a minor. Until decided, the laptop holds such items for review and marketing to anyone under 18 is refused.
8. **What patients volunteer to the front desk.** The cloud holds no clinical record, but patients can still type or say health details in a WhatsApp message or a call. That text is personal health information held by an agent (s.17). Retention is 180 days for messages and 30 days for calls today; the owner should confirm or shorten these, and confirm the processors' (ElevenLabs, Twilio, Meta) copies follow the same limits.
9. **Jane in the subcontractor setting.** Reminders sent from the EHRM may duplicate Jane's own reminders, and messages sent on the clinic's behalf are not in Jane (the legal record) unless someone copies them by hand. Nothing writes to or reads Jane (N1); the owner decides whether the clinic's Jane reminders are switched off for these patients and how sent messages are noted in Jane.

---

## 11. Review changes in v1.1 (adversarial privacy and security review, 2026-10-29)

Each line is a hole found in v1 and what closes it.

1. **Old releases would have been sent.** v1 pushed every released outreach row, including ones released under "released and signed; nothing sent". Now only rows released after the bridge was enabled, with `release_mode='send'` and a named channel, can ever be pushed.
2. **Stale reminders.** A reminder released for a visit that later moved or was cancelled would still go out. Now held `stale_release` (appointment version, future start, 7-day release age, address unchanged).
3. **Visit outcomes in the cloud.** v1 pushed `fulfilled` and `noshow` and kept the mirror for 30 days after the visit with no purge built. Now only future `booked`/`cancelled` visits cross, a `removed` item deletes the mirror, and the purge (1 day after the visit) is BUILT-NOW.
4. **Service type in the cloud.** `serviceRef` removed from booking requests; the receptionist stops asking for service type, age or date of birth.
5. **Second door through the old webhook.** The bridge reused `ehr_key_id`/`ehr_secret`, which also open `/webhooks/ehr` (last name, email, full appointment, automations). The bridge now has its own key and `/webhooks/ehr` refuses bridge clinics.
6. **Unsigned responses.** Everything the laptop acts on (confirmations, booking requests, withdrawals) arrived in unsigned response bodies. Responses are now signed with a `res.` label, checked on the laptop, and redirects are refused (`redirect: 'error'`), which also stops a redirect into the laptop's own `127.0.0.1` server.
7. **Consent fact became a standing grant.** v1 recorded the EHRM's consent in the cloud ledger with basis `ehr`, which other cloud senders could later rely on. Now it is evidence on one item only; the send-time check needs an exact channel and purpose match, `express` for marketing, and no newer cloud withdrawal or suppression.
8. **Business-initiated messages from the cloud.** v1 only switched off automations; cloud staff (and the receptionist) could still start a new conversation. Now only replies to a patient-started conversation are allowed in bridge mode, and outbound calls and funnel messages are off.
9. **Reply matching and shared phones.** A "C" or STOP could hit the wrong patient when family members share a number. Replies now map only on an unambiguous 48-hour match; withdrawals apply to every linked patient; contacts are never merged by shared address.
10. **Wrong FHIR status.** Change/cancel requests were `AppointmentResponse tentative` (means "tentatively accepted"); now a `Communication`. Withdrawn consent was `inactive` plus `deny` (a double negative); now `inactive` with the original `permit`. `Communication.status` mapping is fixed so `completed` means carrier-confirmed delivery only, and `accepted` is shown as "sent to the front desk", not delivered. Local code systems are named instead of borrowing HL7 codes that do not fit.
11. **Cross-clinic.** Queue reads and acks, claims, refs and contacts are now scoped to the key's clinic; one laptop per clinic; re-pair kills the old key; unpair deletes the clinic's bridge data.
12. **Owner-session takeover.** A stolen owner session could point the bridge at another server. Config changes now need step-up, switch the bridge off and show old and new host.
13. **Bot acting as staff.** Event application is written as function calls with a device actor; no capability can sign, release, grant consent, convert or read brain tables; unknown capability names refused.
14. **Model-set fields.** The receptionist could have been talked into setting `phoneVerified`. Verified flag, phone, channel and kind are now set by code only.
15. **Free text and logs.** Queue payload encrypted at rest; no free-text keys in events; no body logging on `/bridge/v1`; laptop error log is codes only; audit rows carry no name, number, address or text; call summaries limited to administrative outcome.
16. **Minors.** Not covered in v1. Now a laptop-side `minor_review` hold, `given_by` on consent, marketing refused under 18, and open decision 7.
17. **"AI" wording.** v1 pre-decided "one named exception sentence". Now left fully to owner and counsel, placeholder itself blocked from patient text, guard pinned for bridge items.
18. **Retention gaps.** Added rows for processors' copies, bridge-created contacts, consent evidence, contact proposals, unpair, and audit; open decision 8 for patient-volunteered text.
19. **Email subject.** v1 guarded only the body; the subject now goes through the same guards on both sides.
20. **Ack before commit.** v1 could ack (and so delete) an event the laptop failed to save. Acks now go only after commit; temporary failures are pulled again.
