# 00-Source-Map: clinical value for session planning

Distilled 2026-10-29 from the Drive folder `00-Source-Map` plus `MANIFEST.md`. These files are **source maps** (catalogues of public literature and where to get it), not clinical texts. Their clinical value is (a) the key numbers and conclusions quoted from abstracts of reliability, effect-size and guideline papers, (b) the "treat less, treat what is symptomatic" argument the team built from them, and (c) a pointer to which open full texts are already downloaded (folder `10-Downloaded-Open-Sources`). Topic coverage is therefore heavy on LBP, neck, reasoning and fascia, and thin to empty on shoulder, hip/knee, TMJ, visceral and pregnancy. The gaps are stated, not filled from memory. Items marked [I] are inference by the source authors, not observation. No patient-identifying information appears in these files, and none is reproduced here.

Abbreviations for citations: **DEEP** = PUBLIC-SOURCES-DEEP-DIVE-2026-10-25.md (Part 0 verifier, P1 clinical reasoning, P2 mechanics/fascia, P3 history, P4 journals/fitness/nutrition, P5 gap fill; row numbers as "P1#12"). **A/B/C/D/E/VER** = research-raw files (A-history, B-clinical-reasoning, C-global-mechanics-fascia, D-journals-fitness-nutrition, E-gap-fill, VERIFICATION). **MAN** = MANIFEST.md.

## Coverage table

| File | Size | Status | Clinical yield |
|---|---|---|---|
| MANIFEST.md | 50 KB | full | Low. Inventory of 10 KB folders; PHI rule for folder 06; source-quality tiers; list of downloaded open full texts (folder 10). |
| PUBLIC-SOURCES-DEEP-DIVE-2026-10-25.md | 229 KB | full for summary, Part 0, P1, P2, P4, P5 (tables, top-10s, gaps); skimmed for P3 (history: top-10, gaps, selected rows); search logs not read | Medium. All the quoted numbers below come from here. |
| research-raw/B-clinical-reasoning-how-what-to-treat.md | 38 KB | full via DEEP (115/120 non-blank lines identical to DEEP P1; differences are headings) | Same as P1 |
| research-raw/C-global-mechanics-fascia.md | 30 KB | full via DEEP (93/99 lines identical to P2) | Same as P2 |
| research-raw/D-journals-databases-access-fitness-nutrition.md | 31 KB | full via DEEP (120/126 lines identical to P4) | Same as P4 |
| research-raw/E-gap-fill.md | 40 KB | full via DEEP (127/132 lines identical to P5) | Same as P5 |
| research-raw/A-history-evolution-classical.md | 47 KB | skimmed via DEEP P3 (124/130 lines identical) | Low (history, regulation) |
| research-raw/VERIFICATION.md | 30 KB | full via DEEP Part 0 (173/185 lines identical) | Corrections, extra papers |
| research-raw/COMMON-BRIEF.md | 4 KB | full | None (task brief for the researchers) |

Failed: none. 9 of 9 files opened. The raw files were checked line by line against DEEP, which is their merged copy with the verifier's corrections applied, so DEEP was read in their place.

---

## 1. General: session architecture and "what not to treat"

**The evidence-backed session flow** (DEEP summary, Finding C; P1 top-10). The papers converge on this order: red-flag triage, then patient goals and function, then a global screen, then symptomatic or function-limiting findings, then a mechanism-based technique choice (Fryer 2017), then the minimal dose with a within-session test-retest, then reassessment and exercise. The global standing/seated/supine screen "survives as a screen, not as a target list." (Decision-model detail is covered in another distillation; only the evidence behind it is given here.)

**How reliable are the findings we treat from?** This is the most important number set for planning.
- Seffinger 2004 (Spine; 49 studies): **pain provocation tests were the most reliable**. Motion and landmark tests were acceptable only in the best studies. **Soft-tissue paraspinal palpation was not reliable.** Segmental motion was less reliable than regional motion. (P1#12)
- Stochkendahl 2006 (JMPT; 48 studies): inter-observer reproducibility of **osseous and soft-tissue pain is clinically acceptable (kappa 0.4 or more)**. Other spinal procedures were not reproducible, or the evidence conflicts. (P1#13)
- Haneline 2009 (JMPT; 29 studies): static palpation agreement is generally low. Pain and tenderness palpation did better than landmark or position palpation. (P1#14)
- Consorti, Basile et al. 2018 (JAOA, sacral TART among students): TART components kappa **0.28-0.34** (fair), landmark position **0.06**, "diagnosis of somatic dysfunction" **0.17** (slight). **Tenderness was the most reliable.** (P1#15)
- Caution: reliability is not validity. Poor agreement does not prove a finding is meaningless. (P1 gaps)
- **Planning rule that follows:** weight tenderness, pain provocation, and reproduction of the patient's complaint above positional or segmental-motion findings. Log asymptomatic findings that are not linked to a goal, and do not treat them. (DEEP Finding B, summary item 3)

**Effect sizes to quote honestly** (P1#17, #19-#21; P5#41)
- OMT for nonspecific LBP (Franke, Franke and Fryer 2014; 15 RCTs): moderate-quality evidence of benefit at 3 months. **Pain MD -12.91 (on a 100-point scale); function SMD -0.36.** (P1#17)
- SMT for chronic LBP (Rubinstein 2019 BMJ; 47 RCTs, 9,211 people): **about equal to other recommended therapies for pain (MD -3.17, CI -7.85 to 1.51)**, with a small functional advantage. Adverse events were mostly transient. "Manipulation is an option, not the answer." (P1#21)
- MET for LBP (Cochrane 2015; 12 small, high-bias RCTs, 500 people): low-quality evidence that **MET adds nothing in most comparisons**. (P1#19)
- OMT overview (Bagagiolo 2022 BMJ Open; 9 SRs, 55 trials, 3,740 people): **promising for MSK pain (LBP, neck, chronic non-cancer pain); inconclusive for paediatrics, headache and IBS.** The included reviews are low or critically low quality on AMSTAR-2. (P1#20)
- Licciardone 2005 OMT-LBP meta-analysis: open in PMC, but contested (Franke 2012 critique; Licciardone's 2013 reply). (P1#18, P5#41)
- Mechanisms (Keter 2025 living review, 62 reviews): evidence on *how* manual therapy works is mostly low or critically low quality. (P1#9)

**How to choose a technique** (P1#6-#8)
- Fryer 2017 Parts 1 and 2: sort technique effects into **bottom-up** (tissue and receptor) and **top-down** (cognitive and psychological) mechanisms, then choose and combine approaches by the mechanism you are targeting, not by the "lesion". Both parts are open author manuscripts and are already downloaded (MAN folder 10, P1-clinical-reasoning).
- Bialosky 2018: small average effects may reflect one-size-fits-all treatment. Matching treatment to the patient's mechanism may identify responders.
- Fryer 2016, "Somatic dysfunction: an osteopathic conundrum": somatic dysfunction has unclear pathophysiology and poor detection reliability. Fryer proposes a tissue-plus-neurological model in its place. (P1#5)
- Thomson, Petty and Moore 2014: experienced osteopaths work as **Treater, Communicator or Educator**. The role sets how much of a session is treatment and how much is explanation. Use it to plan education-heavy sessions deliberately. (P1#3) The same authors' diagnostic study found reasoning switches between hypothetico-deductive and pattern recognition depending on case complexity. (P1#2)
- Hruby et al., *Five Osteopathic Models* (biomechanical, neurological, respiratory-circulatory, metabolic, behavioural): pick the model that is driving *this* patient. (P1#1, P3#41)
- Maitland (Hengeveld and Banks): irritability, severity and "can/can't" signs give a ready rule set for whether to treat and how hard. (P5#19)
- Low-dose options for "treat less": positional release and counterstrain (Chaitow, *Positional Release Techniques*). (P5#23)
- Classical lineage: the ICO podcast has episodes titled "Find it, Fix it and leave it Alone" and "The Classical Osteopathic Approach to Chronic Pain and Central Sensitisation". (P2#13) No written source for minimal-dose rules was found. (P1 gaps)

**Pain science for patient education**
- Greg Lehman, *Recovery Strategies* workbook: free, usable with patients, and downloaded (P1#32; MAN folder 10).
- D'Alessandro 2016: read patient-reported outcomes through **sensitisation and interoception** rather than a purely structural lens. (P1#10)
- Esteves 2022 (Frontiers in Psychology; not IJOM) and Cerritelli and Esteves 2022: treatment as shared perception-action. Touch, alliance and adaptation are active ingredients. (P1#4; Part 0 omission #2)
- Hodges and Tucker 2011, "Moving differently in pain": a theory of motor adaptation to pain. (Part 0 omission #8)

**Posture and structure: do not treat a posture finding just because it is there**
- Lederman 2011: posture, asymmetry and faulty movement are only weakly tied to pain. A JBMT debate issue carries rebuttals (Fryer, Lee, McGill), and Lunghi, Tozzi and Fusco 2016 is the direct reply. (P1#11, P2#33-34, Part 0 omission #3)
- Swain 2020 (J Biomech; umbrella review of 41 SRs): **no consensus on causality** between spine posture or physical exposure and LBP. (P2#35, corrected by the verifier)
- Christensen and Hartvigsen 2008: critical review of sagittal spinal curves and health. (P5#42)
- Lancet 2018 LBP series: "reduce the focus on spinal abnormalities." (P1#22)

**Red flags, safety and scope (Ontario)**
- WHO 2010 *Benchmarks for Training in Osteopathy* contains a **contraindications section** and is the OAO's reference. It is free (36 pp.). It is the first place to pull a contraindication list from. (P3#50)
- OAO 2022 Standards of Practice: act within scope; **refer when it is in the patient's best interest (1.6)**; no kickbacks from product suppliers (3.3). There is no nutrition or supplement clause. (P4#31; downloaded, MAN folder 10)
- Manual osteopathy is unregulated in Ontario (it is not under the RHPA), and no statute defines its scope. (P4#30)
- The title "osteopath" is reserved to CPSO members per an OAO page. Check the Medicine Act before using it. (P5#10)
- Quebec, Oct 2026: a coroner called for regulation after a patient death, and Quebec plans to integrate osteopaths into the Order of Chiropractors. This raises the documentation and screening standard in practice. (P3#46)
- NCOR (UK) publishes adverse-event and complaints reports that show what to avoid. (P4#28)

**Outcome and retest measures**
- The files name **within-session test-retest** as the core step (DEEP summary C), and NCOR offers PROMs support (P4#28). No specific retest instrument (NPRS, ODI, NDI, PSFS and so on) is catalogued anywhere in this slice. **Gap:** source retest tools from the CAO material or the JOSPT CPGs.
- Practical inference from the reliability data [I]: use **pain provocation or tenderness reproduction and a functional movement the patient cares about** as the retest marker, because these are the findings two examiners agree on (P1#12-15).

---

## 2. Low back pain (best-covered topic)

- **Guidelines:**
  - JOSPT 2021 LBP CPG (George et al.; free in PMC; P5#44).
  - NICE NG59 (downloaded PDF; MAN folder 10; P1#26).
  - ACP 2017: most acute and subacute LBP improves regardless of treatment, so choose non-drug options (heat, massage, acupuncture, spinal manipulation; low-quality evidence). **Chronic LBP starts with exercise**, multidisciplinary rehab and mindfulness. (P1#23)
  - Lancet 2018: biopsychosocial framing, education, activity and exercise; be prudent with imaging, drugs and surgery. (P1#22)
- **Technique evidence:** OMT has a modest benefit at 3 months (Franke 2014). SMT is about equal to other care (Rubinstein 2019). MET is unproven (Cochrane 2015). See section 1 for the numbers.
- **Assessment:** sacral TART is unreliable apart from tenderness (Consorti 2018). Pain provocation is the reliable finding (Seffinger 2004).
- **Fascial and structural basis:**
  - Willard et al. 2012: the thoracolumbar fascia transmits tension from abdominal and limb muscles to the lumbar spine and pelvis via the lateral raphe. This is the anatomical basis for lumbopelvic and dorsolumbar transition reasoning. (P2#21)
  - Langevin 2009: ultrasound shows altered lumbar connective tissue in chronic LBP. The study is cross-sectional, so cause is not shown. (P5#39)
  - Panjabi 1992: the three-subsystem model (passive, active, neural) behind "instability" reasoning. Paywalled. (P5#36)
- **Exercise and HEP:**
  - Cochrane 2021, exercise therapy for chronic LBP (Hayden et al.; in PMC). (Part 0 omission #9)
  - McGill, *Low Back Disorders* (spine-sparing loading; 2002 edition borrowable on Open Library). (P5#31)
  - Barbell Medicine LBP and sciatica guides take a strength-training stance. They are not an osteopathic source. (P1#33)
- **Education line (source-derived):** "Most back pain settles whatever we do. Manual treatment helps about as much as other good options, so the main work is staying active and loading up gradually." (ACP 2017, Rubinstein 2019)

## 3. Neck and headache

- **Red flags before neck treatment:** the **IFOMPT International Cervical Framework** (Rushton et al., JOSPT, online 2022, print 2023, corrigendum 2023) sets out structured reasoning on vascular pathology before any neck intervention, that is, when NOT to manipulate. Read it with the Maher 2023 letter, which challenges its risk comparisons. (P1#24-25)
- **Guideline:** the JOSPT neck CPG (2017 revision) is named as the "what to treat and when to stop" anchor. Its access was not verified. (P4#10)
- **Posture:** Mahmoud 2019 meta-analysis on forward head posture and neck pain (free in PMC). Check its effect sizes before using posture as a treatment trigger. (P5#43)
- **Evidence:** OMT is promising for neck pain and **inconclusive for headache** (Bagagiolo 2022; P1#20). The OMM Research Podcast has an episode on OMT for chronic neck pain (P1#42).
- **Gap:** no headache-specific assessment, technique or retest source is catalogued.

## 4. Shoulder

- Only pointers: the JOSPT and APTA region CPGs, which list shoulder (access not verified; P1#27), Barbell Medicine's "Guide to Shoulder Pain" (2025; P1#33), and Levin's shoulder-girdle tensegrity chapters (P2#18).
- **Gap:** no shoulder assessment, red-flag or dosing content in this slice.

## 5. Hip and knee

- Only pointers: the JOSPT CPGs for hip and knee (P1#27), Barbell Medicine's tendinopathy guide (2024; P1#33) and OrthoInfo patient handouts (P4#56).
- Lumbopelvic and SIJ reasoning: Diane Lee, *The Pelvic Girdle* (print-disabled lending only; P5#29). Littlejohn polygon bases: the Gasso 2013 thesis (downloaded) is a tiny uncontrolled photo study, useful for its vocabulary only (P2#16).
- **Gap:** no hip or knee clinical content.

## 6. TMJ and cranial

- Liem, *Cranial Osteopathy: Principles and Practice* (paywalled; P1#39). ICO webinars cover the primary respiratory mechanism (P2#12).
- **Gap:** no TMJ source and no cranial evidence data in this slice.

## 7. Visceral

- Barral, *Visceral Manipulation I and II* (paywalled; P5#21). The Barral Institute courses include a Canada schedule (P2#36). Stone, *Visceral and Obstetric Osteopathy* (paywalled; P1#41). The Kuchera *Osteopathic Considerations in Systemic Dysfunction* is a system-by-system OMT text, used copies only (P5#13).
- Evidence: OMT is **inconclusive for IBS** (Bagagiolo 2022; P1#20). Visceral-fascial restriction logic "evidence for it is thin" (P5#21).
- **Planning implication:** treat visceral work as low-evidence. Use it when it is goal-linked and the patient has been screened medically, not as routine.

## 8. Pregnancy and postpartum

- Downloaded locally (MAN folder 10, P4-journals-access-fitness): **CSEP Physical Activity Guidelines in Pregnancy** and **CSEP 2025 Canadian Guideline for the First Year Postpartum**. These are the Canadian exercise references for this group.
- The WHO 2020 physical activity guidelines include pregnancy (P4#39). Stone covers obstetric osteopathy (P1#41).
- **Gap:** no obstetric contraindication list or technique-safety source is in the tables. Pull contraindications from WHO 2010 Benchmarks (P3#50) and from the downloaded CSEP pregnancy PDF.

## 9. Fascia and global ("collective") mechanics: evidence tier

- **"Collective Mechanics" is a CAO trademark (TM)**, credited to Robert Johnston. Its only public definition is one line: "movement, physics, and the laws of nature". No lines, polygons or algorithm are published, and the CAO pages do not cite Littlejohn or Wernham. The model's only sources are the CAO course material. (P2#1-3, #7; Part 0 3f)
- **Force transmission:**
  - Krause 2016 SR: moderate evidence that tensile force passes between some adjacent structures in the **superficial back line and back functional line**; one front-functional-line study found no significant transfer. (P2#22)
  - Wilke 2016 (dissection-based): **strong** evidence for the superficial back line, back functional line and front functional line; **moderate** for the spiral and lateral lines; **none** for the superficial front line. The data are mostly from cadavers. (P2#23-24; P5#37)
  - Clinical relevance of either finding is unproven.
- The **definition of fascia is contested**: Adstrum 2017 (Fascia Research Society) versus Bordoni 2024. (P2#26; Part 0 omission #5)
- Langevin 2021 (open): fascia mobility, proprioception and myofascial pain. (P5#38) Slater 2024: fascia as a richly innervated regulatory system. (P2#28)
- Schleip and Mueller 2013, "Training principles for fascial connective tissues", is the bridge from fascia science to exercise prescription. (Part 0 omission #6)
- **Rule for Jarvis:** tier fascial and chain reasoning as **"plausible mechanism", never as a treatment rule** (DEEP Finding D). Use chains to generate a hypothesis about a remote driver, then confirm it with a retest. Do not treat a chain because it is "there".

## 10. Exercise prescription and HEP (general)

- **Pre-participation screening:** CSEP **PAR-Q+** (named in the DEEP summary item 6). It is not linked from the CSEP page fetched (P4#38).
- **Baseline dosing, adults (CSEP 24-Hour Movement Guidelines):** sedentary time **8 hours or less**, recreational screen time **3 hours or less**, sleep **7-9 h (18-64)** or **7-8 h (65+)**. (P4#38) The CSEP counselling tools and the "Whole Day Matters" primary-care toolkit are downloaded (MAN folder 10).
- **WHO 2020:** the international baseline. It covers chronic conditions, pregnancy and disability, and its figures are in the PDF. (P4#39)
- **Resistance training:** ACSM position stands are free, including "Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults" and "Guidance for Prescribing Exercise". ACSM has no LBP stand. (P4#40) NSCA *Essentials* (4th edition borrowable) is the reference for load and progression. (P5#32)
- **From findings to HEP:**
  - Janda approach (Page, Frank and Lardner): crossed syndromes linked to an exercise programme. (P5#26)
  - Sahrmann: movement-impairment syndromes with corrective exercise. (P5#27)
  - Kendall: muscle testing standards. (P5#28)
  - All three are textbook tradition. Apply the posture-causality caution in section 1.
- **Chronic pain:** Booth 2017, exercise for chronic MSK pain using a biopsychosocial approach. (Part 0 omission #10)

## 11. Nutrition (scope-safe)

- **Scope:** "dietitian" is a protected title in Ontario and "nutritionist" is not. The OAO Standards say nothing on nutrition. Give general guidance only, refer to an RD for anything therapeutic, and check your association's and your insurer's written position. (P4 gaps; P4#52)
- **Baseline:** Canada's Food Guide. (P4#47)
- **Protein for exercising patients (ISSN, Jager 2017):** **1.4-2.0 g/kg/day**. (P4#49; downloaded)
- **Sports nutrition anchor:** the ACSM and Dietitians of Canada joint position "Nutrition and Athletic Performance" (2016). (Part 0 note)
- **Supplements:** check the product's NPN in Health Canada's LNHPD. The NIH ODS fact sheets are US-centric. Use Examine.com and Precision Nutrition for orientation only. (P4#45-46, #50-51)
- **Evidence ranking:** the folder 08 (Ben McDonald) trainer bundle is Tier D grey literature. Do not let it outvote Tier A on physiology or nutrition. (MAN tiers)

## 12. Source hygiene and data rules (affect what Jarvis may ingest)

- **Folder 06 contains real patient data** (Y4 CCR case report). It must not go into any cloud LLM without de-identification (PHIPA), and it stays out of any product. (MAN PHI note)
- Several local PDFs carry **shadow-library fingerprints** (z-lib, PDFDrive, pdfcoffee, epdf.pub). They are fine for personal study but must not be ingested into anything commercial. Legitimate routes for each title are listed in DEEP P1, P3, P4 and P5. (MAN licensing; DEEP Finding E)
- **Corrections to apply when citing:**
  - Esteves 2022 is "(En)active **Inference**", published in Frontiers in Psychology.
  - "Basile 2017" is actually Consorti, Basile et al. 2018.
  - The IFOMPT framework is dated 2022/23, not 2020.
  - OSTCAN = **Osteopathy Canada**. Medavie lists OAO, OSTCAN, OOAMA and OFOP for Ontario. No standalone "OOA" was found.
  - (DEEP Finding F; Part 0 3a)
- **Not found anywhere:** Zink and Lawson 1979 and the year of Pope's common compensatory pattern paper (unresolved), Mitchell's MET diagnostic logic, and STAR criteria (only TART was seen). No source validates a route from a palpatory finding to a treatment target. (P1 gaps; Part 0 3e)

## 13. Highest-yield open full texts already on the laptop (pull these next)

Folder `10-Downloaded-Open-Sources` (MAN):
- Fryer 2016 and 2017 Parts 1-2
- Thomson, Petty and Moore 2014 (both papers)
- Rubinstein 2019
- Franke 2014
- Bagagiolo 2022
- Keter 2025
- NICE NG59
- Lehman workbook
- Langevin 2009 and 2021
- Licciardone 2005
- Wilke 2016
- Gasso 2013
- the CSEP pregnancy, postpartum and 24-hour guideline set
- ISSN protein stand
- OAO Standards 2022
- GOsC OPS
- OIA 2026 Global Review

Not downloaded but free and high-value:
- JOSPT 2021 LBP CPG (PMC10508241)
- WHO 2010 Benchmarks (contraindications)
- Cochrane 2021 exercise for chronic LBP (PMC8477273)
- Mahmoud 2019 (PMC6942109)
- Willard 2012 (PMC3512278)
- Krause 2016 (PMC5341578)

(DEEP P1, P2, P3, P5; Part 0)
