# Next session — experimental camera hand movement

Checkpoint: 2026-09-06, app source fef3d2d, published 0.16.2/build 21. This file records a plan, not implementation authorization.

## Resume in this order

1. Read `../README.md`, `PROJECT_HANDOVER.md` and the full `HAND_MOVEMENT_ARCHITECTURE_REVIEW.md`.
2. Verify repository, branch, current HEAD and worktree. Preserve unrelated/user changes. Check whether later commits or user messages supersede this checkpoint.
3. Give the user a concise summary: tapping feedback shipped; camera architecture reviewed; no camera code yet; main open gates are dependency/platform compatibility, exact model terms/hash, telemetry behavior and scientific acquisition contracts.
4. Present the architecture for review if the user has not yet reviewed it. Await explicit camera implementation approval. The latest request was to document the project for a future session; “ready for next build?” / “yes” initiated the review, not the implementation phase.
5. Once the user approves, record that fact and scope here. Continue authorized work autonomously in small Astra-plan → Sol-code → test → Astra-review loops; do not request the same approval repeatedly.

## Proposed patient flow

Choose ONE hand → front camera → live skeleton/positioning guide with one detected hand → stable technical-quality gate → Start → 3-second countdown → closed/open/closed acquisition until 10 accepted cycles or 20-second timeout → stop camera → report ON / OFF / Dyskinesia / Unsure → durable save.

Use the same selected hand throughout. Store patient-selected and detector-reported side/confidence separately. Preview mirroring must not alter stored coordinates. If tracking fails, use neutral repeat messaging; a well-tracked slow/incomplete test gets a distinct completion/timeout outcome. Never convert poor tracking into abnormal motor performance.

The existing touch test stays separate: bilateral, 10 seconds per hand, state BEFORE touch acquisition, protocol v4. Camera state is AFTER objective movement and must not reuse the bilateral touch-save contract.

## Scope proposed for the first camera release

- Preserve React/TypeScript/Capacitor; use a Java Android acquisition Activity/plugin behind a typed platform interface. Web initially reports unsupported and retains existing touch features.
- MediaPipe live-stream Hand Landmarker with CPU baseline, CameraX latest-frame backpressure and one in-flight inference owner. Store every returned analysis result, including no-hand/multiple-hand/error records, with explicit missingness and bounded resources.
- Immutable, recoverable raw normalized/world landmarks and metadata, encrypted in private no-backup storage; raw records are the reanalysis source. No bitmap/image/video in normal storage or uploads.
- Independently versioned coordinate convention, raw codec, QC, openness metric, cycle detector and analyzer. All resolved thresholds/configuration and model provenance accompany each session.
- Per-cycle records and descriptive exploratory features only; live/replay debug visualization restricted to developer/research builds. No interpretation shown to patients.
- Separate future research-video sink/configuration/consent boundary, default NoVideoSink; no research video recorder/upload now.
- Explicit portable encrypted export/decoder contract for offline raw analysis; no new cloud patient sync or dashboard in this increment.

## Implementation loops — only after approval

| Loop | Deliverable | Exit evidence |
| --- | --- | --- |
| 0: compatibility and provenance | Inspect pinned AAR/transitive requirements, ABIs/page-size support, model distribution terms/hash, telemetry controls, CPU behavior; resolve minSDK23 versus sample24 without unchecked manifest overrides | Exact version/license/provenance ledger; explicit resolution of any required SDK/product-scope change before shipping |
| 1: raw acquisition foundation | Typed DTOs, documented compact PCHM binary codec, UUID identity mapping, AES-GCM chunked journal, authenticated final manifest, crash recovery and minimal idempotent Dexie index | Synthetic binary roundtrip, bounds/truncation/tamper/key-loss/storage-failure tests; interrupted prefixes never become completed sessions |
| 2: camera and coordinates | Optional CAMERA permission, non-exported Activity, preview overlay, canonical transforms, frame ownership, lifecycle cancellation and quality preflight | Deterministic transform/hand tests plus device permission/no-hand/two-hand/cancel/background/rotation checks; no frame leaks or unbounded queues |
| 3: replayable measurement | Replaceable geometry, versioned causal cycle detector, per-cycle records, separate QC and exploratory analysis runs, developer signal/cycle plots | Synthetic exactly-10/no-11th, noise/gaps/order/zero-duration/scale/early-late tests; online and replay agree using the same causal rules |
| 4: patient save and export | One-hand flow and post-test state, durable completion/retry, medication/meal context references/snapshots, pending recovery, explicit encrypted portable export | No duplicate or wrong-patient writes, interruption recovery, independent decoder reproduces raw points/metadata without a camera |
| 5: device validation and release | Physical left/right fixtures, mirrored preview/rotation, timing/FPS/memory/thermal checks, experimental labeling, notices/version ledger, full regression and dual-signer release | Honest acceptance report; blockers resolved or feature remains unavailable; modified-file list and exact published artifacts |

Do not treat a successful build as completion of physical/scientific validation. Keep algorithm thresholds provisional until synthetic and physical evidence supports a frozen acquisition configuration.

## Technical decisions to carry forward

- Candidate pins from official sample revision `7f3cf17410db91f8e084a46f7517df15bce3479a`: CameraX 1.4.2; MediaPipe Tasks Vision 1.0.0. Maven POM publication confirmed; no integration performed. Model identifier `hand_landmarker/float16/1/hand_landmarker.task`; model not downloaded/hashed or redistribution terms confirmed yet.
- Canonical input upright/unmirrored, x right/y down; preserve model z/world semantics. Record sensor orientation, crop/resolution, rotation, sensor-to-input and input-to-preview transforms. Hand labels remain raw plus explicitly interpreted anatomical side; test all rotations and preview mirroring. A mismatch is a warning/anatomical-side-unverified, not silent correction.
- Time uses documented monotonic clock(s); retain camera timebase/source and receipt timing separately. Map inference milliseconds to original high-resolution timestamps. Do not synthesize intervals or pass uint64 nanoseconds as unsafe JavaScript numbers.
- Exact observable counts: analyzer-received, submitted, completed, app-dropped. CameraX may overwrite frames before callback; do not fabricate an exact upstream-drop count. Report result/submission coverage along with usable-result proportion and gaps.
- Pending journal is durable before capture. Bounded authenticated chunks plus final authenticated expected-count/hash manifest distinguish complete sessions from valid truncated prefixes. Preserve recoverable raw data after interrupted recording; no cross-store atomic transaction is assumed.
- Proposed `hand_openness_chord_ratio_v0`: aggregate four fingers' MCP-to-tip chord / summed finger-segment lengths using world coordinates. Scale/rigid-transform independent, but misses some MCP-only flexion and is vulnerable to occlusion; not a permanent clinical measure. Alternate geometry remains replaceable; raw landmarks are retained.
- Cycle convention closed trough → open peak → closed trough; no candidate spans a tracking gap/identity switch. Freeze calibration and numerical thresholds before countdown, record instructions/pose/progress cues. Retain rejected candidates and whole-window summaries so accepted-cycle selection does not hide weak movements/pauses.
- QC VALID / VALID_WITH_WARNINGS / INVALID is separate from protocol completeness and descriptive motor measures. A low cycle count alone is not evidence of tracking failure.
- Raw landmarks permit new geometric/feature algorithms, not rerunning a different landmark model without original images. Normal mode deliberately cannot supply those images.

## References and reuse boundary

Official MediaPipe samples: Apache-2.0; inspect/adapt only minimal relevant files with required notices. Tasks Vision POM also declares Apache-2.0. Review model terms separately. Google's MediaPipe privacy notice says inputs stay on-device but API performance/utilization metrics are sent; audit the pinned artifact before promising zero telemetry.

VisionMD-Tutorial at `99f2ee9c317605d2daebf5feb17fbe10e8aadcfb`: GitHub license metadata null; no root license found. It is a scientific/methods reference only. Do not copy, translate, port, vendor or derive source from it without the user's specified license report and separate explicit permission.

All source links, mathematical definitions, metadata fields, test cases and the requested 15 review items are in [HAND_MOVEMENT_ARCHITECTURE_REVIEW.md](HAND_MOVEMENT_ARCHITECTURE_REVIEW.md).

## Suggested opening message next time

“Build 21 contains the fixed-target tapping feedback. The camera design and project handover are saved; no camera implementation has started. We can review the proposal, then begin the dependency and raw-storage work once you approve it.”

Update this file when approval arrives or a loop is completed. Record what was actually tested, any failures, the current commit/build and the next concrete action.
