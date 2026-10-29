// Operator commands, run on the server itself (never over the web):
//   npm run cli -- create-clinic "<Clinic name>" <timezone>
//   npm run cli -- create-user <username> "<Full name>" <owner|front_desk|practitioner|auditor> <clinicId>
//   npm run cli -- reset-user <username>
//   npm run cli -- pair-ehr <clinicId> <locationId>        (prints the key id + secret for the EHRM, once)
//   npm run cli -- backup
//   npm run cli -- restore <file.db.enc> <output.db>      (decrypts; stop the server before swapping files)
//   npm run cli -- verify-audit

import { writeFileSync } from "node:fs";
import { config } from "./config.ts";
import { decryptBackup } from "./maintenance.ts";
import { DEMO_CLINIC } from "./seed.ts";
import { createServices } from "./services.ts";
import { randomToken } from "./security/crypto.ts";
import { ROLES, type Role } from "./security/permissions.ts";

const [command, ...args] = process.argv.slice(2);
const s = createServices(config);
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};
const operator = `cli:${process.env.USER ?? "operator"}`;

switch (command) {
  case "create-clinic": {
    const [name, timezone] = args;
    if (!name || !timezone) fail('Usage: create-clinic "<Clinic name>" <timezone, e.g. America/Toronto>');
    // Starts from the sample structure with no services or staff; the owner fills in Settings.
    const id = s.db.createClinic({ ...DEMO_CLINIC, name, timezone, services: [], practitioners: [], faq: [], processorAgreementsRecorded: false });
    s.audit.record({ actorType: "system", actor: operator, clinicId: id, action: "clinic.create", outcome: "ok" });
    console.log(`Clinic ${id} created.`);
    break;
  }
  case "create-user": {
    const [username, name, role, clinicId] = args;
    if (!username || !name || !ROLES.includes(role as Role) || !Number(clinicId)) fail(`Usage: create-user <username> "<Full name>" <${ROLES.join("|")}> <clinicId>`);
    if (!s.db.getClinic(Number(clinicId))) fail(`No clinic ${clinicId}.`);
    const { user, tempPassword } = s.accounts.createUser({ username, name, role: role as Role, clinicIds: [Number(clinicId)], createdBy: operator });
    s.audit.record({ actorType: "system", actor: operator, clinicId: Number(clinicId), action: "user.create", target: `user:${user.id}`, outcome: "ok", detail: role });
    console.log(`User ${user.username} created. Temporary passphrase (shown once; hand over in person):\n  ${tempPassword}`);
    break;
  }
  case "reset-user": {
    const user = s.accounts.findByUsername(args[0] ?? "") ?? fail("Usage: reset-user <username>");
    const temp = s.accounts.resetCredentials(user.id);
    s.audit.record({ actorType: "system", actor: operator, action: "user.reset", target: `user:${user.id}`, outcome: "ok" });
    console.log(`Passphrase and phone-app code reset. Temporary passphrase (shown once):\n  ${temp}`);
    break;
  }
  case "pair-ehr": {
    const [clinicId, locationId] = args;
    if (!Number(clinicId) || !locationId) fail("Usage: pair-ehr <clinicId> <locationId>");
    const keyId = `ehr_${randomToken(8)}`;
    const secret = randomToken(32);
    s.db.setEhrIntegration(Number(clinicId), locationId, keyId, secret);
    s.audit.record({ actorType: "system", actor: operator, clinicId: Number(clinicId), action: "ehr.pair", target: `location:${locationId}`, outcome: "ok" });
    console.log(`Paired. Enter these in the EHRM (shown once):\n  X-EHR-Key-Id: ${keyId}\n  Signing secret: ${secret}`);
    break;
  }
  case "backup":
    console.log(s.maintenance.backup() ?? fail("Set BACKUP_DIR first."));
    break;
  case "restore": {
    const [file, out] = args;
    if (!file || !out) fail("Usage: restore <file.db.enc> <output.db>");
    writeFileSync(out, decryptBackup(file, s.db.vault.systemKey("backup:v1")), { mode: 0o600 });
    console.log(`Decrypted to ${out}. Stop the server, move it into place as DB_PATH, then start again.`);
    break;
  }
  case "verify-audit": {
    const result = s.audit.verify();
    console.log(result.ok ? `Audit chain intact (${result.rows} events).` : `AUDIT CHAIN BROKEN at event ${result.brokenAt}.`);
    if (!s.audit.triggersPresent()) console.log("WARNING: the append-only protection on the audit table is missing.");
    process.exit(result.ok ? 0 : 2);
  }
  default:
    console.log("Commands: create-clinic, create-user, reset-user, pair-ehr, backup, restore, verify-audit");
}
