# Parkinson Companion — project handover

Updated 2026-09-06. Read this with [NEXT_SESSION_PLAN.md](NEXT_SESSION_PLAN.md). This is the current-state guide; earlier roadmaps contain planned functionality that is not shipped.

## Exact stopping point

- Repository `/root/Play-companion`, app `/root/Play-companion/companion`; GitHub `Bosonian/Play`.
- Working branch `codex/observation-review`; do not switch to the old `claude/pd-dosing-companion` build branch or deploy the root Head-in app.
- Last application commit `fef3d2df1633ebb0e94a94a3b1af8189a1dd6d80`: tapping colour/haptic feedback.
- Published app **0.16.2 / build 21**. A subsequent documentation-only commit does not change those APK bytes or imply a newer app release.
- Build 21 GitHub workflow [34039944542](https://github.com/Bosonian/Play/actions/runs/34039944542) completed successfully, including both signing variants and publication verification.
- User said the direct links were good, then agreed to start the camera architecture review. They then requested full documentation for the next session. They have NOT yet approved camera implementation.
- Only documentation is changed for this handover. No camera code, model, Gradle dependency, permission, migration or APK is added.

## Product capabilities and limits

| Area | Implemented now | Not established / not shipped |
| --- | --- | --- |
| Patient diary | Dose, subjective motor state and meal logging; recent events, edit/undo paths | Remote clinical synchronization |
| Patient home | “How I feel now” above the medicine list; scheduled items grouped to reduce clutter; when-needed prescriptions separate | A remote patient portal |
| Regimen | Doctor editing, built-in catalog, device-saved custom name/formulation profiles, scheduled and free-text directions | Live external medicine lookup or inferred equivalence for custom drugs |
| When-needed medicines | Doctor-authored dose, condition/indication and optional limits/instructions; separate patient logging | Automatic determination that a PRN dose is indicated or due |
| Doctor access | First use sets a local passcode of at least six characters; later use unlocks locally; no username/account | Multi-user authentication, password recovery, tenant isolation or a deployed multi-patient dashboard |
| Observation | 14/28-day study, frozen regimen snapshot, one active study per patient, patient progress, stored assessments | Validated clinical response assessment |
| Tapping | Left then right, 10 seconds each, same index finger, fixed alternating targets, pre-test subjective state, atomic linked save | Raw touch-series persistence, calibrated physical target geometry, validated bradykinesia score or objective ON/OFF classification |
| Feedback | Protocol v4: actual touched target changes colour for 100 ms; best-effort Android CLOCK_TICK | Confirmed physical vibration strength on this phone |
| Check-in reminders | Doctor sets 30/60/120/240-minute intervals or custom times, daily window/timezone; opens combined state+tapping flow | Exact delivery guarantees, camera-test reminders |
| Medicine photo import | Optional Android Google Cloud Vision EU OCR using doctor-provided project/API key, conservative draft, explicit field/photo review and atomic apply | Gemini, automatic prescribing, direct in-app camera capture, credentialed end-to-end device acceptance |
| Updates | Native installed signer/version check; same-signer newer APK offer; browser download + Android confirmation | Silent install, proven data-preserving upgrade on the user's actual installation |
| Reports | Opt-in configured GitHub issue reports and activity log | A clinical sync channel or a secure patient-data export |
| PK/PD and LEDD | Pure domain/engine functions and tests; catalog-backed calculations, custom medicines excluded from inferred factors | Camera-driven treatment advice or validated decision-support workflow |
| Camera/tremor/gait/voice | Architecture/roadmap only | Implemented sensor or camera acquisition |

Custom medicine profiles identify a product/formulation, not a patient or schedule. Regimen UUIDs identify prescriptions. PRN items do not become overdue scheduled slots; their possible future doses do not count as baseline scheduled LEDD. Any catalog subtotal is partial when custom medicines are present.

## Architecture and source map

React 18 + TypeScript, Vite 6, Tailwind, Capacitor 7. The Android shell is Java, AGP 8.7.2, Java 21, minSDK 23, compile/target 35. `package-lock.json` is the JavaScript dependency authority; native versions live in Gradle. No router or Companion service worker: React state controls navigation and Capacitor supplies the Android installation.

| Paths relative to companion/ | Responsibility |
| --- | --- |
| `src/app/App.tsx` | Patient/doctor mode and gate |
| `src/app/screens/patient/PatientRoot.tsx` | Patient navigation, reminder-open coordination, local patient binding |
| `src/app/screens/patient/Home.tsx`, `Dose.tsx`, `State.tsx`, `Meal.tsx`, `EventDetail.tsx` | Diary/regimen interaction |
| `src/app/screens/DoctorGate.tsx`, `src/app/lib/passcode.ts` | Local passcode creation/verification; not database encryption |
| `src/app/screens/DoctorHome.tsx`, `screens/doctor/RegimenItemForm.tsx` | Doctor navigation and prescriptions |
| `src/domain/drugs.ts`, `medicationLookup.ts`, `regimen.ts`, `ledd.ts` | Catalog/custom lookup, prescriptions, catalog calculations |
| `src/domain/types.ts`, `motor.ts`, `src/engine/pkpd.ts` | Core events, state mapping and separate model logic |
| `src/domain/observation.ts`, `src/app/screens/doctor/ObservationPlan.tsx` | Studies and check-in plan |
| `src/domain/tapping.ts`, `tappingAcquisition.ts`, `screens/patient/FingerTapping.tsx` | Pure touch analysis/acquisition and UI flow |
| `src/app/tappingFeedback/`, native `TapFeedbackPlugin.java` | Reactive feedback and bounded native haptics |
| `src/domain/observationReminders.ts`, `src/app/observationReminders/`, native `ObservationReminder*.java` | Deterministic schedule, native alarms, lifecycle/reboot recovery |
| `src/domain/medicineImport.ts`, `src/app/medicineOcr/`, `screens/doctor/MedicinePhotoImport.tsx`, `medicinePhotoReview.ts`, native `MedicineOcr*.java` | OCR transport, review and conservative import |
| `src/app/db/store.ts` | Dexie schemas, migrations, atomic persistence and retry guards |
| `src/app/lib/appUpdateIdentity.ts`, `updates.ts`, `components/UpdateBanner.tsx`, native `AppUpdateIdentityPlugin.java` | Installed identity and update selection |
| `src/app/report/`, `src/app/activity/` | Issue-report queue and activity log; never use for camera data |
| `android/app/src/main/java/app/dosing/companion/MainActivity.java` | Explicit native plugin registration |
| `android/app/src/main/AndroidManifest.xml`, `res/xml/file_paths.xml` | Permissions, activity/receiver/provider declarations |
| `scripts/release/companion_release.py`, repository `.github/workflows/companion-apk.yml` | Dual-signer APK publication |

`capacitor.config.ts` uses app ID `app.dosing.companion`, launcher label `Companion`, `webDir: dist`, and disables native bridge payload logging. `vite.config.ts` intentionally does not use the root project's `/Play/` base or PWA configuration.

## Persistence and security truth

Dexie database `pd-companion`, schema **7**. Tables: patients, events, patientModels, consent, regimenItems, activityLog, fieldReports, observationStudies, assessments, customMedications, medicationImportReceipts. Add a new schema version for new storage; do not edit shipped historical `.version(...).stores(...)` declarations.

`AssessmentRecord` stores scalar metadata/features and quality (`pending|valid|invalid`). It is not a raw-frame container. `saveTappingCheckIn` atomically saves one MotorEvent plus exactly two hand assessments, with stable session IDs and idempotent retry/occurrence checks. Raw touchscreen samples and failed-save retry payloads are currently in memory only; process death does not provide a durable retry recovery. Generic event edit/delete paths protect linked assessment state rather than silently breaking the linkage. State is captured BEFORE touch tapping; the planned camera task deliberately captures it AFTER acquisition.

Protocol references at this checkpoint: touch measurement 4; touch feature schema 2; touch feedback config 1; observation/study protocol 1; combined tapping check-in 1; reminder plan 1. Older records keep their own versions; do not silently pool different acquisition conditions.

Clinical IndexedDB is **not encrypted**. Short patient codes are pseudonyms, not anonymous research identities. Doctor passcode verification uses PBKDF2 in localStorage and is only a local UI gate; comments claiming no doctor data exists are historical. Do not infer database protection from the passcode.

The OCR API key alone uses native Android Keystore AES-GCM in private no-backup storage. Photo/OCR drafts live in memory; durable receipts contain reviewed prescription snapshots, provenance and image hash, not image bytes/full raw OCR. Camera acquisition will need its own encrypted storage contract.

`SyncBundle`, `Outbox` and `mergeEvents` are domain scaffolding, not an implemented patient transport; the bundle does not include observations. GitHub issue reports may be public. No working patient export/recovery service exists. Android currently allows backup and has broad external/cache FileProvider paths; the proposed raw vault must be private and excluded from these paths.

Both published APK channels are test signing identities. The repository contains a public test release key; this is unsuitable as a production trust boundary. Preserve update continuity; review a production signing/data migration strategy separately instead of replacing keys casually.

## Build, test and release operations

Run commands from `companion/`, not repository root. CI uses Node 22 and Java 21 on Linux. A normal development checkout uses:

```sh
npm ci
npm test
npm run typecheck
npm run build
npx cap sync android
python3 -m unittest scripts/release/test_companion_release.py
```

For Android, change to `companion/android` and use the chosen matching app version and allocated monotonically increasing build code:

```sh
./gradlew --no-daemon testReleaseUnitTest lintRelease assembleRelease   -PcompanionVersionCode=<allocated-code> -PcompanionVersionName=<app-version>
```

The angle-bracket values are placeholders, not literal shell arguments. Set `VITE_APP_BUILD` to the same allocated code when building the web bundle. Keep `package.json`, root package entries in `package-lock.json` and `src/app/lib/version.ts` version strings aligned. Without explicit properties Gradle falls back to code 1 / 0.0.0-local; the web build defaults to build 0. Do not distribute that accidentally. Some older source comments still say code equals github.run_number; the current publisher allocates above the published maximum.

This phone's Termux/proot environment previously worked with Java `/usr/lib/jvm/java-21-openjdk-arm64`, Android SDK `/root/android-sdk`, and aapt2 `/data/data/com.termux/files/usr/bin/aapt2`:

```sh
env JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64 ANDROID_HOME=/root/android-sdk   ./gradlew --no-daemon --max-workers=2 testReleaseUnitTest lintRelease assembleRelease   -Pandroid.aapt2FromMavenOverride=/data/data/com.termux/files/usr/bin/aapt2   -PcompanionVersionCode=<allocated-code> -PcompanionVersionName=<app-version>
```

Check available paths/tools when resuming. Termux Node and glibc Node need different Rollup optional native binaries; do not repeatedly reinstall dependencies or alter the lockfile to fix a local ABI mismatch. Sandbox commands sometimes return exit 182 without output. Use the supported approval/escalation path when required; never bypass it. Some agent write commands reported success without persisting files: verify writes with readback and Git diff. Root direct Python writes with absolute paths worked; this is a tooling observation, not permission to write outside authorized scope.

Maintained publication workflow: `.github/workflows/companion-apk.yml` triggers on Companion/workflow changes pushed to `codex/observation-review`, or manual dispatch. It serializes releases, tests, builds both non-debuggable variants at one code, verifies identities/hashes, publishes immutable `companion-build-N`, downloads/verifies public assets, then updates `companion-latest` metadata last. Do not run a competing manual publisher concurrently. A documentation-only commit can use `[skip ci]` to avoid creating a new APK merely for documentation.

Read [APP_UPDATES.md](APP_UPDATES.md) and the publisher help before any release. `next-code --repo Bosonian/Play --floor 19` currently would allocate above 21, but always query again rather than hardcode 22. Existing build tags/assets are immutable. The GitHub secret name `COMPANION_LEGACY_KEYSTORE_BASE64` supplies the legacy key; never print/decode it into logs or commit it. Local legacy key location `/root/.android/debug.keystore` is sensitive; preserve it without inspecting contents unnecessarily.

## Build 21 downloads and installation evidence

| Channel | URL | SHA-256 |
| --- | --- | --- |
| Release signer | https://github.com/Bosonian/Play/releases/download/companion-build-21/companion.apk | `dc81a499126444b21a00cb30948ea14a859962f5a0c6e9fa0991379c889c0e40` |
| Known local legacy signer | https://github.com/Bosonian/Play/releases/download/companion-build-21/companion-legacy.apk | `966dee656363421785d517a3b208308950c49f0983e8f72b08643df7f8708bf7` |

Both anonymous downloads returned HTTP 200 and matching hashes during this session. Release size: 3,307,001 bytes; legacy size: 3,306,940 bytes. Release certificate SHA-256: `f8ae5a2403c53b65fdf2ab471da67706bc58cfcb87cba3c9c04750ba15604c43`; known local legacy certificate: `c3b8e9dcc82357158ba815dbf6d5c6c021a1008c5c32337bc01cf9b93af85930`.

The user's requested screenshot showed only generic “App not installed” after a successful security scan. It did not reveal a cause. Installed package/signer queries were blocked by Android, and no successful upgrade preserving existing data has been observed. The user's later “good” confirmed the link discussion, not explicitly successful installation. A third older public `app-debug.apk` signer has no known matching private key here.

Do not infer the installed signer from a local APK or download filename. Do not guarantee either variant updates every existing installation. Do not uninstall/clear data to fix this: local medication/diary/results/settings may be lost and there is no confirmed patient backup. The newer in-app updater chooses only a matching signer; older clients can still download the wrong standard channel. Use direct APK links when the release page fails to initiate downloads.

No build-21 APK was copied into Android Downloads by this session. Prior shared-storage permissions were task-specific, not permission to browse personal data in future sessions.

## Verification evidence and remaining acceptance

For application commit fef3d2d: **340 Vitest tests / 38 files passed**, TypeScript and production bundle passed. Native haptic policy tests and Java compilation passed locally; GitHub completed full release tests, lint, assembly of both signers, publisher checks and verified publication. Astra approved the final feedback implementation. These are build/behavior checks, not clinical validation.

Reminder schedules are inexact, use the study timezone, avoid catch-up bursts and stop at the collection window end; an ended collection window need not change the study status from active automatically. They do not infer actual dose events or ON/OFF state.

Physical acceptance remains open for: haptic feel/settings, full bilateral tapping and interruption flow, upgrade with preserved records, cold/warm reminder opens and blocked channels/idle/reboot/timezone behavior, actual Cloud Vision credentials plus fabricated-list review. Instrumentation currently contains only the generated example, not a real camera/device acceptance suite. See [CHECKIN_OCR_ACCEPTANCE.md](CHECKIN_OCR_ACCEPTANCE.md) and [TAPPING_FEEDBACK.md](TAPPING_FEEDBACK.md).

Earlier build-6 npm audit reported 6 issues (2 moderate, 4 high). That is historical evidence, not a fresh audit of the current dependency set. Do not silently upgrade unrelated dependencies while implementing camera work.

## Next-session working agreement

Astra plans/orchestrates/reviews, Sol codes in coherent bounded tasks. Existing agent names this session were `astra_review`, `sol_code`, `sol_custom_core`; IDs may not survive a restart. Verify tool/model availability instead of pretending they persist. Follow the user's goal-oriented loop preference, with a clear objective, implementation, relevant verification, Astra review and a recorded checkpoint for each approved slice.

Camera boundaries: experimental raw-landmark acquisition first; no diagnosis, severity score, OFF probability, medication advice/timing or validated clinical claim. No normal-mode image/video persistence or upload. Do not derive code from VisionMD without its exact component license, compatibility report and explicit user approval. See the next-session plan for the approved/unapproved boundary.

There is also an existing Codex-to-Termux notification hook from an earlier separate task; the user confirmed its test arrived. This handover did not inspect or change Codex configuration. Do not rewrite it as part of app work.
