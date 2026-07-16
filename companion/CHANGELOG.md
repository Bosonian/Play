# Companion — changelog

A de-identified, physician-in-the-loop Parkinson's dosing companion. Patients
log levodopa doses, motor state, and meals; the treating neurologist reviews the
patterns and adjusts the prescription. The app never prescribes.

## 0.9.1 — Remove Steady Read

The Steady Read gyroscope screen-stabilization tool (added in 0.3.0 as a
prototype) is removed — the implementation was too naive to be worth shipping.
Deleted `src/app/steady/` (the stabilizer core, its tests, the DeviceMotion
hook, and the screen) and the discreet header link that launched it; the header
is now just the Patient / Doctor toggle. No other feature touches it, so nothing
else changes. If a genuinely robust stabilizer is wanted later, the prior
prototype remains in git history as a starting point.

Also fixes a version drift this surfaced: `APP_VERSION` (used in field-report
metadata) had been left at 0.8.1 when 0.9.0 bumped package.json, so 0.9.0
reports would have mislabelled the app version. All three version references
(package.json, `version.ts`, the report test's pin) are back in sync at 0.9.1.

Test suite drops the 7 stabilizer unit tests (217 → 210); typecheck and web
build clean.

## 0.9.0 — Day-part tinted dose groups on Patient Home

"Today's doses" is now grouped under Morning / Midday / Evening / Night
headings, each with a soft tinted card background and a checklist ring
(hollow = pending, filled + check = taken) instead of a flat undifferentiated
list. Taken cards are now tappable too, opening the matched event's detail the
same way a Recent-activity row does. The bottom timeline is renamed "Recent
activity" and no longer repeats doses already shown as a tick above it — a new
`SlotStatus.eventId` (set by `markTakenSlots`, null when pending) lets the
screen derive exactly which events are "consumed" by the checklist and exclude
only those; rescue doses, orphaned scheduled doses, duplicate logs, and all
motor/meal events still show up. "Log another dose" is now a quiet underlined
link rather than a full card, matching "Report a problem"'s treatment.

Colour is a secondary cue throughout: the day-part header word, the ring shape,
and the "Taken · HH:MM" text each carry the same information the tint does, so
nothing here depends on colour perception. Four new `--tint-*`/`--tint-*-accent`
CSS custom-property pairs (light and dark) hold contrast at or above 7:1
(text/tint), 4.9:1 (muted text/tint), and 4.97:1 (accent/background,
accent/tint) in both themes — verified with a throwaway contrast script, not
just eyeballed. Pure `groupSlotsByDaypart` reuses `slotForTime`'s existing
day-part windows so the checklist grouping and the doctor-side BMP grid can
never define "morning" two different ways; its one non-obvious rule is that
the night group re-orders 21:00–23:59 ahead of 00:00–03:59 (a plain string
sort would otherwise put 00:30 before 22:00). No schema change, no new
dependencies, no gamification. 217 tests green (210 + 7 new); Chromium
verification (both themes, all four day-parts, dedup edge cases) is the
orchestrator's per the usual split.

## 0.8.1 — English UI labels throughout

The prescription grid's day-part labels, frequency presets, and patch text are
now English (Morning / Midday / Evening / Night; `1× morning`, `2×
(morning–evening)`, `At night`; `Patch, daily`; `Schedule`), replacing the
earlier German-language labels — the app's UI is English per its own default.
Internal identifiers and the BMP day-part order are unchanged; the input still
accepts a German decimal comma (`0,5`) even though the caption now shows `0.5`.
Copy-only; 210 tests green, all six grid modes re-driven in Chromium (19/19,
including an explicit no-German-words check).

## 0.8.0 — CPOE-style prescription entry (1-1-1-1 grid)

The doctor's medication entry is redesigned to work like standard hospital
prescribing (Epic/Orbis) and the German Medikationsplan. The underlying data
model was chosen by simulation, not assertion: eight normal + edge PD cases run
through two candidate models scored dose-per-time 32/32 vs 29/32 — it's the only
shape that holds an uneven levodopa schedule (125-125-62.5) as a single clean
line, the way the BMP prints it, without false-firing the duplicate-drug
warning. Built in two phases; both shipped here.

### The grid form (Phase B)

- **The 1-1-1-1 grid** — Morning / Midday / Evening / Night quantity
  boxes (the BMP's fixed day-part order, English labels), each a
  quantity × a per-tablet strength, with a per-slot clock time defaulting to
  08 / 12 / 18 / 22 and freely editable. Uneven schedules are entered the way
  you'd write them: `1-1-½-0`.
- **Fraction-aware input** — accepts `½`, `1½`, `¼`, `0,5` (German comma), `1/2`.
- **Strength quick-picks** and **frequency presets** (`1× morgens`, `2×`, `3×`,
  `4×`, `zur Nacht`) to fill the grid in one tap.
- **Live Sig preview** — a plain-language order sentence echoed back before you
  save (`Levodopa 100 mg — 1-1-½-0 — 08:00 · 12:00 · 18:00`), so a fat-fingered
  slot is caught by eye.
- **mg mode** for a drug with no tablet strength (and every migrated row): the
  slot holds milligrams directly.
- **Free-text mode** — the escape hatch for schedules the grid can't hold
  (tapers, alternating days), mutually exclusive with the grid per the BMP rule.
- **Patch mode** — rotigotine bypasses the tablet grid: a single application
  time and mg/24h rating, with a rotate-the-site note.
- **Custom-times fallback** — a schedule that doesn't fit the four day-parts
  (e.g. 6×/day) edits as a plain list of times, still one line.

### Dose-per-time model + migration (Phase A)

- **Dose-per-time model.** A `RegimenItem`'s `times` moves from `["08:00", …]`
  (one dose shared across all times) to `[{time, doseMg}, …]` — each
  administration carries its own dose. Uneven and fractional schedules are now
  one line per drug; LEDD reads each time's real dose; the patient's dose
  checklist and taken-matching are unchanged (dose was never part of the match
  key). Optional `strengthMg` (a UI round-trip convenience for the grid, never
  read by LEDD) and `freeText` (an escape hatch for tapers / patch-change
  instructions the grid can't hold — excluded from LEDD and the patient list,
  with a note saying so) are added.
- **Safe migration of real device data.** A guarded Dexie `version(4)` upgrade
  rewrites existing rows in place (`{doseMg, times:[…]}` → `{times:[{time,
  doseMg}…]}`, copying the dose to each time). It only touches rows still in the
  old shape and never throws — because a throwing upgrade aborts the version
  transaction and leaves the database unopenable. Proven by a v3→v4 migration
  test that seeds old-shape rows and asserts the migrated result.
- **New pure modules** (`quantity.ts`, `grid.ts`) that Phase B's form builds on:
  a German-quantity parser (`½`, `1½`, `0,5`, `1/2`), the grid↔model round-trip
  contract (with an explicit "doesn't fit the 4 slots" fallback for 6×/day
  schedules), frequency presets, and a plain-language **Sig line**
  (`Levodopa 125 mg — 1-1-½-0 — 08:00 · 12:00 · 18:00`) now shown in the
  regimen list and the activity log.

Suite is 210 tests (was 160): +50 across the reshaped domain, the v3→v4
migration, and the two new pure modules (`quantity.ts` fraction parser,
`grid.ts` round-trip contract). The grid form itself is pure UI over those
tested modules; it was verified by driving all six modes in Chromium (tablet
grid → Sig → LEDD, preset fill, mg-mode >20 dose, free-text, patch, and the
uneven-schedule edit round-trip), 17/17, plus the doctor→patient flow on the new
model, 7/7. Typecheck and web build clean; APK compile is CI-only.

## 0.7.0 — Activity log + field reporting

Two coupled systems so a user-reported problem comes with evidence: an
in-app report button that files structured GitHub issues, and a local activity
log that gives each report its context. Built and shipped in two phases under
one version — **Phase A: the activity log**, **Phase B: field reporting** — and
coupled by an opt-in, default-off "attach recent log" that snapshots the log at
filing time.

### Field reporting (Phase B)

- **Report a problem** from patient and doctor Home: free-text description, an
  optional photo attach (gallery or camera, 3 MB cap), and auto-captured
  metadata (app version, current screen, ISO timestamp). No typing beyond the
  description; no network at submit.
- **Offline-first, never lost.** Submitting writes a `pending` row to a local
  Dexie queue and returns immediately — it never blocks on, or even mentions,
  the network. A drain pass runs on every app open (and after each submit, and
  on a manual "Sync now"); it files each report as a GitHub issue and flips the
  row to `synced`. A failed attempt stays `failed` and is retried on the next
  drain. Idempotent by construction: only non-synced rows are attempted, a row
  flips to synced only on confirmed issue creation, a screenshot uploads once
  (checkpointed), and a module-level guard prevents concurrent drains — so no
  report is ever double-filed.
- **Zero backend.** Issues are filed to a configurable repo with a fixed label
  via the GitHub REST API; screenshots upload to a repo folder via the contents
  API and are linked (not inlined, so private-repo images resolve). The *only*
  file in the whole app that touches the network is `report/githubApi.ts`;
  everything above it — payload building, issue-body formatting, the queue state
  machine — is pure and unit-tested with the adapter mocked.
- **The token stays on-device and out of sight.** A fine-grained PAT is entered
  in doctor Settings (behind the passcode) and stored only in localStorage. It
  is write-only in the UI: never pre-filled, never rendered back — a configured
  token shows as "Access token · configured", nothing more. Honest limits stated
  in code and copy: this is UI-gating, not encryption; and a repo-write token on
  a *patient's* device is a documented distribution concern to revisit (narrower
  scope / a relay / per-device tokens) before any wider rollout.
- **Public-repo honesty, at the moment it matters.** If the configured repo is
  public, both Settings and the Report form say so plainly — "publicly visible,
  including screenshots and attached logs" — and the attach-log caption repeats
  it and tells the user to skim the log first.

### Activity log (Phase A)

- **The app's own account of what it did.** A local, capped `activityLog` table
  ({id, at, category, message}) recording one exact sentence per state
  transition — a dose/motor/meal logged, an undo, a regimen edit, app open,
  patient bootstrap. The module states THE RULE at its head and it's enforced
  at review: the log answers "what did the app *do*", never "what did the user
  *see*". No renders, no queries, no screen visits.
- **Logging can never break a feature.** `logEvent` is fire-and-forget,
  double-guarded (sync try/catch + promise catch), never thrown from, never
  awaited. A logging failure silently loses at most one line. Instrumentation
  lives at the write *handlers* (logMotor, logDose, saveItem, …), not the
  store's `addEvent` — because `addEvent` is intent-ambiguous (it serves
  first-log, undo, refine, and time-shift), so only the handler knows the true
  one-sentence intent. One known blind spot is closed deliberately: `logEvent`
  must never run inside a Dexie transaction (the log table isn't in scope and
  the write would be silently rejected), so the patient-bootstrap logs *after*
  its transaction commits — with a regression test pinning that a logging
  failure never aborts the real write.
- **Bounded, self-correcting.** Newest ~2000 rows kept; pruned in one cheap pass
  per app open (not per write), and the prune is itself logged only when it
  removed something.
- **Doctor-side viewer** (behind the passcode): reverse-chronological, local-day
  headers, monospace, plus "Share log" (last ~500 lines via the OS share sheet,
  clipboard fallback on desktop with a calm inline confirmation). This viewer
  and the Phase B report attachment are the *only* two paths by which log rows
  ever leave the device.
- **Clinical-honesty note carried forward:** log lines name drugs, doses, and
  motor states. Sharing or (Phase B) attaching a log to a public repository
  publishes de-identified clinical data — the copy will warn at every point it
  matters once reporting lands.

Schema moves to Dexie `version(3)` (additive, migration-tested v2→v3); it
declares *both* the `activityLog` and the (Phase-B) `fieldReports` tables now, so
the report system needs no further schema change. `APP_VERSION` is a
hand-maintained constant (bumped with package.json) — no compiler enforcement,
stated honestly.

Suite is 160 tests (was 123): +11 for the log (v2→v3 migration, `logEvent`
never-throws including inside a transaction, the 3000→2000 prune newest-kept,
log formatting/capture) and +26 for reporting (issue-body formatting with/without
the fenced log, the queue state machine — offline submit, retry-without-double-
filing, screenshot checkpoint, at-filing-time log capture — and config
save/load). Both flows driven in Chromium (activity log 11/11; report + settings
12/12, with the GitHub adapter mocked: offline queueing, public-repo warning,
token never in the DOM, sync-drains-to-filed, log records the filing without
leaking the token). The real GitHub round-trip is verifiable on-device only —
no PAT and no real network in CI. Typecheck and web build clean; APK compile is
CI-only as before.

## 0.6.0 — Patient dose logging against the regimen

The load-bearing patient-side loop closes: the regimen the doctor authored
(0.5.0) now drives an actual "Today's doses" checklist the patient taps
against. One tap logs a dose at the real moment it was taken; the slab flips
to a calm taken row. Dose events flow through the existing Today timeline,
Event Detail, and Undo unchanged — this increment adds the checklist and the
logging path, nothing about how a logged event is displayed or edited
elsewhere.

- **Taken vs pending is never stored — only computed.** A `DoseEvent` gains an
  optional `scheduledTime` ("HH:MM", same timezone-free semantics as
  `RegimenItem.times`) recorded at tap time, because the patient tapped the
  slot itself — intent is known, not inferred. Whether a slot shows as taken
  is a pure display-side match (`markTakenSlots` in the new
  `app/patient/doses.ts`) on drug + scheduledTime, greedy over the day's slots
  in order, each logged event consumed at most once. Dose strength is
  deliberately *not* part of the match key: if the doctor edits a slot's mg
  after the patient already logged it, a strength-inclusive key would flip the
  slot back to pending and invite a double dose.
- **Actual time is never overwritten by scheduled time.** `at` is always the
  real intake moment (`new Date().toISOString()` at the tap); `scheduledTime`
  is the plan. A taken row shows both — "Taken · 08:12" next to the scheduled
  08:00 — so the delta between plan and actual is visible, not silently
  discarded. Once-daily patch doses (rotigotine) show "Applied" instead of
  "Taken", driven off the catalog's formulation field, not a hardcoded drug id.
- **"Log another dose"** — a minimal picker for unscheduled/rescue doses: one
  slab per distinct (drug, mg) already in the regimen, tap = logged now with
  no scheduledTime, so it shows in the timeline but never ticks a slot.
  Honest limitation: a drug *not* in the regimen can't be logged this way in
  v1 — that would need typing/a drug picker, the exact core-loop anti-pattern
  `docs/RESEARCH.md` §1 rules out.
- **No regimen, no clutter.** An empty regimen renders one calm line ("No
  medications set up yet.") and hides the "Log another dose" row entirely,
  rather than an empty checklist with a dangling extra-dose button.
- **Zero changes to the timeline/detail/undo paths.** `eventLabel`'s dose
  branch now returns a real label ("Levodopa 100 mg") instead of the old
  defensive placeholder ("Dose"); dose events ride the existing Today
  timeline, Event Detail's ±5-minute time stepper and delete, and Undo exactly
  as motor/meal events already do — verified by reading those paths, not by
  touching them.

Suite is 123 tests (was 104): +17 new pure tests for `doses.ts` (schedule
expansion, greedy exact-key matching including the strength-edited-midday and
two-nearby-slots cases, the extra-dose picker's dedup) and +2 for `eventLabel`
covering a dose event. Typecheck and web build clean.

### Deliberately deferred (flagged, not silently dropped)
- **A doctor mid-day time edit orphans an already-logged tick.** If the doctor
  changes a slot's clock time after the patient logged against the old time,
  the event's `scheduledTime` no longer matches any current slot: the slot
  shows pending again and the logged dose reads as an "extra" in the timeline.
  This is the accepted flip side of not storing taken/pending — accurate to
  what's known (the regimen changed), not a data-loss bug, and consistent with
  how a strength edit is handled *without* losing the tick (mg isn't in the
  match key; time is, because time is the thing the slot IS).
- **No missed-dose analytics, streaks, or adherence scoring** — out of scope
  per `docs/RESEARCH.md` §1's anti-pattern list ("gamification / streaks / you
  missed a day guilt"), and per the increment's own NON-goals.

### Not verified in this environment
- The APK **compile** is CI-only (no Android SDK in the sandbox), as before.
- On-device *feel* of tapping a dose slab mid-OFF is only judgeable on the
  phone — the sandbox verifies the logic and the DOM flow, not touch
  ergonomics, same caveat as 0.4.0's motor/meal logging.

## 0.5.0 — Medication regimen: data model + doctor-mode editor

The doctor side gets its first real content: the neurologist authors the
patient's prescribed regimen on-device. This is the enabler for patient dose
logging (next increment) — you can't tap "took my 08:00 dose" until there's an
08:00 dose to tap. Single-device for now (doctor and patient modes share one
local store); cross-device sync is its own later increment.

- **A regimen data model** — `RegimenItem`: one drug at one strength taken at
  fixed local clock times (`"HH:MM"`, timezone-free on purpose — "08:00" means
  08:00 wherever the patient wakes). Uneven regimens (100-100-50) are just
  multiple items of the same drug. New Dexie table on a **schema v2 upgrade
  that is additive and migration-tested** — a real v1-only database is opened
  under v2 in the test suite and its existing data is proven to survive.
- **The doctor regimen editor** (replaces the placeholder) — view, add, edit,
  remove medications. Normal clinician form controls (dropdown, number, time
  inputs) — the no-typing/huge-target rules are the *patient's* constraint, not
  the doctor's. Remove is undo-not-confirm, consistent with the rest of the app.
- **Prescribing is by generic levodopa component, not tablet strength.** This is
  the load-bearing clinical decision: "Madopar 125" is entered as **100 mg**
  (the levodopa part) — the benserazide/carbidopa component is never entered and
  the DDCIs aren't even in the drug picker. Explicit helper text at the dose
  field states the conversion so it can't be got backwards on autopilot. This
  matches the dose model and the LEDD reference base exactly.
- **A live Total LEDD readout** — reuses the already-tested `computeLedd`
  unchanged (one type-only narrowing so it accepts `{drug, doseMg}`). The
  regimen is expanded into a prototypical day's doses — one entry per clock time
  — so the shipped once-per-day dedup for `fixed`/`fraction` factors (safinamide,
  entacapone, opicapone) stays clinically correct. Baclofen is excluded, and the
  readout says so. Labelled "a comparison number, not a target."
- **Non-blocking clinical warnings** — two COMT inhibitors together (entacapone +
  opicapone), or a once-daily drug listed at multiple times, surface as notices.
  They inform; they never block a save. The app never prescribes — the doctor
  decides. (This is the "later validation increment" `ledd.ts` itself pointed
  to.)

Verified here: doctor-mode flow driven in headless Chromium through the passcode
gate — set passcode, empty state, add levodopa (LEDD 400), add opicapone
(LEDD 600), COMT warning on entacapone, edit dose (LEDD recomputes to 1098),
remove + undo, and persistence across a reload — 20/20 checks. Suite is 104
tests (was 79): +21 pure regimen/LEDD unit tests, +4 store tests including the
v1→v2 migration proof. Typecheck and web build clean.

### Deliberately deferred (flagged, not silently dropped)
- **Free-text product label / German-market strength quick-picks** (e.g.
  "Madopar 125 tabl." as a display hint, or one-tap common strengths). Additive
  on top of the generic-mg entry; left out to keep this increment tight. Easy to
  add once the editor's been used in anger.
- **Regimen change-history.** This increment stores the *current* regimen only
  (each item carries `updatedAt`). A versioned adjustment log — for a
  "prescription changed on date X" annotation on the doctor's timeline — is
  deferred; once dose logging ships, the logged doses are the permanent record
  of what was actually taken, so analysis never depends on regimen history.

### Not verified in this environment
- The APK **compile** is CI-only (no Android SDK in the sandbox), as before.
- The COMT-inhibitor fraction LEDD still uses the whole day's levodopa base as
  its denominator (a documented approximation carried over from 0.2.0's
  `computeLedd` — per-dose co-administration tracking is a later increment).

## 0.4.0 — Patient logging loop: motor state + meals

The first screens that actually record something. On first run the app silently
bootstraps a single de-identified local patient (a generated `local-xxxxxxxx`
code — never a name, never anything identifying) and shows the patient's own
"Today". Dose logging and the medication regimen are the next increment; this
one is the motor-state and meal loop only.

- **How I feel now** — three big slabs (ON / OFF / ON with dyskinesia), OFF in
  the centre because that is when the tapping hand is at its worst. One tap logs
  the state with an automatic timestamp. Tapping "ON with dyskinesia" logs
  immediately and then offers an *optional, skippable* "Was it troublesome?"
  refinement — clinical richness for the doctor without ever blocking the
  patient (Skip and Back both just leave it as unspecified).
- **Log a meal** — Low / High protein, one tap. Protein timing matters for
  levodopa absorption, so this is deliberately its own first-class action.
- **A live "Today" timeline** — every log/undo/delete updates it instantly
  (Dexie's own `useLiveQuery`), newest first, empty state stated exactly
  ("Nothing logged yet today.").
- **Undo, never confirm** — a logged or deleted entry surfaces an Undo strip
  that *never auto-dismisses*; it persists until the next action replaces it or
  you tap Undo. This satisfies the "at least 8 seconds" rule with zero timer
  code. Undo is idempotent by construction (Dexie put/delete no-ops), so a
  stray double-tap can't corrupt it.
- **Event Detail** — the one place to change an entry's time (±5-minute stepper)
  or delete it. Time can be stepped freely into the past (a date line keeps a
  cross-midnight step legible) but **never into the future** — the shift is
  clamped to "now" at the write layer, so no symptom or meal can be recorded
  ahead of the clock. Delete has no confirm dialog and no swipe; it just deletes
  and offers Undo.
- **No typing, no confirms, big targets** throughout (heroes ≥120px, controls
  ≥76px/≈20mm, gaps ≥8mm), per `docs/RESEARCH.md` §1. Times display in local
  24-hour format; storage is always UTC ISO (so the timeline sorts by true
  instant and a travelling patient's evening events still land on the right
  local day).
- **Pure logic stays pure** — the event builders, the time-shift/clamp, the
  "today" range, and the label map live in `patient/log.ts` with no React and no
  Dexie, unit-tested in plain node. DB writes live only in the React layer.

Verified here: full flow driven in headless Chromium (bootstrap → log OFF → log
dyskinesia+troublesome → log meal → undo → detail → time-step → delete →
undo-delete → reload-persists), 18/18 checks. Suite is 79 tests (was 55).
Typecheck and web build clean.

### Known behaviour (recorded, not a bug)
- **The logging debounce is global, not per-button.** A single ~450ms guard
  (there to make a tremor double-strike count once) is shared across *all*
  logging actions, so two *deliberate* logging taps within 450ms of each other
  — e.g. tapping "ON with dyskinesia" and then "Yes" on the refinement almost
  instantly — will drop the second. It degrades gracefully (the state is still
  logged, just left unspecified), and for a bradykinetic patient deliberate taps
  are comfortably slower than 450ms, so this is acceptable for v1. If on-device
  use shows it swallowing real taps, the fix is a per-action guard — flagged for
  the next increment.

### Not verified in this environment
- The APK **compile** is CI-only (no Android SDK in the sandbox), as before.
- On-device *feel* of the tap targets and the debounce window is only judgeable
  on the phone; the sandbox verifies logic, layout, and the DOM flow, not touch
  ergonomics.

## 0.3.0 — Steady Read: gyro screen stabilization for tremor (prototype)

An accessibility experiment, reachable as a discreet tool (not part of the
clinical logging path). It counters hand tremor the way a camera's electronic
image stabilization works, pointed at the screen instead of the sensor: the
gyroscope measures the phone's rotation and the content is counter-shifted so
it appears to hold still while you read.

- **Pure, tested stabilizer core** — a leaky-integrator high-pass per axis:
  passes the fast 4–8 Hz tremor (so it can be cancelled) with a *bounded* DC
  response, so it neither drifts nor fights deliberate slow reorientation. Seven
  unit tests drive it with synthetic tremor and verify counter-phase, no-drift,
  overscan clamp, and axis separation.
- **On-device controls** — an always-visible On/Off toggle (a genuine safety
  control) and Strength / Zoom / Cutoff sliders to tune the feel per device.
- **Honest scope, stated in-app:** it steadies *only* what this app renders, not
  other apps or the system. It cancels *rotational* tremor only (a gyroscope
  can't recover pure translation without unbounded drift). It is a plausible
  aid, not a proven therapy.

### Not verified in this environment
- **The actual stabilization feel is untestable in the sandbox** — a headless
  browser can't drive a real gyroscope. The math, types, and build are verified
  here; whether the counter-shift feels right, and whether the **axis signs /
  mapping** are correct for the phone's orientation, can only be judged on the
  APK. Both are deliberately isolated (`AXIS_SIGN` and one line in the hook) so a
  flip is a one-character fix.
- **Latency** (the make-or-break for stabilization) is only measurable on-device.
- APK compile is CI-only, as before.

## 0.2.0 — Data model, drug catalog, LEDD, local persistence (no UI)

The data foundation for logging. No screens yet — this increment makes the app
*able to hold and reason about* a patient's regimen, unit-tested, so the UI in
the next increment just renders it. Informed by `docs/RESEARCH.md`.

- **Motor states:** the five validated Hauser categories are canonical (OFF, ON,
  ON+non-troublesome dyskinesia, ON+troublesome dyskinesia, Asleep), plus an
  `on-dyskinesia-unspecified` fallback. A `mapPatientTap()` helper turns the
  patient's three big buttons (+ optional dyskinesia refinement) into a canonical
  state — clinical richness for the doctor, a two-tap loop for the patient.
- **Drug catalog:** the nine drugs (levodopa, benserazide, carbidopa, rotigotine,
  Madopar LT, entacapone, safinamide, opicapone, baclofen), each carrying its
  class, formulation, **PK/PD engine-handling** decision (own-curve / fast-ka /
  modifies-levodopa-clearance per-dose or all-day / modifies-effect / parallel-
  agonist / ddci-baseline / log-only) and **LED factor** — straight from the
  cited drug research. Baclofen is log-only and hard-excluded from LEDD.
- **LEDD calculator:** total levodopa-equivalent daily dose, handling per-dose
  (reference, per-mg) and once-per-day (fixed, fraction-of-day's-levodopa)
  factors, with baclofen excluded.
- **Local persistence (Dexie):** patients / events / models / consent, with a
  compound-index date-range query. The domain layer stays free of Dexie and of
  the engine (verified) so it remains pure and portable.

### Not verified in this environment
- The APK **compile** is CI-only (no Android SDK in the sandbox). Web build,
  typecheck, and the full suite were verified locally.
- **Known limitation (recorded, not fixed):** event ordering uses lexicographic
  compare on the ISO `at` string; timestamps written under *different* timezone
  offsets (e.g. travel) wouldn't string-sort perfectly by instant. On a single
  device the offset is consistent, so this is a non-issue for v1; the doctor-side
  aggregation can re-sort by parsed instant if it ever matters.
- **At-rest encryption** of the local store is a deliberate later hardening, not
  implemented here (data is de-identified and on-device).

## 0.1.0 — App skeleton, two modes, doctor passcode, CI APK

The first installable shell. No patient data is logged yet — this increment puts
the *frame* in place so features have somewhere to land, and gets an APK building
in CI from day one so there's always something real to sideload.

- **Two modes in one app.** Patient (default) and Doctor, via a header toggle.
- **Doctor mode behind a local passcode.** PBKDF2-HMAC-SHA256 (210k iterations,
  16-byte random salt); only a salted hash is stored, in `localStorage`, never
  the passcode. First entry sets it; later entries verify it. Doctor mode
  re-locks on reload *and* when switching back to patient mode — the phone is
  the patient's, so unlocked access must not ride along. Honest limitation
  (in-code): this deters casual poking on an unlocked phone, it is not a
  security boundary against someone determined with the device; the real
  ceiling is passcode entropy.
- **Reuses the tested core** (de-identified data model + levodopa PK/PD engine);
  no duplication.
- **Builds to an Android APK in GitHub Actions** (debug artifact per push). iOS
  is intentionally deferred; the code stays portable.

### Deliberately NOT in this increment
No dose/motor/meal logging, no charts, no WebRTC sync, no iOS project, no
GitHub Pages deploy, no passcode recovery/lockout/biometrics.

### Not verified in this environment
The APK **compile** happens only in CI — this sandbox has Java + Gradle but no
Android SDK and can't download it, so the first CI run is the real test of the
Android build (SDK provisioning, Gradle/AGP versions). The web build, the full
passcode flow, and the 14-test suite were all verified locally in a browser.
