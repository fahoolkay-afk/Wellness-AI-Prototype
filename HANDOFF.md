# Handoff: front desk app (as of 2026-10-31)

## Where it lives

- **Repository:** `fahoolkay-afk/wellness-ai-prototype`, branch `claude/clever-ramanujan-3w5hfu`.
- **Latest commit:** the one that adds this file.
- **Zip:** `frontdesk-2026-10-31.zip`, the same files as the branch.

## What it is

- **Patient channels:** WhatsApp, SMS, voice (ElevenLabs agent), email, Messenger and Instagram, all in one staff inbox. The look is GoHighLevel-style.
- **AI receptionist:** works in demo mode without an API key. It hands anything clinical to a person. In bridge clinics it books nothing itself and passes requests to the EHRM.
- **Two booking modes:**
  - The clinic's own EHRM, through the bridge. The website booking page and sealed patient forms are v1.2.
  - Jane clinics, where patients get the clinic's Jane link in plain words.
- **Security and privacy:** two review passes, consent per channel, STOP/CANCEL handling, wording guards, encryption at rest, and a hash-chained audit log. See `docs/SECURITY-REVIEW-2026-10-29.md` and `CHANGES-2026-10-29.md`.

## State

- `npm test`: 111 of 111 pass.
- Joint check with the EHRM at contract v1.2: 17 of 17 pass ("in sync").
- The EHRM side is at EHRM commit `8979e59` plus its handoff commit. That side is in a separate chat, as `ehrm-bridge-2026-10-31.zip`.

## Open items (owner decisions)

1. **GATE 0:** signed message templates. Nothing goes out until these are decided.
2. **Safety questions on the patient form:** the three questions are placeholders (`public/form.js`). They need the owner's own wording.
3. **Intake v3:** the form uses the current intake until the v3 file is supplied.
4. **Disclosure wording:** placeholder pending the owner and counsel.
5. **Live channels:** Twilio, Meta (WhatsApp, Messenger, Instagram), ElevenLabs and Postmark are not connected. Demo mode simulates them.

## Starter message for the new chat

> This is the front desk app (WhatsApp/GHL-style inbox and AI receptionist) for my clinic. Read CLAUDE.md, HANDOFF.md and bridge-sync/README.md first. It is linked to my EHRM through the bridge in bridge-sync/; the EHRM is worked on in a different chat. Any bridge change goes contract first and must be mirrored on the EHRM side, then checked with the joint check. Run npm test and tell me the state before changing anything.
