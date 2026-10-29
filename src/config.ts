// Central configuration.
//
// Two modes:
//   - demo (DEMO=1): sample clinic, simulated channels, test console, relaxed
//     webhook checks. Never for real patient data.
//   - production (default): the server refuses to start unless every safety
//     setting is in place (see src/preflight.ts).

try {
  process.loadEnvFile();
} catch {
  // No .env file - rely on the real environment.
}

const env = (name: string, fallback = ""): string => process.env[name]?.trim() || fallback;
const flag = (name: string): boolean => ["1", "true", "yes"].includes(env(name).toLowerCase());

const demo = flag("DEMO");

export const config = {
  demo,
  port: Number(env("PORT", "3000")),
  // Public HTTPS base URL. Twilio signs the full URL, and webhook URLs shown in Settings use it.
  publicUrl: env("PUBLIC_URL", "http://localhost:3000"),
  dbPath: env("DB_PATH", "data/clinic.db"),
  // Number of reverse-proxy hops in front of the app (0 = none). Never "true": that lets anyone spoof their IP.
  trustProxyHops: Number(env("TRUST_PROXY_HOPS", "0")),

  security: {
    // At least 32 random bytes (e.g. `openssl rand -hex 32`). Signs nothing by itself any more; it keys the
    // audit chain and derives per-purpose keys. Required in production.
    sessionSecret: env("SESSION_SECRET", demo ? "demo-only-session-secret-not-for-real-data" : ""),
    // 32-byte key (hex or base64) that encrypts message bodies, transcripts and notes at rest.
    // Each clinic gets its own key derived from this one. Required in production.
    dataKey: env("DATA_KEY", demo ? "demo-only-data-key-not-for-real-data" : ""),
    // Minutes of inactivity before a staff session ends, and the absolute session length.
    idleMinutes: Number(env("SESSION_IDLE_MINUTES", "15")),
    sessionHours: Number(env("SESSION_MAX_HOURS", "12")),
    // Require a phone-app code (TOTP) for every staff account. Always on in production.
    requireTotp: demo ? flag("REQUIRE_TOTP") : true,
    // Unsigned webhooks are accepted only in demo mode and only when this is set.
    allowUnsignedWebhooks: demo && flag("DEMO_UNSIGNED_WEBHOOKS"),
    // Test console that injects messages as if a patient sent them.
    enableSimulator: demo || (flag("ENABLE_SIMULATOR") && env("NODE_ENV") !== "production"),
    // Outbound SMS and calls only to North American (+1) numbers unless explicitly allowed.
    allowInternational: flag("ALLOW_INTERNATIONAL_SENDS"),
  },

  // "standalone": this app owns patients + calendar. "ehr": the clinic's EHRM is the source of truth.
  edition: env("EDITION", "standalone") as "standalone" | "ehr",

  ehr: {
    baseUrl: env("EHR_BASE_URL"),
    apiKey: env("EHR_API_KEY"),
    timeoutMs: Number(env("EHR_TIMEOUT_MS", "8000")),
  },

  anthropic: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("AI_MODEL", "claude-opus-5-5"),
    // Receptionist replies are short chat turns; low effort keeps latency and cost down.
    effort: env("AI_EFFORT", "low") as "low" | "medium" | "high",
    // Per-clinic daily cap on AI turns, and per-contact hourly cap (denial-of-wallet protection).
    dailyTurnsPerClinic: Number(env("AI_DAILY_TURNS_PER_CLINIC", "600")),
    hourlyTurnsPerContact: Number(env("AI_HOURLY_TURNS_PER_CONTACT", "15")),
  },

  sms: {
    // "twilio" or "telnyx" - both are supported so the cheaper one can be picked per deployment.
    provider: env("SMS_PROVIDER", "twilio") as "twilio" | "telnyx",
    twilioAccountSid: env("TWILIO_ACCOUNT_SID"),
    twilioAuthToken: env("TWILIO_AUTH_TOKEN"),
    // A Messaging Service bound to a registered 10DLC campaign (US). Used instead of a bare From number.
    twilioMessagingServiceSid: env("TWILIO_MESSAGING_SERVICE_SID"),
    telnyxApiKey: env("TELNYX_API_KEY"),
    telnyxPublicKey: env("TELNYX_PUBLIC_KEY"),
    telnyxMessagingProfileId: env("TELNYX_MESSAGING_PROFILE_ID"),
    // Max automated or staff texts to one person per hour (pumping and spam protection).
    maxPerContactPerHour: Number(env("SMS_MAX_PER_CONTACT_PER_HOUR", "8")),
  },

  // WhatsApp Cloud API, Messenger and Instagram all go direct to Meta's Graph API.
  meta: {
    graphVersion: env("META_GRAPH_VERSION", "v23.0"),
    appSecret: env("META_APP_SECRET"),
    verifyToken: env("META_VERIFY_TOKEN", demo ? "demo-verify-token" : ""),
    whatsappToken: env("WHATSAPP_ACCESS_TOKEN"),
    pageAccessToken: env("META_PAGE_ACCESS_TOKEN"),
  },

  email: {
    postmarkServerToken: env("POSTMARK_SERVER_TOKEN"),
    // Sent by Postmark as HTTP Basic auth password (configure the inbound URL as https://inbound:<secret>@host/...).
    inboundSecret: env("EMAIL_INBOUND_SECRET"),
  },

  elevenlabs: {
    // Shared secret ElevenLabs sends on server-tool calls (configured as a header on each tool).
    toolSecret: env("ELEVENLABS_TOOL_SECRET"),
    // HMAC secret for post-call webhooks.
    webhookSecret: env("ELEVENLABS_WEBHOOK_SECRET"),
  },

  backups: {
    // Folder for encrypted nightly backups. Required in production.
    dir: env("BACKUP_DIR"),
  },

  scheduler: {
    intervalMs: Number(env("SCHEDULER_INTERVAL_MS", "60000")),
  },
};

export type Config = typeof config;
