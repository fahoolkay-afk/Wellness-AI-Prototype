// Go-live gate. In production the server refuses to start until every safety setting is in place.
// Each check names the PHIPA / security reason so the operator knows why it matters.

import { isStrongKey } from "./security/crypto.ts";
import type { Config } from "./config.ts";

const KNOWN_WEAK = /change-?me|demo|secret|password|example|test/i;

export interface PreflightIssue {
  setting: string;
  problem: string;
}

export function preflight(config: Config): PreflightIssue[] {
  if (config.demo) return [];
  const issues: PreflightIssue[] = [];
  const add = (setting: string, problem: string) => issues.push({ setting, problem });
  const s = config.security;

  if (!isStrongKey(s.sessionSecret) || KNOWN_WEAK.test(s.sessionSecret)) {
    add("SESSION_SECRET", "must be at least 32 random bytes (openssl rand -hex 32). It keys the audit chain and session protection.");
  }
  if (!isStrongKey(s.dataKey) || KNOWN_WEAK.test(s.dataKey)) {
    add("DATA_KEY", "must be a 32-byte key (openssl rand -hex 32). It encrypts messages and transcripts at rest (PHIPA s.12).");
  }
  if (s.dataKey && s.dataKey === s.sessionSecret) add("DATA_KEY", "must differ from SESSION_SECRET.");
  if (!config.publicUrl.startsWith("https://")) add("PUBLIC_URL", "must be your public https:// address.");
  if (!config.backups.dir) add("BACKUP_DIR", "must point at a folder for encrypted backups (PHIPA s.12: protect against loss).");
  if (config.dbPath === ":memory:") add("DB_PATH", "cannot be in memory in production.");

  // A channel that can send must also be able to verify what it receives.
  const sms = config.sms;
  if (sms.provider === "twilio" && sms.twilioAccountSid && !sms.twilioAuthToken) add("TWILIO_AUTH_TOKEN", "is required to verify Twilio webhooks.");
  if (sms.provider === "telnyx" && sms.telnyxApiKey && !sms.telnyxPublicKey) add("TELNYX_PUBLIC_KEY", "is required to verify Telnyx webhooks.");
  if ((config.meta.whatsappToken || config.meta.pageAccessToken) && !config.meta.appSecret) add("META_APP_SECRET", "is required to verify Meta webhooks.");
  if ((config.meta.whatsappToken || config.meta.pageAccessToken) && (!config.meta.verifyToken || config.meta.verifyToken.length < 24)) {
    add("META_VERIFY_TOKEN", "must be a long random value (24+ characters).");
  }
  if (config.email.postmarkServerToken && config.email.inboundSecret.length < 24) add("EMAIL_INBOUND_SECRET", "must be a long random value (24+ characters).");
  if (config.elevenlabs.toolSecret && config.elevenlabs.toolSecret.length < 24) add("ELEVENLABS_TOOL_SECRET", "must be a long random value (24+ characters).");
  if (config.elevenlabs.toolSecret && !config.elevenlabs.webhookSecret) add("ELEVENLABS_WEBHOOK_SECRET", "is required to verify post-call webhooks.");
  if (config.edition === "ehr" && !config.ehr.baseUrl.startsWith("https://")) add("EHR_BASE_URL", "must be https:// in production.");
  if (config.trustProxyHops < 0 || !Number.isInteger(config.trustProxyHops)) add("TRUST_PROXY_HOPS", "must be a whole number of proxy hops.");
  return issues;
}

export function formatPreflight(issues: PreflightIssue[]): string {
  return [
    "Refusing to start: production safety settings are missing.",
    ...issues.map((i) => `  - ${i.setting} ${i.problem}`),
    "Set DEMO=1 to run the sample clinic with simulated channels instead (never with real patient data).",
  ].join("\n");
}
