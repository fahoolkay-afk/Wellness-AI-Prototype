import { Automations } from "./automations.ts";
import { Bridge } from "./bridge/service.ts";
import { BridgeStore } from "./bridge/store.ts";
import { DemoResponder } from "./ai/demo.ts";
import { ClaudeResponder, type Responder } from "./ai/receptionist.ts";
import { createBackends, type Backends } from "./booking/index.ts";
import { Channels } from "./channels/index.ts";
import { Voice } from "./channels/voice.ts";
import type { Config } from "./config.ts";
import { Consents } from "./consent.ts";
import { Db } from "./db.ts";
import { Events } from "./events.ts";
import { UnsubscribeLinks } from "./http/security.ts";
import { Inbox } from "./inbox.ts";
import { Maintenance } from "./maintenance.ts";
import { Accounts } from "./security/accounts.ts";
import { AuditLog } from "./security/audit.ts";
import { deriveKey, parseKey } from "./security/crypto.ts";
import { Vault } from "./security/vault.ts";

export interface Services {
  config: Config;
  db: Db;
  events: Events;
  backends: Backends;
  channels: Channels;
  inbox: Inbox;
  automations: Automations;
  voice: Voice;
  accounts: Accounts;
  audit: AuditLog;
  consents: Consents;
  unsubscribe: UnsubscribeLinks;
  maintenance: Maintenance;
  bridge: Bridge;
}

export function createServices(config: Config, overrides: { db?: Db; responder?: Responder; fetchImpl?: typeof fetch; replyDelayMs?: number } = {}): Services {
  const db = overrides.db ?? new Db(config.dbPath, new Vault(config.security.dataKey));
  const events = new Events();
  // The audit chain is keyed separately from the data key, so neither alone can forge it.
  const audit = new AuditLog(db.sql, deriveKey(parseKey(config.security.sessionSecret || "test-only"), "audit-chain:v1"));
  const accounts = new Accounts(db.sql, db.vault, {
    idleMinutes: config.security.idleMinutes, sessionHours: config.security.sessionHours, requireTotp: config.security.requireTotp,
  });
  const consents = new Consents(db.sql, (contactId, channel) => {
    const c = db.getContact(contactId);
    if (!c) return undefined;
    const address = { sms: c.phone, voice: c.phone, whatsapp: c.whatsapp_id, email: c.email?.toLowerCase() ?? null, messenger: c.messenger_id, instagram: c.instagram_id }[channel] ?? null;
    return { clinicId: c.clinic_id, address };
  });
  const unsubscribe = new UnsubscribeLinks(db.vault, config.publicUrl);
  const backends = createBackends(db, config, overrides.fetchImpl);
  const channels = new Channels(db, config, (clinicId, contactId, channel) => unsubscribe.url(clinicId, contactId, channel), overrides.fetchImpl);
  const responder = overrides.responder ?? (config.anthropic.apiKey ? new ClaudeResponder(config.anthropic) : new DemoResponder());
  const inbox = new Inbox(db, channels, backends, events, responder, consents, audit, config, { replyDelayMs: overrides.replyDelayMs });
  const automations = new Automations(db, events, inbox);
  const voice = new Voice(db, inbox, backends, events, consents, audit);
  const maintenance = new Maintenance(db, audit, accounts, config.backups.dir);
  // Bridge to the clinic's EHRM (docs/INTEGRATION-CONTRACT.md): off for every clinic until paired.
  const bridge = new Bridge(new BridgeStore(db), inbox, consents, audit, events);
  inbox.setBridge(bridge);
  bridge.setPublicUrl(config.publicUrl);
  maintenance.onRetention((now) => bridge.purge(now));
  return { config, db, events, backends, channels, inbox, automations, voice, accounts, audit, consents, unsubscribe, maintenance, bridge };
}
