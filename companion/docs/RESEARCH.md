# Companion — research & design basis

Synthesis of three grounded research passes (patient UI, doctor dashboard, drug
pharmacology) that inform the next build increments. Every non-obvious claim is
cited (§6). This is the source document the Increment 2 (patient logging) and
Increment 3 (doctor dashboard) specs draw from — and it drives concrete changes
to the data model and the PK/PD engine (§4).

Audience reality: the app is a de-identified, physician-in-the-loop dosing diary.
A neurologist's Parkinson's patients log doses / motor state / meals; the doctor
reviews patterns and adjusts the prescription. The app never prescribes.

---

## 1. Patient UI — design for logging *while OFF*

**The load-bearing fact:** the OFF state is exactly when logging matters most and
when the hand is least capable (bradykinetic, rigid, tremulous, sometimes mid-
freeze). If logging needs precision, sequence, or speed, it fails at the moment
it's most needed — and the missing data are the most clinically important ones
(dose failures, wearing-off, delayed-ON). So the core loop is **operable one-
handed, no typing, two taps or fewer, timestamp auto-captured.**

**Numeric spec (build to these):**
- **Two hero buttons** ("I took a dose", "How I feel now"): full-width, **≥88px
  tall, target ~120px (~32mm)** — pressed by the most impaired hand.
- **Standard controls** (steppers, rows, tabs): **≥20mm (~76px)**; never below
  the 44px WCAG-AAA floor. (PD tap accuracy is ~98% at 14mm targets; 20mm buys
  tremor/dyskinesia headroom.)
- **≥8mm gap** between adjacent tap targets (adjacent mis-tap is tremor's main
  failure); ≥12mm around the hero buttons.
- **Single tap only.** No double-tap (tremor triggers/fails it), no swipe-to-
  delete, no drag, no long-press-only, no edge-swipe. **Debounce logging buttons
  ~400–500ms** so a tremor double-strike is one entry.
- **Undo, never confirm.** Log immediately; hold a ≥20mm **Undo for ≥8s** (no
  "Are you sure?" modal in the logging path). Delete lives one screen deep in an
  event's detail, never on a swipe.
- **No timeouts** on logging; no auto-dismiss toasts under ~8s.
- **Type ≥18px** (respect OS scaling), **contrast ≥7:1**, **state by colour +
  text + shape** (never colour alone), `prefers-reduced-motion` honoured.
- Hero actions in the **lower ~60%** (thumb zone); nothing critical in top corners.

**Caregiver-assist is first-class:** a "log for the patient" affordance with the
one place a **retroactive time-picker** appears (caregivers log after the fact).
Store event `source: self | caregiver`; don't clutter the patient UI to show it.

**Voice is a fallback only:** hypokinetic dysarthria/hypophonia make ASR fail for
exactly this population. Voice is offered *only* for an optional free-text note
on an event; the logged fact is always captured by the button tap, never by the
transcript.

**Anti-patterns (do not build):** typing in the core loop; double-tap/swipe/drag/
long-press-only; confirm dialogs in logging; timeouts/fast-dismiss toasts; small
targets/tight spacing/colour-only state/low contrast/tiny fonts; voice-as-primary;
multi-screen wizards; gamification / streaks / "you missed a day" guilt.

**Patient wireframes (condensed):**
- **Home:** header (date, non-interactive) → HERO "I took a dose" (tap = log now
  + "Dose logged · 08:12 · Undo") → HERO "How I feel now" → secondary "Log a
  meal" → read-only Recent timeline (tap a row → detail).
- **State:** three full-width slabs — **ON** / **OFF** / **ON with dyskinesia** —
  clinical term as headline + plain gloss beneath; one tap logs + returns Home.
  OFF sits centre with the most margin (most-impaired hand).
- **Meal:** two slabs — **Low protein** / **High protein** — default time "now",
  optional big −/+ stepper to adjust. (Protein competes with levodopa at the
  amino-acid transporter → dose failures/wearing-off; high/low is the actionable
  minimum. No food diary.)
- **Event detail:** the only place with Change-time (stepper) and Delete (→
  "Entry deleted · Undo").

---

## 2. Doctor dashboard — one patient, one visit

The neurologist has ~10–15 min to answer: *is the levodopa regimen giving enough
ON time without troublesome dyskinesia, and if not, what timing/interval/adjunct
change is worth discussing?* Every element earns its place against that.

**Top rules:**
1. **The day-ribbon is the product** — a 24h horizontal band of motor state with
   dose markers on the same axis. Build this first.
2. **Model output is a discussion point, never a command and never a dose number.**
3. **Observed vs simulated must be visually distinct** — logged states solid;
   the simulated effect-site curve is a thin, lighter, explicitly-"simulated" line.
4. **Every flag is one tap from its raw evidence** (tap suggestion → ribbon
   highlights the exact doses/days).
5. **Default to the smaller claim**; show variability, not just a "typical day";
   show uncertainty (confidence band, sparse-day markers).
6. **One patient = one page**, exportable to a static one-pager for the visit.

**Chart catalog (question → chart):**
- **Day-ribbon** (primary): 00:00–24:00, fill = motor state (colour + texture +
  label), dose-marker lane above, meal-marker lane below, event flags on the
  ribbon (delayed-ON, dose-failure, early wearing-off).
- **Concentration-time overlay** (aligned under the ribbon): simulated effect-
  site levodopa curve + a **shaded confidence band**, two horizontal thresholds
  (**ON** and **dyskinesia**); the band between = therapeutic window. Shade
  model↔observed disagreement rather than hiding it. Fixed caption: "Simulated,
  not measured. Thresholds are estimates for discussion."
- **Multi-day heatmap** (default) — rows = dates, columns = 30-min bins, cell =
  state; reveals recurring OFF windows and good/bad weeks. Small-multiples of the
  ribbon as an opt-in.
- **Wear-off latency distribution** (duration-of-ON, latency-to-ON per dose;
  median + IQR) and **dyskinesia time-since-dose histogram** (peak ~60–120min =
  peak-dose).
- **Total daily LEDD trend** (context, not a target) with per-drug breakdown.

**Suggestions panel — three fixed parts each, medico-legally safe:**
1. **Observation** (quantified): "OFF recurs 3.5h (median, IQR 3.0–4.0) after the
   08:00 dose, on 5/7 days."
2. **Discussion point** (directional, never a number): "Consider a shorter
   interval, or adding a COMT inhibitor." Verbs stay conditional (consider,
   discuss, review) — never increase/give/switch/start.
3. **Evidence link** (tap → highlights generating days) + data-sufficiency badge.
Standing disclaimer: "Discussion points from logged data and a population model.
Not medical advice. The treating physician decides." Doctor can mark
discussed/dismissed per flag.

---

## 3. Drug pharmacology → engine handling

Grounded reference (confidence flags: **[E]** established / **[V]** variable /
**[C]** contested). Structural rule: **only levodopa and rotigotine carry their
own concentration-effect curves; the DDCIs / COMT-I / MAO-B reshape the levodopa
curve; baclofen is outside the model.**

| Drug | Class | Engine handling | LED factor | Key PK |
|---|---|---|---|---|
| **Levodopa** | Dopamine precursor | **OWN CURVE (reference)** | ×1.0 (CR ×0.75) | t½ ~1.5h w/DDCI; Tmax 0.5–1h; effect 2–4h **[E]** |
| **Benserazide** | Peripheral DDCI | modifies-LD (F↑, periph. clearance↓); **baseline** | none (LD content ×1) | extends periph. LD t½ ~90min **[E]** |
| **Carbidopa** | Peripheral DDCI | modifies-LD; **baseline** (= benserazide) | none | LD t½ ~1.5h **[E]** |
| **Rotigotine** (Neupro) | Dopamine agonist patch | **OWN CURVE — flat/continuous plateau**, parallel input | ×30 (mg/24h) | BA ~37%; steady state 1–2d; ~flat 24h **[E/V]** |
| **Madopar LT** | LD+benserazide dispersible | OWN CURVE = LD curve, **faster ka** | ×1.0 (LD content) | ON ~25 vs ~46min; earlier Tmax; same AUC/t½ **[E/V]** |
| **Entacapone** (Comtan) | COMT-I | modifies-LD (clearance↓), **per-dose** | LD dose ×0.33 | LD t½ 1.3→2.4h; AUC +35%; peak unchanged **[E]** |
| **Safinamide** (Xadago) | MAO-B-I + glutamate/Na | modifies-LD **effect** (PD-side, continuous) | fixed 100mg | BA 95%; Tmax 2–3h; t½ 20–26h **[E]**; effect magnitude **[C]** |
| **Opicapone** (Ongentys) | COMT-I once-daily | modifies-LD (clearance↓), **all doses/day** | LD dose ×0.50 | LD t½ ~2×; AUC +~30%; COMT >24h **[E]** |
| **Baclofen** (Lioresal) | GABA-B agonist | **LOG-ONLY — excluded from model & LEDD** | **none** | t½ ~2.5–4h; non-dopaminergic **[E]** |

**Combination modeling rules:**
1. **DDCI is a precondition, not a modifier** — the base levodopa curve *is* the
   with-DDCI curve; never double-count benserazide/carbidopa, never offer a bare-
   levodopa curve.
2. **Per-dose vs all-day COMT** — entacapone modifies only its co-dose; opicapone
   modifies every dose from one bedtime dose. Two application scopes for the same
   clearance-reduction. **Never stack entacapone + opicapone** (flag as conflict).
3. **COMT changes the tail, not the peak** — reduce elimination rate (longer t½,
   higher AUC/trough), hold Cmax/Tmax ~constant. (Peak drives dyskinesia risk;
   COMT extends duration.)
4. **Safinamide is a PD-side effect modifier**, not PK — continuous gain/duration
   on the *effect*; its glutamate/Na actions are out-of-scope (flag, don't
   quantify); its LED (100mg) is a convention, not a curve input.
5. **Rotigotine is an additive parallel dopaminergic input** — a tonic baseline
   filling troughs between levodopa peaks; does not touch levodopa PK.
6. **Madopar LT = levodopa curve with accelerated ka** (same AUC/t½), for morning-
   akinesia / OFF rescue.
7. **Baclofen logged but hard-excluded** from LEDD and every dopaminergic calc —
   distinct medication category so a total can never sum it in.
8. **LED source of truth:** Schade 2020 (adds opicapone ×0.5, safinamide 100mg to
   Tomlinson 2010) or MDS-2023 (Jost). COMT factors are *fractions of concurrent
   levodopa*; the LEDD summer must handle fractional / fixed / per-mg types.

---

## 4. What this drives — concrete data-model & engine changes

For the Increment 2 (logging) and later engine/dashboard specs:

**Data model (`companion/src/domain/types.ts`):**
- **MotorState:** the current `'on' | 'off' | 'on-dyskinesia'` is too coarse for
  the doctor view and possibly too fine for the patient's OFF hand. Proposed
  reconciliation (pending the §5 decision): store the **five Hauser categories**
  (`off | on | on-dyskinesia-nontroublesome | on-dyskinesia-troublesome |
  asleep`) as the canonical value, but the **patient UI logs 3 primary buttons**
  (ON / OFF / ON-with-dyskinesia) with an *optional* one-tap refinement of
  dyskinesia → troublesome/non-troublesome (skippable; defaults to unspecified).
  This keeps the patient loop 2-tap while giving the doctor the validated states.
- **DrugId → a typed drug catalog** encoding, per drug: class, formulation,
  **engineHandling** (`own-curve | own-curve-fast-ka | modifies-levodopa-clearance
  -per-dose | modifies-levodopa-clearance-all-day | modifies-levodopa-effect |
  parallel-agonist | log-only`), **ledFactor** (`{kind: reference|none|fraction|
  fixed|per-mg, value}`), population PK params where own-curve, and a
  `confidence` flag. Baclofen: `log-only`, no LED.
- **MealEvent:** protein `low | high` primary (drop `unknown` to a fallback).
- **Event `source: self | caregiver`** and support for a **retroactive
  timestamp** (caregiver / event-detail edit).

**Engine (`companion/src/engine/pkpd.ts`) — later increment:**
- Keep the levodopa Bateman + effect-compartment core (already built & tested).
- Add per-drug application: DDCI = baseline (no-op on an already-DDCI curve);
  Madopar LT = ↑ka; entacapone = ↓ke on its co-dose; opicapone = ↓ke on all
  doses; safinamide = effect-side gain/duration modifier; rotigotine = additive
  tonic plateau; baclofen = ignored.
- **LEDD calculator** honoring fractional/fixed/per-mg factors, baclofen excluded.
- Every **[V]/[C]** number ships as `draft`/"confirm with neurologist," surfaced
  in a content-review affordance (the neurologist is the final check).

---

## 5. Open product decisions (the neurologist owns these)

1. **Motor-state granularity (gates the data model).** Recommended: store the 5
   Hauser states; patient logs 3 big buttons + optional dyskinesia refinement.
   Alternative: patient logs exactly 3 and the doctor view uses 3 (simpler, loses
   the troublesome-dyskinesia distinction that actually drives management).
2. **Sleep logging.** Patients can't log "asleep" in real time. Options: a
   "going to sleep / woke up" pair, infer gaps as unknown, or omit `asleep` in v1.
3. **Confidence display.** Safinamide effect magnitude and rotigotine "flat"
   profile are `[C]/[V]` — ship them as clearly-flagged estimates you confirm.
4. **Per-patient vs population PK.** Define the minimum logged dose/response count
   before the dashboard shows an individualized curve vs a population one (band
   widens + "population estimate" label below the threshold).
5. **WOQ-9/19.** Optional periodic wearing-off questionnaire — a small trend
   item, not a chart. Defer to a later increment unless wanted now.

---

## 6. Objective sensor module (roadmap — a later increment)

The phone gyroscope/accelerometer is **not** a UI control (a tremulous/dyskinetic
hand can't drive tilt — anti-pattern). But phone sensors as **measurement** are
high-yield: optional, short "check-in" tests producing timestamped objective
signal that overlays on the doctor's day-ribbon → an *objective* wearing-off
curve independent of whether the patient remembered to log OFF.

**Design filter:** for a medication-timing tool, favour measures that swing
fast *within a dose cycle* and cost almost nothing while OFF. That reorders the
usual "digital UPDRS" list.

**Build order (yield ÷ burden):**
1. **Finger-tapping** (touchscreen, **no sensor, no permission**, identical
   Android/iOS) → bradykinesia (the sign that fluctuates hardest/fastest with
   levodopa). Compute: tap rate, inter-tap-interval CV, amplitude, **decrement
   slope**, mis-taps. ~15 s/hand. Highest yield, lowest friction — build first.
2. **Rest/postural tremor** (`@capacitor/motion` DeviceMotion, accel+gyro) →
   4–6 Hz band power, peak frequency, RMS amplitude. ~20 s. Second axis
   (tremor/dyskinesia). Build second.
3. Spiral (touch, confirmatory), 4. Gait (accel, higher burden/fall-safety),
   5. Voice (mic, **privacy-sensitive**) — **deferred**.

**Feasibility (honest):** tapping/spiral = plain touch events, green light.
Tremor = DeviceMotion at ~60 Hz nominal but **irregular** — 60 Hz oversamples a
4–6 Hz signal 5–10×, so amplitude/frequency are recoverable, *but* you must
**resample to a uniform grid** (using `event.interval`) before the FFT and
discard epochs where effective rate < ~40 Hz. No native high-rate plugin needed
for v1 (a 100–200 Hz IMU plugin is a v1.5 fidelity spike only). **iOS gotcha:**
`DeviceMotionEvent.requestPermission()` must fire from a real user gesture over
HTTPS — so a tremor test always starts from an explicit "Begin" tap (which we
want anyway). Android has no such prompt.

**Privacy (crisp):** **no GPS/location ever** (directly identifying; not needed —
gait uses the accelerometer); **store computed features, not raw streams** (a
tremor epoch ≈ 1,200 samples → persist ~6 scalars; a battery, storage, sync, and
privacy win — raw traces can re-identify, scalars can't); **voice opt-in with
on-device extraction and immediate raw-audio discard** (default off / defer).

**Dashboard mapping + framing:** plot each test as a timestamped marker on the
day-ribbon (tap-speed line, tremor-amplitude line vs dose markers). Objective
signal is **flagged for the physician to interpret — never a UPDRS number, never
an ON/OFF verdict, never a diagnosis** (keeps the "never prescribes" posture;
CloudUPDRS-class tools reach only ~70–79% rater agreement — informs, doesn't
replace).

**Adherence is the binding risk, not feasibility.** Unsupervised completion
decays over weeks. Scope these as an *enrichment layer whose absence never
degrades the core diary*; success = "captured a few good OFF-state epochs around
dose times," not daily compliance. If check-ins ever feel nagging, make them
rarer, not louder.

**Data-model addition (later increment):** a fourth `PatientEvent` variant —
`SensorTestEvent { kind:'sensortest'; test:'tap'|'tremor'|'spiral'|'gait'|
'voice'; hand?; durationMs; effectiveHz?; features: Record<string,number>;
quality?:'ok'|'low'|'discarded'; appVersion?; device? (coarse model only) }`.
Features is an open scalar record (add features without migration; dashboard
reads known keys, ignores unknown); `appVersion` pins the extraction code so
old/new tests stay comparable; **no raw-stream field exists — that omission is
the privacy guarantee.** Flows through `SyncBundle`/`mergeEvents` unchanged.

Sensor sources: [mPower (Scientific Data 2016)](https://www.nature.com/articles/sdata201611) ·
[Lee 2016 tapping (DOI 10.1371/journal.pone.0158852)](https://doi.org/10.1371/journal.pone.0158852) ·
[Barrantes 2017 tremor](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0183843) ·
[3D accel tremor vs MDS-UPDRS (PMC9104023)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9104023/) ·
[Su 2021 smartphone gait (PMC7935653)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7935653/) ·
[Parkinson@Home fluctuations (JMIR 2020)](https://www.jmir.org/2020/10/e19068) ·
[CloudUPDRS agreement (npj PD 2020)](https://www.nature.com/articles/s41531-020-00135-w) ·
[@capacitor/motion](https://capacitorjs.com/docs/apis/motion) ·
[Generic Sensor API](https://developer.chrome.com/docs/capabilities/web-apis/generic-sensor).

## 7. Sources

Patient UI: [Nunes 2016 PD smartphone UI guidelines (DOI 10.1007/s10209-015-0440-1)](https://doi.org/10.1007/s10209-015-0440-1) ·
[WCAG 2.5.5 Target Size 44px](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html) ·
[Living with Parkinson's app usability (PMC10338310)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10338310/) ·
[MCI in PD, Sensors 2021 (DOI 10.3390/s21051788)](https://doi.org/10.3390/s21051788) ·
[PD dysarthria & ASR limits (PMC9764905)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9764905/) ·
[Protein–levodopa interaction, npj Parkinson's 2023](https://www.nature.com/articles/s41531-023-00541-w) ·
[mPower, Scientific Data 2016](https://www.nature.com/articles/sdata201611).

Doctor UI: [Hauser home diary 2000](https://pubmed.ncbi.nlm.nih.gov/10803796/) ·
[Hauser 2004](https://pubmed.ncbi.nlm.nih.gov/15390057/) ·
[PD Home Diary validation, npj 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9163037/) ·
[WOQ-9/19 review (PMC5902048)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5902048/) ·
[Levodopa PK/PD, effect-site & ON threshold (PubMed 18690870)](https://pubmed.ncbi.nlm.nih.gov/18690870/) ·
[LID therapeutic window (PMC10342913)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10342913/) ·
[Physician-in-the-loop CDS (Frontiers 2021)](https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2021.690576/full).

Drugs: [Tomlinson 2010 LED review](https://pubmed.ncbi.nlm.nih.gov/21069833/) ·
[Schade 2020 LED update (opicapone/safinamide)](https://movementdisorders.onlinelibrary.wiley.com/doi/10.1002/mdc3.12921) ·
[Jost 2023 MDS LED update](https://movementdisorders.onlinelibrary.wiley.com/doi/10.1002/mds.29410) ·
[Comtan (entacapone) FDA label](https://www.accessdata.fda.gov/drugsatfda_docs/label/2016/020796s026lbl.pdf) ·
[Neupro (rotigotine) SmPC](https://www.medicines.org.uk/emc/product/8082/smpc) ·
[Opicapone PK & levodopa effect (PMC10010692)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10010692/) ·
[Xadago (safinamide) PI](https://www.xadago.com/XADAGO_FullPI.pdf) ·
[Madopar dispersible faster onset (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S1353802098000364) ·
[Baclofen StatPearls (NCBI)](https://www.ncbi.nlm.nih.gov/books/NBK526037/).
