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
npm start
```

Open http://localhost:3000 and sign in with password `demo`. A demo clinic with
sample conversations is created on first run. Use the **Test** tab to message the clinic
as a patient on any channel and watch the AI reply in the inbox.

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

## Going live

Copy `.env.example` to `.env`, then connect each channel. Each one is independent, so you
can start with SMS and add the rest later.

| Channel | Provider | Webhook to configure |
|---|---|---|
| SMS | Twilio **or** Telnyx (`SMS_PROVIDER`) | `/webhooks/twilio/sms` or `/webhooks/telnyx/sms` |
| WhatsApp | Meta WhatsApp Cloud API (direct, no reseller markup) | `/webhooks/meta` |
| Messenger and Instagram DMs | Meta Graph API (Page access token) | `/webhooks/meta` |
| Email | Postmark inbound and outbound | `/webhooks/email?secret=…` |
| Phone | ElevenLabs Agents on the clinic's number | `/webhooks/elevenlabs/init`, `/webhooks/elevenlabs/post-call`, plus server tools (see **Settings → Voice agent** in the app) |
| EHR events | Your EHRM | `/webhooks/ehr` |

All webhooks verify the provider's signature. In production (`NODE_ENV=production`) a
webhook without a configured secret is refused.

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

- Replace the shared staff password with per-user accounts and roles (or SSO from the EHRM).
- Sign BAAs or data-processing agreements with every vendor that touches patient data, and choose hosting in the required region (see the cost and compliance doc).
- Move from SQLite to Postgres with encryption at rest and backups, and add audit logging.
- Register SMS sender numbers (US 10DLC) and get WhatsApp message templates approved for reminders sent outside the 24-hour window.
- Review the AI's prompt and policies with the clinic, and run it in draft mode first.
