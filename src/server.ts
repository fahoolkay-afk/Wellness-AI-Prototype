import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { formatPreflight, preflight } from "./preflight.ts";
import { seedDemo } from "./seed.ts";
import { createServices } from "./services.ts";

// Go-live gate: in production, refuse to start until every safety setting is in place.
const issues = preflight(config);
if (issues.length) {
  console.error(formatPreflight(issues));
  process.exit(1);
}

const services = createServices(config);
if (config.demo && !services.db.listClinics().length) {
  seedDemo(services.db, { consents: services.consents, accounts: services.accounts });
  console.log("Seeded demo clinic: Harbourfront Physio & Wellness (sample data only)");
}
if (!config.demo && !services.accounts.count()) {
  console.log("No staff accounts yet. Create the owner with: npm run cli -- create-user <username> \"<Full name>\" owner <clinicId>");
}
services.automations.start(config.scheduler.intervalMs);

// Retention every hour; an encrypted backup every 24 hours (and once at start).
const hourly = setInterval(() => {
  try {
    services.maintenance.runRetention();
  } catch (err) {
    console.error("[retention]", (err as Error).message);
  }
}, 3600_000);
const daily = setInterval(() => {
  try {
    services.maintenance.backup();
  } catch (err) {
    console.error("[backup]", (err as Error).message);
  }
}, 24 * 3600_000);
services.maintenance.runRetention();
if (config.backups.dir) services.maintenance.backup();

const app = createApp(services);
const server = app.listen(config.port, () => {
  const live = Object.entries(services.channels.status()).map(([c, s]) => `${c}=${s}`).join(" ");
  console.log(`Front desk running at ${config.publicUrl} (port ${config.port}, edition: ${config.edition}, AI: ${services.inbox.responderName}${config.demo ? ", DEMO MODE" : ""})`);
  console.log(`Channels: ${live}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    services.automations.stop();
    clearInterval(hourly);
    clearInterval(daily);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
