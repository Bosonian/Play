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
