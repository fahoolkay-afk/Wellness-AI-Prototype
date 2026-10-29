import { Automations } from "./automations.ts";
import { DemoResponder } from "./ai/demo.ts";
import { ClaudeResponder, type Responder } from "./ai/receptionist.ts";
import { createBackends, type Backends } from "./booking/index.ts";
import { Channels } from "./channels/index.ts";
import { Voice } from "./channels/voice.ts";
import type { Config } from "./config.ts";
import { Db } from "./db.ts";
import { Events } from "./events.ts";
import { Inbox } from "./inbox.ts";

export interface Services {
  config: Config;
  db: Db;
  events: Events;
  backends: Backends;
  channels: Channels;
  inbox: Inbox;
  automations: Automations;
  voice: Voice;
}

export function createServices(config: Config, overrides: { db?: Db; responder?: Responder; fetchImpl?: typeof fetch; replyDelayMs?: number } = {}): Services {
  const db = overrides.db ?? new Db(config.dbPath);
  const events = new Events();
  const backends = createBackends(db, config, overrides.fetchImpl);
  const channels = new Channels(db, config, overrides.fetchImpl);
  const responder = overrides.responder ?? (config.anthropic.apiKey ? new ClaudeResponder(config.anthropic) : new DemoResponder());
  const inbox = new Inbox(db, channels, backends, events, responder, { replyDelayMs: overrides.replyDelayMs });
  const automations = new Automations(db, events, inbox);
  const voice = new Voice(db, inbox, backends, events);
  return { config, db, events, backends, channels, inbox, automations, voice };
}
