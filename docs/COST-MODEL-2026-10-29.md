# Per-clinic monthly cost model: messaging + AI receptionist

Prepared 2026-10-29. All prices are in USD and exclude tax. The editable workbook is `docs/cost-model-2026-10-29.xlsx`. Its `Assumptions` sheet holds every input, there is one sheet per scenario with formulas, and a `Comparison` sheet. The tables below are the workbook's outputs at its default inputs.

## 0. How the prices were checked (read this first)

| Status | Meaning | Applies to |
|---|---|---|
| **Verified** | I fetched the vendor's official pricing page on 2026-10-29 | Anthropic (Claude) prices, prompt-caching rules, effort docs |
| **Search-index only** | The official page was found and its figures read through the search index. A direct fetch was blocked because `www.twilio.com` and `telnyx.com` are outside this session's network allow-list. Treat these as likely current, but re-verify before quoting a customer. | Twilio SMS/voice/WhatsApp/10DLC/SIP/ConversationRelay, Telnyx US SMS/SIP/numbers, ElevenLabs Agents, Postmark, SendGrid, Paubox |
| **Not verified** | Third-party sources only, or a value I derived | Meta WhatsApp North-America per-message rates, Telnyx **Canada** SMS/SIP rates, ElevenLabs LLM pass-through $/min, Paubox paid tier, Messenger/IG being free, whether the US marketing-template pause is still in force |

To finish verification, allow `www.twilio.com`, `telnyx.com` and `developers.facebook.com` in the environment's network settings, then re-check the rows marked "NOT VERIFIED" or "search index" in the `Assumptions` sheet. Each row there carries its source URL and status.

## 1. Changes since the brief that affect cost

1. **Meta WhatsApp pricing changed on 2026-10-01.** Service (free-form) replies inside the 24-hour window are no longer free: each business number gets **1,000 free service messages a month**, and after that each one is charged at the market rate. Utility templates sent inside an open window are **charged again** (they had been free since July 2025). The brief's "free service-window replies" and "free utility templates inside an open window" no longer hold. Sources: [Twilio notice](https://help.twilio.com/articles/53100480177819), [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), [Meta non-template update](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages).
2. **Sonnet 5.5 cache reads cost $0.10/MTok, not $0.20.** Cache reads on Opus 5.5 and Sonnet 5.5 are 0.05x the input price ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). Haiku 5.5 cache reads are $0.01/MTok. 1-hour cache writes are 2x the input price.
3. **Meta has paused WhatsApp marketing templates to +1 US numbers since 2025-04-01.** Third-party reports say the pause was still in force in July 2026. I could not confirm its status for October. The model therefore sends US marketing over SMS (switch: `Assumptions` row "WhatsApp marketing deliverable to +1 US numbers?").
4. **HIPAA (US patients).** None of the following can carry PHI:
   - **SendGrid**: not HIPAA-eligible, and Twilio will not sign a BAA for it ([Twilio](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/hipaa-compliant)).
   - **Postmark**: will not sign BAAs ([Postmark](https://postmarkapp.com/support/article/1041-is-postmark-hipaa-compliant)).
   - **WhatsApp**: Meta does not offer a BAA. This comes from the Twilio HIPAA skill and applies to all routes, not only Twilio.

   Some services need an extra plan before they can sign a BAA:
   - Twilio needs a paid **Twilio Editions** package with HIPAA projects, and covers US area codes only (from the `twilio-security-compliance-hipaa` skill).
   - ElevenLabs needs an **Enterprise** BAA plus Zero Retention Mode ([ElevenLabs](https://elevenlabs.io/agents/hipaa-compliant-answering-service)).

   Paubox includes a BAA on every plan ([Paubox](https://www.paubox.com/products/paubox-email-api)). Telnyx says it signs BAAs for voice, but its written position on SMS is unclear. The model excludes these HIPAA programme fees because none are public.

## 2. Assumptions

**Volumes.** These come from the brief. Scenario C is 50 clinics, each like B.

| Monthly volume per clinic | A (solo) | B (5 practitioners) |
|---|---|---|
| SMS in / out | 300 / 600 | 1,500 / 3,000 |
| WhatsApp conversations (60% patient-initiated service, 40% utility reminders) | 200 | 800 |
| Marketing templates | 80 | 400 |
| Messenger/IG threads | 100 | 300 |
| Calls × 3 min | 150 | 600 |
| Emails | 300 | 1,500 |

**Derived volumes and modelling assumptions.** These are all inputs in the workbook.

- **SMS segments.** Each outbound SMS averages **1.6 segments**. `prompt.ts` tells the AI to keep SMS replies under 320 characters, and 320 GSM-7 characters is 3 segments. Inbound SMS is 1.0 segment.
- **AI text conversations** = SMS in ÷ 3 + WhatsApp service conversations + social threads + 10% of emails.
  - A: 100 + 120 + 100 + 30 = **350**.
  - B: 500 + 480 + 300 + 150 = **1,430**.
- **AI API calls** = conversations × 3 messages × 2 calls, plus utility-reminder replies (50% of reminders get a patient reply, and the AI answers each with 2 calls).
  - A: 350×6 + 80×0.5×2 = **2,180**.
  - B: **8,900**.
- **WhatsApp service replies** = 3 per service conversation, plus 1 for each reminder reply.
  - A: 360 + 40 = 400. This is under the 1,000 free messages, so it costs $0.
  - B: 1,440 + 160 = 1,600, of which **600 are billable**.
- **Calls.** ElevenLabs bills the actual 3 minutes. The carrier bills **3.5 minutes** per call because Twilio rounds each leg up to a whole minute.
- **Bookings** = (AI text conversations + calls) ÷ 3.
  - A: (350+150)/3 = **166.7**.
  - B: **676.7**.
- **One-time fees.** 10DLC one-time fees are spread over 12 months. Each clinic is its own brand and campaign, because ISVs may not share campaigns (from the `twilio-isv-sms-best-practices` skill).
- **Canada.** Canadian long codes have no 10DLC registration fee (an assumption).

### AI footprint per API call (from the code and the brief)

- **Cacheable prefix: 2,896 tokens.** This is the system prompt (1,450), the tools (1,160) and the tool-use system prompt Anthropic adds for Opus, Sonnet and Haiku 5.5 (286). It is above the **512-token minimum cacheable length** for all three 5.5 models ([caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)), so **caching works today**.
  - `receptionist.ts` already marks the static system block with `cache_control` using the default 5-minute TTL.
  - Tools come before system in the cache order, so the tools are inside the cached prefix.
- **Uncached input: 505 tokens.** This is turn context (80), average history (300) and tool-loop carry (125).
- **Output: 140 tokens per call.** This is a reply of about 120 tokens or a tool call of about 60, plus about 50 tokens of low-effort adaptive thinking, averaged over the calls.
- **Cache-write fraction.** This is the share of calls whose prefix has expired since the last call. It is based on Poisson arrivals over a 10-hour day, per clinic, because the prefix contains clinic-specific knowledge.
  - 5-minute TTL: A ≈ 3.5 messages per clinic-hour, so 75% of messages start cold. With 2 calls per message, **37.5%** of calls pay a write. B: **15%**.
  - 1-hour TTL: A **5%**, B **3%**. Most of these are the first message of the day.

**Example: Opus 5.5 cost per call in scenario A**

| Setting | Prefix | Uncached input | Output | Per call |
|---|---|---|---|---|
| No cache | 2,896 × $4/M = $0.01158 | 505 × $4/M = $0.00202 | 140 × $20/M = $0.00280 | **$0.0164** |
| 5-min TTL (as in the code) | 2,896 × (0.375 × $5 + 0.625 × $0.20)/M = $0.00579 | $0.00202 | $0.00280 | **$0.0106** |
| 1-hour TTL | 2,896 × (0.05 × $8 + 0.95 × $0.20)/M = $0.00171 | $0.00202 | $0.00280 | **$0.0065** |

Each conversation has 6 calls. That puts an Opus conversation at $0.098 with no cache, $0.064 with the 5-minute TTL and **$0.039 with the 1-hour TTL**. The same conversation costs about $0.020 on Sonnet 5.5 and $0.001 on Haiku 5.5. For low-traffic clinics, the 1-hour TTL beats the 5-minute TTL even though each write costs 2x.

## 3. Unit prices

| Item | Canada | US | Source | Status |
|---|---|---|---|---|
| Claude Opus 5.5 in / out / cache read / 5m write / 1h write ($/MTok) | 4 / 20 / 0.20 / 5 / 8 | same | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) | Verified |
| Claude Sonnet 5.5 | 2 / 10 / **0.10** / 2.50 / 4 | same | same | Verified |
| Claude Haiku 5.5 (prompts ≤100K) | 0.10 / 0.50 / 0.01 / 0.125 / 0.20 | same | same | Verified |
| `inference_geo: "us"` multiplier | 1.1x (off by default) | | same | Verified |
| Twilio SMS out / in, long code | $0.0083 / $0.0083 per segment | $0.0083 / $0.0083 | [CA](https://www.twilio.com/en-us/sms/pricing/ca), [US](https://www.twilio.com/en-us/sms/pricing/us) | Search index |
| Carrier fee, outbound (blended) | $0.0080 (Bell .0087, Rogers .0084, Telus .0073, Freedom/Vidéotron .0067, other .0064) | $0.0044 (AT&T .0035, T-Mobile .0045, Verizon .005, weighted 30/30/40) | same | Search index; blend derived |
| Carrier fee, inbound | none listed | $0.0018 (AT&T .0035, T-Mobile .0025, Verizon 0) | same | Search index; blend derived |
| Telnyx SMS out / in | $0.004 (assumed = US) | $0.004 / $0.004 per part + carrier fee | [Telnyx messaging](https://telnyx.com/pricing/messaging) | US search index; **CA not verified** |
| Local number / month | Twilio $1.15, Telnyx $1.10 | same | Twilio voice pages; Telnyx | Search index (Telnyx CA not verified) |
| US 10DLC | n/a | Brand $4.50 one-time (Standard incl. secondary vetting $46); campaign vetting $15; Low-Volume Mixed $1.50/mo (Standard $10, Sole Prop $2); Telnyx monthly "$2–$30" | [Twilio 10DLC fees](https://support.twilio.com/hc/en-us/articles/1260803965530-Pricing-and-Fees-for-A2P-10DLC-Service), [Telnyx 10DLC](https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges) | Search index |
| Meta WhatsApp, North America: utility / authentication / service (over 1,000 free) / marketing | $0.0034 / $0.0034 / $0.0034 / $0.025 | same, but marketing paused to US | [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) | Structure from Meta; **rates not verified** (third-party tables) |
| Twilio WhatsApp fee | $0.005 per message **sent or received**, on top of Meta, even when Meta charges $0 | same | [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing) | Search index |
| Messenger / Instagram DM | $0 | $0 | [Messenger Platform](https://developers.facebook.com/docs/messenger-platform/) | No fee found; not verified |
| ElevenLabs Agents | $0.08/min on every plan. Creator $22 (275 min, 10 concurrent), Pro $99 (1,238, 20), Scale $299 (3,738, 30), Business $990 (12,375, 40). Burst over the concurrency limit is $0.16/min. LLM is billed **separately**. Telephony is not charged by ElevenLabs. Custom LLM must be an OpenAI-compatible endpoint. HIPAA requires Enterprise. | same | [ElevenLabs Agents pricing](https://elevenlabs.io/pricing/agents), [SIP trunking](https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking) | Search index |
| ElevenLabs LLM pass-through | $0.01/min (assumption) | same | dashboard estimate | **Not verified** |
| Twilio inbound local voice | $0.0085/min | $0.0085/min | [CA](https://www.twilio.com/en-us/voice/pricing/ca), [US](https://www.twilio.com/en-us/voice/pricing/us) | Search index |
| Twilio Elastic SIP origination | — | $0.0034/min | [Twilio SIP](https://www.twilio.com/en-us/sip-trunking/pricing/us) | Search index |
| Telnyx SIP inbound local | $0.0032 (assumed = US) | $0.0032/min | [Telnyx SIP](https://telnyx.com/pricing/elastic-sip) | US search index; **CA not verified** |
| Twilio ConversationRelay (alternative voice path) | $0.07/min, plus voice minutes, plus your own LLM | same | [Twilio Conversational AI pricing](https://www.twilio.com/en-us/products/conversational-ai/pricing) | Search index |
| Email | SendGrid Essentials $19.95; Postmark Basic $15 (10K); Postmark at 75K ≈ $93 (derived) | Paubox free ≤300/mo (BAA included), paid "from $99/mo" (not verified); Paubox at 75K: quote needed, **placeholder $500** | [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing), [Postmark](https://postmarkapp.com/pricing), [Paubox](https://www.paubox.com/pricing/paubox-email-suite) | Search index / not verified |

## 4. Configurations

| Config | SMS | WhatsApp | Voice | Email | Text model | Cache |
|---|---|---|---|---|---|---|
| (i) All-Twilio | Twilio | via Twilio | ElevenLabs, Twilio native integration | SendGrid | Opus 5.5 | 5-min TTL (as in the code) |
| (ii) Cost-optimised | Telnyx | Meta Cloud API direct | ElevenLabs via Telnyx SIP trunk | Postmark (CA) / Paubox (US, BAA) | Opus 5.5 | 1-hour TTL |
| (iii-a) | same as (ii) | | | | Sonnet 5.5 | 1-hour TTL |
| (iii-b) | same as (ii) | | | | Haiku 5.5 | 1-hour TTL |
| (ref) | same as (i) | | | | Opus 5.5 | no caching |

## 5. Results (USD per month)

| Scenario | (i) All-Twilio + Opus | (ii) Optimised + Opus | (iii-a) + Sonnet | (iii-b) + Haiku | (ref) no cache |
|---|---|---|---|---|---|
| A – Canada | **114.41** | **87.50** | 80.39 | 73.66 | 127.03 |
| A – US | **113.84** | **72.29** | 65.17 | 58.44 | 126.47 |
| B – Canada | **390.98** | **315.63** | 288.59 | 263.03 | 470.36 |
| B – US | **375.65** | **384.05**¹ | 357.01 | 331.45 | 455.04 |
| C – Canada (50 clinics) | **18,641** | **15,125** | 13,773 | 12,494 | 22,611 |
| C – US (50 clinics) | **17,875** | **14,753** | 13,401 | 12,122 | 21,844 |
| C per clinic, CA / US | 373 / 358 | 302 / 295 | 275 / 268 | 250 / 242 | 452 / 437 |

¹ In B-US, (ii) costs more than (i) only because it swaps SendGrid ($19.95, cannot carry PHI) for Paubox ($99, BAA included). For like-for-like compliance, (i) would also need a BAA-capable email service. Without the email line, (ii) is $79 cheaper.

**Cost per booked appointment.** One in three conversations books.

| Scenario | (i) | (ii) | (iii-a) | (iii-b) |
|---|---|---|---|---|
| A – Canada / US | $0.69 / $0.68 | $0.53 / $0.43 | $0.48 / $0.39 | $0.44 / $0.35 |
| B – Canada / US | $0.58 / $0.56 | $0.47 / $0.57 | $0.43 / $0.53 | $0.39 / $0.49 |
| C – Canada / US | $0.55 / $0.53 | $0.45 / $0.44 | $0.41 / $0.40 | $0.37 / $0.36 |

### Arithmetic: B – Canada, config (i)

| Line | Calculation | Cost |
|---|---|---|
| SMS | 4,800 out segments (3,000 × 1.6) × ($0.0083 + $0.0080) = $78.24; plus 1,500 in × $0.0083 = $12.45 | $90.69 |
| Phone number | | $1.15 |
| WhatsApp Meta fees | 320 utility × $0.0034 = $1.09; 400 marketing × $0.025 = $10.00; 600 billable service × $0.0034 = $2.04 | $13.13 |
| WhatsApp Twilio fee | (320 + 400 + 1,600 out + 1,600 in) × $0.005 | $19.60 |
| ElevenLabs minutes | max($99 Pro, 1,800 min × $0.08) | $144.00 |
| ElevenLabs LLM | 1,800 × $0.01 | $18.00 |
| Telephony | 600 calls × 3.5 min × $0.0085 | $17.85 |
| Claude | 8,900 calls × $0.00748 | $66.61 |
| SendGrid | | $19.95 |
| **Total** | | **$390.98** |

Config (ii) changes four lines:
- SMS: 4,800 × ($0.004 + $0.0080) + 1,500 × $0.004 = $63.60.
- The Twilio WhatsApp fee drops to $0.
- Telephony: 2,100 × $0.0032 = $6.72.
- Claude with the 1-hour TTL: 8,900 × $0.00608 = $54.08.

Postmark costs $15. The total is **$315.63**.

### Which line items dominate (config ii)

| Line | A-CA | A-US | B-CA | B-US | C-CA | C-US |
|---|---|---|---|---|---|---|
| ElevenLabs minutes + LLM + telephony | 42.18 (48%) | 42.18 (58%) | 168.72 (53%) | 168.72 (44%) | 8,436 (56%) | 8,436 (57%) |
| Claude text receptionist (Opus) | 14.23 (16%) | 14.23 (20%) | 54.08 (17%) | 54.08 (14%) | 2,704 (18%) | 2,704 (18%) |
| SMS + 10DLC | 12.72 | 14.50 | 63.60 | 58.02 | 3,180 | 2,901 |
| WhatsApp (Meta) | 2.27 | 0.27 | 13.13 | 3.13 | 656 | 156 |
| Email | 15.00 | 0 | 15.00 | 99.00 | 93 | 500 |
| Numbers | 1.10 | 1.10 | 1.10 | 1.10 | 55 | 55 |

- **Voice minutes are the largest cost in every scenario**, at 44–72% of the total. Almost all of that is ElevenLabs' $0.08/min. Carrier minutes are only $0.0032–0.0085/min.
- **SMS is the second-largest line item** in B and C. Canadian carrier fees ($0.008 per segment) are almost as large as the base rate.
- **The text AI is cheap.** With the 1-hour cache, Opus costs about $0.04 per conversation. Switching to Haiku saves about $53/month in B, or about $2,630/month across 50 clinics.

**Voice LLM sensitivity.** I estimated the per-minute cost of running Claude as the voice agent's LLM through a custom endpoint. The estimate assumes about 15 LLM turns in a 3-minute call, with the prefix and history re-sent each turn.

| Voice LLM | $/min | Extra per month vs. the $0.01 default (A / B) |
|---|---|---|
| Opus 5.5 with 1-hour caching | ≈ $0.03 | +$9 / +$36 |
| Opus 5.5 uncached | ≈ $0.09 | +$36 / +$144 |
| Haiku 5.5 | ≈ $0.002 | none |

## 6. The model choice for text: what you lose by moving off Opus

Opus 5.5 costs $14 (A) or $54 (B) per clinic per month. That is about 16–20% of the optimised bill in A and about 14–17% in B. These figures are estimates; check them against `usage` logs from a pilot.

- **Sonnet 5.5** halves that line (saving $7–27 per clinic). The risk is in what this product depends on:
  - multi-step tool use (find_available_times, then book, including reschedule flows that call get_my_appointments first);
  - following the safety rules (no diagnosis, emergency handoff to 911/988);
  - resisting prompt injection in patient messages;
  - getting a warm tone right in a short message.

  Sonnet-class models are generally capable at this. Before switching, run the receptionist evals (booking accuracy, handoff precision and recall, refusal of clinical advice) and compare.
- **Haiku 5.5** cuts AI cost about 40-fold, to under $2 per clinic. It is the most likely to:
  - offer a time without calling the availability tool;
  - miss an emergency cue or a request to speak to a person;
  - drift on policy wording;
  - handle multi-intent messages ("cancel Tue, book Thu, and is parking free?") badly.

  A wrong booking or a missed urgent handoff costs far more than the $50 a month saved. **I do not recommend Haiku as the sole receptionist model.** Use it as a router or FAQ answerer in front of Opus or Sonnet (see the levers below).
- **Recommendation:** keep Opus 5.5 at effort `low` with the 1-hour cache as the default. Move to Sonnet 5.5 only if it matches Opus on the eval set. Booked appointments per clinic are worth far more than the AI line item.

## 7. Levers that cut cost (largest first)

1. **Move calls to text.**
   - Voice costs about $0.094/min, or $0.28 per call, under (ii). A text conversation costs about $0.04 in AI plus about $0.06 in SMS.
   - Have the voice agent offer "I can text you a booking link or available times." The same works for after-hours IVR deflection.
   - Every 10% of calls moved to text saves about $2.70 per month in A and $11 in B, net of the text cost.
   - Keep calls short. Use the ElevenLabs end-call tool after the booking is confirmed, and limit the maximum call duration.
2. **Negotiate ElevenLabs pricing at SaaS scale.** Scenario C has 90,000 minutes per month on the Business plan at $0.08/min, which is $7,200. That is enough volume to ask for Enterprise pricing, which you need for the HIPAA BAA anyway.
   - Watch the 40-concurrent-call limit. Calls over it burst at $0.16/min.
   - The alternative is **Twilio ConversationRelay**: $0.07/min plus voice ($0.0085) plus your own Claude. That is about $0.09–0.11/min, roughly the same as ElevenLabs. It does reuse the existing Claude receptionist code and tools, so only one agent has to be maintained.
3. **Change the cache TTL to 1 hour** (`cache_control: { type: "ephemeral", ttl: "1h" }`). This cuts Opus cost per call by 39% in A and 19% in B compared with the code's current 5-minute TTL. Removing caching altogether would cost 2.5x as much.
   - Also add a top-level automatic `cache_control` (or a breakpoint on the last message) so that tool-loop rounds 2–3 read the history from cache instead of resending it.
   - Do not vary `effort` or `tool_choice` within a conversation; either change invalidates cached message blocks.
4. **Keep effort at `low`** (already the default). Higher effort mainly adds thinking output tokens at $20/MTok on Opus.
5. **Shorten history.** `HISTORY_LIMIT = 40` messages is generous for front-desk threads. Capping it at about 12, or summarising older turns, keeps uncached input near 500 tokens on long threads.
6. **Answer simple FAQs without a model call.** Hours, address, parking and prices can come from a keyword match or a Haiku classifier, with no tool loop. If 30% of messages are FAQs, Opus calls drop by about 30%.
7. **Shorten SMS replies.** At 1.6 segments, a 1-segment target (≤160 GSM-7 characters, no emoji or curly quotes, which force UCS-2) would save about 37% of outbound SMS. That is about $4/month in A-CA and $22 in B-CA. Add a GSM-7 sanitiser before sending.
8. **Prefer WhatsApp and social for chatty threads.** Inbound WhatsApp is free with Meta direct, the first 1,000 service replies per number are free, and Messenger/IG cost nothing. An SMS round trip in Canada costs about $0.021 per segment pair.
9. **Go to Meta direct instead of Twilio for WhatsApp.** This removes $0.005 on every inbound and outbound message: about $20 in B and $880–980 in C.
   - Note that **utility templates inside an open window are no longer free** as of 2026-10-01. The saving now comes from sending free-form service replies (free up to 1,000 per number) rather than templates while the window is open.
10. **Register the right 10DLC tier.** Low-Volume Mixed costs $1.50/month, against $10 for Standard. Low-Volume brands are capped at about 6,000 segments a day, which is plenty for one clinic. Use the Mixed use case rather than separate campaigns.

## 8. Recommended vendor mix

| Patients | SMS + voice carrier | WhatsApp | Voice agent | Email | Text model |
|---|---|---|---|---|---|
| Canada | Telnyx (verify Canadian rates first) | Meta Cloud API direct | ElevenLabs over a Telnyx SIP trunk | Postmark (after a PHIPA/PIPEDA agent-agreement review), or Paubox if you want one vendor | Opus 5.5, effort low, 1-hour cache |
| US | Telnyx, provided a BAA covering SMS is signed. Otherwise Twilio with HIPAA Editions (US area codes only). | Meta direct, for non-PHI messages only (no BAA) | ElevenLabs **Enterprise** (BAA, zero retention) over SIP | Paubox (BAA included) | Opus 5.5, with Anthropic BAA/ZDR |

**Why this mix:**
- It saves about 17–36% against all-Twilio (B-US is the exception, because of the Paubox BAA swap). Most of the saving comes from Telnyx SMS, which is about half Twilio's base rate, and from avoiding Twilio's WhatsApp fee.
- The SIP trunk replaces Twilio's $0.0085/min with $0.0032/min. The native integration is easier to set up, though, and is worth only about $11 a month at scenario B.
- The text AI is a small enough share of the bill that the best model is worth keeping.
- The real lever is voice minutes. Push conversations to text, and negotiate ElevenLabs Enterprise pricing at SaaS scale.
