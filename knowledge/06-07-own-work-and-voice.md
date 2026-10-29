# 06–07 — Practitioner's Own Clinical Reasoning and Patient-Communication Voice

Source slice: Drive folders `06-Own-Clinical-and-Academic-Work`, `07-FormFunction-Blog-Drafts`, `09-Brain-Design` (all but the decision-model spec, which was distilled separately).

**PHI handling:** The Y4 Clinical Case Report (CCR) contains real patient information. This file keeps only the practitioner's method: how he sequences assessment, picks techniques, reassesses and plans dosage. It leaves out every name, age, occupation, date, location and identifying case detail. Any age or occupation that appears in Part B comes from the *fictional composite* vignettes in the blog drafts, never from the CCR.

---

## Coverage

| Folder | File | Status | Notes |
|---|---|---|---|
| 06 | Faheem Kayum - Dissertation Y3 .docx | **skimmed** | Read all reasoning sections in full: objective, common mistakes, mechanical/technique/assessment principles, ARTS, methodology, communication/red flags, theory, mechanical lines, lesion collective mechanics. Anatomy, nerve, vessel and lymph lists only skimmed. |
| 06 | Faheem Kayum - Dissertation Y3 (1).pdf | not read | Same title and date as the docx, so very likely a PDF export of it. |
| 06 | Faheem Kayum - Y3 Lesionology Assignment (1).pdf | **full** | His essay on the cervical spine. |
| 06 | Y3 Lesionology Assignment (1).pdf | **full** | The CAO assignment brief (prompt, not his work). |
| 06 | Y4 APP Faheem Kayum.pdf | **full** | Asthma paper, original submission. |
| 06 | Remediation - Y4 APP Faheem Kayum.pdf | **full** | The resubmitted (remediated) asthma paper. There is **no written assessor feedback** in the folder. What the feedback asked for is inferred by comparing the two versions (see A7). |
| 06 | Y4 CCR Faheem Kayum.pdf (16.7 MB) | **skimmed** | Text extraction worked, but long paragraphs were truncated and the photos are missing. The document calls itself a "rough draft, template complete", and the sections for Patients 2 and 3 are largely copies of the Patient 1 template. PHI is excluded. |
| 06 | Y4 CCR Faheem Kayum (1).pdf (53 MB) | **failed** | read_file_content returned empty text (probably image-based). download_file_content refused the file (over the 10 MB limit). This is likely the final CCR, so the final reflections and lessons are not covered. |
| 07 | STYLE-GUIDE.md | **full** | V1 formula. |
| 07 | STYLE-GUIDE-V2.md | **full** | Grade-6, problem-to-solution version. |
| 07 | articles-v2/README.md | **full** | |
| 07 | articles-v2/01, 02, 03 (article .md) | **full** | |
| 07 | articles-v2/04, 05, 06, 07 (article .md) | **skimmed** | Grepped for headings, analogies and hedges. |
| 07 | articles-v2/08 postural-assessment (article .md) | **full** (about 85%) | |
| 07 | articles-v2/*-meta.md, *-references.md (16 files) | not read | SEO metadata and bibliographies only. |
| 07 | articles-v1/README.md | **full** | |
| 07 | articles-v1/04 structural, 05 visceral | **skimmed** | Analogies and headings. |
| 07 | articles-v1/01, 02, 03, 06, 07, 08 | not read | Superseded by V2. |
| 07 | word-docs/01 - Osteopathic Treatment.docx | **full** | Confirmed to be the V2 article, meta and references combined into one file. |
| 07 | word-docs/02–08 (.docx) | not read | Presumed to be the same V2-plus-meta-plus-references bundles. |
| 09 | (no other files) | n/a | The only file in the folder is JARVIS-DECISION-MODEL-SPEC-v0.1.md, which is excluded. |

**Totals:** 49 files listed. 13 read in full, 8 skimmed, 1 failed, 27 not read (duplicates, metadata or superseded drafts).

---

## Part A: The practitioner's own clinical reasoning style

### A1. Core frame: the Rule of 9 and "big things matter"

- Every assessment and treatment is organised around Johnston's **Rule of 9**, three triplets used together *(Lesionology essay; Dissertation; CCR)*:
  - **Global → Local → Focal**: start with the whole body or system, then narrow to the region, then to the specific structure.
  - **Primary → Secondary → Tertiary**: decide which dysfunction drives the others, and whether treating the primary will change the rest.
  - **Superficial → Intermediate → Deep**: identify which tissue layer the dysfunction sits in. That layer decides the tool: myofascial work for superficial, neuromuscular for intermediate, ligamentous/articular for deep.
- His guiding phrase is **"big things matter."** On early visits he puts less weight on focal findings. He treats the big global soft-tissue lines first because they "can have a big effect on the smaller structures" *(CCR, technique principles, treatments 1 and 3)*.
- He stresses that a global pattern is often *caused by* a local or focal problem, so the operator has to work out which is the cause and which is the result *(Dissertation, "Methodology and Application in Treatment", repeated in each lesion section)*.

### A2. Assessment sequence (his standard first-visit and follow-up flow)

Reconstructed from the CCR treatment notes and the Dissertation "Assessment Principles":

1. **Observation starts at the door.** He notes how the patient walks in, how they hold themselves, and their "vitality" during the opening conversation. "Treatment begins and ends with observation" *(Lesionology essay; Dissertation; CCR)*.
2. **Intake and safety.** He takes the history and looks for contraindications and red flags before any hands-on work. "Once that is complete and the patient is deemed safe to treat…" *(Lesionology essay)*.
3. **Static standing view from 4 sides.** He checks the upper and lower T-lines (declination to either side), the centre of gravity, and external-frame findings such as an internally rotated limb or a protracted or retracted scapula. He repeats this at the start of every treatment, especially the first three *(CCR, OSA sections)*.
4. **Seated global lines.** He tests the anterior, posterior, lateral and oblique lines. On the initial visit he tests **patient-active first** (for safety and to see how they move), then **patient-passive** (for accuracy). Later visits vary: active "for efficiency", passive "for a more accurate finding" *(CCR)*.
5. **Supine baseline, using "base up, centre out."** He checks the pelvis on the transverse plane and vertical axis (pelvic roll), and the innominates anterior or posterior *(CCR; Dissertation lumbar section, "Theory")*.
6. **Local curves.** He motion-tests the lumbar and thoracic curves for flexion/extension, sidebending and rotation coupling, applying Fryette's laws. A 3-point test (upper, middle, lower curve) checks sagittal motion. For the thoracic spine he uses a "reverse bridge" rib-bumping test *(CCR; Dissertation)*.
7. **Focal structures.** He works base up: innominates → sacrum → L5/S1 → upper lumbars → DL junction → CD junction → OA/AA *(CCR treatments 4–5; Dissertation)*.
8. **Visceral screen (from about visit 4).** He runs a 4-quadrant abdominal test. If a quadrant is tender, he treats the matching spinal reflex segment (somato-visceral, e.g. T10–L2 for lower-abdominal viscera), retests, then treats the organ directly (visceral-somatic, e.g. a bladder lift) and retests again *(CCR treatment 4)*.

**ARTS findings he records at each level** *(Dissertation, ARTS subsections)*:
- **A**symmetry: compare left against right.
- **R**estriction of motion: the direction the joint "prefers" versus the barrier.
- **T**issue texture: boggy, soft, warm, cold, fibrotic, ropey. Acute tissue reads warm and restricted. Chronic tissue reads cold, boggy and soft *(APP)*.
- **S**ensorial changes the patient reports.

### A3. Treatment sequencing rules he follows

- **Clear the global lines before chasing the local and focal findings.** "Until their global lines are relatively clear upon assessment, the technique principle applied starts with global direct to the superficial layer," done with a long lever, patient passive *(CCR treatment 2)*.
- **Foundation analogy:** "Much like the foundation of a house… the lower baseline is fundamental as everything else that sits atop is subjugated on its stability." So he works up the chain through the curves to the external frame *(CCR treatment 2)*.
- **Treat the most restricted global line first, then reassess the rest.** In one treatment, releasing the right lateral line improved all the other global lines, "meaning that was holding the other lines" *(CCR treatment 5)*.
- **When the baseline does not change, move up a level.** If the pelvic roll produced no baseline change, he treated the lumbar curve, reasoning that "the lumbars were holding the pelvic rotation" *(CCR treatment 1)*. The reverse also applies: treating a left anterior innominate "indirectly treats the lumbars", then he reassesses the lumbars *(Dissertation lumbar section)*.
- **Spiral in, then spiral out.** He treats a focal structure, then goes back out to the local and global levels "to see if I could get more change" *(CCR treatment 4)*. Spiralling in is how he finds the root cause that is "holding the overall global lesion pattern" *(Dissertation, CD junction)*.
- **Test what holds what.** "I always made sure I assessed multiple structures to make sure I knew what was holding what in my patient's lesion pattern" *(CCR treatment 5)*.
- **Pick the biggest restricted structure in the focal layer.** "Found her innominate being the biggest structure and most restricted… This ended up improving her lumbar curve the most." If a segment was still held after that (e.g. L5/S1), he treated it directly *(CCR treatment 5)*.
- **The CD junction is a transition zone.** Clear or address the structures below it before treating it, and remember "the root of the neck begins" around T6 *(Dissertation, CD junction; Lesionology essay)*.

### A4. Technique choices and principles

- **Default ordering: indirect, then direct.** "Initially, we will utilise an indirect approach followed by direct. This allows us to calm the tissues, reset the neurology… Once we have done that, we can take the body in the direction of most resistance." After that comes post-isometric relaxation (muscle energy), then ligamentous articulation for a deeper holding structure *(Dissertation lumbar section)*.
- **Treat each layer with the matching tool:**
  - Superficial global lines: direct myofascial release using "heat and creep", long lever.
  - Intermediate: neuromuscular junction (NMJ) work "if needed, determined after reassessment".
  - Deep: balanced ligamentous technique or articulation. He takes the joint toward ease, waits for the ligament to soften, then takes it into the barrier *(CCR treatment 1; Dissertation CD and sacral sections)*.
  - For the asthma model he describes the layered dosing as "direct on the global/superficial layer, followed by indirect to direct on all other layers" *(APP and Remediation)*.
- **Lever choice:** long lever for global lines (patient's arm or legs used as the lever). Short lever "on structure" for local and focal work. Mixed lever where useful, e.g. a thoracic rotation correction followed by an arm long lever *(CCR; Dissertation)*.
- **Techniques he names and uses** *(CCR)*: seated direct to the global anterior line, walkaround (oblique line), prone arm rotation, pelvic roll, knees-to-chest lumbar treatment (fixed point at the DL junction), upper T-line long lever with scapular glide, side-lying lateral line lengthening, reverse bridge thoracic test, innominate posteriorisation, L5/S1 rotation through the innominate, T10–L2 reflex work, bladder lift (J stroke), CD-junction knife grip, sacral gapping.
- **Asthma and respiratory toolkit** *(Remediation APP)*: rib raising, MFR, BLT, lymphatic drainage or thoracic pump. Targets are the cervical, thoracic and upper lumbar spine, the three diaphragms (respiratory, oral, superior thoracic aperture), the OA region and the vagus nerve. He links treated segments to the organ reflexes: viscerosomatic T2–T7, elevated right 4th rib, and C3 (phrenic) for diaphragm innervation.
- **Operator mechanics he insists on:** A-frame or fencer stance; neutral spine; 3 points of contact (bent at the hips, hands on structure, lean-on pressure to secure the patient); hand-over-hand; body-to-body contact in seated work "to decrease the patient's fear of falling off the table"; minimal patient movement (side-lying) "which retains their relaxation and calm" *(Dissertation; CCR)*.
- **Rhythm is a technique principle.** "Rhythm of the technique during treatment allows the patient to feel at ease, calming the nervous system and allowing further range of motion." Mental rhythm means applying the thought process methodically through the body *(Dissertation, "Mechanics through Rhythm")*.
- **Patient-active versus patient-passive.** Patient-active is used for safety, to save the operator's mechanics, and for efficiency. Patient-passive is used for accuracy. In the dissertation's lateral-position method, superficial work is passive, intermediate work is active, and deep work is passive again *(CCR treatment 4; Dissertation scapulothoracic section)*.

### A5. Reassessment and progression

- **Test, treat, retest, every time.** His own lists of "common mistakes" include *failure to retest*, *blowing past the barrier*, *moving too fast during assessment*, *failure to be on structure*, *incorrect landmarking*, *weak lever-to-fulcrum connection*, *spiralling in the wrong direction*, *lack of rhythm*, *failure to rule out contraindications*, and *failure to get consent before assessing a sensitive area* *(Dissertation, all four lesion sections)*.
- **Effectiveness depends on lever and fulcrum.** The lever is the body part used to create the change. The fulcrum is the point where the force meets and goes no further *(Dissertation, methodology)*.
- **He sets milestones at visits 3 and 5.** By visit 3 he expects the global lines (short lateral and oblique) to be cleared, so the deeper sagittal curve can be worked. By visit 5 he expects the deep curve or rotation "where the deeper reason for the lesion lies" to be cleared, the T-lines levelled, and the subjective pain reduced *(CCR, "Expectation after the 3rd and 5th treatments")*.
- **Each visit builds on the last.** Visits 1–2 are global and superficial/intermediate. Visit 3 works up the chain into the thoracic and cervical spine (OA/AA). Visits 4–5 add focal work (innominate, sacrum, L5/S1) and a visceral screen *(CCR)*.
- **Dosage model (frequency, intensity, timing per patient).** For a chronic or irreversible condition such as asthma: 1–2× per week for the first month, then every two weeks for 1–2 months. Once the new pattern "begins to hold", he spaces visits out to monthly, quarterly, twice a year, then yearly, giving "the body and its nervous system time to adjust" *(Remediation APP. The original said 1×/week)*.
- **Outcome markers he names:** better cervical and thoracic mobility, better diaphragm doming and rib movement, and patient-reported symptoms. For asthma he adds attack frequency, reliance on medical intervention, and spirometry (PEF, FEV1/FVC) as cited from the literature *(APP; Remediation)*.

### A6. Philosophy and how he explains osteopathy academically

- Structure and function are related. The body is a "dynamic unit of function" with an "internal pharmacy" that can heal and regulate itself. "Find health, fix it and leave it alone." The practitioner is a "facilitator of health" *(CCR, "The difference in the osteopathic approach"; Lesionology essay; APP)*.
- He sets osteopathy apart from other professions. Physiotherapy (in his framing) is test-and-technique based, uses machines and assigns homework. Osteopathy spirals through the layers on principles, uses no machines, and gives lifestyle advice rather than homework *(CCR)*. **This conflicts with his later blog voice**, which promises "one or two simple home movements" and "exercise keeps the window open". Jarvis should follow the newer clinic voice (Part B).
- Theories he names: the Theory of Compensation (the body compensates to keep homeostasis, at a cost); Base Up, Centre Out; Fryette's laws; the Polygon model (3-D, all planes); Belt Theory; Paired Organ Theory; McCole's osteopathic lesion cascade (pressure → obstructed supply and drainage → oedema → fibrosis); the "fuse box" (trace the muscles holding a lesion back to their nerve roots) *(Dissertation; Lesionology essay)*.

### A7. What the remediation asked him to improve (inferred)

No assessor comments are in the folder. Comparing the original Y4 APP with the remediated version shows what was added. That is the likely substance of the feedback:

1. **Name the specific techniques.** The original ended with layer principles and dosage but **no named OMT techniques**. The remediation added rib raising, MFR, BLT, lymphatic drainage or thoracic pump, and named treatment regions.
2. **Give segment-level reasoning.** The remediation added viscerosomatic segments (T2–T7, right 4th rib, C3/phrenic), the OA and vagus link, and the "electrical wiring" (vagus, cervical plexus, cardiopulmonary plexus, pulmonary stretch and C-fibre receptors). It ties *where* he treats to *why*.
3. **Make dosage explicit.** The remediation changed it to 1–2×/week and framed it as maintaining vitality over a lifetime.
4. **Define outcomes and evidence.** The remediation added expected osteopathic outcomes and cited OMT trial data (spirometry and quality-of-life domains) instead of a single vague success line.
5. **Cite the osteopathic literature.** Six sources were added (Schend 2020 JAOA, Johnston 2016, Widdicombe 2006, Jones 2021, an AAO Journal article, Still 2015).

**Lesson for Jarvis:** the practitioner's weak spot under assessment was going from mechanics straight to a vague plan. Pre-session plans should always state, in this order: the **specific techniques** → the **segments or regions and the reason for each** → the **dosage** → the **measurable reassessment markers**.

Separately, the CAO brief itself warned students to keep language "simple and clear; flowery language or jargon will detract" *(Y3 Lesionology Assignment brief)*. His academic writing is dense with mechanics. His later clinic voice (Part B) shows that lesson was learned.

---

## Part B: Patient-communication voice

### B1. Tone rules

- **Grade-6 plain language.** Most sentences are under 15 words and none go over 25. Paragraphs are 1–3 sentences. Use "use" not "utilise", "help" not "facilitate", "check" not "assess" *(STYLE-GUIDE-V2)*. The V2 suite measured at grade 5.4–5.9 with average sentence length of 9–11 words *(articles-v2/README)*.
- **"You" is the main character, with "we" used for clinic authority.** Warm, direct, contractions are fine *(STYLE-GUIDE; V2)*.
- **Mix the rhythm.** Short declaratives for urgency, longer sentences to explain *(STYLE-GUIDE)*.
- **Define clinical words in the sentence that uses them.** Examples: "connective tissue is the stretchy wrap that holds your body together"; "your pelvis, the bowl of bone your spine sits on"; "your diaphragm, the muscle that helps you breathe"; "an aneurysm (a weak spot in a blood vessel)" *(V2 guide; v2/01; v2/02)*.
- **Prefer concrete detail to abstraction.** Name the coin-weight touch, the 404 commute, the laundry basket. Never write "holistic wellness solutions" *(STYLE-GUIDE)*.
- **Rule that outranks all the others: simplifying must never strengthen a claim.** "May help" stays "may help". Never write "will fix", "heals" or "corrects your body" *(STYLE-GUIDE-V2)*.
- **Use honesty to build trust.** Every piece includes "who this may *not* be for" and "when a doctor comes first" *(STYLE-GUIDE; V2)*.

### B2. Banned words and patterns

"unlock", "elevate", "delve", "embark", "journey", "game-changer", "look no further", "In today's fast-paced world", "Whether you're X or Y", "In conclusion", Moreover/Furthermore chains, rhetorical-question openers, exclamation marks, and "holistic" more than once *(STYLE-GUIDE; V2)*.

Clinical-claim bans: **"Dr."**, "diagnose", "treat disease", "cure", "osteopath" as his title (in Ontario that title is reserved for physicians), "put things back in place", "misalignment" *(STYLE-GUIDE regulatory section; v2/03)*.

### B3. Ontario regulatory script (repeat in every patient-facing piece)

- "Manual osteopathy is not a regulated health profession in Ontario." No government body oversees it and there is no standard licensing exam, so "it's smart to ask any practitioner about their training" *(v2/02)*.
- "An osteopathic manual practitioner is not a doctor and cannot use the title 'osteopath.' That title is saved for licensed physicians here" *(v2/01)*. "We're not doctors. We cannot diagnose conditions, and we cannot cure them" *(v2/03)*.
- "This is checking, not diagnosing… If what we find suggests you need medical care first, we say so and point you there" *(v2/01)*.
- Insurance: "OHIP does not cover manual osteopathy. Many extended health plans do… Check your plan's wording." Direct billing is available *(v2/01; STYLE-GUIDE)*.
- His credential, stated plainly: "Faheem Kayum, M.OMSc, osteopathic manual practitioner, four-year master's program, Canadian Academy of Osteopathy" *(v2/01; STYLE-GUIDE brand facts)*.

### B4. How he explains osteopathy and its mechanisms in plain words

- **Whole body:** "Your body works as one connected system. When one part stops moving well, other parts pick up the slack." Example: an old ankle sprain makes the hips compensate, and "your lower back absorbs whatever is left over." Always hedged afterwards: "This whole-body idea is a way of thinking about pain, not a proven fact. Science is still testing it" *(v2/01)*. In V1: "the chain is a list of suspects, not a verdict" *(v1/04)*. In V2: "the ankle is a suspect, not a verdict" *(v2/04)*.
- **Why look far from the pain:** "We test regions far from your pain, build a short list of suspects, and confirm or discard each one hands-on. If your feet turn out to be irrelevant, that finding is useful too" *(v1/04 FAQ)*.
- **What hands-on work actually does:** "Nothing gets moved back, because nothing was out. Your spine is not a cabinet with a stuck drawer." "What skilled touch seems to do is calm your nervous system. Pain signals quiet down, and guarding muscles ease" *(v2/03)*.
- **Joint "pop":** "The pop is gas shifting in joint fluid, not a bone snapping into place." Cracking happens "only if you choose that" *(v2/04)*.
- **Hands open a window, exercise keeps it open.** This is a recurring line: "Hands can open a window. Only exercise keeps it open" *(v2/03)*; "Our hands may help you start. The exercise is what you keep" *(v2/07)*; "What you do between visits keeps that window open" *(v2/04)*. Gains that fade between visits are "the normal shape of progress, not a failure" *(v2/06)*.
- **Craniosacral, honestly:** he names the old fluid-rhythm theory and drops it ("Science has not backed this up… we won't sell you that story"). The one he uses: slow light touch "seems to send your nervous system a safety signal", the "rest-and-digest side" *(v2/02)*.
- **Visceral:** "The theory built on it is not proven… This page treats it as unproven until that changes" *(v2/05)*.

### B5. Plain-language explanations of common conditions

- **Recurring low back pain:** the most common and best-studied reason people book. "Research suggests osteopathic treatment may lower pain and help people move better. May, not will." Some careful studies found only small differences *(v2/01)*. The rule here is "exercise leads, hands assist" *(v2/03)*.
- **Neck pain and desk tension:** "Necks dislike being parked in any position for hours. Even a perfect one." The issue is often that "the small muscles that hold your head up tire too fast. A pillow can't fix that" *(v2/07)*. Hands-on care plus exercise beats exercise alone in the short term *(v2/03)*.
- **Headaches:** for tension-type headaches, "we aim the work at the neck and jaw tension that often travels with headaches, not at the headaches themselves" *(v2/01)*. Migraine is treated as a separate condition: "we don't claim results there" *(v2/07)*. CST for migraine goes alongside the doctor's care, and "we will never suggest changing a prescription" *(v2/02)*.
- **Posture:** "There is no single perfect posture." People with and without pain have similar resting spine shapes. The difference is that people in pain "move less far, more slowly, and more carefully", and fear feeds that pattern. "Your best posture is your next posture." "The chair is rarely the villain. The unbroken hours in it might be." No braces *(v2/08)*.
- **Pregnancy and postpartum:** "may help low back and pelvic pain during pregnancy; after birth, the studies are weaker but encouraging." He checks the pelvis, ribcage and breathing, not just the sore side *(v2/01)*. Pain between the shoulder blades after night feeds: "Curling up to feed your child is not damaging your spine." What helps is building strength, and he gives "permission to stop feeling guilty" *(v2/08)*.
- **Frozen shoulder and stiff joints:** "Only a doctor can make this diagnosis." Mobilization "goes to the firm edge of her range and stops short of sharp pain. Progress is counted in degrees each week" *(v2/06)*. Rotator cuff disease and frozen shoulder show "little to no added benefit" from hands-on work alone *(v2/03)*.
- **Stress / "wired but tired":** "Your body feels braced all day, like it's waiting for bad news." CST gives "your nervous system an hour with no reason to defend itself" *(v2/02)*.
- **Concussion:** "Your doctor leads concussion care, full stop." CST is only a calming add-on after a medical check, and there are no high-quality studies *(v2/02)*.
- **Gut, IBS and scars:** only after a doctor has ruled out serious causes. Visceral work is "comfort support beside your medical care", never a treatment for diagnosed disease such as endometriosis or Crohn's *(v2/05)*.
- **Conditions the evidence does not support:** fibromyalgia, digestive disorders, most children's health concerns *(v2/01)*; infant colic and baby head-shape ("We would rather lose the booking than make a claim we can't stand behind") *(v2/02)*.

### B6. Sensory and pressure analogies for "what it feels like"

- CST touch is "about the weight of a few coins… closer to a hand resting than a massage stroke"; V1 called it "nickel-weight" *(v2/02; STYLE-GUIDE)*.
- Visceral pressure: "the weight of a paperback book, not a deep massage" *(v2/05)*.
- Mobilization "feels more like being rocked than stretched" *(v2/06)*.
- Edge-of-range ache: "a stretching ache that fades within seconds of pausing. Sharp pain is a signal to stop." Next-day soreness is "like after new exercise" *(v2/06)*.
- Firm work "can feel strong but should never feel sharp" *(v2/01; v2/03)*.
- Standard reassurances: "You stay dressed the whole time. Nothing should ever feel forced." "No cracking, no digging, no sudden moves" *(v2/01; v2/05)*.

### B7. Phrases to reuse

- "May, not will." / "'May help' means may help."
- "Science is still testing this. We will be straight with you about that."
- "Low risk is fair to say. Risk-free is not." *(v2/04)*
- "A suspect, not a verdict."
- "Hands can open a window. Only exercise keeps it open."
- "Test it, treat it, test it again." This is the patient-facing version of his clinical retest rule *(v2/03 FAQ)*. "We will measure it, work on it, and measure it again" *(v2/06)*.
- "If nothing changes after a handful of sessions, the plan should change too." / "If nothing has shifted… we will tell you and change the plan" *(v2/01; v2/05)*.
- **Short tracked trial:** "three or four sessions while you track one number that matters to you", for example headache days per week, nights of unbroken sleep, or jaw soreness on waking *(v2/02)*. For visceral work he suggests a check-in after 3–5 sessions *(v2/05)*.
- "There is no fixed number. Anyone who quotes one before checking you is guessing." *(v2/01)*
- "You'll get one or two simple home movements, not a twelve-exercise sheet." *(v2/01)*
- "If another kind of care fits your problem better, we'll say so. At our clinic, that care is usually down the hall." *(v2/01)*
- "Not sure osteopathy is the right fit? Call anyway." / "Bring your hardest questions… skeptical first visits are often the best ones." *(v2/01; v2/02)*
- "If anyone promises you a guaranteed result from any treatment, walk away." *(v2/02)*

### B8. Red-flag language (keep it word for word)

"See a doctor first if you have:" back pain with fever; weight loss you can't explain; numbness around the groin or seat ("the area a saddle would touch"); new bladder or bowel control trouble; weakness that keeps getting worse; pain after a crash, hard fall or major injury; night pain no position eases *(v2/01; v2/03; v2/08)*. For the head and CST: recent skull fracture, known or suspected bleed or aneurysm, stroke, severe bleeding disorder. "The worst headache of your life" or sudden vision, speech, strength or balance changes mean a physician first. After a head injury, a worsening headache, repeated vomiting, growing confusion or new nerve symptoms mean the hospital *(v2/02)*. Severe osteoporosis: no firm end-range work, and pause mobilization until the doctor gives guidance *(v2/06)*. "None of those belong on a treatment table first" *(v2/01)*.

### B9. Article and message structure (V2, problem → solution)

The V2 order is: a scene the reader recognises → the solution in plain words, including how a session feels → how it may help (hedged) → when it is not the right first step (every red flag kept) → what to expect at the clinic → a 4–5 question FAQ → a soft call to action *(STYLE-GUIDE-V2)*. Jarvis can use the same arc for patient explanations: **problem → what we'll do and how it feels → what it may help → limits and red flags → plan and reassessment marker.**

---

## Bridging notes for Jarvis

- **Clinical brain (Part A) and patient voice (Part B) share one rule: test, treat, retest.** Internally this means ARTS before and after each technique, with milestones at visits 3 and 5. For the patient it means "measure it, work on it, measure it again" and tracking one number.
- **Fix the remediation weak spot.** Always produce named techniques, the reason for each region, the dosage, and the markers.
- **Resolve the homework conflict in favour of the clinic voice.** Give 1–2 home movements. The CCR-era "osteopaths don't assign homework" stance is outdated.
- **Translate the clinical language before any patient sees it.** "Short right lateral line / declinated upper T-line / lumbars E SBl Rot r" becomes, for example, "the right side of your trunk is holding tight and your shoulders sit unevenly, so your low back is taking extra load". Then add a hedge.
