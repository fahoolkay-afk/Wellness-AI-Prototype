# Security review: front desk (cloud) and EHRM (laptop), 2026-10-29

Scope: `/home/user/Wellness-AI-Prototype` (cloud front desk) and `/home/user/ehrm/roles-demo` (laptop EHRM). Both were read-only. Six review areas each had their findings checked by an independent verifier. This register keeps the verifier's severity wherever the two disagreed. It goes further than `docs/DEEP-DIVE-2026-10-29.md` and does not repeat it. Where a finding overlaps the deep-dive, the entry says so.

All proof-of-concept scripts and failing tests live under one folder, written as `$S` below:
`$S = /tmp/claude-0/-home-user-Wellness-AI-Prototype/647041c1-ecdd-5ed7-823b-52ee185d760e/scratchpad/security`
They use synthetic data, in-memory or scratch databases, stubbed outbound fetch and local ports only. No real provider was contacted, and no secrets or demo passphrases appear in this document.

---

## 1. Executive summary

1. The cloud front desk is **not safe for real patient data yet**. As shipped, anyone on the internet can sign in as staff using the public default secret or the password "demo".
2. Outside `NODE_ENV=production`, the webhook for the SMS provider you are *not* using is left open. Strangers can make the clinic send paid texts to any number they choose.
3. The AI receptionist trusts caller ID and anything a person says about their own phone or email. A stranger can take over a patient's thread, read and cancel their visits, or get linked to another patient's EHR chart.
4. The consent rules are weaker than the law requires. Broadcasts can target condition tags with no express consent, and "unsubscribe" or "STOP" is ignored on email and WhatsApp and in natural wording on SMS.
5. The cloud stores message bodies and call transcripts in plaintext indefinitely, and sends them to US AI vendors. This contradicts the "cloud holds no clinical data" plan.
6. The EHRM is in much better shape. Its gaps are insider and file-access ones: the consent lockbox is skipped for chart files, the ops manager can turn itself into front desk, assignments never expire, and the audit chain can be rolled back by someone who can write the file.
7. Totals: front desk 1 critical, 6 high, 13 medium, 14 low. EHRM 4 medium, 4 low. Cross-system: 1 low (design checklist).
8. Wave 1 (section 6) is about two weeks of focused work and closes every critical and high finding.

---

## 2. Risk heat table

Counts after merging duplicates and applying the verifier's severities.

| Codebase | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Front desk (SEC-FD) | 1 | 6 | 13 | 14 | 34 |
| EHRM (SEC-EH) | 0 | 0 | 4 | 4 | 8 |
| Both (SEC-X) | 0 | 0 | 0 | 1 | 1 |
| **Total** | **1** | **6** | **17** | **19** | **43** |

Likelihood against impact for the top items. "Anon" means no account is needed; "Insider" means a staff session or file access is needed.

| | Low impact | Moderate impact (cost / one patient) | Severe impact (all patients / regulatory) |
|---|---|---|---|
| **Anon, trivial** | FD-23 | FD-02, FD-08, FD-09 | **FD-01** |
| **Anon, needs one fact** (number, email, spoofed caller ID) | FD-21 | FD-03, FD-04, FD-05 | |
| **No attacker (default behaviour)** | FD-32, FD-33 | FD-20 | FD-06, FD-07, FD-17, FD-18, FD-19 |
| **Insider / staff session** | FD-25, FD-26 | FD-12, FD-13, FD-14, FD-15 | FD-16, EH-01, EH-02, EH-03 |
| **File or drive write access** | EH-05, EH-06 | EH-04 | |

---

## 3. Register

Field key: **Sev** is severity. **Repro** is REPRODUCED (code was run) or CODE (code path read only). **Effort** is S (under a day), M (1 to 3 days) or L (a week or more). **Before real data** says whether the finding must be fixed before any real patient data goes in.

### 3.1 Front desk

#### SEC-FD-01: Shipped defaults give full staff API access, and startup never refuses them
- **Sev:** critical. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** yes.
- **Exploit:** An anonymous attacker on the internet signs a `fd_session` token with `change-me-in-production` (or with `change-me` from `.env.example`), or just tries password `demo`, which the sign-in page displays. They get every clinic's contacts and threads. The token also works as `Authorization: Bearer`, so the attack can be scripted without a browser.
- **Location:** `src/config.ts:18-19`, `src/server.ts:18` (only a log line about the password; the secret is never checked), `src/auth.ts:59` (Bearer fallback), `src/app.ts:166-171` (login has no limiter), `public/app.js:222` (password hint), `.env.example:9-11`, `src/app.ts:45` (`trust proxy` true).
- **Evidence:** `$S/verify-fd-access/forge.mjs`. The real server ran with `NODE_ENV=production` and no secrets set. A forged Bearer token got 200 and the clinic list. Tokens signed with wrong secrets got 401. `POST /api/login {"password":"demo"}` got 200 and a cookie. `$S/frontdesk-access/access.test.ts` test 2. Deep-dive item 1 covered cookie forgery; what is new here is the Bearer path, the fact that `NODE_ENV=production` changes nothing, and the second guessable secret in `.env.example`.
- **Fix:** Refuse to start unless `SESSION_SECRET` is at least 32 random bytes and not on a known-defaults list, and `STAFF_PASSWORD` is neither `demo` nor empty. Allow defaults only with an explicit `DEMO=1`. Blank both values in `.env.example`. Show the hint only in demo mode. Add a login limiter keyed on account and IP. Set `trust proxy` to the real hop count, because with `true` any future IP limiter could be bypassed through `X-Forwarded-For`. Consider dropping the Bearer fallback or giving it its own token type.

#### SEC-FD-02: Webhooks fail open outside production, so the provider you don't use stays open (SMS pumping), and one request fans out without limit
- **Sev:** high. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** yes.
- **Exploit:** An anonymous attacker posts an unsigned `/webhooks/telnyx/sms` to a Twilio deployment, or the reverse. `From` is a premium or satellite number. The AI's reply goes out through the live account, so the clinic pays toll fraud and Claude costs. For Meta, when `META_APP_SECRET` is unset, one 2 MB request holds about 15,000 entries, which become 15,000 contacts, AI turns and Graph send attempts.
- **Location:** `src/app.ts:33-39` (`gate()` fails open when `NODE_ENV != production`), `src/app.ts:65-82` (each route checks only its own secret), `src/app.ts:94-97` (no cap on Meta entries), `src/app.ts:49` (global 2 MB JSON limit), `src/channels/index.ts:475-482`, `src/channels/sms.ts` (no destination country restriction).
- **Evidence:** `$S/verify-fd-webhooks/cross-provider.test.ts`. Both directions (Twilio-configured and Telnyx-configured) sent to `+88213000222`. `$S/webhooks/poc.test.ts` test 1, plus a live run on port 3402. `$S/verify-fd-webhooks/meta-fanout.test.ts`: 500 entries gave 500 AI turns and 500 Graph POSTs, 15,000 entries took about 41 s, `NODE_ENV=production` gave 503, and a configured secret gave 403. `npm start` and `.env.example` never set `NODE_ENV`. Deep-dive item 2 covers the general fail-open; what is new is the cross-provider path and the fan-out. Meta's 24 h window would probably reject most of the WhatsApp sends to arbitrary numbers, but the AI cost and contact pollution remain.
- **Fix:** Fail closed in every environment. Allow unsigned webhooks only with `DEMO_UNSIGNED_WEBHOOKS=1`, which also forces simulated sends. Mount a provider's route only when its verification secret is set. Refuse to start if any channel can send but its inbound secret is missing. Cap entries per webhook at about 50, return 200 and then process from a queue, and set per-route JSON limits (Meta about 256 KB). Set provider geo-permissions and a NANP-only outbound allow-list unless the clinic opts in.

#### SEC-FD-03: The voice agent treats caller ID as identity, so a spoofed call reads, cancels and moves a patient's visits and can take over their thread for good
- **Sev:** high. **Repro:** REPRODUCED (spoofing on the phone network itself was not run). **Effort:** M. **Before real data:** yes.
- **Exploit:** An outside attacker spoofs a patient's caller ID through any VoIP provider. The agent greets them by name, lists the patient's appointments and cancels or reschedules them. `update_patient_details` then moves the patient's phone to the attacker's real number. From then on the attacker texts in from that number and gets the patient's whole cross-channel thread (clinical text, staff notes, claim numbers) plus every future reminder. The real patient's next message creates a new, empty contact.
- **Location:** `src/channels/voice.ts:55-69` (initiation returns `patient_name` for any caller ID), `src/channels/voice.ts:73-85`, `src/channels/voice.ts:146` (`caller_phone` comes from `system__caller_id`), `src/ai/tools.ts:179-183` (ownership is checked only against the caller-derived contact), `src/ai/tools.ts:209-218`, `src/db.ts:206-229,283-285` (phone is the identity column; one conversation per contact).
- **Evidence:** `$S/verify-fd-ai/voice-spoof.test.ts`. Initiation returned the victim's name, the appointment was listed and then cancelled, the phone was rebound, and the attacker's number then resolved to the victim's conversation holding the secret-marker text. `$S/ai-voice/poc-ai-voice.test.ts` test 1 and `$S/ai-voice/http-voice.ts` (live check on port 3403). `$S/verify-fd-webhooks-batch/verify.test.ts` test 1. STIR/SHAKEN attestation is never checked.
- **Fix:** Treat caller ID as a hint only. Before `get_my_appointments`, cancel or reschedule, step the caller up: an SMS one-time code to the number on file, or date of birth plus name. Until then, offer only availability and "take a message". Don't return `patient_name` from initiation before verification. Remove `update_patient_details` from the voice tools, or queue its changes for staff. Notify the phone and email on file of any cancel, reschedule or contact change.

#### SEC-FD-04: The AI can rebind a contact's phone or email to any value, redirecting replies and reminders and handing a stranger a patient's thread
- **Sev:** high. **Repro:** REPRODUCED (the code path; the model's compliance was scripted). **Effort:** M. **Before real data:** yes.
- **Exploit:** There are three variants. (1) Anyone who texts or DMs says "my new number is X". That turn's reply and every later reminder go to X from the clinic's number, which gives a phishing relay and pumping. (2) An email with a spoofed `From` of a patient says "change my email to attacker@". The patient's appointments go to the attacker; in draft mode, the approved draft goes there too. (3) An Instagram user claims a phone number before its owner ever texts. The owner's first SMS merges into the attacker's contact and reaches the attacker through the AI.
- **Location:** `src/ai/tools.ts:209-218` (`updateDetails`), `src/inbox.ts:154-162` (`deliver` uses the mutated contact), `src/inbox.ts:205-216` (`approveDraft` re-reads the contact), `src/channels/index.ts:51-68`, `src/db.ts:222-233` (first row wins; no uniqueness), `src/channels/email.ts:22-30` (no SPF/DKIM/DMARC check).
- **Evidence:** `$S/verify-fd-ai/rebind-contact.test.ts` (4 of 4 reproduce V1, V2-auto, V2-draft and V3). `$S/ai-voice/poc-ai-voice.test.ts` tests 2, 3 and 10. `$S/verify-fd-webhooks-batch/verify.test.ts` showed a 24 h reminder going to an unverified number.
- **Fix:** The AI must never write identity or delivery fields. Store AI-collected values as "proposed" and promote them only after a one-time code to the new address or staff approval; automations must never send to a pending address. Always reply on the channel and address the message came in on. Add a per-clinic unique index on phone and email, or an explicit merge flow. Before the email channel can read appointments, require an SPF/DKIM/DMARC pass from Postmark's headers. Show the recipient on the draft-approval screen.

#### SEC-FD-05: EHR edition: stating another patient's email links the caller to that patient's EHR chart
- **Sev:** high (critical if the connector ships as written). **Repro:** REPRODUCED against the mock EHR. **Effort:** M. **Before real data:** yes (EHR edition).
- **Exploit:** A caller using their own number, with no spoofing, who knows a patient's email asks the agent to "save my email" and then asks for "my appointments". They are linked to the victim's EHR patient id, can list and cancel the victim's visits, and every later message from them is written into the victim's chart.
- **Location:** `src/booking/ehr.ts:88-107` (`ensurePatient` looks up by phone and/or email), `src/channels/voice.ts:80` (voice never calls `linkToEhr` first), `src/ai/tools.ts:209-218`, `src/ehr-mock.ts:71-73` (`byPhone ?? byEmail`), `docs/EHR_CONNECTOR_SPEC.md:41-46` (does not require both to match).
- **Evidence:** `$S/verify-fd-ai/verify-ehr-email-link.test.ts` (2 of 2). The attacker's `external_id` became the victim's `pat_` id, the victim's appointment was listed, and the EHR row became `cancelled`. In the SMS control, a reachable EHR created a separate patient. Text channels are exposed only when the best-effort `linkToEhr` fails. Mitigating factor: the owner's EHRM has no `/patients/lookup` endpoint, so this connector path may never be deployed under the planned design.
- **Fix:** Link only on the channel identity that came with the message, or after a one-time code to contact details already in the EHR. Run `linkToEhr` by caller ID before any voice tool. Never link on email alone. In the spec, require that phone and email both match the same patient when both are given, and return nothing otherwise. `update_patient_details` should write proposed changes only.

#### SEC-FD-06: Opt-outs are captured only from an exact SMS keyword; email, WhatsApp and Messenger unsubscribes and natural-language SMS revocations are ignored
- **Sev:** high. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** yes (before any broadcast or automation reaches real patients).
- **Exploit:** No attacker is needed. A patient replies "unsubscribe" to an email, "STOP" on WhatsApp, or "Please stop texting me", "revoke", "STOP!" or "stop." by SMS. The AI answers and the next broadcast still reaches them. That is exposure under CASL s.11 (10 business days), the FCC revocation rule (TCPA per-text damages for US numbers) and Meta's policy. Staff have no way to record an opt-out by hand.
- **Location:** `src/inbox.ts:102-113` (keyword handling only when `channel === 'sms'`), `src/channels/sms.ts:79-88` (exact whole-message match), `src/channels/index.ts:56-69` (non-SMS sends have no consent check), `src/channels/email.ts:32-41` (no `List-Unsubscribe` header and no footer), `src/app.ts:306-317` (staff cannot set `opted_out`), `src/ai/tools.ts` (no opt-out tool).
- **Evidence:** `$S/verify-compliance/optout.test.ts`: email "unsubscribe" then broadcast gave `{sent:1}`, and the Postmark payload had no unsubscribe header; WhatsApp "STOP" then broadcast called Graph. `$S/verify-compliance/sms-revoke.test.ts`: 7 of 8 phrasings were ignored, each got an AI reply and then a broadcast SMS. `$S/compliance/optout-phrases.ts`. Correction: email `From` does carry the clinic name, so sender identification is present. Not tested: carrier-level opt-out handling of `STOP!`.
- **Fix:** Build one suppression table keyed by person, channel and purpose. Feed it from normalised keywords on all channels (stop, quit, end, revoke, opt out, unsubscribe, "stop texting"), from Meta opt-out and block events, and from Postmark SubscriptionChange and SpamComplaint webhooks. Enforce it in `Channels.send` for anything non-transactional. Skip the AI reply on a revocation and send at most one confirmation. Treat "cancel" as an appointment intent unless it is the whole message. Add RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers and a legal footer to commercial email, and "Reply STOP to opt out" to SMS and WhatsApp marketing. Let staff record opt-outs, with a timestamp and source.

#### SEC-FD-07: Broadcasts and marketing automations target condition tags and patient stage with no express-consent check (PHIPA s.33)
- **Sev:** high. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** yes (or switch broadcasts off).
- **Exploit:** No attacker is needed. A staff member sends a promo to tag `lower-back` or stage `active_patient` from the normal Broadcast screen. That uses PHI (that the person is a patient, and their condition) for marketing without express consent, and leaves no consent evidence to defend an IPC or CRTC complaint. The `post-visit-review` and `lead-nurture-24h` automations are enabled by default.
- **Location:** `src/app.ts:455-463`, `src/automations.ts:140-152`, `src/inbox.ts:226-236`, `src/db.ts:23-36` (no consent columns), `public/app.js:842-861`, `src/seed.ts:60-81,112`.
- **Evidence:** `$S/verify-compliance/consent.verify.test.ts`: a broadcast to `lower-back` gave `{sent:2}` over Twilio and Postmark with no consent recorded. `$S/compliance/compliance.poc.test.ts`. Overlaps deep-dive items 6 and 8; the PHIPA s.33 express-consent point and condition-tag targeting are new. The CASL implied-consent window may cover recent patients, but PHIPA s.33 still applies.
- **Fix:** Add a consent table (person, channel, purpose, basis, expiry, source, wording version, timestamp, actor). Broadcasts and every marketing-lane automation should require live express marketing consent and report "N matched, M skipped (reason)". Block clinical or condition tags as audience selectors. In EHR mode, turn cloud broadcasts off and accept only signed audiences from the EHRM.

#### SEC-FD-08: Denial of wallet: any new sender id starts an Opus turn, with no size, rate or budget limit
- **Sev:** medium. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** no (before first clinic).
- **Exploit:** An anonymous attacker rotates Messenger or Instagram ids or emails the inbox. Each message runs up to 8 rounds at `max_tokens` 16000 with 40 messages of history. A single 1.5 MB email becomes a request of about 390k tokens and is re-sent in every later turn. Email draft mode still calls the model.
- **Location:** `src/inbox.ts:115-125,147-160`, `src/ai/receptionist.ts:20-21,67-77`, `src/channels/email.ts:28`, `src/app.ts:49`.
- **Evidence:** `$S/verify-fd-ai-batch/verify.test.ts` F1: 20 senders plus 1 email gave 21 requests, one of them over 1.5M characters. Coalescing is per conversation only.
- **Fix:** Cap inbound bodies (4 KB for chat, 16 KB of stripped email) and truncate history by tokens. Add per-contact and per-clinic rate limits and a daily model budget with a circuit breaker that falls back to "staff will reply". Skip AI for automated-looking first contacts. Lower `max_tokens` for chat. Cap outbound SMS per contact per hour.

#### SEC-FD-09: No limit on bookings per contact: one throwaway social account can fill the calendar
- **Sev:** medium. **Repro:** REPRODUCED (model scripted). **Effort:** S. **Before real data:** no.
- **Exploit:** A prankster or competitor with throwaway Instagram or Messenger accounts gets the AI to book every slot it finds: 6 per find, in parallel tool calls, up to 8 rounds per message.
- **Location:** `src/ai/tools.ts:155-176`, `src/booking/builtin.ts:66-90`, `src/ai/receptionist.ts:94-101`.
- **Evidence:** `$S/verify-fd-ai-batch/verify.test.ts` F2: 6 future bookings for "Spam Bot" from one message.
- **Fix:** Allow at most 1 or 2 future AI-made bookings per contact. Contacts reachable only on social channels get tentative holds or a staff task. Allow one booking-changing tool call per turn. Set a per-clinic hourly cap and alert staff.

#### SEC-FD-10: One global EHR webhook secret, with the clinic picked from the body's `locationId` and no replay protection
- **Sev:** medium today; high if every clinic laptop shares the secret under the planned design. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** yes (before any EHRM pairing).
- **Exploit:** Whoever holds the secret (under the planned design, every clinic owner or any malware on one laptop) signs `patient.updated` for another clinic's `locationId` and moves that clinic's patients' phones to attacker numbers. A captured delivery can be replayed at any time to roll data back.
- **Location:** `src/config.ts:28`, `src/app.ts:131-157`, `src/booking/ehr.ts:212-216`.
- **Evidence:** `$S/verify-fd-webhooks/ehr-crosstenant-replay.test.ts`: a cross-clinic phone change returned 200, a byte-identical replay returned 200 again, and the phone flipped back. `$S/webhooks/poc.test.ts` test 5.
- **Fix:** Use a per-clinic (per-pairing) secret chosen by a key id header, and derive the clinic from the key, rejecting a body whose `locationId` does not match. Sign `timestamp.body` and accept a window of about 5 minutes. Require a stored, deduped event id, and apply only events newer than the stored version. Route `patient.updated` changes to phone or email through confirmation or audit before outreach uses them. See SEC-X-01.

#### SEC-FD-11: No browser security headers (CSP, frame-ancestors, nosniff, HSTS, Referrer-Policy)
- **Sev:** medium. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** yes.
- **Exploit:** A network attacker on clinic Wi-Fi SSL-strips a first plain-http visit (no HSTS) and captures the shared password. Any future DOM-injection bug would also have no CSP behind it. Clickjacking is largely blunted today by the SameSite=Lax cookie.
- **Location:** `src/app.ts:44` (only `x-powered-by` is disabled), static files at `src/app.ts:493`, API at `src/app.ts:487`.
- **Evidence:** `$S/web/web-hardening.test.ts` test 1. `curl -sI /` showed none of these headers.
- **Fix:** Add one middleware before the routes that sets: `Content-Security-Policy: default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and HSTS in production. Set HSTS at the edge proxy too. `app.js` already fits this CSP.

#### SEC-FD-12: The staff Test console (`/simulate`) runs in production and can re-opt-in a patient who texted STOP and forge patient messages
- **Sev:** medium (high when chained with FD-01). **Repro:** REPRODUCED (opt-out flip and live send; the EHR-log part is CODE). **Effort:** S. **Before real data:** yes.
- **Exploit:** Any staff session posts `simulate {from: <patient phone>, body: "START"}`, which clears `opted_out`. The next broadcast then texts a patient who withdrew consent. The same route makes the AI act "as" the patient on live channels, and `logCommunication` writes a fake inbound entry into the EHR record. It is the only staff path that can clear a STOP.
- **Location:** `src/app.ts:471-484`, `src/inbox.ts:99,103-107`, `public/app.js:885-892`.
- **Evidence:** `$S/verify-fd-access/simulate-optin.test.ts`: `opted_out` went from 1 to 0, and the broadcast sent 1 Twilio SMS to that number. In the control, `PATCH opted_out` was ignored.
- **Fix:** Register the route and show the Test tab only with `ENABLE_SIMULATOR`, and refuse it in production. Mark simulated messages and skip keyword handling, EHR logging and live sends for them. Allow consent changes only from verified provider webhooks or an audited staff action with recorded proof.

#### SEC-FD-13: Staff can set any `ehrLocationId` in the clinic profile, which redirects that clinic's EHR calls and captures another location's inbound EHR events
- **Sev:** medium today (high once per-clinic accounts exist). **Repro:** REPRODUCED. **Effort:** S. **Before real data:** yes (EHR edition with multiple locations).
- **Exploit:** A clinic A user sends `PUT /profile {ehrLocationId: "loc-B"}`. A's contacts are then linked to B's charts, can book into B's calendar and write into B's communications log. Signed `/webhooks/ehr` events for loc-B (name, phone, email) land in A and stop reaching B (first match wins, so A needs the lower id). The `String(id)` fallback lets A claim an unconfigured clinic by its numeric id.
- **Location:** `src/app.ts:214-227` (the whole profile is stored without a schema), `src/booking/ehr.ts:53-60,84-86`, `src/app.ts:133`.
- **Evidence:** `$S/verify-fd-access/ehr-pivot.test.ts`: `PUT=200`, A's contact got B's `pat_1`, and a loc-B webhook landed in A and not in B.
- **Fix:** Remove the integration fields (`ehrLocationId`, `bookingProvider`, `janeBookingUrl`) from the staff-editable profile and set them only through provisioning, with a unique index. Make the webhook reject a `locationId` that matches more than one clinic. Drop the `String(id)` fallback. Use per-clinic EHR credentials. Validate the rest of the profile with a schema, including https-only URLs for `reviewUrl` and `janeBookingUrl`.

#### SEC-FD-14: By-id routes and the SSE stream never check clinic ownership
- **Sev:** medium (high if `:cid` scoping is added and these routes are left alone). **Repro:** REPRODUCED (tasks, appointment status, SSE); CODE for conversations, messages and contacts. **Effort:** M. **Before real data:** yes (it is part of the per-clinic scoping work).
- **Exploit:** Once sessions are bound to clinics, a clinic A user can still: create a task pointing at a clinic B contact (B's name then shows in A's list); close B's tasks through `/tasks/:id` with a `clinicId` taken from the request body; act on `/conversations/:id`, `/messages/:id/*`, `/contacts/:id` and `/appointments/:id/status` by global id; and open `/api/events` with no `?clinic` to receive every tenant's `{clinicId, kind, id}` stream, which keeps running after logout or expiry. Today any session can already reach every clinic, which is deep-dive item 1.
- **Location:** `src/app.ts:430-446`, `src/db.ts:429-441` (the `listTasks` join has no clinic check), `src/app.ts:182-197` (SSE), and the by-id routes listed above. The one correct pattern is `src/app.ts:391`.
- **Evidence:** `$S/verify-fd-access/cross-clinic-task.test.ts`. `$S/frontdesk-access/access.test.ts` test 8. The SSE-after-logout capture is in `$S/verify-fd-web-batch/`.
- **Fix:** Bind the session to a list of clinic ids at login. Add an `owned(entity)` helper that returns 404 and call it in every by-id route. Validate `contactId` the way line 391 does. Load the task first and use its own `clinic_id`. Add `AND c.clinic_id = t.clinic_id` to the join. For SSE, require an entitled `?clinic`, re-check `exp` on each ping, and cap streams per session.

#### SEC-FD-15: Broadcasts have no cap, no confirmation, no rate limit and no real sender attribution
- **Sev:** medium. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** no.
- **Exploit:** Any session sends one unfiltered broadcast, which reaches the 500 newest contacts on live channels and is sent inside the HTTP request. The rows are stored as `author='ai'`, `author_name='Broadcast: <caller-chosen name>'`, so a harmful or phishing blast cannot be traced to a person.
- **Location:** `src/app.ts:455-463`, `src/automations.ts:140-152`, `src/db.ts:274` (`LIMIT 500`).
- **Evidence:** A run on port 3461 returned `{sent:2, skipped:2}` with no confirmation (synthetic DB in `$S/verify-fd-access-batch/`).
- **Fix:** Store `author='staff'` and the real staff identity on the broadcast and on each message. Require a recipient-count preview and a confirmation token above N. Rate-limit per clinic per day. Restrict broadcasts to an owner role once per-user accounts exist. Send from a background queue.

#### SEC-FD-16: No individual accountability: shared password, a self-typed staff name, and no read audit
- **Sev:** medium. **Repro:** REPRODUCED. **Effort:** L (per-user accounts) or S (interim). **Before real data:** yes.
- **Exploit:** Someone who knows the shared password signs in as "Dr Owner (Admin)" or as a colleague. Every write is credited to that typed name, and thread reads leave no record at all. The clinic cannot detect snooping or investigate a breach under PHIPA s.12(2) and O.Reg 329/04 s.6.3.
- **Location:** `src/app.ts:166-171,185`, `src/app.ts:245-254` (`GET /conversations/:id` writes nothing), `src/db.ts` schema (no audit table).
- **Evidence:** `$S/frontdesk-access/access.test.ts` test 9: `created_by='staff:Dr Owner (Admin)'`. `$S/verify-compliance-batch/run.sh`: a read with the name "Somebody Else" changed no rows. Builds on deep-dive item 1.
- **Fix:** Per-user accounts, with identity taken from the account record and not from the login body (EHRM SSO is planned). Add an append-only, hash-chained `access_events` table (actor, role, action, contact id, timestamp, IP) covering reads, exports, broadcasts and setting changes, and review it weekly. As an interim step, store the IP and a session id with every record.

#### SEC-FD-17: The cloud SQLite holds message bodies, transcripts and notes in plaintext, with no backups
- **Sev:** medium. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** yes.
- **Exploit:** A leaked disk snapshot, volume backup or stolen disk exposes every patient's messages and call transcripts in clear text. That is a notifiable loss under PHIPA s.12. Whether it happens depends on deployment: the code neither ensures nor documents volume encryption. With no backups, a disk loss destroys data.
- **Location:** `src/db.ts:124-129` (default umask, no encryption), `src/db.ts:51-63,105-117`, `src/channels/voice.ts:97-108`.
- **Evidence:** `$S/verify-compliance/atrest.mjs`: modes db/wal/shm `644` and directory `755`, and all three synthetic markers were found verbatim in the file bytes. The "another tenant process" scenario does not apply, because tenants share one process. README:138 lists encryption and backups as to-do.
- **Fix:** Use a managed database in ca-central with encryption at rest, PITR backups and a tested restore, or at minimum encrypted volumes plus nightly encrypted off-host backups. Encrypt free-text columns with AES-GCM under a KMS key, as EHRM `atrest.mjs` does. Set umask 077 so files are 0600 and the directory 0700.

#### SEC-FD-18: No retention limit, purge, per-person erase or export in the cloud
- **Sev:** medium. **Repro:** REPRODUCED (route and SQL inventory). **Effort:** M. **Before real data:** yes (the plan depends on it).
- **Exploit:** No attacker is needed. Message bodies, AI drafts and full voice transcripts are kept forever, so every other finding (FD-01, FD-14) exposes the full history. The clinic cannot erase one person or delete them from providers. This contradicts the "purge 30 days after the EHRM acknowledges" plan.
- **Location:** `src/app.ts` (42 routes, none for delete, export or purge), `src/db.ts:357` (the only DELETE, used for drafts), `src/automations.ts:33`, `src/channels/voice.ts:98-108`.
- **Evidence:** `$S/verify-compliance/retention-routes.sh`. Access requests can already be answered by hand through existing GET routes, so only the export is a convenience gap.
- **Fix:** Add a retention job that nulls bodies, transcripts and summaries N days after the EHRM acknowledges them (0 days for template-only clinics), keeping the metadata. Stop storing `calls.transcript` in the cloud. Add staff "erase this person" (including Twilio, ElevenLabs and Postmark deletion APIs) and "export this person", each written to the audit table. Publish the retention schedule.

#### SEC-FD-19: Each AI turn sends name, phone, email and 40 raw messages (clinical text, staff notes) to US processors, with no agreement gate
- **Sev:** medium. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** yes.
- **Exploit:** No attacker is needed. A patient's MRI and medication details, plus staff notes such as claim numbers, go to Anthropic on every turn. Voice content goes to ElevenLabs, which also receives the patient's name for any presented caller ID. Nothing checks that an O.Reg 329/04 s.6 agreement or BAA with zero data retention is on file. This is more than minimum necessary under PHIPA s.30.
- **Location:** `src/ai/prompt.ts:63-75`, `src/ai/receptionist.ts:20-46,60-77`, `src/channels/voice.ts:55-66`, `src/seed.ts:44` (AI mode defaults to `auto`).
- **Evidence:** `$S/verify-compliance/ai-disclosure.ts`: phone, email and clinical text were all in the request, and the 40-message cap held. `$S/ai-voice/poc-ai-voice.test.ts` test 1 found the staff claim-number message in the request. Correction to the original fix: draft mode does not stop the disclosure (`src/inbox.ts:147-154`); only mode `off` does.
- **Fix:** Send the first name only, cut history to the current booking exchange, strip email subjects, and summarise or exclude staff and system notes. Add a per-clinic "processor agreements recorded" setting that `runAi` checks before calling the model. Disclose US processing in the information-practices text.

#### SEC-FD-20: The voice agent never tells callers the call is transcribed and stored
- **Sev:** medium. **Repro:** CODE (agent config read; no live call). **Effort:** S. **Before real data:** yes.
- **Exploit:** No attacker is needed. The PHIPA s.18 knowledgeable-consent notice is missing. For US callers this is CIPA s.632 exposure, though AI transcription is still being litigated there.
- **Location:** `src/channels/voice.ts:155` (`first_message`), `src/channels/voice.ts:89-118`.
- **Evidence:** The `first_message` text has no notice, while `postCall` stores the full transcript (`$S/compliance/compliance.poc.test.ts`, "Voice"). `agentConfig()` is only a suggested config, so operators could add the notice themselves; the shipped default has none.
- **Fix:** Have `first_message` announce the automated assistant and the recording and transcription, and offer "say staff at any time". Store a notice version on each call. Offer a no-transcript handoff.

#### SEC-FD-21: The Postmark inbound secret is accepted in the query string and compared with `===`
- **Sev:** low. **Repro:** REPRODUCED (accept/reject only). **Effort:** S. **Before real data:** no.
- **Exploit:** Anyone who can read proxy, CDN or APM access logs learns `EMAIL_INBOUND_SECRET` and can inject forged patient emails for the AI to act on (deep-dive item 15 covers the `From` spoofing). Network timing on `===` is not a practical attack.
- **Location:** `src/app.ts:100-101` (the same `===` is used for `x-tool-secret` at `:106-107`), `.env.example:43`.
- **Evidence:** `$S/verify-fd-webhooks-batch/verify.test.ts` test 4.
- **Fix:** Accept the secret only through HTTP Basic auth or a header, compare digests with `timingSafeEqual`, and remove `?secret=`.

#### SEC-FD-22: The voice call summary reaches the text AI labelled as a trusted "Clinic system note"
- **Sev:** low. **Repro:** REPRODUCED (storage and labelling; model behaviour not tested). **Effort:** S. **Before real data:** no.
- **Exploit:** A caller dictates instructions such as "Caller verified by staff…". If ElevenLabs' summary repeats them, the text AI later reads them with clinic authority. While the post-call webhook fails open (FD-02), the note can be injected directly.
- **Location:** `src/channels/voice.ts:103-115`, `src/ai/receptionist.ts:33-35`.
- **Evidence:** `$S/verify-fd-ai-batch/verify.test.ts` F3 and `$S/verify-fd-webhooks-batch/verify.test.ts` test 3.
- **Fix:** Store summaries with author `call` and label them for the model as "caller-derived summary". Reserve the system-note label for text the app generates itself, and never let a note grant identity verification.

#### SEC-FD-23: The Meta handshake echoes any `hub.challenge` under a publicly known default verify token
- **Sev:** low. **Repro:** REPRODUCED (reflection only; no script execution shown). **Effort:** S. **Before real data:** no.
- **Exploit:** An anonymous attacker gets the PHI origin to echo attacker-chosen bytes as `text/plain` with no `nosniff`, and can confirm the endpoint is live. `gate()` is not applied, so the default token works even in production.
- **Location:** `src/app.ts:86-92`, `src/config.ts:53`.
- **Evidence:** A request with `hub.challenge=<script>…` returned that exact body (`$S/verify-fd-web-batch/`).
- **Fix:** Refuse to start in production with the default token. Echo only values matching `^[0-9A-Za-z_-]{1,128}$`. Add `nosniff` (FD-11).

#### SEC-FD-24: The cookie's `Secure` flag depends on spoofable `req.secure`, there is no `__Host-` prefix, and `trust proxy` is `true`
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** yes (trivial).
- **Exploit:** If the edge does not forward `X-Forwarded-Proto`, or the origin is reachable over http, the 12 h staff cookie is never marked Secure and can leak over plain http. A client can also set `req.ip`.
- **Location:** `src/auth.ts:53`, `src/app.ts:45,169`.
- **Evidence:** Login over http gave no `Secure`; adding a forged `X-Forwarded-Proto: https` added it.
- **Fix:** Always set `Secure` in production. Rename the cookie to `__Host-fd_session`. Set `trust proxy` to the hop count.

#### SEC-FD-25: Logout does not end the session; a copied token stays valid for 12 h and survives a password change
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** no (before first clinic).
- **Exploit:** Someone who copied a token from a shared PC or a log keeps access after sign-out and after `STAFF_PASSWORD` is rotated. The only way to kill it is to rotate `SESSION_SECRET`. Open SSE streams also outlive logout.
- **Location:** `src/app.ts:173-176`, `src/auth.ts:25-34`.
- **Evidence:** `$S/frontdesk-access/access.test.ts` test 1. After logout the token still got 200 as a cookie and as Bearer.
- **Fix:** Put a `jti` in the token and keep a server-side session table (or deny list). Add a credential version and an idle timeout. Send `Clear-Site-Data` on logout.

#### SEC-FD-26: No CSRF defence beyond SameSite=Lax; the API accepts form-encoded POSTs from any Origin
- **Sev:** low. **Repro:** REPRODUCED server side only (no browser attack run). **Effort:** S. **Before real data:** no.
- **Exploit:** An attacker-controlled sibling subdomain, or any future weakening of SameSite, can post a form to `/broadcast` or `/tasks`.
- **Location:** `src/app.ts:49-50` (global `urlencoded`), `src/auth.ts:53`.
- **Evidence:** `$S/frontdesk-access/access.test.ts` test 7: `Origin: https://evil.example` with a form body returned 201.
- **Fix:** Check `Origin` on cookie-authenticated non-GET `/api` requests. Mount `urlencoded` only on the Twilio webhook. Consider SameSite=Strict.

#### SEC-FD-27: A malformed session cookie or a body-parser error returns 500 with a logged stack trace
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** no.
- **Exploit:** Someone who can plant `fd_session=%` (sibling subdomain or extension) locks staff out with 500s. Oversized or odd-charset bodies on public webhooks produce 500s and fill the log.
- **Location:** `src/auth.ts:47` (unguarded `decodeURIComponent`), `src/app.ts:495-506`.
- **Evidence:** `$S/web/web-hardening.test.ts` tests 3 and 4. A 3 MB body got 500 instead of 413, and `charset=foo` got 500 instead of 415.
- **Fix:** Wrap the decode in try/catch and treat failure as no session. Honour a 4xx `err.status` in the error handler.

#### SEC-FD-28: PHI API responses carry no `Cache-Control: no-store`
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** yes (trivial).
- **Exploit:** On a shared reception PC, the next person recovers contact lists and threads from the browser cache or with Back after sign-out.
- **Location:** `src/app.ts:487`.
- **Evidence:** `$S/web/web-hardening.test.ts` test 2.
- **Fix:** Send `Cache-Control: no-store` on every `/api` response and `Clear-Site-Data: "cache"` on logout.

#### SEC-FD-29: A retried ElevenLabs post-call delivery returns 500 instead of an idempotent 200
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** no.
- **Exploit:** A provider retry hits the unique index and gets 500, so call summaries may be lost or the webhook auto-disabled (ElevenLabs' retry behaviour was not verified). The replay-overwrite claim was refuted (see Appendix A).
- **Location:** `src/channels/voice.ts:110` (no `messageExists` check), `src/channels/voice.ts:23` (`toleranceS = 1800`).
- **Evidence:** `$S/verify-fd-webhooks-batch/verify.test.ts` test 2 and `$S/webhooks/poc.test.ts` test 6.
- **Fix:** Check `messageExists('voice', 'call:<id>')` or use `ON CONFLICT DO NOTHING` and return 200. Lower the tolerance to about 5 minutes.

#### SEC-FD-30: The voice agent ignores a staff pause or handoff, and a voice handoff silences the text AI
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** no.
- **Exploit:** After staff pause a thread (complaint, suspected impersonation), a caller with that number can still book and cancel. A spoofed call can pause the patient's text AI.
- **Location:** `src/channels/voice.ts:73-85`, `src/ai/tools.ts:232-243`.
- **Evidence:** `$S/verify-fd-ai-batch/verify.test.ts` F4.
- **Fix:** Refuse state-changing voice tools when `ai_enabled=0` or `needs_attention` is set. Record who paused a thread, and keep the voice pause separate from the text pause.

#### SEC-FD-31: `reschedule_appointment` has no past-time or minimum-notice check
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** no.
- **Exploit:** A confused or injected model moves a visit into the past, where it drops out of "upcoming" and reminders misfire. The practitioner-offers-service check is also missing (CODE only).
- **Location:** `src/booking/builtin.ts:96-112`.
- **Evidence:** `$S/verify-fd-ai-batch/verify.test.ts` F5.
- **Fix:** Reuse `isOpenSlot` with `MIN_LEAD_MS`, check that the practitioner exists and offers the service, and run it in a transaction as `book` does.

#### SEC-FD-32: Reminder templates name the service and the "Dr." practitioner over channels with no BAA
- **Sev:** low (medium if US clinics are onboarded). **Repro:** CODE (verifier); the original PoC reproduced it. **Effort:** S. **Before real data:** no.
- **Exploit:** No attacker is needed. A text like "Chiropractic initial visit with Dr. …" goes through Meta and Postmark, which is more than minimum necessary. Overlaps deep-dive item 12.
- **Location:** `src/seed.ts:51,57`, `src/automations.ts:163-177`.
- **Evidence:** `$S/compliance/compliance.poc.test.ts` ("US HIPAA minimum necessary").
- **Fix:** Use generic default templates, a per-service `patient_label`, and a jurisdiction and BAA flag per clinic and channel.

#### SEC-FD-33: No go-live gate: production boots with the demo seed and simulated channels, and `/healthz` always reports ok
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** no (before first clinic).
- **Exploit:** No attacker is needed. A misconfigured deploy runs "healthy" with simulated sends and a demo clinic, and automation errors go only to `console.error`. Correction: missing webhook secrets do fail closed in production, but only per request.
- **Location:** `src/server.ts:6-19`, `src/app.ts:491`, `src/automations.ts:33,35,108`.
- **Evidence:** A boot with `NODE_ENV=production` printed "Seeded demo clinic" and `sms=simulated`, and `/healthz` returned `{"ok":true}`.
- **Fix:** Add a production preflight that refuses on defaults (FD-01), simulated channels, a missing backup target or a missing retention setting. Make `/healthz` report DB writability, the last automation tick, the failed-send rate and the backup age. Use structured logs without message bodies.

#### SEC-FD-34: US SMS has no Messaging Service/10DLC binding, no `statusCallback` and no quiet hours (unproven at carrier level)
- **Sev:** low. **Repro:** CODE (not tested against carriers). **Effort:** M. **Before real data:** no (US only).
- **Exploit:** For a US clinic, unregistered or filtered traffic fails silently because delivery errors are never captured.
- **Location:** `src/channels/sms.ts:24-33`.
- **Evidence:** The request carries only `From`, `To` and `Body`.
- **Fix:** Use a per-clinic Messaging Service SID with a registered campaign, a `statusCallback`, and recipient-local quiet hours (8:00-21:00).

### 3.2 EHRM

#### SEC-EH-01: The consent directive (W16 lockbox) is not enforced on chart-filed documents
- **Sev:** medium. **Repro:** REPRODUCED. **Effort:** S. **Before real data:** yes.
- **Exploit:** A practitioner on the clinic laptop who is not named in the patient's directive, but is assigned (any desk, ops or portal booking assigns them), lists and downloads chart-filed documents such as referral letters and signed forms. The same practitioner gets `403 needs_override_basis` on the chart. No `directive.override` is raised; the reads are logged as plain `files.read` and `files.download`.
- **Location:** `server.mjs:~2383` (`mayView`), used by `GET /api/patients/:id/files` (~2393) and `GET /api/files/:id/download` (~2423). `lockbox()` (~1220) is not called on either route.
- **Evidence:** `$S/verify-ehrm/lockbox-files.mjs` (and `$S/ehrm/poc-http.mjs`): chart 403, file list 200, download 200 with all bytes, and 0 override rows. No test covers files (CP5, CP16 and A11 cover chart, intake, FHIR and HEP).
- **Fix:** On practitioner access to `chart=1` files, call `lockbox(ctx, p)`. Refuse with `needs_override_basis` when no basis is given, and call `overrideFlag()` when one is. Hide restricted files in the list and count them as hidden. Decide deliberately whether admin-only uploads tagged `treating` should also be locked. Add a regression test.

#### SEC-EH-02: Set-password links go back to the person who made them: the ops manager can become front desk, and the owner can become any practitioner
- **Sev:** medium. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** yes.
- **Exploit:** A signed-in ops manager (W12: no contact data) creates a `front_desk` account, receives the link in the 201 response, sets the password and signs in. They then read every patient's contact details, insurance, files, desk notes and billing. In real mode the new account's enrol-scope session lets them enrol their own TOTP too. In the variant, the owner resets a practitioner, uses the link, and reads charts as "assigned" with no break-glass entry. The verifier rated that variant low, because the owner is custodian and has other paths (see EH-03).
- **Location:** `server.mjs:3339-3359` (`POST /api/users`), `server.mjs:~3413-3416` (password reset), `server.mjs:3734-3760` (`setOwnPassword` needs only the token), `server.mjs:1502` (enrol routes), `compliance.mjs:32`.
- **Evidence:** `$S/verify-ehrm/ops-to-desk.mjs`: ops got 403 on contact, created the account (201), set-password 200, login 200, then contact 200 with every field and a 613-person list. The incident count stayed 0. `$S/verify-ehrm-batch/v-http.mjs` covers the owner-reset variant. Each step is audited and points back to the creator.
- **Fix:** Never return the token to a creator who is not the owner. Accounts made by ops wait for owner activation, with the link shown only to the owner or printed for in-person handover, or the link is bound to a second secret the creator never sees. Raise an incident when `password.set` comes from the creator's address or device within a short window. On the owner review, flag chart reads by an account within N hours of an owner reset, along with owner-created practitioner accounts and owner-made bookings.

#### SEC-EH-03: Assignments never expire: one booking, even if cancelled straight away, gives lasting full chart access
- **Sev:** medium. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** yes.
- **Exploit:** Front desk, ops or owner (all hold `schedule.write`) books any patient with any practitioner and cancels immediately. That practitioner keeps "assigned" access to the full chart, contact, files and FHIR export with no break-glass. A role barred from clinical data can therefore grant clinical access.
- **Location:** `server.mjs:1651` (desk), `1765` (reschedule), `3153-3159` (portal), `1247` (treated), `1209` (`isAssigned` only checks that a row exists). There is no DELETE or UPDATE on `assignments` anywhere.
- **Evidence:** `$S/verify-ehrm-batch/v-http.mjs` part 4: before 403, book 201, cancel 200, after 200 `assigned`.
- **Fix:** Mark booking-made assignments as provisional. Promote them to "treated" on arrived or seen. Expire them on cancel or no-show, and expire every assignment after about 18 months with no visit. List grants made by non-clinical roles on the owner/auditor review.

#### SEC-EH-04: Someone who can write `clinic.db` without the passphrase can truncate the sealed audit chain, or downgrade and rewrite it
- **Sev:** medium. **Repro:** REPRODUCED (real mode, scratch folder, synthetic passphrase). **Effort:** M. **Before real data:** yes.
- **Exploit:** Another Windows user, malware, or an insider hiding a break-glass drops the append-only triggers and deletes the tail rows. Or they set `at_rest.audit_keyed_from` to 1e12, edit a row and re-hash with unkeyed SHA-256. The next start still prints "Audit log sealed and checked as untouched". This contradicts CHANGES-2026-10-27 item 3.
- **Location:** `server.mjs:1095-1099` (`keyed_from` read from an unauthenticated row), `compliance.mjs:540-549` (no head anchor; reports `keyed:true` even for the unkeyed prefix), `server.mjs:219-222` (triggers only created for new files and never checked).
- **Evidence:** `$S/verify-ehrm-batch/v-poc-audit-chain.mjs` and `$S/ehrm/poc-audit-chain.mjs`: after truncation, ok and 4 rows; after the downgrade and edit, ok, keyed and the start check passed. The only trace was `rows_before_seal=999999999999` in the health output.
- **Fix:** Store an HMAC under the audit key over `keyed_from`, and refuse to start when it fails or exceeds `MAX(id)+1`. Write a head anchor (last id, hash, HMAC) to `keys/` or the backup folder at every shutdown and backup and include it in backup manifests; alert when the database is behind it. Check for the triggers at start, recreating them and raising an incident if they are missing. Report `keyed` truthfully.

#### SEC-EH-05: Backups are encrypted but not authenticated, so a planted backup restores as "intact"
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** no (before first clinic).
- **Exploit:** Someone with write access to the backup drive builds a database containing their own owner account and no `at_rest` row, then encrypts it with the public backup key. After a restore, that owner can sign in at the laptop. They cannot read the real backups, and the clinic would see a wrong or empty patient list, so the impact is mainly integrity and availability.
- **Location:** `restore.mjs:54-58` (`keyMatches=null` is not refused; `keyedFrom` falls back to Infinity), `server.mjs:1090-1091`, `atrest.mjs:~350`.
- **Evidence:** `$S/verify-ehrm-batch/v-poc-backup-forge.mjs` and `$S/ehrm/poc-backup-forge.mjs`.
- **Fix:** Treat `keyMatches=null` as a failure. Refuse a non-empty file with no `at_rest` row. MAC the manifest (sha256, size, audit head) with a key derived from the passphrase or the data key, and check it before restore writes anything.

#### SEC-EH-06: Field encryption uses a constant AAD, so sealed values can be swapped between patients undetected
- **Sev:** low. **Repro:** REPRODUCED. **Effort:** M. **Before real data:** no.
- **Exploit:** Someone with write access to the file moves an anticoagulant alert, phone number or draft note to another patient, and it decrypts cleanly.
- **Location:** `atrest.mjs:207,213`.
- **Evidence:** `$S/verify-ehrm-batch/v-poc-field-swap.mjs` and `$S/ehrm/poc-field-swap.mjs`.
- **Fix:** Version the format with an `e2:` prefix whose AAD is `table|column|row id`, and re-seal at start.

#### SEC-EH-07: PHIPA reporting gaps: no s.6.4 annual breach-count export, no extension or deemed-refusal flow, no patient column in the audit log
- **Sev:** low. **Repro:** CODE. **Effort:** M. **Before real data:** no (the s.6.4 report is due 1 March 2027).
- **Exploit:** No attacker is needed. The owner counts incidents by hand for the IPC report, overdue access requests are never shown as deemed refusals (s.54(7)), and per-patient audit answers mean parsing free text. These match the known open items C7, C8 and C12 in COMPLIANCE-MATRIX.md.
- **Location:** `server.mjs:215-220`, `server.mjs:3418-3615`.
- **Fix:** Add `GET /api/compliance/annual-report?year=`. Add `extension_until`, `extension_notice_at`, a `deemed_refused` state and a statement-of-disagreement record. Add `patient_id` to `access_events`.

#### SEC-EH-08: Consent evidence does not record the wording version, and marketing consent is one flag for all channels
- **Sev:** low. **Repro:** CODE. **Effort:** S. **Before real data:** no (before the cloud delivery path ships).
- **Exploit:** No attacker is needed. Under CASL s.13 the burden of proof is on the sender, and the clinic cannot show what wording the person agreed to, per channel. Desk registration always sets marketing consent to 0, so marketing consent is never captured there.
- **Location:** `server.mjs:165,168,1888-1892`.
- **Fix:** Add `consent_text_version` (a hash of the wording shown) and rows per channel and purpose (e.g. `sms.marketing`). Sync only the booleans plus the version to the cloud.

### 3.3 Both systems

#### SEC-X-01: The planned EHRM-to-cloud link has no safe contract yet: payload contents, credential storage, outbox, and trust in cloud input
- **Sev:** low (advisory design checklist; becomes high if built on today's code). **Repro:** CODE (no outbound code exists yet). **Effort:** L. **Before real data:** yes, before pairing any EHRM with the cloud.
- **Exploit:** If release starts pushing as the code stands: outreach merge variables carry the first name, the practitioner and `/x/<bearer token>`; the day-1 card points at `127.0.0.1`, so making it work would mean hosting exercise pages (health content) in the cloud; the `settings` table is plaintext in the live `clinic.db`, so a cloud token or Ed25519 key stored there would be readable; release has no outbox, idempotency key or audit row per send. On the cloud side, the EHR webhook uses one shared secret with no replay protection (FD-10), and consent can be changed from unverified input (FD-12).
- **Location:** EHRM `server.mjs:3044` (merge variables), `server.mjs:2234` (`publicBase`), `day1.mjs:64,256`, `server.mjs:3063-3070` (release), `server.mjs:186` (settings, not in `SCRAMBLED_COLUMNS`). Front desk `src/app.ts:131-157`, `src/booking/ehr.ts:212-216`.
- **Evidence:** Code reading. Outreach bodies already pass `guardClinical`. Backups are public-key encrypted, so the exposure is the live file only.
- **Fix:** Send a template id and minimal merge fields only. Exercise links become opaque cloud redirect ids that the laptop resolves, or stay laptop-only. Never send program names. Keep the Ed25519 key and cloud token wrapped in `keys/` under the KEK and out of `settings`. Add an outbox with idempotency keys, `send_after`, bounded retries with backoff, timeouts that never block the synchronous request path, and one audit row per attempt. Use per-pairing keys, a signed `timestamp.body` and event-id dedupe in both directions. Treat everything coming down from the cloud as untrusted: verify its signature, apply the markup and wording guards, never render it as HTML, and let withdrawals win, so a compromised cloud can never switch consent on.

---

## 4. Strengths to keep

**Front desk**
- The staff UI renders all data as text nodes through `h()`/`append()`. There is no `innerHTML`, no `eval` and no data-built `href`, so patient text cannot run as script. Inbound email keeps text only.
- The session HMAC and the password are compared with `timingSafeEqual` over fixed-length digests, and the payload is parsed only after the signature checks.
- `PATCH /contacts/:id` uses an allow-list, so `opted_out`, `external_id` and `clinic_id` cannot be mass-assigned. SQL is parameterised throughout.
- `POST /clinics/:cid/appointments` checks `contact.clinic_id === clinic.id` (`src/app.ts:391`). Copy this pattern everywhere.
- Webhook signatures for Twilio, Telnyx (Ed25519 with a 5-minute window), Meta, EHR and ElevenLabs are checked over the raw bytes with constant-time comparison. The Twilio signing URL comes from `PUBLIC_URL`, not from the request's headers. Inbound messages are deduped by a unique index.
- AI tools are scoped to the server-side `ctx.contact` (`ownAppointment`). There is no patient-search tool. The tool loop is capped at 8 rounds, then hands off to staff. Emergencies are handled deterministically.
- Error responses are generic, with no stack traces in responses. Static serving cannot be traversed. The demo build contains no keys.
- The production rule of returning 503 when a webhook secret is missing is right. Only its trigger (`NODE_ENV`) is weak.

**EHRM**
- Sessions are random 192-bit tokens stored only as hashes, with idle locks per role and revocation on logout, deactivation and password change. There are no cookies. Host, Origin and Sec-Fetch checks block cross-site and DNS-rebinding attacks.
- Login uses scrypt with a dummy hash for unknown users and backoff per user and address. TOTP has replay protection. Recovery codes are single-use and hashed. The setup token is loopback-only and expires.
- Projections deny by default and are checked by `assertPolicy` at boot. Break-glass requires a typed reason. The portal is bound to the session's patient. The brain-export gate is strict.
- Uploads are checked by MIME allow-list, magic bytes and a markup scan, and downloads are always attachments with `nosniff`. The CSP uses per-response nonces.
- Fields use AES-256-GCM with random nonces, and keys are wrapped under a scrypt KEK. Backups use public-key encryption, so the nightly job never needs the passphrase. Real mode refuses `NODE_OPTIONS`, old Node versions, cloud-sync folders and a second running copy.
- `errlog.mjs` logs only the route pattern, status and error type. This is the right model for the cloud as well.
- The EHRM makes no outbound network calls (C10). Consent events record time, method and actor. Outreach requires express marketing consent. COMPLIANCE-MATRIX.md separates verified facts from inferences; extend it with the cloud's rows.

---

## 5. Fix plan in three waves

### Wave 1: before any real patient data
In order:
1. **FD-01**: refuse to start on defaults, add a login limiter, set `trust proxy` correctly. (S)
2. **FD-02**: fail closed on webhooks everywhere, mount only configured providers, cap entries, NANP allow-list. (M)
3. **FD-03, FD-04, FD-05**: identity hardening: caller ID is only a hint, a one-time code before appointment access, AI-collected contact details held as "proposed" only, no linking by email, reply on the inbound address. (M, mostly shared code)
4. **FD-06, FD-07**: suppression table across all channels, normalised revocation, consent table, express-consent gate on broadcasts and marketing automations, unsubscribe headers. Until that ships, switch broadcasts and marketing automations off. (M)
5. **FD-12**: hide `/simulate` behind a flag. (S)
6. **FD-11, FD-24, FD-28**: header middleware, `__Host-` Secure cookie, `no-store`. (S)
7. **FD-14, FD-16, FD-13**: per-user accounts bound to clinics, the `owned()` helper, audit table, integration fields removed from the profile. (L)
8. **FD-17, FD-18, FD-19, FD-20**: encrypted Canadian hosting with backups, retention purge and erase, minimised AI payload with an agreement gate, voice notice. (M)
9. **FD-10 and SEC-X-01**: per-pairing keys and replay protection, before any EHRM pairing. (M to L)
10. **EH-01, EH-02, EH-03, EH-04**: lockbox on files, out-of-band links, provisional and expiring assignments, anchored audit chain. (S to M each)

### Wave 2: before the first clinic goes live
- FD-08 (budget and rate limits), FD-09 (booking caps), FD-15 (broadcast confirmation and attribution), FD-21 (Postmark secret), FD-22 (summary labelling), FD-23 (Meta token), FD-25 (revocable sessions), FD-26 (Origin check), FD-27 (500s), FD-30 (voice respects pause), FD-33 (go-live preflight and real health checks).
- EH-05 (authenticated backups), EH-08 (consent wording version), EH-07 (annual report export, due 1 March 2027).

### Wave 3: before scale (several clinics or US clinics)
- FD-29 (idempotent post-call), FD-31 (reschedule validation), FD-32 (generic templates, BAA flags), FD-34 (10DLC, `statusCallback`, quiet hours).
- EH-06 (row-bound AAD with a re-seal migration).
- Per-clinic EHR credentials in place of the global key (finishes FD-13 and FD-10). A dependency CVE scan (`npm audit` was not run because internet access was not allowed). An external penetration test of the deployed cloud.

---

## 6. Skills each area used

| Area | Skills loaded | Notes |
|---|---|---|
| fd-access (auth, tenancy, staff API) | verified-security-sweep, ateam-security-audit:security-audit | `security-review` failed to load (its preamble needs `origin/HEAD`, which this clone lacks) |
| fd-webhooks | twilio-developer-kit:twilio-security-hardening, twilio-developer-kit:twilio-webhook-architecture, verified-security-sweep | |
| fd-ai (receptionist, tools, voice) | ateam-security-audit:security-audit | Scoping and register steps skipped (read-only, scope set by orchestrator); `security-review` failed to load |
| fd-web (browser surface) | verified-security-sweep | `security-review` failed to load |
| ehrm | verified-security-sweep, ateam-security-audit:security-audit | |
| compliance (PHIPA, CASL, TCPA, HIPAA) | legal:compliance-check, audit-suite:audit-as-prod-readiness, operations:risk-assessment, twilio-developer-kit:twilio-compliance-traffic | |
| Lead consolidation | none | Merging, dedupe and severity arbitration only |

---

## Appendix A: Refuted, overstated or merged claims

**Refuted or dropped:**
- **ElevenLabs post-call replay "overwrites the call record"** (FD-29): refuted. A replay must be byte-identical to pass the HMAC, so `upsertCall` writes the same values again.
- **"`trust proxy` lets an attacker bypass the login limiter"** (FD-01): no limiter exists, so there is nothing to bypass today. Kept only as a design caution in the fix.
- **"Clinic A can read clinic B's EHR patients" through the outbound lookup** (FD-13): overstated. The lookup returns only an id. The real data leak goes through the inbound webhook path, which is what FD-13 now describes.
- **"Live WhatsApp spam to any number"** (FD-02, Meta part): mostly blocked by Meta's 24 h service window (error 131047). This is unproven against real Meta, and the stub reports attempted sends only. The cost and pollution impact remains.
- **"Another tenant process reads the 0644 database"** (FD-17): wrong threat model. Tenants share one process. The real risk is offline copies.
- **"Production boots with missing webhook secrets"** (FD-33): wrong. `gate()` returns 503 in production.
- **"No sender identification in email"** (FD-06): wrong. `From` carries the clinic name.
- **"No CASL consent for active patients"** (FD-07): overstated. Implied consent under an existing business relationship may apply. PHIPA s.33 is the binding rule.
- **"Keep AI on draft mode" as a disclosure fix** (FD-19): wrong. Draft mode still calls the model.
- **"Backup forger gets the clinic's records"** (EH-05): wrong. They cannot decrypt real backups.
- **Reschedule to a practitioner who does not offer the service** (FD-31): code gap only, not demonstrated (three attempts failed on hours).
- **Chrome's 2-minute Lax-POST exception** (FD-26): does not apply, because SameSite=Lax is set explicitly.
- **Clickjacking as a live exploit** (FD-11): blunted by SameSite=Lax. Kept only as defence in depth.

**Merged duplicates:**
- Meta fan-out → FD-02.
- Voice caller-ID findings from fd-webhooks and fd-ai, plus "AI points phone at unverified number" → FD-03 and FD-04.
- Natural-language SMS revocation and non-SMS opt-out → FD-06.
- Both SSE findings → FD-14 (logout aspect in FD-25).
- Both Postmark-secret findings → FD-21.
- Both post-call summary findings → FD-22.
- Staff typed-name identity and no read audit → FD-16.
- Data-minimisation and cross-border disclosure → FD-19 (transcript retention into FD-18).
- Owner-reset break-glass bypass → EH-02.

**Severity changes from the verifiers:**

| Finding | Reviewer rated | Verifier rated |
|---|---|---|
| FD-02 | critical | high |
| FD-05 | critical | high |
| FD-07 | critical | high |
| FD-10, FD-12, FD-13, FD-14 | high | medium |
| FD-17, FD-18, FD-19 | high | medium |
| FD-25 | medium | low |
| FD-22, FD-32, FD-33 | medium | low |
| EH-01, EH-02 | high | medium |
| EH-05 | medium | low |
| Owner-reset variant (in EH-02) | medium | low |
| X-01 | medium | low |

## Appendix B: Not verified
- Real PSTN caller-ID spoofing and STIR/SHAKEN behaviour (FD-03).
- Whether Claude actually follows the injected or socially engineered tool calls. The PoCs script the model (FD-04, FD-09, FD-22).
- Whether ElevenLabs copies caller text into its summaries, and its retry and auto-disable behaviour (FD-22, FD-29).
- Carrier-level handling of `STOP!` and `stop.`, and 10DLC filtering (FD-06, FD-34).
- Meta's real delivery behaviour (FD-02).
- A cross-site browser CSRF attack and reflected-XSS execution (FD-23, FD-26).
- EHRM real-mode TOTP enrolment by the shadow account. It was read from code but not run, because it needs an on-disk database (EH-02).
- Dependency CVEs. `npm audit` was not run, because internet access was not allowed.
