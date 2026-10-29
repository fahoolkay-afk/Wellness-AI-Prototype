// Browser demo: the real server code (inbox, AI demo responder, booking,
// automations, API) running in the page on an in-memory SQLite database.
// Build with `npm run demo:build`; the result is one self-contained HTML file.

import { setApp } from "./intercept.js";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { setSqlEngine } from "./shims/sqlite.js";
import { config } from "../src/config.ts";
import { createApp } from "../src/app.ts";
import { seedDemo } from "../src/seed.ts";
import { createServices } from "../src/services.ts";
import "../public/app.js";

(async () => {
  setSqlEngine(await initSqlJs());
  const services = createServices(config, { replyDelayMs: 900 });
  seedDemo(services.db, { consents: services.consents, accounts: services.accounts });
  setApp(createApp(services));
  // Automations normally tick every minute on the server.
  const tick = () => services.automations.tick().catch((err) => console.error("[automations]", err));
  tick();
  setInterval(tick, 30_000);
})();
