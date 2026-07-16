# Companion — changelog

A de-identified, physician-in-the-loop Parkinson's dosing companion. Patients
log levodopa doses, motor state, and meals; the treating neurologist reviews the
patterns and adjusts the prescription. The app never prescribes.

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
