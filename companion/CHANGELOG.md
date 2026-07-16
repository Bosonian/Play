# Companion — changelog

A de-identified, physician-in-the-loop Parkinson's dosing companion. Patients
log levodopa doses, motor state, and meals; the treating neurologist reviews the
patterns and adjusts the prescription. The app never prescribes.

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
