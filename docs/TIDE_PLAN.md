# TIDE — plan

Status: **planning** (Fable). Working name **Tide** (vetoable before first release). Sibling to Runway in this monorepo (`apps/tide`), `appId: de.bosonian.tide`.

Read alongside `CLAUDE.md` (the same binding contract governs Tide: calm/spare/exact copy, no emojis/exclamations/streaks/shame/gamification, 24h time, ISO dates, Monday-first weeks, defaults lean smaller, truth over reassurance, ask before Moderate/Major).

---

## 1. Who and why

Same user as Runway (Deepak — neurology resident, Stuttgart, ADHD patterns, erratic hospital schedule). Second domain of his life: **health**. 99 kg / 182 cm (BMI ≈ 29.9, top of overweight). NAFLD risk. No gym time or energy after erratic shifts; often skips meals at the hospital; eats mostly Indian home food.

Tide is NOT a medical device and NOT a diet prescriber. **The target (e.g. −7–10% body weight, the NAFLD-relevant lever) and the workup (LFTs, FibroScan) belong to Deepak and his physician.** Tide owns only the *behaviour between visits* — measured honestly, at near-zero friction.

## 2. Philosophy (Runway DNA, ported)

- **Measure the outcome, don't estimate the input.** The de-noised **weight trend** is the north star — a calorie-balance meter that can't lie the way a food log can. Same EMA-smoothing idea as Runway's slip median: watch the line, ignore daily water-weight noise. Body-fat % (BIA) treated identically — trend-reliable, absolute-noisy.
- **Not a calorie counter.** A deficit is required (physics); *counting* is not (a weak, high-friction, systematically-under-reported instrument, abandoned fastest by exactly this user). Tide creates deficit awareness without the counting burden.
- **The ideal division of labour.** Machines measure what the body did (scale → weight/body-fat; watch → steps/heart-rate/active-energy, all passive via Health Connect). The human supplies the one irreducible subjective input — *what went in* — as a 3-tap plate check-in, never a gram log.
- **No shame.** No red "you failed", no streaks, no guilt ledger. A skipped meal is logged as an honest event (skip→binge is a real pattern), never a "0-calorie win".
- **A day-sized shape.** Not "lose 10 kg" (paralysis) but "3 honest check-ins + a 15-min walk today" (doable) — the anti-inertia headline that worked for Prüfung.
- **Ambient, local-first, no accounts, no keys.** On-device Dexie; Health Connect is on-device and permissioned. Same signed-APK, self-update, activity-log, backup machinery as Runway.

## 3. Architecture

Separate installable APK, same foundation as Runway — reuse verbatim where possible: Capacitor 7 + React 18 + TS strict + Vite + Tailwind + Dexie, the design system/tokens, the CI signed-APK workflow pattern, the activity log, backup/restore, and the self-update checker. Its own Dexie DB, its own `appId`.

**Health Connect is the single integration point** for all passive hardware:
- **Renpho scale** → Samsung Health → Health Connect → weight + body-fat %.
- **Galaxy Watch** → Samsung Health → Health Connect → steps, heart rate, active energy.
- Google Fit API is being wound down in favour of Health Connect — build on Health Connect, not Fit.
- A thin native Health Connect bridge (own Capacitor plugin, same pattern as Runway's Wi-Fi/Bluetooth plugins). Read-only, permissioned. One-time Samsung Health→Health Connect sync toggle by the user; the Renpho connected to Samsung Health once.

## 4. Data model (Dexie, first cut)

- `weighIns`: { id, at (ISO), weightKg, bodyFatPct?, source: 'healthconnect'|'manual' } — the trend's raw points.
- `meals` (plate check-ins): { id, at, kind (breakfast/lunch/dinner/snack/skipped), carbPortion (none/some/lot), protein (none/some/lot), veg (none/some/lot), fried (bool), sugary (bool), photoRef?, estimatedKcal? (derived, secondary) }.
- `movement`: { id, date, source, steps?, activeKcal?, manualTier? (walk/stairs/home) } — mostly auto from Health Connect.
- `settings`: key-value (targets, Health Connect enabled, units, daily-shape config), same shape as Runway.
- Carried over later: `events` (activity log), backup uses same buildBackup pattern.

Pure trend math (`lib/trend.ts`): EMA / robust smoothing over weighIns → the displayed trend line + slope (kg/week), with a minimum-points floor before it speaks (Runway evidence-floor discipline). This is the heart; build and test it first, dependency-free.

## 5. The signals (what the app shows)

1. **Weight trend** — smoothed line + "trend: −0.4 kg/week over N weighings" (evidence-floored). North star.
2. **Body-fat trend** — same treatment, secondary.
3. **Today's plate check-ins** — the day's meals as composition chips; skipped shown honestly.
4. **Movement** — passive steps/active-energy from the watch + optional manual tier.
5. **Daily shape** — the day-sized target headline (configurable), emerald when met, nothing-shaming when not.
6. **Soft energy picture (secondary, de-emphasised)** — out (watch, measured) vs in (plate estimate from Indian composition data). The weight trend overrules both.

## 6. Indian food data

Home food: portion-level estimates from the open **Indian Nutrient Databank (INDB)** / **ICMR-NIN Indian Food Composition Tables 2017** (authoritative, India-specific, open) — a curated portion table (roti, dal, rice, sabzi, curd, common dishes) mapping a 3-tap plate to a rough kcal/macros estimate. No per-gram logging. Packaged food (occasional): Open Food Facts India API (free, no key) barcode lookup — later increment.

## 7. Increment roadmap (each through the fable–sonnet–fable loop)

1. **Scaffold + trend math** — `apps/tide` shell (stack + design system reused), Dexie model, manual weigh-in entry, and the pure EMA trend engine with tests. Installable-nothing yet; the trend line is the first real thing.
2. **Capacitor + CI signed-APK** — mirror Runway's workflow so Deepak can hold it; self-update + activity log + backup ported.
3. **Health Connect bridge** — native plugin; read weight/body-fat/steps/active-energy; the passive-measurement unlock. UNVERIFIED-until-device, flagged.
4. **Plate check-ins** — the 3-tap flow + INDB portion table → derived estimate (secondary).
5. **Daily shape + home + widget** — the anti-inertia headline, ambient surfaces.
6. **Polish + backup/update/log parity + review round.**

## 8. Non-goals (v1)

- No calorie *counting* UI (gram logging). No social features. No coaching/AI meal plans. No medical diagnosis or targets set by the app. No cross-app dependency on Runway (a schedule→skipped-meal prediction is a *later* synergy idea, not v1). No cloud, no account, no paid API.

## 9. Honest risks named up front

- Health Connect delivery/permissions vary by device and Samsung Health version — real native work, verified only on the S25.
- BIA body-fat is noisy in absolute terms; trend-only framing is mandatory, not optional.
- The plate→kcal estimate is deliberately rough; it must never be presented as precise, and the weight trend must always visibly outrank it.

## 10. Body composition — decided: take nothing more (2026-07-24)

The Renpho reports many figures (visceral/subcutaneous fat, muscle mass, body water, bone mass, protein, BMR, metabolic age). Tide deliberately stores **only weight and body-fat %**. Decision, after the first real weigh-in raised the question:

- **No further Health Connect record types.** Health Connect has no type at all for visceral/subcutaneous fat, protein or metabolic age. The types that do exist (LeanBodyMass, BoneMass, BodyWaterMass, BasalMetabolicRate) are algebraic transforms of the *same single impedance reading* Tide already receives as `bodyFatPct` — zero independent information, bought with new native Kotlin (unverifiable off-device; three consecutive on-device regressions on this surface), a new permission prompt, and more Samsung setup.
- **No BMI line.** Height is constant, so BMI is the weight trend rescaled — no new dynamic information. If the NAFLD-relevant −7–10% target ever wants a marker, it belongs on the existing weight trend denominated in kg, not as a second line.
- **No lean-mass line, ever.** `lean = weight × (1 − bf%)` is free to compute, but at ~99 kg one percentage point of BIA error ≈ 1 kg, giving ~1.5–2 kg of noise per reading against a ~0.45 kg signal across the whole 21-day slope window — it would flip sign for months. Worse, it is **biased toward the shame axis**: early-deficit glycogen-water loss sits in the lean compartment and raises impedance, so BIA reads successful early dieting as muscle loss. §2 forbids shame, and trend framing cannot rescue a biased trend. The action it would prompt (adequate protein, some resistance work) is correct unconditionally, and the plate check-in already records protein per meal.

**Revisit gate — data, not vibes.** Consider ONE quiet **fat-mass** trend line (never lean mass) only if, after **≥8 weeks of syncing and ≥20 paired weight+body-fat readings**, the weight trend is down ≥2 kg while the body-fat trend is flat or rising — the single pattern the current display genuinely hides. If built: `emaSeries` over `weightKg × bodyFatPct/100` on paired readings (reusing `selectSlopeWindow`/`fitSlopeKgPerWeek`, as `bodyFatTrend` does), on **History, not Home** (Home's hierarchy stays untouched), behind its own stricter floor of ≥10 paired readings spanning ≥28 days. Copy: `Fat mass: −0.4 kg/week over 12 paired readings.` Fat-mass framing keeps the honest partition legible — lean change is the residual against the weight trend — without ever printing a muscle-loss alarm built on a hydration artifact.
