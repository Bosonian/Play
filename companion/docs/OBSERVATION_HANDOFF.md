# Observation study implementation handoff

> Historical observation-foundation checkpoint. Current application: 0.16.2 / build 21, tapping v4 with feedback. Read [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md) and [TAPPING_FEEDBACK.md](TAPPING_FEEDBACK.md) for current status. Historical build commands, test counts and release status below are not current release instructions. Outstanding device checks remain outstanding unless later evidence is recorded.

Status: implemented locally on `codex/observation-review`; release packaging and physical-device acceptance remain pending.

## Implemented in this increment

### Study lifecycle

- A doctor can start a 14- or 28-day study from the current regimen. The study stores a deep regimen snapshot and the device timezone at start.
- When no study exists, Patient mode shows a Finger tapping setup card. Its action opens the existing locked Doctor mode; first use asks the user to choose a passcode of at least six characters with no username, and later use asks for that device-local passcode with no default. After adding the prescribed regimen, the setup route is Doctor mode → Observation → start a 14- or 28-day period.
- Only a newly active study cancels another active study for the same patient. Writing completed or cancelled history does not change the current active study.
- Repeated start, complete, and cancel taps are guarded synchronously. Writes show disabled controls while busy and a visible retryable error on failure.
- Reaching the planned end date does not close the study. Collection continues until the doctor explicitly completes or cancels it.

### Bilateral finger tapping

- Each hand uses a monotonic `[0, 10000 ms)` acquisition window. A delayed timer callback still produces the nominal 10,000 ms measurement, and touches at or after the deadline are ignored.
- The expected target advances only after a successful alternating touch. Outside and repeated-target attempts remain counted but do not advance the accepted sequence.
- Backgrounding, `pagehide`, layout resize/orientation change, and multitouch during the window produce an explicit invalid interrupted outcome. Low or zero motor performance in a technically complete run remains a valid measurement.
- An explicit unable outcome is stored without feature values, keeping inability distinct from a completed run with zero successful taps.
- Both hand records share a session ID. Their stable assessment IDs and one IndexedDB transaction make save retries idempotent and prevent a half-saved bilateral session.
- If the right hand is interrupted or marked unable, the completed left result remains in the bilateral save. Stopping between hands records a distinct `user-stopped-before-hand` interruption before saving both.
- Saving and failed-save states are visible. A failed write retains the same two-record payload in memory and exposes Retry save while the screen and app process remain alive.
- Records use tapping measurement protocol version 2 and feature schema version 2. Each run stores side, viewport size, device pixel ratio, and display orientation metadata. No raw touch stream is persisted.

### Feature contract and persistence

- Version 2 features separate attempted and successful counts/rates, accepted-touch interval median/CV, alternation errors, outside touches, first/last-third successful rates, and signed temporal rate change.
- `rateChangePercent` describes rate over time. It is not labeled or treated as clinical movement-amplitude decrement.
- Invalid or out-of-window sample times are classified as timestamp defects; malformed coordinates/targets retain the general invalid-sample classification.
- The additive Dexie v4-to-v5 path is covered by a seeded migration test that preserves patients, events, patient models, consent, regimen, activity rows, and field reports while adding usable study and assessment tables. Legacy feature-schema version 1 records remain version 1.

## Automated acceptance

The focused tapping, acquisition, persistence, and migration suites pass 32/32. TypeScript passes. After the discovery follow-up, the final full suite passes 238/238 across 23 test files in 21.96 seconds with one worker and a 30-second runner timeout appropriate to this constrained proot environment. The test implementation and its assertions were not weakened. Astra review accepted the final domain, store, migration, and UI behavior with no blocking findings.

The final version-code-2 Android build and lint completed successfully in 44 seconds with zero lint errors and 16 existing dependency/template warnings. All three packaged public assets were byte-equal to the final web `dist` files. The APK uses the same signing certificate as the previous local build, certificate SHA-256 `c3b8e9dcc82357158ba815dbf6d5c6c021a1008c5c32337bc01cf9b93af85930`. The verified artifact is `/storage/emulated/0/Download/Companion-observation-setup-fix.apk` (4,175,747 bytes), SHA-256 `2ca4970671265ba71aeed839cb03c4a93674aa35027ef73f141dc9db5b98d4f4`; its copied bytes match the Gradle output.

Use the Linux Node runtime inside this Termux/proot environment so Rollup loads the Linux native package rather than the Android namespace-blocked binary:

```sh
cd /root/Play-companion/companion
PATH=/tmp/node-v22.14.0-linux-arm64/bin:$PATH npm ci --no-audit --no-fund
PATH=/tmp/node-v22.14.0-linux-arm64/bin:$PATH npm run typecheck
PATH=/tmp/node-v22.14.0-linux-arm64/bin:$PATH npm test -- --maxWorkers=1 --testTimeout=30000
PATH=/tmp/node-v22.14.0-linux-arm64/bin:$PATH npm run build
PATH=/tmp/node-v22.14.0-linux-arm64/bin:$PATH node node_modules/@capacitor/cli/bin/capacitor sync android
```

Run Android verification from `/root/Play-companion/companion/android` with native Java 21 and the Termux-compatible AAPT2 binary:

```sh
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64 \
ANDROID_HOME=/root/android-sdk \
./gradlew --no-daemon --max-workers=2 assembleDebug lintDebug \
  -Pandroid.aapt2FromMavenOverride=/data/data/com.termux/files/usr/bin/aapt2 \
  -PcompanionVersionName=0.11.0-observation-local \
  -PcompanionVersionCode=2
```

The npm package version remains `0.10.0`. The Android version name above is a local validation label, not a release version bump. The APK is debug-signed for local validation, has not been installed or released, and is not a compatible update for release-signed installations.

The source work is maintained on `codex/observation-review`, with commit `c85803e` as the comparison baseline. Use a separate checkout for review or rollback comparisons; do not reset or restore the active working tree. No device downgrade path from the additive v5 database schema has been validated or assumed.

## Deferred roadmap

- Link assessments to a confirmed, actual dose event and implement scheduled pre-dose/onset/wearing-off windows. Reason selection currently records context only and does not infer a dose link.
- Add practice trials, paired-hand asymmetry, touch-amplitude/decrement features, protocol adherence thresholds, and clinician-facing evidence review.
- Add tremor and later sensor protocols only with foreground acquisition, sampling-quality gates, minimal retained features, and explicit permission/privacy behavior.
- Add at-rest protection and retention/deletion policy before treating the local database as production clinical-study storage.
- Add a durable pending-session journal if save recovery must survive an operating-system process kill. The current retry payload is intentionally in memory only.
- Keep outputs descriptive for clinician interpretation; do not infer diagnosis, treatment changes, or a UPDRS score.

## Remaining device acceptance

- Install and launch the locally labeled APK on the target Android device.
- Exercise normal, zero-success, unable, interrupted-left, and interrupted-right bilateral paths.
- Verify background, app switch, rotation/resize, two-finger touch, and late-deadline behavior on device.
- Force or simulate an IndexedDB write failure and verify the same bilateral records save once after Retry.
- Check large text, screen-reader labels/status announcements, target sizing, scroll behavior, and both portrait and landscape layouts.
- Confirm upgrade behavior using a copy of representative pre-v5 device data before release packaging.
