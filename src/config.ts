// Central configuration. Every integration is optional: when its credentials
// are missing the app runs in "simulated" mode for that channel, so the whole
// product can be demoed locally with no accounts at all.

try {
  process.loadEnvFile();
} catch {
  // No .env file - rely on the real environment.
}

const env = (name: string, fallback = ""): string => process.env[name]?.trim() || fallback;

export const config = {
  port: Number(env("PORT", "3000")),
  // Public base URL used to verify Twilio signatures (Twilio signs the full URL).
  publicUrl: env("PUBLIC_URL", "http://localhost:3000"),
  dbPath: env("DB_PATH", "data/clinic.db"),
  staffPassword: env("STAFF_PASSWORD", "demo"),
  sessionSecret: env("SESSION_SECRET", "change-me-in-production"),

  // "standalone": this app owns patients + calendar. "ehr": the clinic's EHRM is the source of truth.
  edition: env("EDITION", "standalone") as "standalone" | "ehr",

  ehr: {
    baseUrl: env("EHR_BASE_URL"),
    apiKey: env("EHR_API_KEY"),
    // HMAC secret the EHRM uses to sign webhooks it sends to /webhooks/ehr.
    webhookSecret: env("EHR_WEBHOOK_SECRET"),
    timeoutMs: Number(env("EHR_TIMEOUT_MS", "8000")),
  },

  anthropic: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("AI_MODEL", "claude-opus-5-5"),
    // Receptionist replies are short chat turns; low effort keeps latency and cost down.
    effort: env("AI_EFFORT", "low") as "low" | "medium" | "high",
  },

  sms: {
    // "twilio" or "telnyx" - both are supported so the cheaper one can be picked per deployment.
    provider: env("SMS_PROVIDER", "twilio") as "twilio" | "telnyx",
    twilioAccountSid: env("TWILIO_ACCOUNT_SID"),
    twilioAuthToken: env("TWILIO_AUTH_TOKEN"),
    telnyxApiKey: env("TELNYX_API_KEY"),
    telnyxPublicKey: env("TELNYX_PUBLIC_KEY"),
    telnyxMessagingProfileId: env("TELNYX_MESSAGING_PROFILE_ID"),
  },

  // WhatsApp Cloud API, Messenger and Instagram all go direct to Meta's Graph API.
  meta: {
    graphVersion: env("META_GRAPH_VERSION", "v23.0"),
    appSecret: env("META_APP_SECRET"),
    verifyToken: env("META_VERIFY_TOKEN", "clinic-verify-token"),
    whatsappToken: env("WHATSAPP_ACCESS_TOKEN"),
    pageAccessToken: env("META_PAGE_ACCESS_TOKEN"),
  },

  email: {
    postmarkServerToken: env("POSTMARK_SERVER_TOKEN"),
    inboundSecret: env("EMAIL_INBOUND_SECRET"),
  },

  elevenlabs: {
    // Shared secret ElevenLabs sends on server-tool calls (configured as a header on each tool).
    toolSecret: env("ELEVENLABS_TOOL_SECRET"),
    // HMAC secret for post-call webhooks.
    webhookSecret: env("ELEVENLABS_WEBHOOK_SECRET"),
  },

  scheduler: {
    intervalMs: Number(env("SCHEDULER_INTERVAL_MS", "60000")),
  },
};

export type Config = typeof config;
