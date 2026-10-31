// The bridge sync kit (bridge-sync/) must match this project's contract and its own event table, so a bridge change made
// here cannot drift from what the EHRM side is told. The cross-project half is bridge-sync/joint-check.mts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EVENT_TYPES } from "../src/bridge/events.ts";

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const lock = JSON.parse(readFileSync("bridge-sync/CONTRACT.lock.json", "utf8"));

test("bridge sync kit: the contract copy, the lock and this project's event table agree", () => {
  assert.equal(sha("bridge-sync/INTEGRATION-CONTRACT.md"), lock.contractSha256, "the kit's contract changed without updating the lock");
  assert.equal(sha("docs/INTEGRATION-CONTRACT.md"), lock.contractSha256, "docs/INTEGRATION-CONTRACT.md and bridge-sync/ differ");
  assert.deepEqual(Object.keys(EVENT_TYPES).sort(), [...lock.eventTypes].sort());
  assert.match(readFileSync("public/form.js", "utf8"), new RegExp(`"${lock.formCrypto.hkdfInfo}"`), "the form page's HKDF info must match the lock");
});
