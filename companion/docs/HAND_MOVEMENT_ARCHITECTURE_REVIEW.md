# Experimental hand movement: architecture review for approval

Review date: 2026-09-05. Status: PROPOSAL ONLY; no camera implementation or camera dependencies added. Reviewed the working tree containing the completed 0.16.0 check-in/OCR increment. Astra orchestrated/reviewed; Sol performed the repository audit. This report covers the requested 15 items.

Recommendation: keep React/Capacitor, add an isolated Android acquisition module, and store immutable encrypted raw landmarks before adding exploratory analysis. Treat hand opening/closing as its own protocol, independent of touchscreen tapping. Approval is required before implementation.

## 1. Current framework and architecture

`package.json`, `src/app/App.tsx`, `capacitor.config.ts`, and Android Gradle files establish React 18, TypeScript, Vite 6, Tailwind, and Capacitor 7. Domain functions are independent of UI and persistence. Android uses Java, AGP 8.7.2, Java 21, compile/target SDK 35, minimum SDK 23; it is not a Kotlin/Compose app.

Navigation is React state: App selects patient/doctor mode, PatientRoot owns patient screens, DoctorHome owns doctor screens. DoctorGate is a local passcode gate. There is no router/service worker or deployed doctor PWA. MainActivity explicitly registers native plugins. Preserve these boundaries.

## 2. Existing motor and finger-tapping implementation

`src/domain/tapping.ts`, `tappingAcquisition.ts`, and `src/app/screens/patient/FingerTapping.tsx` implement touch protocol v3 / feature schema v2: fixed equal targets, self-paced alternation, either target first, one index finger, left then right, 10 seconds per hand. Monotonic deadlines, multiple-pointer/background/layout interruption handling, attempts/errors/intervals and descriptive temporal changes are separate from React rendering.

State is collected BEFORE this existing tapping test. `saveTappingCheckIn` atomically saves a linked MotorEvent and two AssessmentRecords, with stable retry IDs and reminder-occurrence uniqueness. Raw touch samples remain in memory; persisted records contain aggregates. Historical changing-colour protocol v2 remains distinguishable. Neither protocol is a validated clinical score.

The proposed camera protocol asks state AFTER movement, as requested; it must not reuse the bilateral pre-test save helper or label its results as touchscreen tapping.

## 3. Existing persistence and models

`src/app/db/store.ts` uses Dexie/IndexedDB schema v7. Tables cover patients, events, models, consent, regimen, activity, reports, studies, assessments, custom medicines and OCR import receipts. Existing migrations are additive and older schema declarations must remain unchanged.

`src/domain/observation.ts` defines 14/28-day studies with regimen snapshot and reminders. AssessmentRecord has scalar metadata/features, technical quality and outcome, with optional session/dose/state links. It cannot faithfully hold a raw frame sequence. Patient identifiers are short pseudonymous codes, not cryptographically strong research identities. Medication and meal events already provide timeline IDs/timestamps.

## 4. Existing encryption and sync

Clinical IndexedDB data is explicitly NOT encrypted. The passcode verifier in localStorage protects the UI, not database contents. Only the OCR API key currently uses Android Keystore AES-GCM and private no-backup ciphertext. That implementation is a useful platform pattern, not an existing clinical-data vault.

SyncBundle/Outbox/mergeEvents in `src/domain/types.ts` are domain scaffolding, not an implemented transport. SyncBundle excludes studies/assessments. The GitHub report queue submits issue reports, not clinical data. There is no functioning patient-data export/sync or durable pending-acquisition journal. Camera data must never enter that report queue.

## 5. Camera dependencies and permissions

No CameraX, MediaPipe, Capacitor Camera, getUserMedia, camera permission, or camera lifecycle implementation exists. Current native permissions are INTERNET, POST_NOTIFICATIONS and RECEIVE_BOOT_COMPLETED. OCR receives a selected file; it does not supply a reusable live camera pipeline.

The manifest currently allows backup and its FileProvider has a broad external path. The new module must use private no-backup files and a separate narrowly scoped export provider; it must not place frames in that provider or shared storage. Camera permission is requested only when opening the optional test. Declare camera hardware optional so the rest of the app remains usable without it.

## 6. MediaPipe fit and version gates

Architecturally it fits: a thin Capacitor plugin can launch a non-exported native Activity with CameraX PreviewView, overlay and dedicated analysis executor. Return bounded session/status DTOs, not per-frame objects through the WebView bridge. Web/iOS initially report unsupported, with existing touch tapping available.

The inspected official sample declares CameraX 1.4.2 and `com.google.mediapipe:tasks-vision:1.0.0`; its model downloader names `hand_landmarker/float16/1/hand_landmarker.task`. These are proposed starting pins, NOT installed or compatibility-tested versions. Do not use the documentation's dynamic latest.release example. [Sample dependency file](https://github.com/google-ai-edge/mediapipe-samples/blob/7f3cf17410db91f8e084a46f7517df15bce3479a/examples/hand_landmarker/android/app/build.gradle), [model downloader](https://github.com/google-ai-edge/mediapipe-samples/blob/7f3cf17410db91f8e084a46f7517df15bce3479a/examples/hand_landmarker/android/app/download_tasks.gradle).

The sample minSdk is 24 versus this app's 23. Resolve the actual artifact manifest/transitive requirements before choosing whether an optional Android library boundary can retain SDK 23 or a minimum-SDK change needs review. Also verify ABI coverage, native library/page-size compatibility, APK size, CPU delegate throughput, Java API compatibility and release packaging. Maven artifact availability was not independently verified during this review. No model was downloaded; SHA-256 remains unset. Before integration, verify model redistribution terms, download the exact version once, hash it, and record library/model/hash/delegate/build in every session. No silent model updates.

## 7. Proposed components and changes

Proposed new native package `app.dosing.companion.handmovement`: HandMovementPlugin, HandMovementActivity, HandCaptureController, CanonicalCoordinates, RawSessionCodec, EncryptedHandSessionStore, HandQualityAssessor, HandOpennessMetric, HandCycleDetector and HandKinematicsAnalyzer. Pure measurement/storage classes stay independent of camera and UI. Add a native developer-only replay/debug Activity and minimal layouts/resources. Keep implementation Java unless a concrete dependency requires otherwise.

Proposed TS files: `src/domain/handMovement.ts` for versioned DTOs; `src/app/handMovement/native.ts` for the platform interface; patient HandMovement screen for hand selection and post-test state; a separate doctor session summary. Native methods: status/permission, start/cancel, list pending results, finalize state/linkage, acknowledge indexed result, delete and explicitly authorized export. Bind each request to an opaque UUID and patient/study identity; reject mismatched callbacks.

Existing changes would be limited to MainActivity registration, manifest, explicit Gradle dependencies, PatientRoot/ObservationStatus routing, doctor enablement, additive Dexie indexing, typed assessment references, tests and documentation. Add `hand-opening-closing` as a distinct kind. Do not change the current check-in reminder protocol into camera prompts silently.

Flow: select ONE side; front camera; detect exactly one hand and stable usable positioning; enable Start; 3-second countdown; collect up to 10 accepted closed-open-closed cycles or 20-second acquisition timeout; stop camera; ask ON / OFF / Dyskinesia / Unsure; save. Countdown is outside acquisition duration. Cancellation/background/rotation/camera loss produces a distinct interrupted result, not a resumed continuous test. Missing front camera gives an explicit supported alternative or unavailable state. No experimental measurements are shown to normal patients.

## 8. Proposed data model and durable storage

Use three independently versioned records:

- HandMovementSession: UUID; cryptographically random patient research UUID with separate local patient-code mapping; study UUID; test/protocol/schema versions; wall start/end; monotonic clock definition and start/end; selected side; detected-side distribution/summary and confidence; requested/accepted cycles; duration; completion/timeout/interruption outcome; processed/usable/dropped frame counts, effective FPS and usable percentage; device manufacturer/model, OS, app version/build; exact Tasks/model/hash/delegate; camera facing, sensor/input resolution, crop/rotation metadata; geometry/QC/cycle/analyzer versions and full configuration; raw object hash; post-test state plus capture time; existing medication/meal event references and study regimen snapshot reference. Record reference timestamps/revision or minimal snapshots so later edits/deletions do not silently rewrite measurement context.
- RawHandSequence: immutable header plus every analyzed-frame result, including empty/multiple-hand/error records. Each hand result contains all 21 normalized xyz and world xyz if returned, raw handedness label/confidence, and exposed presence/tracking/detection scores with explicit availability. An option threshold is not a returned confidence. Preserve both hands when two are detected; neither contributes valid cycles. Dropped/unsubmitted frames have timing/counter records, not fabricated landmarks.
- HandAnalysisRun: UUID; raw content hash; analyzer/geometry/QC/cycle version and config hash; timestamp; per-cycle records; descriptive features; quality assessment and provenance. Reanalysis appends a new run; it never overwrites raw data or an earlier run. Raw landmarks support new geometry, QC and feature algorithms; changing the landmark model itself requires source images, unavailable in normal mode.

Native storage owns an AES-GCM encrypted session envelope and raw binary in noBackupFilesDir, with independent key alias, random IVs and authenticated schema/session/chunk identity. No plaintext clinical manifest on disk. Dexie receives only a minimal opaque reference/index needed for navigation; sensitive metadata/state/features stay encrypted native. Existing plaintext clinical data is a separate known limitation, not solved by adding this vault.

Persist acquisition as an encrypted pending record, then durably attach the post-test state and links, then index idempotently in Dexie and acknowledge. There is no cross-store atomic transaction: recover pending records on restart, reconcile orphan indexes, and never say saved until durable finalization succeeds. A recovery draft is explicitly not a completed subjective report. Handle disk-full/key loss/authentication failure without deleting usable data silently. Uninstall/Keystore loss can make local ciphertext unrecoverable; an explicit encrypted research export is needed for portability.

## 9. Proposed landmark serialization and export

Use a documented little-endian binary format `PCHM` v1, avoiding a new serialization dependency initially. A compact length-prefixed UTF-8 metadata header is acceptable; each landmark is three float32 values, not a JSON object. Frame records have length/type/version, uint64 monotonic nanoseconds, uint64 relative nanoseconds, sequence number, quality flags, orientation-record reference, hand count and optional-field bitmap. Follow with bounded per-hand category/confidence and 21x3 float32 arrays for normalized/world coordinates. Missing measurements remain absent, never zero-filled. Store original finite model outputs without clipping or lossy quantization; reject malformed imported lengths/counts safely.

For 600 single-hand frames, both coordinate sets need about 302,400 bytes plus timestamps/flags/header before encryption. Bound duration/frame count/bytes, include authenticated integrity and a SHA-256 raw-content identity. A float32 sequence remains recoverable independent of the current UI/analyzer. Include an offline decoder specification and golden byte fixtures; nanoseconds cross JS only as strings, never unsafe Number integers.

Provide an explicit user-controlled encrypted export containing the raw binary, metadata and analysis runs. Export recipient/password key management must be specified and tested; a device Keystore ciphertext alone is not portable. No automatic upload or shared-storage traversal. Future sync needs a new clinical protocol and authorization; it is not included in the current app's sync scaffolding.

## 10. Canonical coordinates and handedness

Store model-input coordinates in a documented upright, unmirrored full analysis image: x increases right, y increases down, origin top-left; normalized z and world landmarks retain the model's coordinate semantics. Record input width/height and don't treat normalized x and y as equal physical units. For image-space Euclidean geometry, use `(x, y*height/width, z)`; world points are model estimates, not measured absolute anatomical distances.

Read sensor orientation, CameraX image rotation, crop rectangle and timestamps BEFORE closing the frame. Rotate once into upright inference input; do not reflect inference because the preview is mirrored. Store the exact sensor-to-input transform and input-to-preview crop/scale/reflection transform, plus a coordinate-convention version. Preview horizontal reflection affects rendering only. Do not copy the sample's front-camera inference flip into the scientific pipeline. [Inspected helper](https://github.com/google-ai-edge/mediapipe-samples/blob/7f3cf17410db91f8e084a46f7517df15bce3479a/examples/hand_landmarker/android/app/src/main/java/com/google/mediapipe/examples/handlandmarker/HandLandmarkerHelper.kt).

Store raw detected labels unchanged AND an anatomically interpreted label with an explicit tested convention if the pinned backend requires conversion. Never infer anatomical hand from left/right screen position. Selected hand is never silently corrected. Model handedness convention must be confirmed with labeled left/right fixtures and a physical front-camera test, including preview mirroring on/off and all rotations. A disagreement is recorded as a warning; unstable identity can invalidate that segment. Abort/restart acquisition on input-orientation change rather than joining different geometries.

Keep camera timestamp source/value and analysis-receipt elapsedRealtimeNanos separately; only equate their timebases when the device reports a compatible source. Derive elapsed acquisition from a documented monotonic source. Map strictly increasing inference milliseconds back to original higher-resolution timestamps; record/drop duplicates, do not invent intervals. Wall-clock changes must not affect duration.

## 11. Quality assessment and acquisition performance

Quality is separate from movement outcome/features: VALID, VALID_WITH_WARNINGS, INVALID with machine-readable reasons and versioned thresholds. Assess finite/full landmarks, exact hand count, boundary margin, identity consistency, tracked/usable proportion, gaps and effective FPS. Configure detection for at least TWO hands; maxHands=1 cannot establish exactly-one-hand quality.

Provisional engineering defaults for validation: start after 1 second stable tracking; warning below 90% usable, invalidate tracking below 70%; gap over 250 ms resets the candidate cycle, over 1 second adds interruption warning; warn below 15 effective FPS. These are unvalidated technical starting points, must be tuned with camera trials and stored per run. Do not use a slow cycle, small movement or low cycle count alone to label tracking failure. Completion below 10 is a protocol timeout/incomplete result; retain the well-tracked raw sequence and separately report protocol completeness. Surface tracking failure neutrally: “Hand tracking was interrupted. Please repeat the test.” A well-tracked timeout gets a different neutral message.

Use CameraX KEEP_ONLY_LATEST plus an explicit single in-flight inference owner. Copy only the necessary bounded pixel buffer off-main, close every ImageProxy exactly once in finally, and retain MPImage/backing buffer only until the matching callback/error completes. Count discarded frames. No unbounded executor/result queue; no frame/bitmap/Base64 bridge traffic; no blocking awaitTermination on the UI thread. Generation tokens discard late callbacks after cancel. Teardown unbinds camera, closes detector/images and shuts down executor asynchronously with bounded cleanup. Validate reusable-buffer lifetime rather than assuming copy semantics. [Camera sample inspected](https://github.com/google-ai-edge/mediapipe-samples/blob/7f3cf17410db91f8e084a46f7517df15bce3479a/examples/hand_landmarker/android/app/src/main/java/com/google/mediapipe/examples/handlandmarker/fragment/CameraFragment.kt).

Every analyzed frame is recorded even without a hand; usable percentage denominator is all analyzed acquisition frames. Report acquired/submitted/processed/dropped counts separately. Effective FPS is processed frames divided by acquisition duration, with null for zero duration. Preserve failures without interpreting them as motor performance.

## 12. Replaceable geometry, cycle detection, features and debug view

Pipeline: immutable raw sequence -> HandQualityAssessor -> HandOpennessMetric -> HandCycleDetector -> HandKinematicsAnalyzer(version) -> new HandAnalysisRun. Implement pure Java components so acquisition and offline native replay use the same implementation; no algorithm embedded in Activity/UI. Publish format/math so independent external analyzers can replay it.

Proposed experimental geometry `hand_openness_chord_ratio_v0`: for each index/middle/ring/little finger with MCP/PIP/DIP/tip points a,b,c,d, calculate `r=norm(d-a)/(norm(b-a)+norm(c-b)+norm(d-c))`; openness is the mean of four finite ratios. Prefer world landmarks; an aspect-corrected normalized-coordinate variant has its own identifier and never silently replaces world geometry. Zero/degenerate bone lengths are unusable. This is scale/rigid-transform independent, but insensitive to some MCP-only flexion and vulnerable to self-occlusion/model error. Document that limitation. Joint-angle extension and fingertip/palm alternatives remain separate interchangeable experimental metrics. Keep raw values regardless of V0 choice.

Cycle convention: a supported closed trough -> open peak -> next closed trough within one contiguous usable segment. A causal time-based smoothing stage operates on a copy; retain raw signal. Define bounded peak-confirmation lookahead and decision latency explicitly. Online and replay use identical causal processing and stop rules, so replay cannot use future samples to claim earlier completion. Version all smoothing, hysteresis, prominence, dwell and noise-estimation settings. A peak/trough must be supported by tracked samples; don't bridge missing frames or count an isolated spike. Pre-test open/fist practice can estimate the individual's signal range/noise; store those calibration landmarks and resolved thresholds separately from acquisition. Do not erase amplitude differences through per-session normalization of reported raw amplitudes. Resolved V0 numerical thresholds require synthetic and physical trial evidence before being frozen; they are not established scientific cutoffs.

Accept a cycle only after its closing trough; return start/peak/end times, sample indices, opening/closing duration, amplitude and quality. Stop exactly on the tenth accepted cycle, using the same detector online and in replay. Later raw callbacks may be recorded as post-stop diagnostics but cannot create an eleventh acquired cycle. Timeout keeps incomplete segments and rejected candidates with reasons, including well-tracked zero-cycle recordings. Accepted cycles are algorithmic detections, not clinically validated movement cycles. Accepted-cycle-only summaries can select the clearest movements and hide pauses or weak/ambiguous movements: retain whole-window summaries, rejected candidates and missingness alongside them. No hard maximum cycle duration should exclude slow movement before the overall timeout.

Define amplitude as peak minus mean(start/end trough openness); duration=end-start; opening/closing duration split at peak; mean velocity proxies are the corresponding openness change divided by positive duration. Aggregates: median durations/amplitudes, population SD and CV only with adequate data and positive mean; frequency=accepted cycles/total accepted-cycle time (also separately report count/acquisition duration); pauses are explicitly versioned signal-stability intervals, not a clinical label. For ten cycles, early/late compare means of first 3 versus last 3, report absolute difference and fractional change only with nonzero denominator; fewer than 6 gives null. Name changes `amplitude_change_v0`/`duration_change_v0`, never severity or bradykinesia scores.

Developer/research build only: live/replayed skeleton and quality, processed FPS, accepted count, openness-versus-time, peaks/troughs, individual accepted/rejected cycle spans, amplitude/duration per cycle and early/late trends. Normal patients see positioning, countdown, progress and neutral completion only. Doctor access alone does not silently enable research interpretation.

Tests before shipping: independent synthetic landmark fixtures for translation/scale/rotation/mirror invariance, openness limits/degeneracy, exactly 10 cycles/no 11th, noise/missing data/interruptions, timestamp duplicates/reordering/zero duration, early/late math, handedness mismatch, invalid recordings and all version/config metadata. Binary roundtrip/truncation/bounds/authentication tests and database migration/idempotent recovery tests do not use a camera. Device tests cover permission deny/grant/revoke, no/multiple hands, cancel/background/foreground/rotation, completion, process death/storage errors and image-resource accounting; physical trials measure thermal load/FPS/memory and labeled hand orientation. Existing 322 passing app tests establish regression evidence, not camera validity.

## 13. External references and licensing

- Google official MediaPipe samples: inspected HandLandmarkerHelper, CameraFragment, dependency/model downloader and LICENSE, only selected files; no repository cloned or code copied. Reference main revision recorded as `7f3cf17410db91f8e084a46f7517df15bce3479a`. License Apache-2.0. Any later adaptation must retain copyright/license, mark changes and preserve applicable NOTICE attribution in a new THIRD_PARTY_NOTICES.md plus bundled license texts. [Sample license](https://github.com/google-ai-edge/mediapipe-samples/blob/7f3cf17410db91f8e084a46f7517df15bce3479a/LICENSE).
- Official Hand Landmarker Android guide: inspected live-stream outputs/timestamps/confidence options. It returns normalized/world landmarks and handedness; confidence thresholds are configuration, not necessarily per-frame output fields. Only save exposed scores. [Android guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/android).
- VisionMD-Tutorial: inspected repository README/listing and GitHub repository metadata, reference `99f2ee9c317605d2daebf5feb17fbe10e8aadcfb`. GitHub reports license=null; no root license was visible. No permissive source-code license is established. Its high-level movement-feature discussion is a methods reference only. No source copied, ported, translated, vendored or used to derive implementation. Any future component reuse requires its exact license, compatibility explanation and your explicit approval. [Repository](https://github.com/mea-lab/VisionMD-Tutorial), [license metadata](https://api.github.com/repos/mea-lab/VisionMD-Tutorial).
- Parkinson Companion itself has no repository LICENSE/LICENCE/COPYING or package license declaration. Do not assume the project is open-source licensed. This does not remove obligations for later Apache components. Exact model distribution terms must be verified separately from sample-source licensing.

## 14. Privacy, security and regulatory concerns

Normal mode persists no camera images/video and uploads none. Landmark sequences with medication/state timelines are still sensitive health-related data; pseudonyms are not anonymization. Keep them out of issue reports/logging, exclude encrypted storage from Android backup, provide explicit export/delete behavior and handle lost keys. Existing app plaintext IndexedDB, backup configuration, casual doctor gate and report credentials are relevant limitations; this scoped module must not be presented as fixing them all.

MediaPipe states input processing is on-device, but also documents performance/utilization metrics sent to Google and user-consent responsibilities. Audit the exact pinned artifact's telemetry controls and network behavior before deployment; do not promise zero egress from the whole app, which already has INTERNET/OCR/update/report paths. This is a release privacy gate, not permission to upload landmarks. [MediaPipe privacy notice](https://github.com/google-ai-edge/mediapipe#privacy-notice).

Research video extension: define a capture-output interface whose normal implementation is NoVideoSink. A future separate research build may supply encrypted video storage only with explicit research configuration and recorded consent. No video recorder/storage path is enabled or upload implemented now; the native frame ownership model leaves room for an independently audited future sink.

No diagnosis, severity classification, OFF probability, medication advice/timing or validated score. Keep camera analysis disconnected from existing PK/PD logic. “Experimental” labeling alone does not determine regulatory status: intended purpose and use need separate assessment before clinical deployment. [EU software qualification/classification guidance, June 2025 revision](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=mdcg_2019_11_en.pdf). No classification conclusion is asserted here.

## 15. Conflicts, unresolved choices and proposed implementation order

| Specification need | Current gap / proposed resolution |
| --- | --- |
| Reprocessable raw data | Current assessments store scalars: add encrypted immutable native sequence + explicit index/export. |
| Exactly 10 valid cycles | Current tapping is timed: introduce separate open-close protocol and configurable detector. |
| State AFTER objective task | Current touch state is before: new camera flow and save contract. |
| Secure research identity | Short local patient codes: map to random research UUIDs without changing existing identities. |
| Exactly one hand | Configure at least two detections and preserve multiple-hand results as unusable. |
| Rich technical quality | Existing quality union is limited: separate versioned camera quality/outcome record. |
| Native dependencies | SDK 23 vs sample24, artifact/ABI/model/telemetry gates remain unverified. |
| Clinical sync/export | None implemented: explicit encrypted export; no promised dashboard synchronization. |
| Research consent/video | No consent workflow: default no-video interface; future research build needs separate approval. |

After architecture approval only: (1) resolve artifact/model/license/telemetry and SDK gates; (2) implement binary format, encrypted durable store and synthetic replay tests; (3) implement canonical camera acquisition and neutral quality/lifecycle tests; (4) add versioned geometry/cycles/analyzer and developer replay; (5) connect patient post-state flow and controlled export; (6) perform device validation, review, tests/build and report every changed file. Small coherent changes, no unrelated refactors. No camera work is implemented in this review.
