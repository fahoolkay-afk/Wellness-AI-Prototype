# Osteopathic Jarvis — Pre-Session Brain (TL;DR v1)

Distilled from the *Osteopathic Jarvis Knowledge Base* (Drive):
`09-Brain-Design/JARVIS-DECISION-MODEL-SPEC-v0.1.md`, `01-NotebookLM-Sources/mechanical Assessment Algorithm y4.docx` [Algo-Mech],
`Y4 Algorithm - Lee O'Neill.docx` [Algo-ONeill], `Copy of Fryette Mechanics.docx`, plus the two Jarvis engines
(`jarvis_engine_1.py` SOAP/HEP output, `jarvis_local_mvp-v2.py` Johnston 5-class / technique matrix).

**Purpose:** turn an intake form into a *pre-session game plan* — what to screen, what is likely to matter,
what NOT to chase, which approach to reach for, and what to retest. It is a reasoning aid for the practitioner,
not a diagnosis. Hands and retest findings in the room always override it.

---

## 1. The session flow (gate, not lookup table)

```
[1] RED-FLAG TRIAGE ──fail──► stop / refer / modify (no cervical HVLA etc.)
[2] GOALS & FUNCTION        what must this person get back to doing?
[3] GLOBAL SCREEN           collective mechanics → hypotheses + load map, NOT a target list
[4] FILTER (the gate)       keep only symptomatic / function-limiting + goal-linked + reliable findings
[5] MECHANISM-BASED CHOICE  why this approach for this person (irritability, chronicity, model driving it)
[6] MINIMAL DOSE + RETEST   one or two big things per position → retest the chosen measure
[7] REASSESS + HAND OVER    3-tier HEP (Liberate → Re-groove → Build capacity), education, load plan
```

"I don't want to treat everything" = only Stage-4 survivors get treated. Everything else is logged for trend.

## 2. Do-not-treat rules

1. Asymptomatic + not goal-linked → log, don't treat.
2. Low-reliability findings (segmental restriction, static landmark asymmetry, tissue texture, "SD" composite) are never the *sole* reason to treat — need co-occurring tenderness/pain provocation or a goal-linked functional limit.
3. No within-session change on the chosen measure → stop that target; don't escalate dose.
4. Postural / T-line / lateral-line / polygon asymmetry alone → screen output, not an indication.
5. Fascial-chain / line-of-pull reasoning = hypothesis generator ("plausible mechanism"), not a rule.
6. Difficult / irritable → "don't touch it, look at what feeds into it" → indirect, education, load management.

## 3. Evidence weights

| Finding | Weight |
|---|---|
| Pain provocation / tenderness reproducing complaint | HIGH — primary gate |
| Patient goal / function-limiting complaint | HIGH — anchor |
| Red flags | GATE — stop/refer |
| TART composite, segmental restriction, landmark asymmetry, tissue texture | LOW — never sole justification |
| Global lines / posture / COG | SCREEN ONLY |
| Myofascial chain / line of pull, fascia-as-regulator | PLAUSIBLE MECHANISM |

## 4. Red-flag / intake screen (Algo-ONeill)

Systems review (EENT, cardio-resp, GI/elimination), pregnancy, surgeries with hardware/organ removal,
informed + verbal consent, **heel drop on first treatment**. Also: night pain, unexplained weight loss,
fever, saddle anaesthesia / bowel-bladder change, progressive neuro deficit, trauma, cancer history,
anticoagulants/osteoporosis (force modification). Neck: IFOMPT vascular reasoning before any cervical
intervention; **no stacking ext/rot/SB in cervicals; don't palpate C2 laterally / occlude vertebral arteries.**
Pacemaker/hardware → contraindication for sternal/thoracic inlet work.

## 5. Global screen (CAO Y4 algorithm — Tier B teaching model)

- **Standing:** T-lines (upper/lower), lateral lines, oblique lines (short/long), COG A/P; PSIS thumbs with active flex/ext/SB/rot; fascial line of pull, breaks in collective motion.
- **Seated (true spinal eval, innominates locked):** active flex/ext/SB/rot, head first for cervicals; arm circumduction (breaks at elbows/wrists, dorsal region); GHJ if dysfunction; ribs lower/middle/upper insp/exp. Seated soft-tissue prep (straddle, rotation to barrier, **indirect first**) to "clear the smoke".
- **Supine:** visual from foot of table; static ASIS; pelvic rotation (tells you DL — base of lower polygon vs upper polygon); cross check (oblique lines, ant/post innominate); lumbar flexion / posterior line (dural tug; L3 cancels the 2 transition zones; QL/central tendon via double knee-to-chest); innominate (in/outflare, ant/post, up/downslip); diaphragm (attaches lumbars, lower 5 ribs, T12/L1; fluid mechanics); upper-limb traction (lateral/anterior lines); CFJ (root of hip is DL via psoas); limbs last ("foot and knee take care of themselves" once load dysfunction is resolved).
- **Side-lying:** best position for torsion (SB + rot), lesion side up; innominate wheel; lumbar SB (short/long lever); body roll for oblique lines; scapula, GHJ, rib fascial along lateral line. *Assess both sides first, treat on the 2nd side-line.*
- **Prone:** take residual pelvic torsion out first; sacrum nutation/counternutation with breath; ILA → sacral base 6-point test, sphinx; **L5 loads the sacrum → treat L5 first if sacrum in lesion**; springing spine + rib sections; thoracic wheel.
- **2nd supine:** take torsion out before neck; reverse bridging T6 up (root of neck); sternal glide / STA (open thoracic inlet); cervical 4 pillars (pretracheal/hyoid, SCM, nuchal lig/trap); C3–7 translation (concavity left = SBL); AA/OA focal. Cranial beyond vault hold/sagittal suture only if warranted.
- **Visceral (if warranted):** linea alba, 4 quadrants, liver, bladder lift → presacral fascia, colon lift.
- **2nd seated:** triplanar clean-up, seated spinal sweep, reassess all planes.

"Perfect OP outcome" pattern: *short right lateral line, lumbars rotated right, restricted ascending colon — global, local, focal.*
Wayne tips: **have a finding → what can hold it → what planes/axes can I treat to change it → treat → reassess.**
If cervicals restricted, look down the lines and treat lower. Mirroring: OA/AA ↔ L5/S1; GH issues → look at neck; OA ↔ innominates.
Short-lever wheel: superficial = hold, intermediate = breath, deep = articular.

## 6. Johnston 5-class + Fryette

- Class I posture lines · II regional ROM · III static landmarks · IV tissue (TART) · V motion-demand (active ease vs bind).
- **Type I (neutral, group ≥3, thoracic/lumbar):** SB and rot to OPPOSITE sides. **Type II (non-neutral, single segment, flexed/extended):** SAME side. **Law III:** motion in one plane modifies all others.
- OA: SBx Ry (opposite). AA: rotation only. C3–7: SB and rot same side (facets). Primary motions: cervical rot/SB, thoracic rot, lumbar flexion, sacrum nutation/counternutation.

## 7. Technique selection matrix

| Presentation | Approach |
|---|---|
| Acute / high irritability / guarding | **Indirect** — counterstrain (90 s ease), BLT, functional, indirect MFR |
| Chronic / fibrotic / low irritability | **Direct** — MET, direct MFR, articulation, (HVLA only where appropriate & cleared) |
| Complex / combined | **Still technique** — ease → vector (compression/traction) → carry through barrier |
| Very irritable / complex | Don't chase — treat what feeds it, education, load management |

Minimal dose: ~1–2 big things per position, then reassess. Always reassess cross-check + ASIS after pelvic/diaphragm/arm work.

## 8. Pre-session brief output template (per patient)

1. **Snapshot** — age/occupation, complaint, duration/onset, irritability (low/mod/high), stage (acute/subacute/chronic), goal.
2. **Red-flag & precaution check** — clear / to confirm in room / modify (with reason).
3. **Working hypotheses** — likely primary driver + what may feed it (tagged HIGH / SCREEN / PLAUSIBLE).
4. **Screen priorities** — what to look at in standing / seated / supine / side-line / prone, and what to *skip unless warranted*.
5. **Treat-if-confirmed** — candidate targets with the Stage-4 condition that must be met, and suggested approach (direct / indirect / Still) + position.
6. **Do-not-chase list** — findings likely to appear that should be logged, not treated.
7. **Retest markers** — 2–3 concrete pre/post measures (pain-provoking movement + NPRS, ROM, functional test tied to the goal).
8. **Hand-over** — 3-tier HEP idea (Liberate / Re-groove / Build capacity), education line, follow-up.

---

*Tier note: the CAO collective-mechanics model is Tier B teaching material (clinical tradition, not outcome evidence).
Gating rules and evidence weights come from the Tier A literature summarised in the decision spec.*

*Privacy: intake forms are PHI. Use initials / de-identified forms when sending them for briefs, and do not commit them to this repo.*
