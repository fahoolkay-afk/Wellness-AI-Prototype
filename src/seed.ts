import type { Consents } from "./consent.ts";
import type { Db } from "./db.ts";
import type { Accounts } from "./security/accounts.ts";
import type { ClinicProfile } from "./types.ts";
import { addDays, localDate, zonedToUtc } from "./time.ts";

const weekdays = (ranges: [string, string][]) => ({ mon: ranges, tue: ranges, wed: ranges, thu: ranges, fri: ranges });

export const DEMO_CLINIC: ClinicProfile = {
  name: "Harbourfront Physio & Wellness",
  type: "Physiotherapy, chiropractic and registered massage therapy clinic",
  timezone: "America/Toronto",
  address: "200 Queens Quay W, Suite 110, Toronto, ON M5J 2Y5",
  phone: "+1 416-555-0100",
  email: "frontdesk@harbourfrontphysio.example",
  website: "https://harbourfrontphysio.example",
  hoursText: "Mon-Fri 8am-7pm, Sat 9am-2pm, closed Sunday",
  services: [
    { id: "physio-initial", name: "Physiotherapy initial assessment", durationMin: 60, priceCents: 12000, description: "A full assessment and a care plan with a registered physiotherapist." },
    { id: "physio-followup", name: "Physiotherapy follow-up", durationMin: 30, priceCents: 9000, description: "A follow-up session." },
    { id: "chiro-initial", name: "Chiropractic initial visit", durationMin: 45, priceCents: 11000, description: "History, exam and first adjustment." },
    { id: "chiro-adjustment", name: "Chiropractic adjustment", durationMin: 20, priceCents: 6500, description: "Follow-up adjustment." },
    { id: "rmt-60", name: "Registered massage therapy (60 min)", durationMin: 60, priceCents: 13000, description: "Therapeutic massage with an RMT. Receipts accepted by most extended health plans." },
    { id: "rmt-90", name: "Registered massage therapy (90 min)", durationMin: 90, priceCents: 17500, description: "Extended therapeutic massage." },
  ],
  practitioners: [
    { id: "pr-maya", name: "Maya Chen", title: "Registered Physiotherapist", services: ["physio-initial", "physio-followup"], hours: { ...weekdays([["08:00", "12:00"], ["13:00", "16:00"]]) } },
    { id: "pr-daniel", name: "Daniel Okafor", title: "Chiropractor", services: ["chiro-initial", "chiro-adjustment"], hours: { mon: [["11:00", "19:00"]], wed: [["11:00", "19:00"]], fri: [["08:00", "14:00"]], sat: [["09:00", "14:00"]] } },
    { id: "pr-sofia", name: "Sofia Alvarez", title: "Registered Massage Therapist", services: ["rmt-60", "rmt-90"], hours: { tue: [["10:00", "19:00"]], thu: [["10:00", "19:00"]], sat: [["09:00", "14:00"]] } },
  ],
  policies: [
    "24 hours' notice is required to cancel or reschedule; late cancellations and no-shows are charged 50% of the visit fee.",
    "We direct-bill most major insurers (Sun Life, Manulife, Canada Life, Green Shield, Blue Cross). Patients should bring their insurance card to the first visit.",
    "No doctor's referral is needed for physiotherapy, chiropractic or massage, although some insurance plans require one for reimbursement.",
    "Please arrive 10 minutes early for a first visit to complete intake forms.",
  ],
  faq: [
    { q: "Is there parking?", a: "Paid underground parking is available in the building (entrance on Lower Simcoe St). The 509/510 streetcars stop at the door." },
    { q: "What should I wear?", a: "Comfortable, loose clothing such as shorts and a t-shirt so the practitioner can assess movement." },
    { q: "Do you see patients with WSIB or motor-vehicle accident claims?", a: "Yes. Please let us know when booking so we can set up the claim; staff will follow up for claim details." },
  ],
  bookingProvider: "builtin",
  janeBookingUrl: "https://harbourfrontphysio.janeapp.com",
  reviewUrl: "https://g.page/r/harbourfront-physio/review",
  audienceTags: ["newsletter", "returning", "family-plan"],
  retention: { messageDays: 180, callDays: 30 },
  processorAgreementsRecorded: false,
  quietHours: { start: "08:00", end: "21:00" },
  aiModes: { sms: "auto", whatsapp: "auto", messenger: "auto", instagram: "auto", email: "draft", voice: "auto" },
  automations: [
    {
      id: "booking-confirmation", name: "Booking confirmation", enabled: true,
      trigger: { type: "appointment_booked" },
      actions: [
        { type: "set_stage", stage: "booked" },
        { type: "send_message", channel: "preferred", purpose: "service", template: "Hi {{first_name}}, you're booked at {{clinic_name}} on {{appointment_time}} with {{practitioner}}. Reply here if you need to change anything." },
      ],
    },
    {
      id: "reminder-24h", name: "Appointment reminder (24h)", enabled: true,
      trigger: { type: "appointment_upcoming", hours: 24 },
      actions: [{ type: "send_message", channel: "preferred", purpose: "service", template: "Hi {{first_name}}, a reminder of your appointment at {{clinic_name}} on {{appointment_time}}. Reply C to confirm or CHANGE to reschedule." }],
    },
    {
      // Marketing: sent only to patients who gave express consent for marketing on that channel.
      id: "post-visit-review", name: "Post-visit check-in + review request", enabled: true,
      trigger: { type: "appointment_completed", hours: 3 },
      actions: [
        { type: "set_stage", stage: "active_patient" },
        { type: "send_message", channel: "preferred", purpose: "marketing", template: "Hi {{first_name}}, thanks for visiting {{clinic_name}} today! If you have a minute, a review helps us a lot: {{review_url}}" },
      ],
    },
    {
      id: "cancel-rebook", name: "Cancellation: offer rebooking", enabled: true,
      trigger: { type: "appointment_cancelled" },
      actions: [
        { type: "send_message", channel: "preferred", purpose: "service", template: "Your appointment at {{clinic_name}} has been cancelled, {{first_name}}. Whenever you're ready to rebook, just reply here and we'll find a time." },
        { type: "create_task", title: "Cancellation: try to fill the open slot from the waitlist", taskType: "booking" },
      ],
    },
    {
      // Off by default: a follow-up to someone who hasn't booked is marketing and needs express consent.
      id: "lead-nurture-24h", name: "New lead not booked (24h)", enabled: false,
      trigger: { type: "lead_not_booked", hours: 24 },
      actions: [
        { type: "send_message", channel: "preferred", purpose: "marketing", template: "Hi {{first_name}}, just checking in from {{clinic_name}}. Would you like help finding an appointment time? You can also book online: {{booking_url}}" },
        { type: "set_stage", stage: "contacted" },
      ],
    },
    {
      id: "lapsed-60d", name: "Re-engage lapsed patients (60 days)", enabled: false,
      trigger: { type: "patient_lapsed", days: 60 },
      actions: [
        { type: "set_stage", stage: "lapsed" },
        { type: "send_message", channel: "preferred", purpose: "marketing", template: "Hi {{first_name}}, it's been a while since your last visit to {{clinic_name}}. If you'd like to book a check-in, reply here and we'll set it up." },
      ],
    },
  ],
};

/** Demo-only staff accounts (demo mode shows these on the sign-in screen). */
export const DEMO_ACCOUNTS = [
  { username: "owner", name: "Alex Rivera", role: "owner" as const },
  { username: "frontdesk", name: "Sam Lee", role: "front_desk" as const },
  { username: "auditor", name: "Jordan Kim", role: "auditor" as const },
];
export const DEMO_PASSWORD = "harbourfront-demo";

/** Seeds the demo clinic once (demo mode only). Returns its id. */
export function seedDemo(db: Db, deps?: { consents: Consents; accounts: Accounts }): number {
  const existing = db.listClinics()[0];
  if (existing) return existing.id;

  const clinicId = db.createClinic(DEMO_CLINIC);
  db.addChannelAccount(clinicId, "sms", "+14165550100");
  db.addChannelAccount(clinicId, "voice", "+14165550100");
  db.addChannelAccount(clinicId, "whatsapp", "demo-whatsapp-phone-id");
  db.addChannelAccount(clinicId, "messenger", "demo-facebook-page-id");
  db.addChannelAccount(clinicId, "instagram", "demo-instagram-account-id");
  db.addChannelAccount(clinicId, "email", "frontdesk@harbourfrontphysio.example");

  const tz = DEMO_CLINIC.timezone;
  const today = localDate(new Date(), tz);
  const at = (days: number, time: string) => zonedToUtc(addDays(today, days), time, tz).toISOString();

  // A patient who booked through WhatsApp.
  const priya = db.createContact(clinicId, { name: "Priya Sharma", phone: "+14165550123", whatsapp_id: "14165550123", stage: "booked", tags: '["physio","lower-back"]', preferred_channel: "whatsapp" });
  const c1 = db.conversationForContact(priya, "whatsapp");
  db.addMessage({ conversationId: c1.id, channel: "whatsapp", direction: "in", author: "patient", body: "Hi! Do you have anything this week for lower back pain? I've never been before.", status: "received" });
  db.addMessage({ conversationId: c1.id, channel: "whatsapp", direction: "out", author: "ai", body: "Hi Priya, sorry to hear about your back. For a first visit we'd book a 60-minute physiotherapy initial assessment ($120, direct billing available). Maya Chen has openings on Thursday at 9:00 AM or 2:30 PM. Would either work?", status: "simulated" });
  db.addMessage({ conversationId: c1.id, channel: "whatsapp", direction: "in", author: "patient", body: "Thursday 2:30 please", status: "received" });
  db.addMessage({ conversationId: c1.id, channel: "whatsapp", direction: "out", author: "ai", body: "You're all set: physiotherapy initial assessment with Maya Chen on Thursday at 2:30 PM. Please arrive 10 minutes early to fill out intake forms, and bring your insurance card.", status: "simulated" });
  db.createAppointment({ clinic_id: clinicId, contact_id: priya.id, service_id: "physio-initial", practitioner_id: "pr-maya", starts_at: at(3, "14:30"), ends_at: at(3, "15:30"), created_via: "ai:whatsapp" });

  // A caller whose question the AI couldn't answer, so it made a callback task.
  const tom = db.createContact(clinicId, { name: "Tom Becker", phone: "+16475550188", stage: "new_lead", tags: '["mva-claim"]', preferred_channel: "sms" });
  const c2 = db.conversationForContact(tom, "voice");
  db.addMessage({ conversationId: c2.id, channel: "voice", direction: "in", author: "call", body: "📞 Call answered by the virtual assistant (2m 41s)\nSummary: Tom was rear-ended last week and wants physiotherapy under his auto insurance claim. He has a claim number and asked whether the clinic bills the insurer directly. Callback requested.", status: "received" });
  db.updateConversation(c2.id, { needs_attention: 1, attention_reason: "Auto insurance (MVA) claim: staff callback needed" });
  db.createTask({ clinicId, contactId: tom.id, conversationId: c2.id, type: "callback", priority: "urgent", title: "Call back Tom Becker about MVA claim billing", details: "Rear-ended last week; has claim number. Wants to know about direct billing to auto insurer before booking.", createdBy: "ai:voice" });
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  db.upsertCall({
    clinic_id: clinicId, contact_id: tom.id, conversation_id: c2.id, external_id: "demo-call-1", direction: "inbound", handled_by: "assistant",
    from_number: "+16475550188", to_number: "+14165550100", duration_s: 161, summary: "Auto insurance claim question; callback requested.", outcome: "callback_requested",
    transcript: [
      "Assistant: Thanks for calling Harbourfront Physio & Wellness. This is the clinic's virtual assistant, and this call is transcribed to help our team. How can I help?",
      "Caller: Hi, I was rear-ended last week and my insurance says I can get physio. Do you bill them directly?",
      "Assistant: I can help you get started. Billing for auto insurance claims is handled by our front desk team. Can I take your name and the best number to call you back?",
      "Caller: Tom Becker. This number is fine, 647 555 0188.",
      "Assistant: Thanks, Tom. Do you have your claim number handy? The team will ask for it.",
      "Caller: Yes, I have it.",
      "Assistant: Great. I've asked the team to call you back today. Is there a time that works best?",
      "Caller: After 3 is good.",
      "Assistant: You're all set. Someone from the front desk will call you after 3 PM today. Anything else I can help with?",
      "Caller: No, that's it. Thanks.",
    ].join("\n"),
  });
  db.sql.prepare("UPDATE calls SET created_at = ? WHERE external_id = 'demo-call-1'").run(ago(95));
  // Staff called Tom back from the clinic line.
  db.upsertCall({
    clinic_id: clinicId, contact_id: tom.id, conversation_id: c2.id, external_id: "demo-call-2", direction: "outbound", handled_by: "Sam Lee",
    from_number: "+14165550100", to_number: "+16475550188", duration_s: 252, summary: "Explained direct billing for auto claims; Tom will book after his adjuster confirms.", outcome: "completed",
    transcript: [
      "Sam Lee: Hi Tom, it's Sam from Harbourfront Physio & Wellness returning your call. Is now a good time?",
      "Tom: Yes, thanks for calling back.",
      "Sam Lee: We can bill your auto insurer directly once we have your claim number and adjuster's details.",
      "Tom: I'll get the adjuster's email and call you back to book.",
      "Sam Lee: Perfect. I'll note that here. Talk soon.",
    ].join("\n"),
  });
  db.sql.prepare("UPDATE calls SET created_at = ? WHERE external_id = 'demo-call-2'").run(ago(20));
  db.addMessage({ conversationId: c2.id, channel: "voice", direction: "out", author: "call", body: "Outgoing call by Sam Lee (4m 12s)\nSummary: Explained direct billing for auto claims; Tom will book after his adjuster confirms.", status: "sent", externalId: "call:demo-call-2" });
  // A missed call the assistant couldn't take (line busy), so it's on the call log for follow-up.
  const nadia = db.createContact(clinicId, { name: "Nadia Haddad", phone: "+19055550161", stage: "new_lead", preferred_channel: "sms" });
  db.upsertCall({
    clinic_id: clinicId, contact_id: nadia.id, conversation_id: db.conversationForContact(nadia, "voice").id, external_id: "demo-call-3", direction: "inbound", handled_by: null,
    from_number: "+19055550161", to_number: "+14165550100", duration_s: 0, summary: null, transcript: null, outcome: "missed",
  });
  db.sql.prepare("UPDATE calls SET created_at = ? WHERE external_id = 'demo-call-3'").run(ago(8));
  // Staff followed up Priya on WhatsApp inside the 24-hour window.
  db.addMessage({ conversationId: c1.id, channel: "whatsapp", direction: "out", author: "staff", authorName: "Sam Lee", body: "Hi Priya, it's Sam at the front desk. Street parking is free on Thursday afternoons, and the entrance is on Queens Quay.", status: "simulated" });

  // An Instagram lead.
  const jess = db.createContact(clinicId, { name: "Jess Morales", instagram_id: "ig-1789000", stage: "new_lead", tags: '["massage"]', preferred_channel: "instagram" });
  const c3 = db.conversationForContact(jess, "instagram");
  db.addMessage({ conversationId: c3.id, channel: "instagram", direction: "in", author: "patient", body: "how much is a 90 min massage? do u take blue cross", status: "received" });
  db.addMessage({ conversationId: c3.id, channel: "instagram", direction: "out", author: "ai", body: "Hi Jess! A 90-minute registered massage therapy session is $175, and yes, we direct-bill Blue Cross. Sofia has availability Tuesday and Thursday evenings. Want me to check times for you?", status: "simulated" });

  // An email in the general inbox with an AI draft waiting for approval.
  const rob = db.createContact(clinicId, { name: "Robert Lin", email: "robert.lin@example.com", stage: "active_patient", preferred_channel: "email", tags: '["newsletter"]' });
  const c4 = db.conversationForContact(rob, "email");
  db.addMessage({ conversationId: c4.id, channel: "email", direction: "in", author: "patient", subject: "Receipt for my insurance", body: "Hello, could you please send me receipts for my last three chiropractic visits? My insurer needs them for reimbursement. Thanks, Robert", status: "received" });
  db.addMessage({ conversationId: c4.id, channel: "email", direction: "out", author: "ai", subject: "Re: Receipt for my insurance", body: "Hi Robert,\n\nThanks for reaching out. I've passed your request for receipts for your last three chiropractic visits to our billing team, and they'll email them to you within one business day.\n\nBest regards,\nHarbourfront Physio & Wellness", status: "draft" });
  db.updateConversation(c4.id, { needs_attention: 1, attention_reason: "AI draft waiting for approval" });
  db.createTask({ clinicId, contactId: rob.id, conversationId: c4.id, type: "billing", title: "Send Robert Lin receipts for last 3 chiro visits", createdBy: "ai:email" });
  db.createAppointment({ clinic_id: clinicId, contact_id: rob.id, service_id: "chiro-adjustment", practitioner_id: "pr-daniel", starts_at: at(-6, "11:00"), ends_at: at(-6, "11:20"), created_via: "staff" });

  // Demo EHR pairing (used only when EDITION=ehr with the mock EHR).
  db.setEhrIntegration(clinicId, "loc-harbourfront", "demo-key", "demo-ehr-webhook-secret");

  if (deps) {
    const { consents, accounts } = deps;
    const inbound = (contactId: number, channel: "sms" | "whatsapp" | "instagram" | "email") =>
      consents.record({ clinicId, contactId, channel, purpose: "service", status: "granted", basis: "inbound", source: `patient messaged on ${channel}`, by: "system" });
    inbound(priya.id, "whatsapp");
    consents.record({ clinicId, contactId: tom.id, channel: "sms", purpose: "service", status: "granted", basis: "staff", source: "caller asked to be contacted at this number", by: "system" });
    inbound(jess.id, "instagram");
    inbound(rob.id, "email");
    consents.record({ clinicId, contactId: rob.id, channel: "email", purpose: "marketing", status: "granted", basis: "express", source: "intake form checkbox", textVersion: "intake-2026-01", by: "system" });
    for (const a of DEMO_ACCOUNTS) {
      if (accounts.count() >= DEMO_ACCOUNTS.length) break;
      accounts.createUser({ ...a, clinicIds: [clinicId], createdBy: "demo-seed", password: DEMO_PASSWORD });
    }
  }
  return clinicId;
}
