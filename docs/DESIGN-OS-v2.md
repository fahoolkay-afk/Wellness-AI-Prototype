# Design OS v2: one family, two registers

Proposal for the clinic's two products:

- **Front desk** (`/home/user/Wellness-AI-Prototype/public/styles.css`, `app.js`) is a cloud inbox and CRM. Today it is styled like WhatsApp Web. The goal is to make it feel *modern, sleek, intelligent*.
- **EHRM** (`/home/user/ehrm/roles-demo/index-v12.html`, plus `kiosk.html`, `hep.html`, `day1.html`) is the records system on the laptop. The goal is to **keep the v1 look** ("cut words, not design").

Method: I loaded four skills (`design:design-system` for the audit/document/extend format, `audit-suite:emil-design-engineering`, `audit-suite:make-interfaces-feel-better` and `audit-suite:web-animation-design`). I applied them to both apps running in Playwright at 1440x900 (light and dark) and 390x844, using synthetic data only.

Evidence tags used below:
- **[OBS]**: seen in the running app. A screenshot path is given.
- **[CODE]**: read in source. A file:line is given.

Screenshots are in `/tmp/claude-0/-home-user-Wellness-AI-Prototype/647041c1-ecdd-5ed7-823b-52ee185d760e/scratchpad/lenses/ds-shots/` (written as `shots/` below).

> **Note on "which EHRM is at /"**: in demo mode, `/` serves **index.html (v1)**, not v12 (`server.mjs:3947`). v12 is served at `/` only in real-clinic mode (`server.mjs:3940`); in demo mode it is at `/v1.2`. Both are captured: `shots/ehrm-v1-*` are from `/` and `shots/ehrm-v12-*` are from `/v1.2`. The token extraction below is from index-v12.html as asked.

---

## Part A: Audit (current state)

### A1. Summary

| | Front desk | EHRM v12 |
|---|---|---|
| Token file | `styles.css:1-28`, 23 tokens, dark mode duplicated twice (`:30-65`) | `index-v12.html:9-18`, ~45 tokens, re-declared and partly overridden at `:493-495` |
| Colour tokens used consistently | Mostly yes. 8 one-off hex values in `app.js` (avatar hues) | No: 63 literal `#fff` and 71 distinct hex values inline in CSS |
| Type scale | None: 11/12/13/14/17/22/26/42px set ad hoc | Partial: `--fs-11…--fs-26` added at `:495` but only used in K5 overrides |
| Spacing scale | None: 2–28px ad hoc | Yes: `--g1..--g5` (8/16/24/32/40) |
| Radius | One token, `--radius:10px`, with 6/8/12/14/20/999 hardcoded | `--r 14`, `--r2 10`, `--r3 999`, with 6/7/8/9/12/18 hardcoded |
| Elevation | One shadow (`--shadow`) | Three (`--sh`, `--sh-h`, `--sh2`) |
| Motion tokens | None. One `transition: 0.15s` (= all) on the switch (`:205-206`) | None. `transition:all` ×9 (`:69,228,244,256,260,372,376,383,414`) |
| `prefers-reduced-motion` | **0 rules** [OBS: computed from stylesheets] | **0 rules** [CODE: grep] |
| Dark mode | Yes (light/dark/auto) | **No.** "dark mode parked" (`:492`) [OBS `shots/ehrm-v12-prac_a-home-d-dark.png` renders light] |
| Focus style | `outline 2px primary` on `.btn`, `.nav button` and `.conv` only (`:265`); inputs fall back to browser default | Global `:focus-visible` navy 2px outline (`:499`), with white on dark surfaces (`:500`) |
| Score (design-system skill rubric) | **48/100** | **71/100** |

### A2. Extracted design language

**EHRM v12, the "v1 look" to preserve** [CODE `index-v12.html`]
- **Colour.** Navy `#0b1220` for the strip, hero, toasts, code and date chips. Teal ramp: `#0f766e` (primary), `#0d9488`, `#14b8a6` (decorative and focus on navy), and `#f0fdfa / #ccfbf1 / #99f6e4` for soft fills and lines. Slate inks `#0f172a / #475569 / #5e6b7e` (ink3 raised from `#94a3b8` at `:493`). Status colours amber, green and red, each in 3 steps. Violet is **retired** and remapped to navy-grey (`:494`).
- **Type.** `Inter → Segoe UI Variable Text → Segoe UI → system-ui` (no webfont is shipped, so the owner's Windows laptop renders Segoe UI Variable). Sizes 26/22/18/15/14/13/12/11. Weights 600/650/700. Headings use `letter-spacing:-.01em`. Body is `tabular-nums` globally (`:496`). Mono (`Cascadia Mono`) is reserved for IDs and invoice numbers in v12 (`:497`).
- **Shape.** Cards have 14px radius, a 1px `--line` border and a two-layer soft shadow (`:15,:80`). The hero is 18px, modals 18px, buttons 10px (sm 8, xs 7, lg 12), inputs 10px, pills full-round with a 6px leading dot (`:60-61`).
- **Signature pieces.** The navy hero with teal radial glow and dot grid (`:102-109`). The privacy "shield" (`:189-197`). Pills with dots. The time box (`.tbox`) and wait timer (`.timer`) (`:130-137`). Schedule blocks with a 4px left status bar (`:323-332`). The navy toast with a teal left edge (`:306`). Dark modal header (`:295`).
- **Motion.** Modal `pop .18s ease-out` plus scrim `fade` (`:289-292`). Skeleton shimmer (`:200`). Spinner (`:202`). Moved-row highlight over 2.4s (`:476`). Hover lift was removed in K5 (`:507`).

**Front desk** [CODE `styles.css`] [OBS `shots/fd-inbox-d-light.png`, `fd-inbox-d-dark.png`]
- **Colour.** WhatsApp palette: primary `#00a884`, primary-soft `#d9fdd3`, chat wallpaper `#efeae2` with a dot pattern, nav `#111b21`. AI violet `#6b4fd8` / `#ebe5ff`. Channel brand colours.
- **Type.** System stack (`-apple-system…Roboto`, `:70`), 14/1.4 body. No tabular numbers anywhere.
- **Shape.** 8px buttons and inputs, 10px cards, 76px icon rail nav, 3-column inbox `340 / 1fr / 300` (`:135`).
- **Signature pieces.** Chat bubbles (incoming white, outgoing green, AI violet, draft with dashed violet border) (`:176-188`). Channel dot on the avatar (`:148`). AI switch (`:203-209`). Kanban (`:240-245`). Week calendar (`:247-255`).

### A3. Inconsistencies between the two (naming, tokens, components)

| # | Issue | Front desk | EHRM | Standard to adopt (v2) |
|---|---|---|---|---|
| 1 | Brand colour | `#00a884` WhatsApp green (`styles.css:8`) | `#0f766e` teal (`index-v12.html:11`) | One accent: **teal `#0f766e`** in both. WhatsApp green survives only as the WhatsApp channel badge |
| 2 | Token naming | `--text/--muted/--panel/--border` | `--ink/--ink2/--line/--teal50` | Semantic roles (`--fg`, `--fg-muted`, `--surface`, `--border`, `--accent`…) in both. Keep the EHRM names as aliases for one release |
| 3 | Font | System UI stack | Inter/Segoe stack | One stack: `"Inter var", Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif` |
| 4 | Button height and radius | ~31px tall, 8px radius, weight 400 (`:81-82`) [OBS 31px] | 36px tall, 10px radius, weight 600 (`:40`) | 36px (md), 32px (sm), 44px (lg); radius 10/8/12; weight 600 |
| 5 | Pill | 11px with no dot (`:123`) | 22px tall, 11px/650, with a leading dot (`:60-61`) | EHRM pill everywhere (the dot carries status) |
| 6 | Card | 10px radius, border only (`:214`) | 14px radius, border plus 2-layer shadow (`:80`) | 14px, border plus `--elev-1` |
| 7 | Toast | Bottom-centre, inverted `--text`, no live region, no action (`styles.css:266`, `app.js:98-101`) | Bottom-right, navy with teal edge, `aria-live` and an action button (`:305-307,468`, `aria-live` at `:549`) | EHRM toast in both |
| 8 | Modal | 12px radius, 380px wide, no focus trap, no motion (`:262-264`, `app.js:104-116`) | 18px radius, `pop .18s`, sizes 640/820/1080 (`:288-302`) | EHRM modal plus a focus trap in both |
| 9 | z-index | Toast 50 sits **below** modal 60 (`:262,266`) | Modal 60, toasts 90, "still there?" 95 | Fixed scale (see B3.9) |
| 10 | AI colour | Violet `#6b4fd8` is used for AI **and** for every on/off switch (`:207`) [OBS `shots/fd-automations-d-light.png`: automations look AI-driven] | Violet retired (`:494`) | Indigo `--ai` for AI presence **only**. Switches use `--accent` |
| 11 | Section header | `13px uppercase .04em` (`styles.css:212`) | Uppercase removed in K5 (`:503-505`) | Sentence case, 12px/600, no tracking |
| 12 | Icons | Emoji as UI icons: 🩺 🤖 📞 ⚡ (`app.js:375,433,446,821`; `seed.ts:123`) | Inline stroke SVG at 15–20px | Stroke SVG only (1.75px stroke, 16/20px). No emoji in chrome |
| 13 | Numbers | Proportional digits, so time stamps and counts jitter | `tabular-nums` body-wide (`:496`) | `tabular-nums` body-wide in both |
| 14 | Dark mode | Yes | No | Both get dark. EHRM dark is opt-in until it is reviewed (owner rejected a stripped look, so dark must keep the hero, shadows and pills) |
| 15 | Motion | Almost none, `transition: 0.15s` (all) | `transition:all` ×9, no reduced-motion handling | Motion tokens, explicit properties, reduced-motion on every rule |

### A4. Findings ranked by user impact

| Rank | Finding | Evidence | Why it matters |
|---|---|---|---|
| 1 | **Patient-facing EHRM text says "Osteopathic treatment"** (two banned words) on the patient portal visit list and receipts | [OBS] `shots/ehrm-v12-ana-home-m-light.png` and `ehrm-v1-ana-home-m-light.png`. [CODE] `seed.json:71,73,75,76,88`. The wording guard covers only HEP and outreach (`server.mjs:2958,3048`) and not service names on portal pages or receipts | Breaks the owner's hard rule on a patient surface |
| 2 | **Front desk patient-facing text uses banned words**: services "Full assessment, **diagnosis** and **treatment** plan…" and "Follow-up **treatment** session" (`src/seed.ts:17-18`); practitioner "**Dr.** Daniel Okafor" (`seed.ts:26`), which flows into the `{{practitioner}}` booking confirmation and reminder templates; FAQ "Do you **treat** WSIB…" (`seed.ts:38`); and the AI prompt teaches "our physiotherapists assess and **treat** back pain" (`src/ai/prompt.ts:42`). All of this is knowledge the AI repeats to patients | [OBS] `shots/fd-inbox-d-light.png` side panel "Dr. Daniel Okafor"; `shots/fd-automations-d-light.png` templates with `{{practitioner}}`. [CODE] as cited | Same rule. The front desk needs the same `guardPatientFacing` check on templates, the knowledge base and AI output |
| 3 | **Primary button fails contrast**: white on `#00a884` = **3.03:1** (needs 4.5:1 at 14px). Affects Sign in, Send, Approve & send, Send broadcast | [OBS] `shots/fd-login-d-light.png`, `fd-inbox-d-light.png`. [CODE] `styles.css:8,86` | Primary actions are hard to read, and this fails AA |
| 4 | **Input and control borders are nearly invisible**: `#e3e6ea` on white = **1.25:1** (needs 3:1 for control boundaries) | [OBS] `shots/fd-broadcast-d-light.png` (fields float). [CODE] `styles.css:5,94` | Forms feel unfinished and low-vision users lose the fields |
| 5 | **Broadcast composes free-form text for every channel**, including WhatsApp. Business-initiated WhatsApp messages must be Meta-approved templates. Automations also hold free-form text (`Booking confirmation`, `Reminder`, `Re-engage`) | [OBS] `shots/fd-broadcast-d-light.png`, `fd-automations-d-light.png` | The UI invites messages that will be rejected, and contradicts the decision that the EHRM owns outreach. v2 adds a template-bound composer (B4.15) |
| 6 | **No reduced-motion handling in either app**; `transition:all` in 9 EHRM rules and the FD switch | [OBS] 0 `reduced-motion` rules in FD stylesheets. [CODE] EHRM grep shows 0 | Vestibular accessibility. `all` also animates layout properties |
| 7 | **Small hit targets**: 24 FD controls under 40px at 1440 (tabs 26px tall, `.btn.small`, tag ×, Mark handled); EHRM 40–47 per role screen (`.btn.xs` 26px; `.pill` actions) | [OBS] Playwright count; `shots/fd-inbox-d-light.png` | Shared-tablet front desk use (EHRM front desk is on a tablet) |
| 8 | **FD toast is silent to screen readers and sits under modals** (no `role=status`; z 50 < 60). The confirm dialog has no focus trap | [CODE] `app.js:98-116`, `styles.css:262,266` | Feedback is lost |
| 9 | **The FD looks like a WhatsApp clone, not a product**: the wallpaper dot pattern, green outgoing bubbles and the robot emoji make it read as a chat app rather than an intelligent front desk; the dashboard is 8 identical number boxes | [OBS] `shots/fd-inbox-d-light.png`, `fd-dashboard-d-light.png` | This is the owner's "modern, sleek, intelligent" ask |
| 10 | **Mobile EHRM: the toast overlaps the server-log footer and the last card** | [OBS] `shots/ehrm-v12-ana-home-m-light.png` | The toast needs `bottom: calc(footer + 16px)` and safe-area |
| 11 | **Chat timestamps are below AA**: `#667781` on chat bg `#efeae2` = 3.88:1 | [CODE] `styles.css:7,17,184` | Small 11px text |
| 12 | **EHRM has no dark mode** but the laptop OS may be dark; FD respects it | [OBS] `shots/ehrm-v12-prac_a-home-d-dark.png` | Inconsistency when the two run side by side |

---

## Part B: Design OS v2

### B1. Principles

1. **One family, two registers.** Both apps share one token set, one accent (clinic teal), one type stack, one icon style and one copy voice.
   - The **Record register** (EHRM) is calm, structured and dense. It keeps the navy hero, the bordered and shadowed card, pills with dots, and mono IDs. This *is* the v1 look.
   - The **Live register** (front desk) is quieter chrome so that conversations lead. It uses the same tokens, with an AI layer that is visible but never shouty.
   - Someone switching between laptop and cloud should feel they are in the same clinic.
2. **Cut words, not design.** Shorten copy before removing visual structure. Don't remove the hero, shadows or pills to look "minimal". The owner rejected that.
3. **Show who is speaking.** Every message, draft, action and log row shows its author: patient, staff (with name), the assistant, or the system. The AI never passes as staff, and staff never pass as the AI.
4. **The human approves what leaves the building.** Anything business-initiated (reminders, campaigns, follow-ups) is a template with consent and a release step. The UI makes the approved path the easy path.
5. **Fast over delightful.** Things seen 100+ times a day (switching conversations, typing, nav) are not animated. Animation is reserved for arrival (new message, AI draft ready), confirmation, and spatial moves (panel open, card drop).
6. **Accessible by default.** AA contrast is a token property, not a later check. There is a visible focus on every control, 40px minimum targets (44 on touch), reduced motion honoured, and status never shown by colour alone (dot plus word).
7. **Privacy is visible.** Shielded data, consent state and who-can-see are shown as first-class UI (shield, consent chips, privacy light), never hidden in settings.

### B2. Token architecture

Tokens come in three layers, defined once in a shared `tokens.css`. Each app keeps zero build steps by inlining or copying the file.
1. **Core**: raw palette (`--teal-700`, `--slate-500`…). Never used directly in components.
2. **Semantic**: role tokens (`--fg`, `--surface`, `--accent`, `--ai`…). Redefined for dark.
3. **Component**: only where a component needs a dial (`--bubble-out-bg`, `--hero-bg`).

Dark mode follows the house pattern already in the FD: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` plus `:root[data-theme="dark"] {…}`. The EHRM starts as `data-theme="light"` (forced) until dark is reviewed.

For migration, EHRM names stay as aliases for one release: `--ink: var(--fg); --ink2: var(--fg-muted); --ink3: var(--fg-subtle); --line: var(--border); --teal: var(--accent); --teal50: var(--accent-soft); --navy: var(--navy-900)`.

### B3. Tokens

#### B3.1 Colour roles: light

| Role | Token | Value | Use | Contrast (measured) |
|---|---|---|---|---|
| Page | `--bg` | `#f6f8fb` | App background (EHRM v1 value kept) | n/a |
| Surface | `--surface` | `#ffffff` | Cards, panels, list | n/a |
| Surface 2 | `--surface-2` | `#f8fafc` | Table heads, footers, hover | n/a |
| Sunken | `--surface-sunken` | `#eef2f7` | Segmented control track, skeleton base | n/a |
| Chat canvas | `--chat-bg` | `#eef2f6` | Thread background (replaces beige WhatsApp wallpaper; no dot pattern) | `--fg` 15.87:1, `--fg-subtle` 4.81:1 |
| Text | `--fg` | `#0f172a` | Body and headings | 16.78:1 on `--bg` |
| Text muted | `--fg-muted` | `#475569` | Secondary text | 7.58:1 on surface |
| Text subtle | `--fg-subtle` | `#5e6b7e` | Meta, timestamps (v12 value) | 5.41:1 on surface, 5.09:1 on bg |
| Border | `--border` | `#e2e8f0` | Card and divider lines (decorative) | n/a (not a control boundary) |
| Control border | `--border-control` | `#7c8799` | Inputs, checkboxes, switches (v12 `--line-ctl`) | 3.63:1 ✓ (≥3:1) |
| Accent | `--accent` | `#0f766e` | Primary buttons, links, active nav, selection | 5.47:1 on white; white on it 5.47:1 ✓ |
| Accent hover | `--accent-hover` | `#115e59` | Primary hover and pressed | 7.0:1 |
| Accent soft | `--accent-soft` | `#f0fdfa` | Soft button, selected row, outgoing bubble tint | `--accent` on it 5.25:1 |
| Accent line | `--accent-line` | `#99f6e4` | Soft borders | n/a |
| Accent bright | `--accent-bright` | `#14b8a6` | **Decorative only**: glows and focus on navy (2.49:1 on white, never text on white) | 7.52:1 on navy |
| Navy | `--navy-900` | `#0b1220` | Hero, strip, toast, dark modal header, date chip | `--fg-on-navy-muted #a7b4c8` 8.92:1 |
| Focus | `--focus` | `#0b1220` (on light), `#ffffff` (on navy) | 2px outline, 2px offset | 18.7:1 |
| AI | `--ai` | `#4338ca` (indigo 700) | AI presence: label, glyph, draft border | 7.90:1 on white |
| AI ink | `--ai-ink` | `#3730a3` | Text on AI soft | 8.88:1 on `--ai-soft` |
| AI soft | `--ai-soft` | `#eef2ff` | AI bubble, AI chip | n/a |
| AI line | `--ai-line` | `#c7d2fe` | AI bubble border (decorative; label carries meaning) | 1.49:1 (decorative) |
| Success | `--success` / `-soft` / `-line` | `#047857` / `#ecfdf5` / `#a7f3d0` | Done, paid, consent given | 5.21:1 on soft |
| Warning | `--warn` / `-soft` / `-line` | `#b45309` / `#fffbeb` / `#fde68a` | Needs attention, waiting, expiring window | 4.84:1 on soft |
| Danger | `--danger` / `-soft` / `-line` | `#b91c1c` / `#fef2f2` / `#fecaca` | Failed, no-show, refused | 5.91:1 on soft |
| Info | `--info` / `-soft` | `#1d4ed8` / `#eff6ff` | Neutral system notices | 6.16:1 on soft |

#### B3.2 Colour roles: dark

| Role | Value | Contrast (measured) |
|---|---|---|
| `--bg` | `#0b1220` (EHRM navy becomes the page) | n/a |
| `--surface` | `#111a2b` | `--fg` 14.12:1 |
| `--surface-2` | `#16213a` | n/a |
| `--surface-sunken` | `#0e1626` | n/a |
| `--chat-bg` | `#0d1524` | `--fg` 14.81:1 |
| `--fg` | `#e2e8f0` | 15.19:1 on bg |
| `--fg-muted` | `#a7b4c8` | 8.29:1 on surface |
| `--fg-subtle` | `#8391a7` | 5.45:1 on surface |
| `--border` | `#22304a` | decorative |
| `--border-control` | `#64748b` | 3.66:1 ✓ |
| `--accent` (fills) | `#0f766e` with white text | 5.47:1 ✓ (do **not** brighten fills to `#14b8a6`: white on it is 2.49:1) |
| `--accent-fg` (text, icons, links) | `#2dd4bf` | 9.35:1 on surface |
| `--accent-soft` | `#0f2e2c`, text `#5eead4` | 9.81:1 |
| `--ai` | `#a5b4fc` | 8.73:1 on surface |
| `--ai-soft` | `#1e1b4b`, text `#c7d2fe` | 10.72:1 |
| `--success / --warn / --danger / --info` | `#34d399 / #fbbf24 / #f87171 / #93c5fd` | 9.05 / 10.43 / 6.29 / 9.65 :1 |
| `--focus` | `#5eead4` | 11.77:1 |
| Elevation | Because surface and bg differ by only 1.08:1, dark cards **must** keep the 1px border and add a `0 0 0 1px rgba(255,255,255,.04)` inner highlight. Shadows alone vanish on navy | n/a |

#### B3.3 Channel colours (badge fills with white glyph; 3:1 minimum for non-text)

| Channel | Current | v2 | White glyph contrast |
|---|---|---|---|
| SMS | `#1a73e8` (4.51) | `#2563eb` | 5.17 |
| WhatsApp | `#25d366` (**1.98** ✗) | `#128c7e` | 4.14 |
| Messenger | `#0084ff` (3.66) | `#0866ff` | 4.82 |
| Instagram | gradient (light stops fail) | `#c13584` solid (gradient only at 20px+) | 5.11 |
| Email | `#5f6368` | `#475569` | 7.58 |
| Voice | `#f29900` (**2.25** ✗) | `#b45309` | 5.02 |
| Web chat / portal | n/a | `#0f766e` | 5.47 |

The badge always has an `aria-label` / `title` with the channel name. Colour is never the only cue, so the glyph shape differs per channel.

#### B3.4 Type

Stack: `--font: "Inter var", Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`. `--mono: "Cascadia Mono", "SF Mono", Consolas, ui-monospace, monospace` is **only** for IDs, invoice numbers and codes. Numbers use the main font with `tabular-nums` (the v12 rule, `:497`).

Root: `-webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;`. Headings use `text-wrap: balance`; body paragraphs use `text-wrap: pretty`.

| Token | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|
| `--t-display` | 26/32 | 700 | -0.01em | EHRM hero title (desktop) |
| `--t-title` | 22/28 | 700 | -0.01em | Page title, compact hero |
| `--t-heading` | 18/24 | 650 | -0.01em | Modal title, section |
| `--t-subheading` | 15/22 | 650 | 0 | Card title, contact name in thread header |
| `--t-body` | 14/21 | 400 | 0 | Default UI text |
| `--t-body-strong` | 14/21 | 600 | 0 | Inbox name, button label |
| `--t-chat` | 15/22 | 400 | 0 | Bubble text (chat is read more than scanned) |
| `--t-small` | 13/19 | 400/600 | 0 | Previews, table cells, tabs |
| `--t-meta` | 12/16 | 500/600 | 0 | Labels, timestamps, section headers (sentence case) |
| `--t-micro` | 11/14 | 650 | 0.02em | Pills, badges only |
| `--t-stat` | 24/28 | 700 | -0.01em | Dashboard numbers (tabular) |

Rules:
- No 9px text (the FD channel letter is 9px, `styles.css:156`; the glyph replaces it).
- Inputs are 16px on touch (`pointer: coarse`) to stop iOS zoom.
- Never change font weight on hover or selection; use colour or background instead (no layout shift).

#### B3.5 Spacing (4px base; the EHRM 8px rhythm is kept as the main steps)

`--s-1: 4px` · `--s-2: 8px` (= `--g1`) · `--s-3: 12px` · `--s-4: 16px` (= `--g2`) · `--s-5: 20px` · `--s-6: 24px` (= `--g3`) · `--s-8: 32px` (= `--g4`) · `--s-10: 40px` (= `--g5`) · `--s-12: 48px` · `--s-16: 64px`.

Component padding:
- Card header/body: `16px 24px` (desktop), `16px` (≤640).
- List row: `12px 16px`.
- Bubble: `8px 12px`.
- Composer: `12px`.
- Modal: `24px`.
- Page gutter: `24px` desktop, `16px` mobile.

#### B3.6 Radius (concentric: outer = inner + padding)

| Token | Value | Use |
|---|---|---|
| `--r-xs` | 6px | Tag, kbd, inline code |
| `--r-sm` | 8px | Small button, menu item, schedule block inner |
| `--r-md` | 10px | Button, input, icon button, segmented item |
| `--r-lg` | 14px | Card, panel, bubble cluster outer, kanban column |
| `--r-xl` | 18px | Hero, modal, sheet |
| `--r-full` | 999px | Pill, badge, avatar, chip, composer field |

Concentric rules:
- Segmented control: track `--r-md` (10) with 3px padding → items 7px.
- Menu: 12px with 6px padding → items 6px (the current EHRM `menu` 12/6 → items 8 is off by 2; fix to 6).
- Bubble: 14px, with the tail corner 4px on the sender side.
- Kanban: with today's 8px column padding, a 14px column would need a 6px card radius. Instead, set column padding to 4px, so the column stays 14px and the card gets 10px.

#### B3.7 Elevation (layered transparent shadows; the border stays on cards for the v1 look)

| Token | Light | Use |
|---|---|---|
| `--elev-0` | none, 1px `--border` | Flat lists, table |
| `--elev-1` | `0 1px 2px rgba(15,23,42,.04), 0 6px 20px rgba(15,23,42,.06)` (= v1 `--sh`) | Card, stat, kanban column |
| `--elev-2` | `0 2px 4px rgba(15,23,42,.05), 0 12px 28px rgba(15,23,42,.10)` (= `--sh-h`) | Hover on draggable, kanban card while dragging, popover |
| `--elev-3` | `0 24px 64px rgba(11,18,32,.28)` (= `--sh2`) | Modal, toast, command palette |
| `--elev-bubble` | `0 1px 1px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.06)` | Chat bubble (lighter than a card) |

Dark: multiply alpha ×2 and add `inset 0 0 0 1px rgba(255,255,255,.04)`.

#### B3.8 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 0ms | Conversation switch, typing, nav (100+/day: do not animate) |
| `--dur-micro` | 120ms | Hover colour, press scale, switch knob |
| `--dur-fast` | 160ms | Dropdown, tooltip, popover, toast exit |
| `--dur-base` | 200ms | Modal and scrim enter, toast enter, new message arrive |
| `--dur-panel` | 240ms | Side panel / drawer slide, mobile sheet |
| `--dur-slow` | 300ms | Maximum for any UI motion. Only for page-level route change on mobile |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` (out-quint) | Anything entering or exiting |
| `--ease-in-out` | `cubic-bezier(0.645, 0.045, 0.355, 1)` (in-out-cubic) | On-screen move: kanban card settle, panel resize |
| `--ease` | `ease` | Hover and colour |
| `--ease-linear` | `linear` | Spinners, hold-to-confirm progress, wait timers only |

Rules:
1. Animate only `transform` and `opacity` (plus `background-color`/`color`/`border-color` for hover). **Never `transition: all`.**
2. Enter from `scale(.97)`/`translateY(6px)`, never from `scale(0)`. Exit about 20% faster, with a smaller travel (`translateY(4px)`).
3. Paired elements (modal and scrim, drawer and backdrop) share duration and easing.
4. Press feedback: `.btn:active { transform: scale(.97) }` on pointer devices only. Drop the current `translateY(1px)` (`index-v12.html:42`).
5. Hover effects only under `@media (hover:hover) and (pointer:fine)`.
6. Keyboard-triggered actions (shortcuts) are not animated.
7. Skip enter animations on first paint. Add a `.no-anim` class on `<html>` until the first `requestAnimationFrame` after data load.
8. Reduced motion, required in every file:

```css
@media (prefers-reduced-motion: reduce) {
  :root { --dur-micro: 0ms; --dur-fast: 0ms; --dur-base: 0ms; --dur-panel: 0ms; --dur-slow: 0ms; }
  .skel { animation: none; }            /* static grey block */
  .spin { animation-duration: 1.6s; }   /* spinner may keep turning slowly: it carries meaning */
  .lrow.moved, .msg.arrive { animation: none; } /* keep the background tint, drop the fade */
}
```

Because all durations read from tokens, one query covers every component. The spinner is the only exception.

#### B3.9 z-index scale

`--z-base 0` · `--z-sticky 10` (headers, sticky table heads) · `--z-drawer 30` (mobile side panel) · `--z-popover 40` (menus, typeahead) · `--z-modal 60` · `--z-toast 80` (always above modal) · `--z-critical 95` (idle lock, "still there?"). No `9999`. Use `isolation: isolate` inside components.

#### B3.10 Iconography

Inline SVG, 24-grid, `stroke-width: 1.75`, `stroke-linecap: round`, rendered at 16px (in buttons and pills) or 20px (nav, header).
- One **AI glyph**: a 4-point sparkle, never a robot face or the 🤖 emoji.
- One **shield** (privacy).
- One **template glyph** (stamp) for approved templates.
- Emoji are allowed only inside message content written by people.

### B4. Components

Every component lists its states. All interactive states use: hover (pointer only) = `--surface-2` background; focus-visible = 2px `--focus` outline at 2px offset; pressed = `scale(.97)` (buttons only); disabled = 55% opacity plus `cursor:not-allowed` plus a reason in a `title`/tooltip.

#### B4.1 Button

| Variant | Light | Use |
|---|---|---|
| Primary | `--accent` fill, white text, `--elev` `0 1px 2px rgba(15,118,110,.25)`; hover `--accent-hover` | One per view region (Send, Approve & send, Sign in) |
| Secondary | `--surface`, 1px `--border-control`, `--fg` | Default |
| Soft | `--accent-soft`, `--accent-line` border, `--accent` text | Supporting positive action (Check in, Prescribe) |
| AI | `--ai-soft`, `--ai-line` border, `--ai-ink` text, sparkle glyph | "Draft reply", "Summarise", "Suggest times": invokes the assistant |
| Ghost | Transparent, `--fg-muted`; hover `--surface-sunken` | Toolbar, icon buttons |
| Danger | `--surface`, `--danger-line` border, `--danger` text; hover `--danger-soft` | Discard, Cancel appointment |
| On-navy | `rgba(255,255,255,.08)` fill, `.18` border, white | Inside hero and strip (= EHRM `.btn.dark`) |

Sizes: sm 32px / r 8 / 12px; md 36px / r 10 / 13px; lg 44px / r 12 / 14px. Touch: minimum 44px (`pointer:coarse`). Icon button: 36×36 visible with the hit area extended to 44 by a pseudo-element.

States: default · hover · focus-visible · pressed · **loading** (label stays, spinner replaces the icon, width locked so there is no shift, `aria-busy=true`) · disabled · **success flash** (icon becomes a check for 1.2s, used on Approve & send).

#### B4.2 Inbox list item (`.conv`)

Anatomy, 72px tall (two-line), 12px/16px padding:
- Avatar (40px, hue from the name like EHRM `.av`) with a channel badge at the bottom-right (18px, 2px `--surface` ring).
- Name (`--t-body-strong`, ellipsis).
- Time (`--t-meta`, `--fg-subtle`, tabular, right-aligned).
- Preview line: author prefix as text ("You:", "Assistant:", or a 12px sparkle for AI). Ellipsis.
- Flags row: status pills (Needs reply, Draft waiting, Booked), unread count badge, and a **24h window chip** for WhatsApp/Messenger/IG ("Window 3h left" in warn when under 4h; "Template only" in neutral when closed).

| State | Visual |
|---|---|
| Default | `--surface` |
| Hover | `--surface-2` |
| Selected | `--accent-soft` background plus a 3px inset left bar `--accent` (keeps the FD cue, now in teal) |
| Unread | Name 600 → **stays 600** (no weight change); unread badge `--accent`; preview `--fg` instead of muted |
| Needs attention | Warn pill "Needs reply" with dot; time in `--warn` |
| AI handling | Small sparkle with "Assistant replying…" in the preview line, `--ai`. A 3-dot typing indicator *only* while generating |
| AI paused | Neutral pill "Assistant off" |
| Snoozed | Clock glyph plus "Until 2:00 PM" in the meta slot |
| Focus-visible | Outline inside (offset −2px) so it isn't clipped by the scroll container |
| Loading (skeleton) | 6 rows: circle 40 plus 2 bars (60% / 85%), static under reduced motion |

Keyboard: `↑/↓` or `j/k` to move, `Enter` to open, `e` to mark done, `u` to toggle unread. `role="listbox"` with `aria-activedescendant`; the active row has `scrollIntoView({block:'nearest'})`.

#### B4.3 Chat bubble

Base:
- Max width `min(560px, 78%)` (88% mobile). Radius 14px, sender-side tail corner 4px. Padding 8px 12px.
- `--t-chat` text; `white-space: pre-wrap`.
- Meta row inside at the bottom right: time (tabular, `--fg-subtle`) plus delivery state glyph.
- Consecutive bubbles from one author within 3 minutes group: 2px gap, author label only on the first, tail only on the last.

| Variant | Alignment | Fill / border | Author label (first in group) |
|---|---|---|---|
| Patient (incoming) | Left | `--surface`, `--elev-bubble` | none (name is in header); group chats show the name |
| Staff (outgoing) | Right | `#e6f4f1` (light) / `#12332f` (dark) (teal tint; `--fg` 15.79 / 11.06:1) | "Maya · Front desk" in `--accent`, 12px/600 |
| AI sent | Right | `--ai-soft`, 1px `--ai-line` | Sparkle plus "Assistant" in `--ai-ink`, with "· auto-sent" |
| AI draft (awaiting approval) | Right | `--surface`, **1.5px dashed `--ai`** border (4.47:1 for `#6366f1`, or use `--ai` 7.9:1), no shadow | Sparkle plus "Draft, needs your OK" plus a "Why this reply?" disclosure listing the knowledge used (service, policy) and tools called. Actions in a footer: **Approve & send** (primary), Edit (secondary), Discard (danger ghost). Under it, the channel and window: "WhatsApp · inside 24h window" |
| Template message (sent) | Right | Staff fill plus a stamp glyph and template name chip ("Appointment reminder v3 · approved") | Shows variables filled-in, with variables underlined dotted |
| System / event | Centre | No bubble; 12px `--fg-subtle` text with a hairline both sides, or a compact pill for structured events: "Call answered by the assistant · 2m 41s · Summary ▸" | n/a |
| Internal note | Full width | `--warn-soft` with left 3px `--warn` bar; lock glyph "Only staff can see this" | Staff name |
| Failed | Same as variant | 1px `--danger` border; meta shows "Not delivered · Retry" (link) | n/a |

Delivery states (glyph plus `aria-label`): sending (clock, 50% opacity, optimistic), sent (single check), delivered (double), read (double in `--accent`), failed (alert in `--danger`).

Arrival animation: new incoming or AI messages fade and rise 6px over `--dur-base` `--ease-out`. Own sent messages appear instantly (optimistic, no animation). Under reduced motion they just appear.

#### B4.4 Composer

- Container: `--surface`, top `--border`, 12px padding, sticky bottom with safe-area inset.
- Row: channel picker (pill select showing the channel badge plus name) · auto-growing field (`--r-full` until 2+ lines, then `--r-lg`, max 40vh, 16px font on touch) · Send (44px circle, primary).
- Toolbar above the field (ghost icon buttons, 36px, labelled): Templates (stamp) · **AI: draft reply** (sparkle, AI variant) · Snippets (`/`) · Attach · Internal note toggle.
- Footer line (12px `--fg-subtle`): context that changes behaviour, e.g. "Sending pauses the assistant on this thread · [Keep it on]". Replaces the checkbox plus sentence (`app.js:483`).

| State | Behaviour |
|---|---|
| Empty | Send disabled (with reason tooltip "Type a message") |
| Typing | `Enter` sends, `Shift+Enter` newline, `⌘/Ctrl+Enter` always sends (keep `app.js:464`) |
| **Window closed** (WhatsApp/Messenger/IG over 24h since the last patient message) | The field is replaced by a **template picker** card: "The 24-hour window closed 3h ago. You can send an approved template." · [Choose template]. Free text is not possible here |
| Window closing (under 4h) | Warn chip in the footer: "Window closes in 3h 12m" (tabular, updates each minute) |
| Internal note | Field background `--warn-soft`, placeholder "Note for staff only", Send becomes "Add note" |
| AI drafting | Field shows a skeleton line plus "Drafting…" with a Stop button; the result lands in the field as editable text with a sparkle "Drafted by assistant" tag that clears on first edit |
| Sending | Optimistic bubble appears; field clears; on failure the text is restored to the field with an error toast plus Retry |
| Opted out (STOP) | Field replaced by: "This person opted out of texts on Oct 2. Reply by email or phone." |

#### B4.5 Channel badge

18px circle (14px in dense lists), white 11px glyph on the channel fill (B3.3), 2px `--surface` ring when overlapping an avatar. Has `role="img"` and `aria-label="WhatsApp"`. A larger "channel chip" variant (24px tall pill: glyph plus name) is used in the composer and thread header.

#### B4.6 Status pills (EHRM pill, adopted by both)

22px tall, `--r-full`, 11px/650, 1px border, **6px leading dot in currentColor** (`index-v12.html:60-61`). Variants map to semantic colours:

| Domain | Pill → colour |
|---|---|
| Conversation | Needs reply → warn · Draft waiting → ai · Handled → success (nodot) · Assistant off → neutral · Opted out → danger |
| Pipeline | New lead → info · Contacted → neutral · Booked → accent · Active → success · Lapsed → warn |
| Appointment | Booked → neutral · Confirmed → accent · Arrived/Waiting → warn · In room → navy-grey · Done → success · No-show → danger · Cancelled → neutral, struck |
| Template | Approved → success · Pending at Meta → warn · Rejected → danger · Draft → neutral |
| Consent | Given → success · Withdrawn → danger · Not asked → neutral |

The text always states the status; the colour only reinforces it. A count variant ("badge") is 18px min-width, tabular, `--accent` (unread) or `--danger` (overdue).

#### B4.7 AI-presence indicator

The front desk's "intelligent" feel comes from consistent, quiet AI presence rather than decoration.
- **Header status (global):** a chip in the top bar showing sparkle plus "Assistant · On" (or "Draft mode" or "Off"), with a dot (success/ai/neutral). It opens a popover with mode per channel, today's counts ("12 replies, 3 bookings, 2 handed to you"), and the knowledge last updated date. Replaces `AI: demo mode` (`app.js:272`).
- **Thread-level control:** a segmented control `Auto | Draft | Off` (not a bare switch labelled "AI", `app.js:402`), `aria-label="Assistant mode for this conversation"`.
- **Activity states:**
  - Idle: no indicator.
  - Thinking: 3 dots in `--ai`, opacity pulse 1.2s; under reduced motion a static "Assistant is writing…".
  - Handed off: system row "Assistant handed this to staff: patient asked for a person".
  - Error: "Assistant couldn't reply · [Retry] [Reply yourself]".
- **Attribution:** every AI-sent message, task or booking carries the sparkle and "Assistant". Bookings show "Booked by assistant via WhatsApp" (replaces `via ai:whatsapp` [OBS `shots/fd-calendar-d-light.png`] and `ai:email` in task meta [OBS `shots/fd-dashboard-d-light.png`]).
- **Restraint:** the AI colour never fills large areas, never appears on patient-facing EHRM screens, and is never used for non-AI toggles.

#### B4.8 Side panel (contact / patient context)

- Desktop at 1280px and up: docked 320px column, `--surface`, left `--border`, its own scroll.
- 1024–1279: collapsible, toggled by an `i` button (and the `.` key), sliding over the thread with `--elev-3`.
- Under 1024: full-height sheet from the right (drawer), with a scrim.

Sections are cards (14px, `--elev-0` border only inside the panel, to avoid shadow-on-shadow). Order:
1. Identity (avatar 56, name, pronouns, channels with the preferred one starred).
2. **Consent** (SMS / WhatsApp / Email / Marketing chips with dates; this is where CASL and WhatsApp opt-in live).
3. Next appointment (with Confirm / Reschedule).
4. Pipeline stage (select).
5. Tags.
6. Tasks.
7. Notes (staff only).
8. EHRM link ("Open in records". Opens the laptop app; the cloud never displays clinical notes).

Inline-edit fields save on blur with an optimistic "Saved" tick (no Save button; replaces `Save` [OBS `shots/fd-inbox-d-light.png`]).

States:
- Loading: section skeletons.
- Empty sections collapse to one line ("No tasks · Add").
- Read-only (permission): fields render as text with a lock tooltip.
- Drawer motion: `translateX(16px)→0` plus opacity, `--dur-panel` `--ease-out`; the scrim uses the same timing.

#### B4.9 Kanban card (pipeline)

Column: `--surface-2`, `--r-lg`, 4px padding, header 13px/600 with the count badge plus **value or age summary** ("2 · oldest 3d").

Card: `--surface`, `--r-md` (concentric), `--elev-1`, padding 10/12. Contents:
- Name (600) plus channel badge.
- Last message snippet (1 line, muted).
- Meta row: time in stage ("3d"), next step chip ("Reply" / "Book" / "Follow up Fri"), owner avatar 20.
- Tags (max 2 plus "+n").

| State | Visual |
|---|---|
| Hover (pointer) | `--elev-2`, no lift |
| Focus | Outline; `Space` picks up, arrows move between columns, `Space` drops, `Esc` cancels (announced via live region) |
| Dragging | `--elev-2` plus `rotate(1deg)`, origin at the cursor; source slot shows a dashed `--accent-line` placeholder of the same height |
| Over column | Column outline 2px dashed `--accent` (keep `styles.css:242`) |
| Dropped | Optimistic move; card settles with `--dur-base` `--ease-in-out`; on server failure it returns to its origin with a danger toast plus Retry |
| Stale (no activity over 7d) | Warn left bar 3px |
| Empty column | Dashed `--border` area with the stage hint: "Leads you've replied to land here" |

#### B4.10 Calendar event

Uses the EHRM schedule block (`index-v12.html:323-332`) in both apps: `--r-sm` 9→8, 1px border, **4px left status bar**, 12px text, name 12.5/600 ellipsis, time and service in meta. Status fills map to B4.6.

| State | Visual |
|---|---|
| Hover | `--elev-2` (no translate; K5 removed lift) |
| Selected / open | 2px `--accent` outline |
| Booked by assistant | Small sparkle in the top-right plus "by assistant" in the popover |
| Tentative / held | Diagonal hatch (EHRM `.slot.lunch` pattern) plus a dashed border |
| Conflict | Danger bar plus an alert glyph |
| Now line | 2px `--danger` with a dot (EHRM `.nowline`) |
| Empty slot (hover) | Dashed `--accent-line` plus "+ Book 10:30" (EHRM `.slot`) |

The front desk's week view (`styles.css:247-255`) becomes a **time grid** (day / 3-day / week) like the EHRM schedule. The day-list cards with a "—" placeholder [OBS `shots/fd-calendar-d-light.png`] are replaced; the empty day reads "No visits".

#### B4.11 Task row

Row of 48px minimum:
- Checkbox (20px visible, 40px hit area).
- Title (14px, struck and muted when done).
- Meta line: due (tabular; overdue in `--danger` with the word "Overdue"), linked contact chip, source ("from assistant · call").
- Priority shown as a pill only for Urgent (do not colour the whole title red, as `styles.css:225` does [OBS `shots/fd-dashboard-d-light.png`]).
- Assignee avatar.
- Row actions on hover/focus: Snooze, Open conversation.

States:
- Completing: the check animates with the stroke-dash over `--dur-fast`, then the row fades and collapses after 600ms with an **Undo** toast (5s).
- Optimistic.
- Loading: skeleton.
- Empty: "Nothing to do. The assistant adds callbacks here."

#### B4.12 Modal

EHRM modal (`index-v12.html:288-302`) in both:
- Scrim `rgba(11,18,32,.55)` plus `backdrop-filter: blur(2px)`.
- Card `--r-xl` 18, `--elev-3`.
- Header / body / footer zones; footer `--surface-2` with actions right-aligned (Cancel = secondary, confirm = primary or danger).
- Sizes sm 420 / md 640 / lg 820 / xl 1080.
- On mobile, a bottom sheet (full width, top radius 18, max-height 92dvh).

Enter: card `translateY(8px) scale(.98)→none` plus opacity, scrim opacity; both `--dur-base` `--ease-out`. Exit `--dur-fast`.

Behaviour:
- Focus moves to the first field (or the safe button for destructive actions).
- **Focus trap**; `Esc` closes; scrim click closes unless the form is dirty (then confirm "Discard changes?").
- Focus returns to the trigger.
- `role="dialog"`, `aria-modal`, `aria-labelledby`.
- Dark header variant (`.mh.dark`) is reserved for privacy and consent moments (break-glass, release).

#### B4.13 Toast

EHRM toast in both:
- Navy `--navy-900`, `#e2e8f0` text, `--r-lg` 12, `--elev-3`, 3px left edge (teal success / amber warn / red error).
- Bottom-right on desktop; on mobile bottom-centre above the bottom nav or footer: `bottom: calc(var(--footer-h) + 12px + env(safe-area-inset-bottom))`. This fixes the overlap [OBS `shots/ehrm-v12-ana-home-m-light.png`].
- `z-index: --z-toast`, above modals.
- Container `role="status" aria-live="polite"`; errors use `role="alert"`.
- One action maximum (Undo / Retry / View). A close button with `aria-label="Dismiss"`.
- Durations: 4s for info, 6s with an action, sticky for errors until dismissed. Pause on hover or focus.
- Maximum 3 stacked; newer ones push older up by `translateY`.
- Enter `translateY(8px)` plus opacity `--dur-base` `--ease-out`; exit opacity `--dur-fast`.

#### B4.14 Empty state

Centered in its container:
- 28px stroke icon in `--fg-subtle` (no emoji, replaces 🩺 `app.js:375`).
- Title 15/600.
- One sentence (`--fg-muted`, max 44ch, `text-wrap: balance`).
- One primary or secondary action.

Three kinds:
- **First use**: "No conversations yet. Connect a channel or send a test message." · [Connect channel]
- **Cleared**: "All caught up. New messages appear here." No action.
- **No results**: "No matches for 'robrt'." · [Clear search]

Never a bare "—" [OBS `shots/fd-calendar-d-light.png`].

#### B4.15 Campaign / funnel builder step

Replaces the free-text Broadcast form [OBS `shots/fd-broadcast-d-light.png`] and the read-only automation list [OBS `shots/fd-automations-d-light.png`] with a vertical step builder. Each step is a card connected by a 2px `--border` spine with a 24px node.

| Step type | Node glyph | Card content |
|---|---|---|
| Trigger | Bolt | "When an appointment is booked" · filter chips |
| Audience | People | Stage / tag filters plus **live count** ("118 people · 9 excluded: no consent") with a "Who's excluded?" link |
| Wait | Clock | "Wait 24 hours" · quiet-hours chip ("Not before 9 AM, not after 8 PM, clinic time") |
| Condition | Branch | Yes/No split; branches render side by side at ≥1024, stacked below |
| Message | Stamp | **Template picker** (required for WhatsApp/SMS business-initiated): template name, status pill (Approved / Pending at Meta / Rejected), language, a channel preview rendered as a real bubble with variables highlighted, and a "Variables" panel mapping `{{1}}` → `first_name`. Free-text is only allowed for email and is still run through the wording check |
| Action | Check | Move stage, create task, notify staff |
| Release | Shield | **Owner/EHRM release** step: shows "Released by EHRM · Oct 29, 4:12 PM · signed" or "Waiting for release in the records system". Business-initiated patient messages do not send until released |

Step states:
- Default.
- Selected (2px `--accent` outline, edit panel opens right).
- Invalid (danger left bar plus an inline reason: "Template not approved yet").
- **Wording violation** (danger, lists the banned words found).
- Disabled (dashed, muted).
- Running stats (sent / delivered / replied, tabular) once live.

Builder header: name · status pill (Draft / Waiting for release / Live / Paused) · **Test send to me** · primary **Request release** (not "Send").

Adding a step: a "+" node between steps opens a popover menu (`--dur-fast` `--ease-out`, origin at the node).

#### B4.16 Other shared parts (kept from EHRM, adopted by FD)

- Navy hero (B5).
- Stat card. Label 12/600 sentence case, value `--t-stat` tabular, plus a **delta or sparkline** in the FD dashboard ("3 more than last week"), so 8 identical number boxes become 4 meaningful cards plus a "Today" timeline [OBS `shots/fd-dashboard-d-light.png`].
- Shield banner.
- Segmented control.
- Tabs (2px underline).
- Table (`table.t`).
- Skeleton.
- Spinner.
- Banner (info / warn / success / danger / ai).

### B5. Layout grid and breakpoints

**Breakpoints** (one set for both; the current ones are 640/720/900/1023/1100/1180/1760):

| Name | Min width | Front desk | EHRM |
|---|---|---|---|
| `xs` | 0 | Single pane; bottom tab bar (5 items plus More); list → thread → panel as pushed screens; composer fixed | Single column; nav scrolls horizontally under the header; hero compact (20px padding, 21px title) |
| `sm` | 640 | As xs, with wider bubbles (88%) | 2-column stats |
| `md` | 1024 | Rail nav (64px) plus list (320) plus thread; panel as a drawer | `.layout` becomes 2-col; nav on its own row |
| `lg` | 1280 | Rail plus list 340 plus thread plus panel 320 | Nav inline when it fits; 4-col stats |
| `xl` | 1600 | Thread content max 760px centred; panel 360 | `main` max 1440 centred (`:268`) |

Other layout rules:
- **Grid.** 12 columns with a 24px gutter (16px at xs) for page views (dashboard, settings, builder). The inbox uses fixed panes, not the grid.
- **Page shell.** FD keeps the left rail (it suits a tool used all day) but in `--surface` with an `--border` right edge, **not** the near-black WhatsApp rail (`styles.css:18,108`). The active item gets an `--accent-soft` pill and `--accent` icon. EHRM keeps its top header plus nav plus navy strip.
- **Shared hero.** FD pages other than Inbox (Dashboard, Automations, Broadcast) get the *compact* navy hero (`.hero.compact`, `index-v12.html:508-512`). This is the visual tie between the two products: the same navy with a teal glow, title plus one-line summary plus actions.
- **Safe areas.** `env(safe-area-inset-*)` on bottom bars, composer and toasts.
- **No horizontal page scroll at 390px.** Both are verified as passing today [OBS: scrollWidth 390 in both]. Keep the check in tests.

### B6. Interaction details

**Optimistic updates** (show at once, reconcile, roll back visibly):

| Action | Optimistic UI | On failure |
|---|---|---|
| Send message | Bubble appears with the clock glyph; field clears | Bubble turns failed plus "Retry"; text restored if retried from the composer |
| Approve & send draft | Draft becomes a sent bubble; button shows a check | Reverts to draft plus error toast |
| Move pipeline card | Card moves; counts update | Card returns (`--ease-in-out`), toast plus Retry |
| Complete task | Strike, then collapse with an Undo toast | Row returns |
| Toggle assistant mode | Segmented control updates; system row "Assistant set to Draft" | Control reverts, toast |
| Edit contact field | "Saved" tick inline for 1.2s | Field outlined danger plus the message, value kept |
| Book appointment | Not optimistic (needs the server slot check): button shows loading, then the event appears | Inline error in the form ("That time was just taken. Here are the next 3.") |

**Loading and skeletons:**
- Show skeletons only if loading exceeds 300ms (avoid flash). Spinner only inside buttons.
- Skeleton shapes match the real layout (list rows, bubbles alternating sides, panel cards) to avoid layout shift.
- Reduced motion uses a static block.
- Live updates (SSE) never reflow the list under the cursor. New conversations insert above with a "2 new · Show" pill if the user has scrolled.

**Hover and press:**
- Hover only under `(hover:hover) and (pointer:fine)`. `transition: background-color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease)`.
- Press `scale(.97)` on buttons, chips and the send button only (not list rows, which are too frequent).
- Row actions appear on hover **and** on focus-within, and are always visible on touch.

**Keyboard shortcuts** (front desk; shown in a `?` cheat-sheet modal and as `kbd` hints in tooltips; disabled while typing in a field except for the `⌘/Ctrl` combos):

| Key | Action |
|---|---|
| `⌘/Ctrl K` | Command palette (jump to contact, view, action) |
| `j / k` or `↓ / ↑` | Next / previous conversation |
| `Enter` / `o` | Open conversation |
| `r` | Focus composer |
| `a` | Approve & send the visible AI draft (with a 2s Undo toast before the real send) |
| `e` | Mark handled |
| `u` | Toggle unread |
| `.` | Toggle side panel |
| `t` | New task for this contact |
| `g i / g p / g c / g d` | Go to Inbox / Pipeline / Calendar / Dashboard |
| `/` | Focus search |
| `Esc` | Close panel, modal or palette; leave the composer |
| `?` | Shortcut sheet |

The EHRM keeps its smaller set (Esc closes modal or menu, `index-v12.html:832`) and adds `/` for patient search and `⌘/Ctrl K` only for staff roles.

**Focus management:**
- After sending, focus stays in the composer.
- After approving a draft, focus moves to the next conversation needing attention (with a toast "Sent · Next: Tom Becker").
- After closing a modal, focus returns to the trigger.

**Undo over confirm:** reversible actions (mark handled, complete task, archive, move card) use Undo toasts, not confirm dialogs. Confirm dialogs are only for irreversible or outward actions: send a campaign, cancel an appointment (notifies the patient), break-glass.

**Live-region announcements:** new message in the open thread ("New message from Robert"), draft ready, card moved, send failed.

### B7. Voice and copy rules

**Voice:** a calm, competent front-desk colleague. Plain words, short sentences, sentence case, no exclamation marks in the UI chrome, no jargon ("ai:email", "S1", "nodot") on staff screens.

**Banned in all patient-facing text, enforced in both apps** (templates, the AI knowledge base, AI output, service names, receipts, portal, kiosk, HEP, voice greeting):

| Banned | Use instead |
|---|---|
| "Dr." (title) | First and last name, plus their designation if needed: "Daniel Okafor, Chiropractor" |
| "osteopath", "osteopaths", "osteopathic" | "manual practitioner", "Osteopathic Manual Practitioner" → "Manual therapy practitioner"; service "Osteopathic treatment" → "Manual therapy session" |
| "diagnosis", "diagnose" | "assessment", "assess" |
| "AI" | "our assistant", "virtual receptionist", "automated message" |
| "cure" | "help with", "support" |
| "treat", "treatment" | "session", "visit", "care", "work with": "Do you see WSIB or motor-vehicle claims?" |

Enforcement:
- Run the same word guard (`server.mjs` `guardPatientFacing`) in the front desk on template save, knowledge-base save, AI output before send (block and fall back to "A team member will follow up"), and service and practitioner names.
- The builder shows violations inline (B4.15).
- Flagged now: FD `src/seed.ts:17,18,26,38`, `src/ai/prompt.ts:42`; EHRM `seed.json:71,73,75,76,88` (rendered on the portal and receipts).

**Staff-facing** text may say "AI" where accuracy matters (settings, audit), but prefers "assistant" in everyday UI so that the staff and patient vocabularies match.

**Copy patterns:**
- Buttons are verb plus object: "Approve & send", "Request release", "Book visit", "Mark handled". Never "OK" or "Submit".
- Errors say what happened plus what to do: "Not delivered: WhatsApp window closed. Send an approved template instead."
- Status uses the past tense for events ("Booked by assistant"), the present for states ("Waiting for release").
- Counts and times use tabular numbers and relative time under 24h ("12 min ago"), then absolute in clinic time ("Thu, Oct 29, 4:12 PM").
- Cut redundant labels: "Patient Directory (Shielded)" → "Patients" plus a shield glyph (v12 already did this [OBS `shots/ehrm-v12-desk-home-d-light.png`] vs v1 [OBS `shots/ehrm-v1-desk-home-d-light.png`]).

### B8. Animation audit (before → after)

| Before | After |
|---|---|
| `transition:all .15s` on `.chip, .pcard, .ppill, .iconbtn, .rolebtn, .opt, .slotbtn, .tplcard, .plight` (`index-v12.html:69,228,244,256,260,372,376,383,414`) | `transition: background-color, border-color, color, box-shadow var(--dur-micro) var(--ease)` |
| `.switch span { transition: 0.15s }` (all) (`styles.css:205-206`) | Knob: `transform var(--dur-micro) var(--ease-out)`; track: `background-color var(--dur-micro) var(--ease)` |
| `.btn:active { transform: translateY(1px) }` (`index-v12.html:42`) | `@media (hover:hover){ .btn:active { transform: scale(.97) } }` with `transition: transform var(--dur-micro) var(--ease-out)` |
| Modal `pop .18s ease-out` + scrim `fade` unspecified (`:289-292`) | Card and scrim both `var(--dur-base) var(--ease-out)`; exit `var(--dur-fast)` |
| FD modal and toast appear with no motion (`styles.css:262-267`) | Toast `translateY(8px)`+opacity `var(--dur-base) var(--ease-out)`; modal as above |
| `.bar .fl { transition: width .5s }` (`index-v12.html:151`) | `transform: scaleX()` with `transform-origin:left`, `var(--dur-slow) var(--ease-out)` |
| `.lrow.moved { animation: moved 2.4s ease-out }` (`:476`) | Keep the tint, 1.6s; `animation: none` under reduced motion |
| Skeleton shimmer `1.2s infinite` (`:200`) | Keep; reduced motion → static `--surface-sunken` |
| No reduced-motion rules in either app | Token-zeroing block (B3.8) in both |
| FD side panel on narrow screens appears instantly (`styles.css:274`) | Drawer `translateX(16px)`+opacity `var(--dur-panel) var(--ease-out)` with a paired scrim |

### B9. Migration plan (versioned, no build step)

1. **v2.0-tokens.** Add `tokens.css` (core plus semantic, light/dark, motion, z) to both apps. In the EHRM, alias the old names to the new ones; no visual change except reduced-motion and `transition:all` fixes. FD: swap `--primary` to `--accent`, `--border` on inputs to `--border-control`, and channel colours. **This fixes findings 3, 4, 6 and 11.**
2. **v2.1-components.** Shared pill, button, toast, modal (with focus trap), and empty state in FD; remove emoji icons; tabular numbers.
3. **v2.2-inbox.** Bubble variants, composer with the window state and template picker, AI-presence chip and segmented control, list item flags.
4. **v2.3-builder.** Campaign / funnel builder with the release step wired to the EHRM; wording guard in FD.
5. **v2.4-ehrm-dark** (opt-in). EHRM dark theme reviewed against v1 screenshots; owner sign-off before it becomes the default.

Each step keeps before/after screenshots at 1440x900 and 390x844 in both themes, and a Playwright check for: contrast tokens, no `transition: all`, a reduced-motion rule present, hit targets ≥40px, no horizontal scroll at 390, and no banned words in patient-facing strings.
