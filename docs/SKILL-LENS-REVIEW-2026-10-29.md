# Skill-lens review: front desk and EHRM (2026-10-29)

This report merges five reviews. Each one applied a different set of skills to both apps while they were running.

| Lens | Skills loaded |
|---|---|
| Visual | `design:design-critique`, `audit-suite:web-design-guidelines` |
| Accessibility | `design:accessibility-review`, `audit-suite:audit-as-a11y-eng` (plus an axe-core 4.10.2 scan run from scratch) |
| Friction and copy | `audit-suite:audit-as-ux-eng`, `design:ux-copy` |
| Design OS | `design:design-system`, `audit-suite:emil-design-engineering`, `audit-suite:make-interfaces-feel-better`, `audit-suite:web-animation-design` |
| Growth | marketing-plus `onboarding`, `signup`, `emails`, `sms`, `cro`, `churn-prevention`, `referrals`, `marketing-psychology`; small-business `speed-to-lead`, `reactivate`, `review-reputation` |

**How the reviews were run:**
- Neither project was edited. The only project file written is this report.
- All data was synthetic.
- Screenshots were taken at 1440x900 and 390x844.
- Every server a lens started was stopped.

**Evidence labels:**
- **O**: seen in the running app.
- **C**: read in code.

**Scratch root:** `/tmp/claude-0/-home-user-Wellness-AI-Prototype/647041c1-ecdd-5ed7-823b-52ee185d760e/scratchpad/lenses/`. In this report, `visual/`, `a11y/shots/`, `ux/`, `ds-shots/` and `growth/` all sit under that root.

**Security is not covered here.** No security lens result was included in this merge. A security pass (`ateam-security-audit:security-audit` or `verified-security-sweep`) is still open.

## Correction that affects every demo

In demo mode, the EHRM serves the **old v1 `index.html` at `/`** (`/home/user/ehrm/roles-demo/server.mjs:3947`). **v1.2 (`index-v12.html`) is at `/v1.2`** (`server.mjs:3958`). v1.2 is served at `/` only in real-clinic mode (`server.mjs:3940`).

So anyone demoing from `/` sees v1. On v1, the front-desk role hits a dead end: a schedule block opens a profile on the Clinical Notes tab, which the front desk is not allowed to see (`index.html:1208`, `ux/ehrm-desk-03-appt.png`). v1.2 fixes this with a visit sheet.

All EHRM findings below are about v1.2.

**Fix:** in demo mode, serve v1.2 at `/` and move v1 to `/v1`.

## Contradictions resolved

| Topic | Lenses disagreed on | Resolution (checked read-only) |
|---|---|---|
| Phone inbox overflow vs "reflow passes" | Visual: the list is 1564px wide. A11y: there is no page-level horizontal scroll at 320px. | Both are true. At 720px and below, `.inbox` uses a `1fr` track (`public/styles.css:282`). The `nowrap` preview (`styles.css:153`) sets that track's minimum width, and `.view{overflow:auto}` (`styles.css:131`) contains the overflow. The page itself does not scroll sideways, but the list does. It is still a real defect. |
| Number of phone nav items | 12 vs 11 | There are 11 views (`public/app.js:185-187`) plus Sign out (`app.js:254`), so 12 buttons. |
| "3.88:1" | Visual: muted text on the chat background. A11y: the warning pill. | Both are 3.88:1: `#667781` on `#efeae2`, and `#b26a00` on `#fff4dc`. Muted text on `#f0f2f5` is 4.14:1. |
| Primary colour fix | Visual and A11y: use `#008069` for fills. Design OS: change the accent to teal `#0f766e`. | Use `#008069` now as a one-line fix (4.89:1). Move to teal in Design OS v2.0 tokens. White on `#0f766e` is 5.47:1. |
| AI switch | Friction: rename it "Auto-replies on". Design OS: an Auto / Draft / Off segmented control. | Adopt the Design OS control. Whatever the control, new messages must be flagged while the assistant is off (Must-fix 2). |
| "Reply C" | Friction: read in code only. Growth: observed. | Observed by Growth: "C" got the generic fallback reply and created a second staff task. |
| EHRM consent line "I consent to assessment and treatment" (`index-v12.html:2706`) | It contains "treat". | Standard legal consent wording. **The owner decides.** Do not change it automatically. |

---

## 1. Must fix before redesign (correctness, compliance, blockers)

1. **WhatsApp STOP is ignored, and the next campaign goes out by SMS (O).**
   - What happened: Priya sent "STOP" on WhatsApp and stayed opted in. Her next broadcast went out by SMS.
   - Cause: `src/inbox.ts:102` checks opt-out keywords on SMS only, and `src/inbox.ts:230-233` silently switches to another channel.
   - Risk: this breaks CASL and Meta policy.
   - Fix: check STOP on every channel. Keep a consent ledger per channel (type, date, source, expiry). Never fall back to another channel for marketing messages.
   - Evidence: `growth/desk-wa-stop-then-sms-broadcast.png`.
2. **After a staff reply, later patient messages vanish (O).**
   - Sending a reply turns the assistant off (`src/inbox.ts:196`, `app.js:483`). After that, `runAi` returns early (`inbox.ts:139`). The patient gets no reply, there is no "Needs attention" flag and no task is created.
   - Fix: whenever the assistant is off, flag the conversation and create a task.
   - Evidence: `ux/desk-20-reply-C.png`, `ux/desk-21-reschedule-request.png`.
3. **Broadcast has no consent gate, CASL footer, recipient count or channel breakdown (O).**
   - Its free-form WhatsApp text also breaks the rule that business-initiated WhatsApp messages must use approved templates.
   - When the WhatsApp window is closed and the patient has no other channel, it still sends free text on WhatsApp (`inbox.ts:233`), which Meta rejects (`meta.ts:77`).
   - Staff broadcasts are labelled "AI" (`inbox.ts:234`).
   - Code: `app.js:858-860`, `src/automations.ts:140-152`.
   - Fix: send only approved templates, filter by consent, add the footer, preview recipients before sending, and route release through the EHRM.
   - Evidence: `growth/desk-broadcast-confirm.png`.
4. **Banned words in patient-facing text (O+C).**
   - Front desk:
     - "Dr. Daniel Okafor" (`src/seed.ts:26`) is inserted through `{{practitioner}}` into confirmations and reminders.
     - "diagnosis and treatment plan" (`seed.ts:17`).
     - "Follow-up treatment session" (`seed.ts:18`).
     - "Do you treat…" (`seed.ts:38`).
     - The AI's sample phrase "assess and treat" (`src/ai/prompt.ts:42`).
     - The same strings are bundled into `demo/dist/clinic-front-desk.html`.
   - EHRM portal, booking and receipts: "Osteopathic treatment", "a first treatment", "Hands-on treatment" (`server.mjs:33-35`, `seed.json:71,73,75`).
   - The EHRM wording checker has no rule for "treat" or "cure" (`compliance.mjs:336-350`), and it does not check service names.
   - Fix: a display-name map (e.g. "Osteopathic visit", "Initial visit"), plus one shared lint over all patient-facing strings.
5. **The "Reply C to confirm" reminder does nothing (O).**
   - Nothing handles the reply (`demo.ts:102`), and the front desk has no "confirmed" status. EHRM staff then confirm 8 or more visits by hand (`index-v12.html:1579`).
   - Fix: a WhatsApp utility template with Confirm and Change time buttons, a reply handler, and a sync of the confirmed status to the EHRM.
6. **The 24-hour WhatsApp window is invisible in the composer.**
   - The composer shows no window state and has no template picker (`app.js:461`). `staffReply` never checks the window (`inbox.ts:188-202`), so the send only fails afterwards.
7. **Front desk core flows cannot be used by keyboard (O).**
   - Inbox rows are `<div onclick>` (`app.js:335-338`).
   - Pipeline cards can only be dragged (`app.js:647-662`).
   - The confirm dialog does not hold focus, does not respond to Escape and does not return focus (`app.js:105-116`).
8. **EHRM dialog and combobox focus (O).**
   - The booking dialog does not keep focus inside it or return it on close (`index-v12.html:795-810`).
   - The patient search has no arrow keys, and focus is lost after picking (around line 1851-1877).
   - Header focus is white on white (`index-v12.html:500`; one-line fix: drop `.hdr` from that rule).
9. **Front desk phone inbox is 1564px wide (O).**
   - Fix: `.inbox{grid-template-columns:minmax(0,1fr)}` and `.list{min-width:0}`.
   - Evidence: `visual/fd-m-inbox.png`.
10. **Every EHRM role lands mid-page after sign-in (O).**
    - Landing `scrollY` is 550px on desktop and about 1593px on phone.
    - `render` keeps the old scroll when it draws a new page (`index-v12.html:1240-1245`). Fix: `scrollTo(0,0)` when `!same`.
11. **A front desk network failure looks like a logout (O).**
    - `app.js:966` runs `boot().catch(() => renderLogin())`. Fix: show a "Can't reach the server - Retry" state instead.
12. **Demo data contradicts itself (O).**
    - The message says "Thursday", but the booking lands on Sunday, when the clinic is closed (`seed.ts:115-118`).
13. **Social channels invite clinical detail.**
    - The lapsed-patient message asks "How are you feeling?" (`seed.ts:88`), which `prompt.ts:46` forbids.
    - The seed WhatsApp thread stores "lower back pain" and the tag `lower-back` (`seed.ts:112-114`).

## 2. Redesign priorities (Design OS v2)

1. **Front desk phone navigation.** There are 12 buttons and only 6 fit. Use 4-5 tabs plus a "More" sheet, and take Test and Settings out of the daily nav (`styles.css:278`).
2. **A real reschedule in the front desk.** Today it means cancel plus rebook, about 8 clicks and two contradictory messages (`app.js:561`, `seed.ts:71`). Copy the EHRM v1.2 "Move visit" pattern.
3. **Calendar.** Replace the 7-day card strip with the EHRM grid pattern: time axis, practitioner columns, now-line. Make it possible to book from the calendar and to click dashboard rows (`app.js:711-744`, `623-627`).
4. **Callback tasks.** Show the phone number, a tap-to-call link and an outcome field, and replace `callback · ai:voice` with plain words (`app.js:590-599`).
5. **Dashboard hierarchy.** Lead with 3 tiles: Needs a human, Today's visits, Open tasks. Put the 7-day figures in a smaller row, and add funnel rates (see section 3).
6. **AI presence in one place.** Use indigo only for assistant content. Switches should be green when on, not purple (`styles.css:207`). Add the Auto / Draft / Off control.
7. **Undo instead of confirm.** Discard draft (`app.js:455`) and Mark handled (`app.js:407`) currently have no undo.
8. **Remove developer surfaces.**
   - Raw codes: `ai:voice`, `callback_requested`.
   - Vendor names: ElevenLabs, Twilio, Telnyx.
   - `{{tokens}}` shown as text: render them as chips.
   - JSON editors: use forms for automations and the clinic profile (`app.js:824`, `924`).
   - Emoji empty states (`app.js:351`, `375`, `446`).
9. **EHRM: "cut words, not design".**
   - Drop duplicated actions: New Appointment appears 3 times, Clinical Note twice.
   - Drop the hero summary line that repeats the stat cards.
   - Move the "Your Access" rail and the raw permission keys into the profile menu (`index-v12.html:601`).
   - Use fixed action slots in schedule rows.
10. **EHRM phone chrome takes about 35% of the screen.**
    - Put the persona bar in a menu.
    - Give the "+" button a visible label.
    - Fade the edges of the tab row.
    - Below 640px, show patients as cards.
    - Move the toast clear of the server-log bar and the Quick Actions.
11. **EHRM type scale.** There are 15 font sizes; reduce to 6 (12/13/14/16/20/28). Use mono only for IDs and money. "Money Today $0.00" should lead with the booked amount.
12. **Front desk page widths and titles.** Align the 1200px cap (`styles.css:132`), remove the duplicate "Contacts" h3 (`app.js:687`), and format phone numbers instead of showing raw E.164.

## 3. Growth and funnel actions (after Must-fix 1, 3 and 5)

1. **Reminders.** A 48h utility template with Confirm and Reschedule buttons, then a 2h SMS. Add a no-show rebook flow (the `no_show` status already exists in `types.ts:149`).
2. **Plan-of-care nudge.** The EHRM supplies the recommended next-visit date. The front desk nudges patients with nothing booked. A/B test 24h vs 72h.
3. **Lead nurture.** Currently 1 touch. Test 3 touches (24h, 72h, 7d). The first reply should name the clinic. Alert staff about MVA and WSIB leads.
4. **Reviews.** One ask per patient, after a one-tap satisfaction check that still sends the link to everyone who answers (no review gating). Check Ontario college advertising rules on testimonials.
5. **Recall and reactivation.** The 7-day `LOOKBACK` (`automations.ts:14`) blocks 30- and 90-day recall. The first message is a check-in with no pitch, ranked by patient value, and stops on complaint.
6. **Year-end benefits campaign.** First week of November vs first week of December, with a 10% holdout. Express or valid implied consent only.
7. **Referrals.** No incentive. Add a "How did you hear about us?" field and UTM capture.
8. **Engine guards.** Quiet hours, a frequency cap, stop-on-reply, a marketing vs utility category, and a template ID and approval state on `AutomationAction` (`types.ts:72-73`).
9. **Dashboard metrics.**
   - Time to first reply (median and 90th percentile).
   - Lead-to-booked rate within 24h and 7d.
   - Confirm and no-show rates.
   - Visit-2 rate within 14 days.
   - Review rate.
   - Opt-outs per send (under 0.5%).
   - Sends with no recorded consent (must be 0).
10. **Keep:** about 1.5s speed-to-lead with real slots (`growth/desk-sms-speed-to-lead.png`), and booking-only handling of clinical questions (`growth/desk-wa-clinical.png`). Add red-flag triage, because "leg pain after a fall" got none.

The template copy for the top 8 messages is in the Growth lens: booking confirmation, 48h reminder, missed visit, plan-of-care gap, review, year-end benefits, reactivation and referral. All are under 300 characters, contain no banned words and include STOP where required. The EHRM releases the marketing ones (templates 5-8).

## 4. Accessibility fixes (WCAG 2.1 AA)

**Verdicts:** the front desk **needs rework**. The EHRM is **approve with changes**.

1. **Front desk inbox and pipeline keyboard access (F1, F2).**
   - Inbox: a listbox with arrow keys and Enter.
   - Pipeline: cards become focusable buttons with a "Move to..." menu, and each move is announced.
2. **One shared dialog helper for both apps (F3, E2).** Use `inert` on the shell, trap Tab, handle Escape at document level, return focus to the opener, and set `aria-labelledby`.
3. **Live regions.**
   - Front desk: there are none. Add a polite region for toasts and announce "New message" and "AI draft waiting" (F4).
   - EHRM: add `role="alert"` and `aria-invalid` to sign-in and booking errors (E5), and announce "Chosen" in the combobox (E3).
4. **Front desk contrast (F5-F7, F11).**
   - Primary fills to `#008069`.
   - `--muted` to about `#586872`, `--warn` to about `#8a5200`.
   - Dark-theme overrides: `--primary-dark` about `#4fd1b0`, `--warn` about `#f0b54a`, `--danger` about `#ff7b72`.
   - Input borders need at least 3:1 (now 1.25:1 light, 1.47:1 dark).
   - Channel badges: WhatsApp is 1.98:1, voice 2.25:1.
5. **EHRM contrast (E7).**
   - `.faint` inside the strip and server log goes to `#94a3b8` (3.45:1 now).
   - Kiosk hints go to `#5e6b7e` (2.56:1 now). The kiosk is patient-facing.
6. **Labels.**
   - 17 unlabeled front desk controls (`app.js:218`, `462`, `535-545`, `573-576`).
   - Icon-only buttons: back (`app.js:398`), Patient details (`app.js:403`), and the EHRM phone role menu and Book Visit link (E6).
7. **The AI switch.** Give it a focus-visible ring and `role="switch"`, name it "AI receptionist replies to this patient", and give the off-state track a visible border (F8).
8. **EHRM widgets.**
   - Persona picker: remove the fake listbox and use `aria-pressed` (E8).
   - Tabs: implement the full pattern or use `aria-current` (E9).
   - Body map: add a keyboard "Add point" path (E4).
   - Idle countdown: announce it once (E12).
9. **Structure.** Add `<main>`, an `<h1>`, a nav `aria-label` and a skip link in both apps. Fix the heading order. Add `aria-pressed` to the filter tabs.
10. **Touch targets and motion.** At least 44px on `pointer:coarse` (24 of 71 and 66 of 95 targets are under that today). Add a `prefers-reduced-motion` reset in both apps, and remove the 9 `transition:all` rules in the EHRM.
11. **Live refresh drops focus on Approve & send** (`app.js:506-509`, C). Patch draft bubbles in place.

## 5. Copy rewrites (no banned words)

| Where | Now | Rewrite |
|---|---|---|
| Reminder (`seed.ts:57`) | "...Reply C to confirm" | "Hi {{first_name}}, see you tomorrow at {{appointment_time}} with {{practitioner}} at {{clinic_name}}. Reply YES to confirm or CHANGE for a new time." On WhatsApp, a template with Confirm and Change time buttons. |
| Service (`seed.ts:17`) | "Full assessment, diagnosis and treatment plan" | "A full first visit: we go over your history, see how you move, and make a plan with you." |
| Service (`seed.ts:18`) | "Follow-up treatment session" | "Follow-up visit" |
| Practitioner (`seed.ts:26`) | "Dr. Daniel Okafor" | "Daniel Okafor" |
| FAQ (`seed.ts:38`) | "Do you treat WSIB..." | "Can I come in under a WSIB or car-accident claim?" |
| AI prompt (`prompt.ts:42`) | "assess and treat back pain" | "our physiotherapists see many people with back pain; a first visit is a 60-minute assessment" |
| EHRM services (`server.mjs:33-35`) | "Osteopathic treatment", "Hands-on treatment" | "Osteopathic visit", "Initial visit", "Hands-on visit" |
| Lapsed (`seed.ts:88`) | "How are you feeling?" | "Hi {{first_name}}, it's been a while since your last visit to {{clinic_name}}. To book a check-in, reply here or visit {{booking_url}}. Reply STOP to opt out." |
| Cancellation (`seed.ts:71`) | generic | "Hi {{first_name}}, your {{appointment_time}} visit is cancelled. Want a new time? Reply here and we'll find one." |
| Fallback (`demo.ts:103`) | "passed it to our front-desk team" | "Thanks, {first_name}. I've passed this to our front desk. They'll reply here during clinic hours ({{hours}})." |
| Raw error (`demo.ts:111`) | "Sorry, ${res.result}" | "Sorry, that time was just taken. Here are the next openings: ..." Never pass the tool's error text to the patient. |
| Broadcast confirm (`app.js:858`) | "Send this message now to every matching contact?" | "Send to 14 people (3 by WhatsApp template, 11 by SMS)? This can't be undone." Buttons: "Send to 14 people" / "Keep editing". |
| Broadcast result (`app.js:860`) | "Sent to 1 contacts, skipped 3." | "Sent to 1 person. Not sent to 3: 2 opted out of SMS, 1 has no phone or email." |
| Task / visit metadata (`app.js:560,599`) | `callback · ai:voice`, `booked · via ai:whatsapp` | "Callback · from a phone call · 12:47 AM · +1 647-555-0188"; "Booked by the assistant on WhatsApp" |
| Cancel confirm (`app.js:554`) | generic | "Cancel Priya Sharma's visit on Sun, Nov 1 at 2:30 PM? We'll text her that it's cancelled." Buttons: "Cancel visit" / "Keep visit". |
| Search empty (`app.js:351`) | "No conversations yet. Use the Test tab..." | "No matches for 'zzzz'." plus a Clear button. |
| EHRM toast (`index-v12.html:2621`) | "Released and signed. Nothing was sent." | "Approved. It sends at {time} by {channel}." In demo mode: "Approved. Demo mode: messages aren't sent." |
| Composer switch (`app.js:483`) | "AI" | Auto / Draft / Off. Hint for Off: "You're handling this chat. New messages will still be flagged." |

Avoid one-letter replies such as "Reply C". They don't translate well.

---

## Design OS v2 (summary)

**File:** `/tmp/claude-0/-home-user-Wellness-AI-Prototype/647041c1-ecdd-5ed7-823b-52ee185d760e/scratchpad/lenses/DESIGN-OS-v2.md` (701 lines). Screenshots are in `ds-shots/`.

The proposal is **"one family, two registers"**.

- **Scores today:** front desk 48/100, EHRM v1.2 71/100. The document lists 15 inconsistencies between the two apps.
- **Shared base:** one `tokens.css` file with light and dark colour roles and measured contrast for each. Clinic teal `#0f766e` is the single accent.
- **Scales:** channel colours fixed for contrast, an 11-step type scale, 4px-based spacing, and concentric radii (outer corner = inner corner + padding).
- **Motion and layers:** 4 elevation levels, motion from 0 to 300ms with a reduced-motion block, and a fixed z-index scale that keeps toasts above modals.
- **Assistant identity:** one indigo colour and a sparkle icon, used only for the assistant and never on patient-facing EHRM screens.
- **EHRM** keeps the v1 look: navy hero, bordered and shadowed cards, pills with a status dot, mono IDs. The old token names stay as aliases for one release.
- **Front desk** becomes modern and calm: teal instead of WhatsApp green, a cool grey chat background, a light left nav, and the same compact navy hero on non-inbox pages.
- **Components:** 15 specified with their states. Among them:
  - a composer that switches to a template picker when the 24-hour window is closed
  - a campaign builder with steps for template, consent count, quiet hours, EHRM release and wording check
  - Auto / Draft / Off control
  - a "Why this reply?" explanation on drafts
- **Layout:** breakpoints at 0, 640, 1024, 1280 and 1600, on a 12-column grid.
- **Interaction:** optimistic updates with rollback, skeletons only after 300ms, undo instead of confirm, keyboard shortcuts.
- **Copy rules:** a banned-word map applied everywhere patients see text: templates, the assistant's knowledge, service names, receipts, portal, kiosk, exercise pages and the voice greeting.
- **Rollout:**
  - v2.0 tokens: fixes primary contrast, input borders, motion and timestamps.
  - v2.1 components.
  - v2.2 inbox.
  - v2.3 campaign builder.
  - v2.4 EHRM dark mode, opt-in, with owner sign-off.
  - Each step has a Playwright gate for contrast, no `transition:all`, reduced motion, hit targets of 40px or more, no horizontal scroll at 390, and no banned words.

## What to keep

**EHRM v1.2:**
- the dark teal hero and soft cards
- the schedule grid with its now-line and hatched off-hours
- the kiosk keypad
- the sign-in screen grouped by role
- the visit sheet (Check in, Reschedule, Cancel)
- toasts that are already announced correctly

**Front desk:**
- the three-pane inbox and the channel badges
- the dashed AI-draft bubble with Approve / Edit / Discard
- the "AI draft waiting" bar
- fast first replies

## Not checked
- the `/x/<token>` exercise page in the running app (it needs a token link)
- the EHRM ops and auditor roles
- the front desk in dark mode on screenshots
- a security review (pending; see the top of this report)
