# Medication-response build plan

## Product boundary

Companion collects a 14- or 28-day, dose-linked record of symptoms and objective
measurements. It presents the doctor with explainable evidence and constrained
treatment options. It does not change medication autonomously.

Every recommendation must identify its inputs, missing data, confidence,
applicable clinical constraints, expected benefit, and important risks. The
doctor remains the decision maker.

## Medication lookup boundary

Medication lookup is offline-first. It combines the curated catalog with
custom name/formulation profiles saved on this device. Saved profiles contain
no patient, dose, frequency, or schedule data. Their immutable UUID identifies
only the medicine profile; regimen item UUIDs identify schedules and dose
matching.

Custom medicines have no inferred LEDD or PK/PD factor. Any LEDD shown beside
a regimen containing one is explicitly a partial catalog subtotal. A future
live provider integration may be evaluated against an authoritative medicines
source, but no external lookup, scraping, or fuzzy clinical identity merging
is part of this release.

## When-needed prescriptions

A when-needed prescription is a prescriber-authored instruction, represented
separately from scheduled and free-text regimens. It requires a positive dose
and a stated indication; optional instructions can state spacing, maximum
amount, or duration. The software supplies no defaults and does not decide
whether the condition is met or whether another dose is due.

When-needed items never appear as pending, overdue, or completed schedule
slots. Patient logging snapshots the prescribed indication and instructions
without asserting that the patient experienced the indication. Baseline LEDD
excludes these uncertain future doses; actual logged catalog doses remain
eligible for ordinary LEDD calculation.

## Finger-tapping setup entry

Patient setup requests store only an in-memory navigation intent, re-lock
doctor mode, and pass through the existing passcode gate. Successful unlock
opens the 14/28-day finger-tapping setup directly. Cancelling or returning to
patient mode clears the intent and re-locks access; no deep link or persisted
state bypasses the gate.

## Doctor workspace and medication-photo import

The proposed responsive Vercel doctor PWA, multi-patient ownership model, and
Gemini photo-to-reviewed-draft workflow are specified in
[the doctor PWA and import plan](DOCTOR_PWA_AND_IMPORT_PLAN.md). They require
tenant authentication, patient-scoped data access, provider retention review,
and cross-patient isolation tests before real patient data is processed.

## Release sequence

### 1. Observation foundation — implemented locally

The implementation and validation record is in the [observation handoff](OBSERVATION_HANDOFF.md).
Automated migration, persistence, replacement, completion and tapping tests pass;
physical-device acceptance remains pending. The larger safety, protocol, sensing
and decision-support stages below remain incomplete.

- Doctor starts a 14- or 28-day study.
- Starting a study freezes the current regimen as its analysis baseline.
- Only one study can be active for a patient.
- Patient mode shows collection progress.
- Assessment records are protocol- and feature-schema-versioned.
- Raw sensor streams are reserved for native encrypted storage.

Exit gate: automated migration, persistence, replacement and completion tests
pass; physical-device acceptance is pending.

### 2. Safety and privacy foundation

- Replace the publicly exposed Android signing identity.
- Encrypt clinical records with an Android Keystore-backed key.
- Define backup, export, deletion and recovery behavior.
- Add explicit consent for motion, audio and video.
- Replace the on-device GitHub PAT with a constrained reporting relay.
- Create an immutable audit record for regimen and recommendation changes.

Exit gate: threat-model review and tested data migration from existing installs.

### 3. Observation protocol

- Link each assessment to an actual dose event.
- Schedule pre-dose, expected-onset and expected-wearing-off windows.
- Rotate intensive assessment across doses to reduce patient burden.
- Record missed assessments and protocol deviations explicitly.
- Require at least 10 evaluable days and configurable completeness thresholds
  before generating recommendations.

Exit gate: a simulated 14/28-day study produces a complete, inspectable timeline.

### 4. Finger tapping

- Bilateral ten-second alternating-target test.
- Capture touch time, position, target and tested side.
- Derive rate, interval variability, errors, decrement and asymmetry.
- Add practice trials and device/screen metadata.
- Reject poor-quality sessions rather than imputing clinical results.

Exit gate: repeatability and manually verified synthetic-sequence tests.

### 5. Tremor

- Native Kotlin Capacitor plugin using SensorManager.
- Rest and postural protocols for each hand.
- Record actual sampling timestamps, accelerometer and gyroscope metadata.
- Derive spectral peak, band power, RMS, intermittency and artifact flags.
- Keep raw samples encrypted and delete them according to policy.

Exit gate: known-motion bench tests and within-session repeatability.

### 6. Dose-response analysis

- Combine actual dosing, meals, self-reported state, tapping and tremor.
- Estimate onset, peak response, wearing-off and dyskinesia with uncertainty.
- Preserve the underlying timeline beside every inference.
- Detect recurring coverage gaps without yet proposing treatment.

Exit gate: clinician review of labeled historical/simulated cases.

### 7. Gait, turning, sit-to-stand and voice

- Standardized phone placement and caregiver safety flow.
- Foreground-only recording and quality gates.
- Local audio feature extraction; delete recordings by default.
- Treat freezing and other uncertain events as review candidates.

Exit gate: manual-video comparison, device matrix, accessibility and safety review.

### 8. Doctor decision support

- Evidence quality and adherence summary.
- Current regimen versus actual behavior.
- Typical-day and per-day response timelines.
- Recurring pattern explanations.
- Up to three timing candidates within doctor-authored constraints.
- Accept, modify, reject or defer with an audit trail.

Exit gate: doctors can independently reproduce the basis of each suggestion.

### 9. Prospective schedule trials

- Version the doctor-approved regimen.
- Compare baseline and trial periods.
- Monitor OFF time, troublesome dyskinesia, adherence and adverse events.
- Support immediate rollback and defined stop conditions.

Exit gate: approved clinical protocol and usability validation.

### 10. Dose suggestions

Exact dose suggestions remain disabled until the sensing measures, response
model and recommendation workflow have analytical and clinical validation.
When enabled, they must remain inside doctor-authored drug, formulation, amount,
spacing and total-daily-dose constraints.

## Verification strategy

- Pure domain unit tests for schedules, features and recommendations.
- IndexedDB migration and persistence tests.
- Native sensor instrumentation tests on a representative device matrix.
- Golden raw-signal fixtures with independently calculated expected features.
- Property tests for optimizer safety constraints.
- Human-factors tests with patients and caregivers.
- Clinical association, analytical validation and clinical validation.
- Algorithm, protocol and feature-schema version stored with every result.
