# Front desk app: working rules

This is the clinic's front desk app in the cloud: the WhatsApp, text, call and email inbox, the GHL-style CRM, and the AI receptionist. It is linked to the records system (EHRM) on the clinic laptop by the bridge. The EHRM is developed in a separate chat; see `bridge-sync/README.md`.

## The owner's rules (verbatim where quoted)

- "Synthetic data only in any AI chat. Never paste, upload or read real patient data."
- "Draft and ask before anything external."
- "Challenge me with substance."
- "Add a test with every change, run the full suite, and write a CHANGES-<date>.md entry."
- Patient-facing text never says "Dr.", "osteopath(s)", "diagnosis/diagnose", "AI", "cure" or "treat".
- Free text is encrypted at rest. Logs hold counts and ids only. The audit log is hash-chained and append-only.
- Nothing is sent without a signed template. This is GATE 0, still undecided by the owner.
- Never add packages without asking the owner.
- Keep the current look (Design OS v2, `docs/DESIGN-OS-v2.md`).

## The owner's decisions about the system

- The laptop calls out only. Nothing on the internet opens a connection to it.
- The cloud keeps no clinical data.
- The EHRM owns outreach. In a bridge clinic, the front desk sends only what a person released in the EHRM.
- Jane is the legal record in Jane clinics. Never write to it or scrape it.

## The bridge (keep in sync with the EHRM)

- The contract is `docs/INTEGRATION-CONTRACT.md` (v1.2). It must stay byte-identical to `bridge-sync/INTEGRATION-CONTRACT.md`.
- Any change to `src/bridge/` follows `bridge-sync/README.md`: contract first, update the lock, change both sides, run the joint check.
- If the EHRM is not in this chat, implement the front desk side only. Say plainly that the EHRM side and the joint check are still to do.

## Commands

- Front desk tests: `npm test`. They run in memory.
- Type check: `npm run typecheck`.
- Demo: `npm run demo`, then open http://localhost:3000.
- Joint check, with the EHRM folder on disk:
  ```bash
  FD_DIR=$PWD EH_DIR=/path/to/roles-demo node --disable-warning=ExperimentalWarning bridge-sync/joint-check.mts
  ```
