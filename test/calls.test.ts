// The conversation view shows who contacted whom: the clinic's address on each channel and every call
// (direction, from, to, who handled it, duration, transcript) for that person.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createApp } from "../src/app.ts";
import { api, listen, setup, signIn, testConfig } from "./helpers.ts";

const servers: { close: () => Promise<void> }[] = [];
after(() => Promise.all(servers.map((s) => s.close())));

test("a conversation lists its calls with direction, numbers, handler, duration and transcript", async () => {
  const s = setup({ config: testConfig() });
  const server = await listen(createApp(s));
  servers.push(server);
  const contact = s.db.createContact(s.clinicId, { name: "Call Person", phone: "+14165550901" });
  const conv = s.db.conversationForContact(contact, "voice");
  s.db.upsertCall({ clinic_id: s.clinicId, contact_id: contact.id, conversation_id: conv.id, external_id: "t-in", direction: "inbound", handled_by: "assistant",
    from_number: "+14165550901", to_number: "+14165550100", duration_s: 75, summary: "Asked about parking.", transcript: "Assistant: Hello\nCaller: Is there parking?", outcome: "success" });
  s.db.upsertCall({ clinic_id: s.clinicId, contact_id: contact.id, conversation_id: conv.id, external_id: "t-out", direction: "outbound", handled_by: "Sam Lee",
    from_number: "+14165550100", to_number: "+14165550901", duration_s: 40, summary: "Returned call.", transcript: null, outcome: "completed" });

  const desk = api(server.url, await signIn(s, server.url, "front_desk"));
  const res = await desk("GET", `/api/conversations/${conv.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.clinicAddresses.sms, "+14165550100");
  const byDir = Object.fromEntries(res.data.calls.map((c: { direction: string }) => [c.direction, c]));
  assert.equal(byDir.inbound.to_number, "+14165550100");
  assert.equal(byDir.inbound.handled_by, "assistant");
  assert.match(byDir.inbound.transcript, /Is there parking/);
  assert.equal(byDir.outbound.handled_by, "Sam Lee");
  assert.equal(byDir.outbound.duration_s, 40);

  // Transcripts are encrypted at rest.
  const raw = s.db.sql.prepare("SELECT transcript FROM calls WHERE external_id = 't-in'").get() as { transcript: string };
  assert.match(raw.transcript, /^e1:/);

  // A role without call access gets the conversation without call records.
  const practitioner = api(server.url, await signIn(s, server.url, "practitioner"));
  const p = await practitioner("GET", `/api/conversations/${conv.id}`);
  assert.equal(p.status, 200);
  assert.deepEqual(p.data.calls, []);
});
