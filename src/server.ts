import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { seedDemo } from "./seed.ts";
import { createServices } from "./services.ts";

const services = createServices(config);
if (!services.db.listClinics().length) {
  seedDemo(services.db);
  console.log("Seeded demo clinic: Harbourfront Physio & Wellness");
}
services.automations.start(config.scheduler.intervalMs);

const app = createApp(services);
const server = app.listen(config.port, () => {
  const live = Object.entries(services.channels.status()).map(([c, s]) => `${c}=${s}`).join(" ");
  console.log(`Front desk running at http://localhost:${config.port} (edition: ${config.edition}, AI: ${services.inbox.responderName})`);
  console.log(`Channels: ${live}`);
  if (config.staffPassword === "demo") console.log('Staff password is "demo"; set STAFF_PASSWORD before going live.');
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    services.automations.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
