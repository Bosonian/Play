# Companion 0.16.0 delivery — local build 6

> Historical 0.16.0 / build-6 delivery record. Current application: 0.16.2 / build 21, tapping v4 with feedback. Read [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md) and [TAPPING_FEEDBACK.md](TAPPING_FEEDBACK.md) for current status. Historical build commands, test counts and release status below are not current release instructions. Outstanding device checks remain outstanding unless later evidence is recorded.

The finished increment adds fixed-target bilateral touch tapping, linked subjective
state, doctor-configured Android check-in reminders and optional reviewed medicine
OCR using the doctor's Google Cloud Vision EU project/API key. Gemini is not used.
The camera hand-opening module has only an architecture proposal, awaiting review.

## Build and validation

- Full app suite: 322 tests / 35 files passed.
- TypeScript and production Vite build passed, with VITE_APP_BUILD=6.
- Capacitor Android sync passed.
- Android testDebugUnitTest, lintDebug and assembleDebug succeeded. Native JVM
  results: 9 tests, no failures/errors; Gradle reused these unchanged test results.
- Android lint: no errors; 15 warnings for dependency versions and existing resources/icons.
- Astra code review approved; follow-up reminder performance checks: 9/9 passed.
- APK signature verification passed. Build is debug-signed and intended for local testing.
- npm dependency audit reported 6 issues (2 moderate, 4 high); no unrelated dependency
  upgrade was included. This is not a production security approval.

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

Application ID: `app.dosing.companion`; versionCode: `6`; versionName: `0.16.0`.

APK SHA-256: `0eb44e35b88a7937be094787b4ee1d468bc0d53200885ce7a7eda0b7992cf898`

Signing certificate SHA-256: `c3b8e9dcc82357158ba815dbf6d5c6c021a1008c5c32337bc01cf9b93af85930`.
This matches the prior local debug build. A release-signed installed app has a
different identity; no actual install/upgrade was performed during this validation.

APK size: 4239677 bytes. APK remains inside the project; no personal/shared storage was accessed for delivery.

## Still requiring device acceptance

Real Cloud Vision credentials/photo OCR, cold/warm reminder taps, blocked channels,
idle/reboot delivery and an upgrade preserving existing records are untested on the
installed app. Follow [CHECKIN_OCR_ACCEPTANCE.md](CHECKIN_OCR_ACCEPTANCE.md).
No camera code, clinical validation, remote doctor dashboard or clinical sync is
included. The separate [camera review](HAND_MOVEMENT_ARCHITECTURE_REVIEW.md) covers
all 15 requested architecture topics and stops before implementation.

## All added or modified project files

- `companion/CHANGELOG.md`
- `companion/android/app/src/main/AndroidManifest.xml`
- `companion/android/app/src/main/java/app/dosing/companion/MainActivity.java`
- `companion/android/app/src/main/java/app/dosing/companion/MedicineOcrPlugin.java`
- `companion/android/app/src/main/java/app/dosing/companion/MedicineOcrPolicy.java`
- `companion/android/app/src/main/java/app/dosing/companion/ObservationReminderManager.java`
- `companion/android/app/src/main/java/app/dosing/companion/ObservationReminderReceiver.java`
- `companion/android/app/src/main/java/app/dosing/companion/ObservationReminderRestoreReceiver.java`
- `companion/android/app/src/main/java/app/dosing/companion/ObservationReminderSchedule.java`
- `companion/android/app/src/main/java/app/dosing/companion/ObservationRemindersPlugin.java`
- `companion/android/app/src/main/res/drawable/ic_notification_companion.xml`
- `companion/android/app/src/test/java/app/dosing/companion/MedicineOcrPolicyTest.java`
- `companion/android/app/src/test/java/app/dosing/companion/ObservationReminderScheduleTest.java`
- `companion/capacitor.config.ts`
- `companion/docs/BUILD_PLAN.md`
- `companion/docs/CHECKIN_OCR_ACCEPTANCE.md`
- `companion/docs/CHECKIN_OCR_DELIVERY.md`
- `companion/docs/DOCTOR_PWA_AND_IMPORT_PLAN.md`
- `companion/docs/HAND_MOVEMENT_ARCHITECTURE_REVIEW.md`
- `companion/package-lock.json`
- `companion/package.json`
- `companion/src/app/db/observationStore.test.ts`
- `companion/src/app/db/store.test.ts`
- `companion/src/app/db/store.ts`
- `companion/src/app/lib/version.ts`
- `companion/src/app/medicineOcr/imagePreflight.test.ts`
- `companion/src/app/medicineOcr/imagePreflight.ts`
- `companion/src/app/medicineOcr/native.test.ts`
- `companion/src/app/medicineOcr/native.ts`
- `companion/src/app/observationReminders/native.test.ts`
- `companion/src/app/observationReminders/native.ts`
- `companion/src/app/observationReminders/reconcile.test.ts`
- `companion/src/app/observationReminders/reconcile.ts`
- `companion/src/app/patient/log.test.ts`
- `companion/src/app/patient/log.ts`
- `companion/src/app/screens/DoctorHome.tsx`
- `companion/src/app/screens/doctor/MedicinePhotoImport.test.tsx`
- `companion/src/app/screens/doctor/MedicinePhotoImport.tsx`
- `companion/src/app/screens/doctor/ObservationPlan.tsx`
- `companion/src/app/screens/doctor/RegimenItemForm.tsx`
- `companion/src/app/screens/doctor/medicinePhotoReview.test.ts`
- `companion/src/app/screens/doctor/medicinePhotoReview.ts`
- `companion/src/app/screens/patient/EventDetail.tsx`
- `companion/src/app/screens/patient/FingerTapping.tsx`
- `companion/src/app/screens/patient/PatientRoot.tsx`
- `companion/src/app/screens/patient/State.tsx`
- `companion/src/app/screens/patient/StatePicker.tsx`
- `companion/src/domain/medicineImport.test.ts`
- `companion/src/domain/medicineImport.ts`
- `companion/src/domain/motor.test.ts`
- `companion/src/domain/motor.ts`
- `companion/src/domain/observation.ts`
- `companion/src/domain/observationReminders.test.ts`
- `companion/src/domain/observationReminders.ts`
- `companion/src/domain/tapping.test.ts`
- `companion/src/domain/tapping.ts`
- `companion/src/domain/tappingAcquisition.test.ts`
- `companion/src/domain/tappingAcquisition.ts`
- `companion/src/domain/types.ts`
