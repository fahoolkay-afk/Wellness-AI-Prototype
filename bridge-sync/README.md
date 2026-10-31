# Bridge sync kit

This folder is identical in both projects:

- **Front desk** (WhatsApp, texts, calls; the GHL-style staff app in the cloud): `bridge-sync/` in the front desk repository.
- **Records system** (EHRM on the clinic laptop, with the RevitAlign exercise brain): `bridge-sync/` in the `roles-demo` folder.

The two apps only meet through the bridge. This kit keeps them in step, even though each is now developed in its own chat.

| File | What it is |
|---|---|
| `INTEGRATION-CONTRACT.md` | The bridge contract (v1.2): routes, events, fields, consent, crypto, what never crosses. The single source of truth. |
| `CONTRACT.lock.json` | The contract version, its SHA-256 fingerprint, and the event types, capabilities, routes, form crypto and consent versions both sides must share. |
| `joint-check.mts` | Proves the two apps agree. It compares both allow-lists, then runs both apps together in memory over real signed HTTP. |

## Run the joint check

Both projects must be on the same machine, with Node 22.18 or later. Run the front desk's `npm install` once.

```bash
FD_DIR=/path/to/front-desk EH_DIR=/path/to/roles-demo node --disable-warning=ExperimentalWarning bridge-sync/joint-check.mts
```

`17/17 passed — in sync` means the two match. Any `FAIL` means they have drifted, and the line names what. The check:

- uses synthetic people only;
- keeps all data in memory;
- uses ports chosen by the system, never 8787;
- never touches `data/clinic-demo.db`.

What it checks:

| Check | What it proves |
|---|---|
| J1–J3 | The contract and the lock are the same in both projects. |
| J4–J11 | The same id patterns, name and phone rules, service codes, event types and keys, and capabilities on both sides. The laptop accepts every channel the front desk sends, and both refuse an event with an extra key. |
| J12 | The laptop pairs with the front desk and enables the bridge. |
| J13 | A website request arrives on the laptop with its v1.2 fields. |
| J14 | The person is registered and booked, and the secure link goes out by text. |
| J15 | The sealed form opens only on the laptop. The desk keeps the details, and the intake lands on the visit with its safety flag. |
| J16 | A released confirmation is pushed and sent, and its delivery status comes back. |
| J17 | Appointment facts are mirrored in the cloud, with no column for a service, notes or a reason. |

## Rules for changing the bridge

1. **Contract first.** Any change to a route, event, field, code, capability, the form crypto or a consent wording version starts in `INTEGRATION-CONTRACT.md`. Raise the version (for example 1.2 to 1.3) and add a section saying what changed.
2. **Update the lock.** Put the new SHA-256 of the contract in `CONTRACT.lock.json`, plus any new event type, capability, route or version string.
   ```bash
   sha256sum bridge-sync/INTEGRATION-CONTRACT.md
   ```
3. **Change both sides in the same round.** The front desk side is `src/bridge/*.ts`. The laptop side is `bridge.mjs`, plus `server.mjs` where data lands. A change that exists on only one side is not finished.
4. **Copy the kit across.** The three files must be byte-for-byte identical in both projects, and the front desk's `docs/INTEGRATION-CONTRACT.md` must match the kit's copy. Check J3 fails until they do.
5. **Run each side's own tests, then the joint check.** Front desk: `npm test`. EHRM: `node test-roles.mjs`. Joint: the command above. Record the result in that day's `CHANGES-<date>.md` in both projects.
6. **Hand over.**
   - **Front desk:** push to its branch.
   - **EHRM:** never push to GitHub. It goes back as a zip and patch.
   - **Both:** say which contract version each side is on.

## If you only have one project in the chat

You can still change the bridge in the contract first and implement your own side. Say plainly that the other side still needs the same change, and that the joint check has not been run. Do not report the bridge as in sync until it has.
