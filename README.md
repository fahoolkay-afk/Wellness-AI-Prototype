# Clinic Front Desk: unified inbox + AI receptionist

WhatsApp-style messaging and GoHighLevel-style CRM, built for physiotherapy,
chiropractic, massage and wellness clinics, with an AI front-desk receptionist
built in.

Patients don't download anything. They text, WhatsApp, Facebook-message, Instagram-DM,
email or call the clinic as they normally would. Every conversation lands in one
staff inbox, and the AI receptionist:

- answers questions about services, prices, hours, insurance and policies
- books, reschedules and cancels appointments
- answers the phone (ElevenLabs voice agent) and takes messages and callback requests
- drafts replies to the general email inbox for staff approval
- creates front-desk tasks for anything it can't finish (receipts, insurance forms, claims)
- hands off to a human when asked, when a patient is upset, or for anything clinical
- tells patients to call 911 or 988 in an emergency and alerts staff

Around the inbox are the CRM tools a front desk uses daily: a contact list with tags, a patient
pipeline (new lead → contacted → booked → active → lapsed), a calendar, tasks, a call log,
**automations** (confirmations, 24-hour reminders, post-visit review requests,
cancellation rebooking, lead nurturing, lapsed-patient re-engagement) and **broadcasts**.

## Two editions, one codebase

| | **Standalone** (`EDITION=standalone`) | **EHR-connected** (`EDITION=ehr`) |
|---|---|---|
| Who it's for | Partner clinics on any practice software | Clinics on our own EHRM |
| Patients and calendar | Kept in this app | Read from and written to the EHRM |
| Jane App clinics | AI sends the clinic's Jane booking link | n/a |
| Everything else | Same inbox, channels, AI, voice, automations | Same |

The editions differ only in which `PracticeBackend` is plugged in (`src/booking/`).
The contract the EHRM must implement is in **[docs/EHR_CONNECTOR_SPEC.md](docs/EHR_CONNECTOR_SPEC.md)**,
and there is a working mock EHR (`npm run ehr:mock`) to build and test against.

## Try it in your browser

`npm run demo:build` packages the real app (server code included) into one HTML file,
`demo/dist/clinic-front-desk.html`, that runs entirely in the browser on an in-memory
database with the demo clinic. Nothing is sent anywhere and data resets on reload. It's the
easiest way to show the product without hosting anything.

## Quick start (no accounts needed)

Requires Node.js 22.18 or newer (it runs TypeScript directly; no build step).

```bash
npm install
```

```bash
npm run demo
```

Open http://localhost:3000. Demo mode creates a sample clinic (made-up people only) and three
staff accounts shown on the sign-in screen: `owner`, `frontdesk` and `auditor`, each with the
demo passphrase printed there. Use the **Test** tab to message the clinic as a patient on any
channel and watch the AI reply in the inbox. Never put real patient data into demo mode.

With no API keys, every channel runs in **simulated** mode (nothing is really sent) and a
keyword-based demo responder stands in for the AI. Add `ANTHROPIC_API_KEY` to use Claude.

To try the EHR-connected edition, run the mock EHR and the app in two terminals:

```bash
npm run ehr:mock
```

```bash
npm run start:ehr
```

```bash
npm test
```

`npm start` (without `DEMO=1`) is production mode: it refuses to start until every safety
setting is in place (keys, https address, backups, webhook secrets); see **Going live**.

## Going live

1. Copy `.env.example` to `.env`. Generate `SESSION_SECRET` and `DATA_KEY` with `openssl rand -hex 32` (two different values) and keep them in a password manager: losing `DATA_KEY` makes stored messages unreadable.
2. Set `PUBLIC_URL` (https), `BACKUP_DIR`, and `TRUST_PROXY_HOPS` if a load balancer sits in front.
3. Create the clinic and its owner on the server: `npm run cli -- create-clinic "Clinic name" America/Toronto`, then `npm run cli -- create-user <username> "Full name" owner <clinicId>`. The owner signs in with the temporary passphrase, chooses their own and enrols a phone-app code (any authenticator app). The owner then adds staff in **Settings → Team**.
4. In **Settings**, record that processor agreements (BAA / data-processing agreements) are signed with each vendor. The AI stays off until this is recorded.
5. `npm start`. If anything is missing, the server lists exactly what and stops.

Then connect each channel. Each one is independent, so you
can start with SMS and add the rest later.

| Channel | Provider | Webhook to configure |
|---|---|---|
| SMS | Twilio **or** Telnyx (`SMS_PROVIDER`) | `/webhooks/twilio/sms` or `/webhooks/telnyx/sms` |
| WhatsApp | Meta WhatsApp Cloud API (direct, no reseller markup) | `/webhooks/meta` |
| Messenger and Instagram DMs | Meta Graph API (Page access token) | `/webhooks/meta` |
| Email | Postmark inbound and outbound | `https://inbound:<EMAIL_INBOUND_SECRET>@your-host/webhooks/email` (Basic auth) |
| Phone | ElevenLabs Agents on the clinic's number | `/webhooks/elevenlabs/init`, `/webhooks/elevenlabs/post-call`, plus server tools (see **Settings → Voice agent** in the app) |
| EHR events | Your EHRM | `/webhooks/ehr` (per-clinic key from `npm run cli -- pair-ehr`) |

Every webhook verifies the provider's signature. A webhook route does not exist until its
secret is configured, so nothing unsigned is ever accepted.

## Security and privacy

How the front desk protects patient information, mapped to PHIPA and FHIR R4. Details and
the full findings register: [docs/SECURITY-REVIEW-2026-10-29.md](docs/SECURITY-REVIEW-2026-10-29.md).

| Control | PHIPA | What it does |
|---|---|---|
| Individual accounts, roles, phone-app codes | s.12, O.Reg 329/04 | No shared password. Owner, front desk, practitioner and auditor roles. 15-minute idle timeout, 12-hour maximum, lockout after 5 wrong tries. |
| Clinic isolation | s.12 | Every record is checked against the clinics a person works at. |
| Audit log | s.10.1 | Who viewed or changed what and when (ids and counts, never message text). Hash-chained and append-only; exports as FHIR `AuditEvent`. |
| Encryption at rest | s.12 | Messages, call transcripts, notes and phone-app secrets are AES-256-GCM encrypted with a per-clinic key. Backups are encrypted too. |
| Consent per channel and purpose | s.18, s.33, CASL | Reminders need consent on that channel; marketing needs express consent. No silent fallback to another channel. STOP, CANCEL and "stop messaging me" are honoured; history exports as FHIR `Consent`. |
| Minimum necessary | s.30 | Texts and social messages the clinic starts never name the service, body area or condition. |
| Wording guard | RHPA | No "Dr.", "osteopath(s)", "diagnosis", "AI", "cure" or "treat" in anything sent to a patient. |
| Identity checks | s.12 | The AI shares or changes existing appointments only after a one-time code to the phone or email on file. It can't change where messages go. |
| Retention | s.13 | Message and call text is cleared after the clinic's retention period; the record of who, when and which channel stays. |
| Access and erasure | s.52, s.55 | A person's data exports as a FHIR R4 `Bundle`; messaging data can be erased (consent and audit history are kept). |

See **[docs/COST_AND_VENDOR_STRATEGY.md](docs/COST_AND_VENDOR_STRATEGY.md)** for the per-clinic cost
comparison (Twilio vs alternatives) and the compliance notes (HIPAA, PIPEDA and PHIPA).

## Architecture

```
 Patients ─ SMS / WhatsApp / Messenger / Instagram / Email ──► webhooks ──► Inbox ──► AI receptionist (Claude + tools)
          └ Phone ─► ElevenLabs voice agent ──► server tools ─┘   │                │
                                                                   ▼                ▼
                       Staff web app (inbox, CRM, calendar) ◄── SQLite ◄── PracticeBackend
                                                                   ▲          ├─ Builtin calendar (standalone)
                                  Automations (events + timers) ───┘          ├─ Jane App link-out (standalone)
                                                                               └─ EHR connector (EHR-connected)
```

| Path | What it does |
|---|---|
| `src/inbox.ts` | Routes inbound messages to clinic, patient and thread; runs the AI; sends replies |
| `src/ai/` | Receptionist prompt, the shared tool set (also used by the voice agent), Claude loop, offline demo responder |
| `src/channels/` | Twilio, Telnyx, Meta, Postmark and ElevenLabs adapters and signature checks |
| `src/booking/` | `PracticeBackend` interface plus the builtin, Jane and EHR implementations |
| `src/automations.ts` | Workflow engine (event and timer triggers, idempotent runs) and broadcasts |
| `src/app.ts` | HTTP API and webhooks |
| `public/` | Staff web app (no build step) |
| `src/ehr-mock.ts` | Mock EHRM implementing the connector spec |

### AI receptionist

`src/ai/receptionist.ts` runs Claude (`claude-opus-5-5` by default, `AI_MODEL` to change)
with a tool loop. The clinic profile (services, practitioners, hours, policies, FAQ) is the
model's only knowledge source, and it sits in a cached system-prompt prefix so repeat
messages are cheap. Server-side refusal fallback is enabled, and a refusal or a loop that
runs too long hands the thread to staff instead of replying.

Per channel, the AI can **reply automatically**, **draft for approval**, or stay **off**
(Settings). Email defaults to drafts. When staff reply in a thread the AI pauses there until
someone turns it back on.

## Before real patient data

This is an MVP. Before using it with real patients:

- Sign BAAs or data-processing agreements with every vendor that touches patient data, and choose hosting in the required region (see the cost and compliance doc).
- Have a privacy officer review the consent wording, the retention periods and the audit-log review routine.
- Consider Postgres for multi-server hosting (SQLite with encrypted fields and encrypted backups is fine for one server).
- Register SMS sender numbers (US 10DLC) and get WhatsApp message templates approved for reminders sent outside the 24-hour window.
- Review the AI's prompt and policies with the clinic, and run it in draft mode first.
