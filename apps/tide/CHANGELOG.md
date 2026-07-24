# Tide changelog

Versions map to `versionName` in `android/app/build.gradle`. Install always
via the `tide-latest.apk` asset at
https://github.com/Bosonian/Play/releases/tag/tide-latest — it carries
whichever version built last.

## 0.3.0

**The passive-measurement unlock — the Health Connect bridge.** TIDE_PLAN.md
§3: weight and body-fat from the Renpho scale, steps and active energy from
the Galaxy Watch, both via Samsung Health syncing into Android Health
Connect, read into Tide with zero manual entry once connected. This is the
**highest-UNVERIFIED increment yet, stated plainly**: nothing native in this
release has been built or run — this environment has no JDK/Android SDK, so
every Java/Kotlin/Gradle/manifest change below is **verified by reading
only**. CI's Gradle build (`tide-apk.yml`) proves the app *compiles*; it
proves nothing about whether Health Connect actually grants permissions or
returns real data. The real test is the S25 Ultra, after Samsung Health is
configured to sync into Health Connect and a Renpho scale is paired to it —
see "Health Connect setup" in README.md.

- **`HealthConnectPlugin.kt`** (new) — this app's first custom native
  plugin, and its first Kotlin file. **Java vs. Kotlin, and why:**
  `androidx.health.connect:connect-client`'s entire API
  (`HealthConnectClient.readRecords`, permission checks) is Kotlin
  suspend-function-based, with no published Java/Futures adapter — calling a
  suspend function from Java means hand-rolling a raw
  `kotlin.coroutines.Continuation`, exactly the kind of "harder to verify by
  reading, easier to get subtly wrong" tradeoff not worth taking for code
  that can't be compiled here. Kotlin was the honest choice; see the file's
  own header comment for the full reasoning, including its PERMISSION SHAPE
  section — Health Connect permissions are **not** ordinary Android runtime
  permissions and don't go through Capacitor's `@Permission`/
  `@PermissionCallback` machinery at all. They ride on
  `PermissionController.createRequestPermissionResultContract()`, a custom
  `ActivityResultContract` registered directly against
  `bridge.registerForActivityResult` inside `load()` (Capacitor's `Bridge`
  class exposes this as a generic method; the plugin doesn't need
  `@Permission`/`@PermissionCallback` annotations for it at all).
  - Six `@PluginMethod`s: `isAvailable` (maps `HealthConnectClient.getSdkStatus`
    to `'installed' | 'not_installed' | 'unsupported'`), `requestHealthConnectPermissions`
    (deliberately NOT named `requestPermissions` — see the file's own
    comment on why that name would risk colliding with `Plugin`'s own
    inherited generic permission method), `readWeight`/`readBodyFat`
    (`WeightRecord`/`BodyFatRecord`, raw records since `sinceMs`),
    `readSteps`/`readActiveEnergy` (`StepsRecord`/`ActiveCaloriesBurnedRecord`,
    aggregated to one row per LOCAL calendar day — done by reading raw
    records and bucketing them in Kotlin, not via
    `HealthConnectClient.aggregateGroupByPeriod`, a deliberate choice: the
    raw-read approach reuses the exact same `ReadRecordsRequest` shape the
    weight/body-fat methods already use, which this increment can actually
    verify by reading against a working reference; the aggregate API is a
    separate surface with no comparable anchor in an environment that can't
    compile either to find out which is right). Every method resolves an
    empty/false shape and never throws or rejects — missing permission,
    Health Connect absent, or any read failure all collapse to the same
    "nothing to report" result, same idiom as apps/runway's
    `WifiBridgePlugin.getCurrentSsid`.
  - `MainActivity.java` gains `registerPlugin(HealthConnectPlugin.class)`
    before `super.onCreate()` — this app's first custom plugin registration,
    same ordering rule apps/runway's own `MainActivity.java` documents at
    length for its five.
- **Gradle/manifest changes needed to build a Kotlin file at all** (this
  project was 100% Java until now):
  - `android/build.gradle`: `classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21'`
    (hardcoded, not sourced from `variables.gradle`'s `ext {}` — that block
    isn't applied yet when `buildscript {}` evaluates, same reason the AGP
    classpath line above it is hardcoded too).
  - `android/app/build.gradle`: `apply plugin: 'org.jetbrains.kotlin.android'`,
    a `kotlinOptions { jvmTarget = "21" }` block (has to match
    `capacitor.build.gradle`'s generated Java 21 `compileOptions` or the
    build fails on a JVM-target mismatch — **the single most likely spot to
    need adjusting if CI's build fails**), and two new dependencies:
    `androidx.health.connect:connect-client:1.1.0` (the library's first
    STABLE release, promoted from release-candidate in October 2025 — chosen
    over the newer `1.2.0-alpha` line specifically because this environment
    can't compile-verify either, so the conservative stable pin is the
    honest call) and `org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1`
    (core only, no `-android` artifact — every coroutine here runs on
    `Dispatchers.IO`, and `PluginCall.resolve()` is safe from any thread
    since Capacitor's own `MessageHandler` posts to the WebView internally,
    so there's no `Dispatchers.Main` needed anywhere in this plugin).
  - `android/variables.gradle`: **`minSdkVersion` bumped 23 → 26.**
    `connect-client` declares its own minSdk floor in its packaged manifest
    (Health Connect's documented general requirement is Android 8.0/API 26
    via the standalone app, Android 9/API 28 built-in); a lower `minSdk` in
    Tide's own manifest fails the manifest merge outright. **Real
    consequence, not a free change: this drops support for Android 7.x
    devices below API 26** — acceptable since Deepak's only device (S25
    Ultra) runs far above this floor, but stated plainly rather than
    treated as incidental. `compileSdk`/`targetSdk` needed **no** bump —
    already at 35, comfortably above what connect-client 1.1.0 needs.
  - `AndroidManifest.xml`: four read-only Health Connect permissions
    (`READ_WEIGHT`, `READ_BODY_FAT`, `READ_STEPS`,
    `READ_ACTIVE_CALORIES_BURNED` — no `WRITE_*` anywhere, Tide never writes
    back to Health Connect), a `<queries>` block declaring the Health
    Connect app package (`com.google.android.apps.healthdata`, required for
    package-visibility on API 30+), and a second `<intent-filter>` on
    `MainActivity` for `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` —
    Health Connect's own documented contract requiring some activity to
    answer this intent for its "how your data is used" link. Routed at
    MainActivity itself rather than a dedicated privacy-policy screen: Tide
    is sideloaded, single-user, with no policy page of its own to link to —
    landing on Home when tapped is an accepted, honest simplification.
- **`src/native/healthConnect.ts`** (new) — the web-safe TS wrapper, same
  one-choke-point/never-throws pattern as apps/runway's `wifi.ts`:
  `isHealthConnectAvailable`, `requestHealthPermissions`, `readWeight`,
  `readBodyFat`, `readSteps`, `readActiveEnergy`. All resolve empty/false on
  web or any native error.
- **`src/lib/healthSync.ts`** (new) — the Dexie-touching orchestrator,
  `syncHealthData()`. No-ops immediately (before any native call) unless
  Settings' "Connect health data" has been used once. Two cursor-based
  syncs: `syncWeighIns` merges new weight/body-fat records into
  `weighIns` (`source: 'healthconnect'`), `syncMovement` upserts
  steps/active-energy into `movement`, keyed by date (Dexie's own PK there,
  so re-syncing "today" repeatedly is correct, not a dedup bug — see the
  file's own comment on why the two syncs need genuinely different cursor
  semantics). `mergeBodyFat` attaches a body-fat reading to a weight record
  by NEAREST-within-`BODY_FAT_MATCH_WINDOW_MS` (2 minutes), not an exact
  `atMs` match — an exact match was this file's first cut, and was reverted
  during review as too brittle: a Renpho computes weight and body-fat from
  one stepping-on event, but Samsung Health can write the two Health
  Connect records a few seconds apart or round their timestamps
  differently, and on an exact-match requirement that silently leaves the
  body-fat trend empty forever. The window version is greedy-nearest
  (weight records processed in ascending `atMs`, each claiming the closest
  still-unclaimed body-fat record within the window) so two real,
  closely-timed weigh-ins can't cross-claim each other's reading, and the
  boundary is inclusive (`<=`, not `<`) at exactly 120,000ms — erring
  toward matching, not losing a real reading, is the same "generous, not
  brittle" reasoning the window exists for. Still a real, load-bearing,
  UNVERIFIED assumption (that Samsung Health pairs the two records within
  2 minutes at all), just a much less brittle version of it; a body-fat
  record with nothing nearby is dropped and logged
  (`unmatchedBodyFat`, itself now window-based: "no weight anywhere within
  the window", not "no weight at the exact instant"), not fabricated into
  a phantom weight-less row. First sync after connect reads Health Connect
  since epoch (cursor `0`) — an intentional backfill of existing Samsung
  Health history, also unverified at any real data volume.
  Pure functions (`newRecordsSinceCursor`, `mergeBodyFat`, `unmatchedBodyFat`,
  `mergeMovementDays`, `localDateKey`, `formatMovementLine`) are the only
  parts of this file with tests — the orchestrator itself has none, matching
  apps/runway's own `transitSync.ts` precedent (its pure `transit.ts` is
  tested; the Dexie orchestrator around it isn't).
- **`src/lib/healthSettings.ts`** (new) — the four settings keys:
  `healthConnectEnabled`, `healthWeighInSyncCursorMs`,
  `healthMovementSyncCursorMs`, `healthLastSyncAt`.
- **`db/types.ts`**: `EventCategory` gains `'health'`. No Dexie version bump
  — every field this increment needs (`weighIns.source`,
  `movement.source`/`steps`/`activeKcal`/`manualTier`) already existed from
  increment 1; this is the first real WRITER of `movement`, not a schema
  change.
- **`src/lib/trend.ts`**: generalized for body fat, DRY — extracted the EMA
  loop into an internal `emaSeries({at, value}[])` that both weight's
  existing `trendSeries` and a new `bodyFatSeries` call, and reused
  `selectSlopeWindow`/`fitSlopeKgPerWeek` verbatim (both were already
  unit-agnostic despite the "Kg" in one name — a leftover from when weight
  was the only caller). New exports: `BodyFatPoint`, `BodyFatTrend`,
  `bodyFatTrend()`, `formatBodyFatTrendLine()` — kept as separate typed
  functions from the weight ones (not a shared generic type) so Home never
  has to read a field called `smoothedKg` and remember it means a
  percentage this time. Every existing weight-trend test still passes
  unchanged — the refactor moved the math, it didn't change it.
- **Settings.tsx**: the Health Connect stub becomes real. Exact caption:
  *"Weight and body-fat from your scale, steps and active energy from your
  watch — read from Health Connect, on your device only. In Samsung Health,
  allow syncing to Health Connect, and connect your Renpho scale once."*
  "Connect health data" → `isHealthConnectAvailable` (not-installed/
  unsupported get their own calm inline message) → `requestHealthPermissions`
  → **any** granted scope (not necessarily all four) counts as connected,
  storing the enabled flag and running an initial `syncHealthData()`. Once
  connected: *"Connected. Last sync: {day, time}."* + "Sync now" +
  "Disconnect" (clears the app-side flag only — stated in a code comment and
  worth restating here: Android has no API for an app to revoke its own
  already-granted permission, so "Disconnect" means "Tide stops reading",
  not "access is gone").
- **Home.tsx**: a body-fat trend line (`bodyFatTrend`, absent — not a
  placeholder — until its own evidence floor is met) under the weight
  headline, and a quiet *"Steps today: {N} · active {kcal} kcal."* line from
  today's `movement` row when present (`null` in either field reads as "not
  yet", never a bare 0 — a missing reading isn't the same claim as "zero
  steps taken").
- **`main.tsx`**/**`App.tsx`**: `void syncHealthData()` wired into startup
  and the `visibilitychange` resume hook — TIDE_PLAN.md §3's exact scenario
  ("step off the scale, open Tide, see the new weight") now has a resume
  hook driving it, not just a cold-start one.
- **Tests**: 81 total, up from 47 — 25 `trend` (18 existing + 7 new
  body-fat), 27 `healthSync` (new, pure functions only — includes the
  window-boundary coverage for `mergeBodyFat`/`unmatchedBodyFat` above:
  exact-instant regression, 30s-off match, 5min-off non-match, the
  120,000ms boundary itself both inclusive and one millisecond past it,
  and the two-nearby-weigh-ins no-cross-match case), 20 `updateCheck`
  (unchanged), 9 `eventLog` (unchanged).
- `npm run typecheck && npm run test && npm run build` and
  `npx cap sync android` all pass from `apps/tide`. The Android/Kotlin/
  Gradle/Health-Connect side is **verified by reading only** — see this
  entry's opening paragraph. Nothing here has run on a device.
- `versionCode 3` / `versionName "0.3.0"`.

## 0.2.0
- **Tide is now an installable, signed APK — the first release Deepak installs by hand, every one after it announces itself.** Increment 1 was web-only (Vite dev server, no native shell). This increment mirrors apps/runway's own Capacitor + CI + self-update + activity-log machinery, adapted to Tide's own domains rather than copied wholesale.
  - **Capacitor + Android** (`capacitor.config.ts`, `android/`): `appId: 'de.bosonian.tide'`, `appName: 'Tide'`. The Android project was generated via `npx cap add android` against the same Capacitor 7.6.7 the repo's Runway app uses, then hand-adapted (versionName/versionCode, the signing block) rather than hand-typed from scratch — every gradle template file that doesn't need app-specific values (`variables.gradle`, root `build.gradle`, `gradle.properties`, the gradle wrapper) came out byte-identical to Runway's own, which is expected: both apps share the same Capacitor/Gradle/JDK toolchain versions.
  - **Permissions — deliberately minimal.** The manifest carries exactly one `<uses-permission>` beyond Capacitor's own template defaults: `android.permission.INTERNET`, needed for the self-update check below. No notification, alarm, calendar, Bluetooth, Wi-Fi, or health permission — Health Connect is increment 3 (TIDE_PLAN.md §7), and asking for it now, before there's a feature behind it, would be exactly the permission-ambush pattern CLAUDE.md/TIDE_PLAN.md warn against.
  - **`MainActivity.java`**: unchanged from Capacitor's own generated template (`public class MainActivity extends BridgeActivity {}`) — no custom native plugin exists yet to register. Contrast with Runway's own `MainActivity.java`, which registers five.
  - **Signing — a shared, committed keystore, a documented tradeoff.** `apps/tide/signing/runway.keystore` is a verbatim copy of `apps/runway/signing/runway.keystore` (same file, same alias `runway`, same passwords), referenced from `apps/tide/android/app/build.gradle`'s `signingConfigs.release` the same way Runway's own build.gradle references its copy. **Both apps now share one signing identity rather than each minting its own.** This was a deliberate reuse, not an oversight: generating a *second* keystore for Tide would need `keytool`, which this build environment cannot guarantee works reproducibly across sessions, and reusing an already-trusted, already-documented keystore identity was judged lower-risk than introducing a second one with its own rotation story. The keystore's certificate subject still says `CN=Runway` — cosmetic only; Android's signature check is the key material, not the certificate's subject fields. Same threat model as Runway's own README "Signing" section: this is a personal sideloaded app with one installed device, and the committed keystore's blast radius is bounded to "an attacker with physical access to Deepak's unlocked phone could sideload a malicious 'update'" — it exposes nothing remotely. **Recommended hardening, not done here (flagged, not silently skipped): move both apps' keystores off the committed-file pattern and onto GitHub Actions secrets.** That would remove the "anyone who can read this public repo can build a trusted-looking update" property entirely, at the cost of secret-management overhead this personal-app tradeoff was written to avoid. Worth reconsidering if either app is ever shared beyond Deepak's own device.
  - **`.github/workflows/tide-apk.yml`** (new): clones `runway-apk.yml`'s structure — its own `paths: apps/tide/**` trigger, its own `concurrency: tide-apk` group (a Tide push can never cancel or be cancelled by an in-flight Runway build), `timeout-minutes: 20`. The "Compute release metadata" step uses the same **anchored** greps Runway's workflow was fixed to use after its first stamped release (v0.42.0) grabbed a LOUD comment instead of the real field: `^[[:space:]]*versionName "` / `^[[:space:]]*versionCode [0-9]`, matched from the line start so a comment mentioning either token higher up in `build.gradle` can never be the match. Publishes/refreshes a `tide-latest` prerelease tagged release, asset `tide-latest.apk`, name stamped `Tide v{versionName} ({versionCode})` from the very first release — unlike Runway (which had pre-existing unstamped `runway-latest` releases to stay compatible with), Tide has no legacy release history, so there is no "can't recognize its own first update" caveat to carry here. `runway-apk.yml` itself is untouched.
  - **`src/lib/eventLog.ts`** (new, ported from Runway's own file): `logEvent` (fire-and-forget, never throws), `pruneEventLog` (newest-2000 kept, run once on startup), `recentEvents`, `formatEventLine`. `EventCategory` (`db/types.ts`) is `'lifecycle' | 'weighin' | 'update'` — deliberately smaller than Runway's ten-plus-variant union; grows as later increments (plate check-ins, movement, Health Connect) add real transitions worth tracing, not preemptively now. `db.ts` gains `events: 'id, at'` as an additive Dexie `version(2)` bump — every v1 table and row is untouched. Wired in: `main.tsx` startup (`pruneEventLog` + `"App started."`), `App.tsx`'s new `visibilitychange` hook (`"App resumed."` / `"App backgrounded."`, mirroring Runway's own App.tsx), `ErrorBoundary`'s `onError` prop (increment 1 left this as a `console.warn` placeholder with an explicit comment to swap it — done here), and `WeighInEntry`'s save path (`"Weigh-in logged: {kg} kg."`). 9 new tests (`formatEventLine` × 2, `logEvent` × 2, `pruneEventLog` × 3, `recentEvents` × 2) — `db` mocked, same precedent as Runway's own `eventLog.test.ts`, no real IndexedDB.
  - **`src/lib/updateCheck.ts`** (new, ported from Runway's own file): points at THIS repo's `tide-latest` release (`GET api.github.com/repos/Bosonian/Play/releases/tags/tide-latest`) and parses `Tide v{version} ({code})`. Same 6h throttle (`lastUpdateCheckAt` settings row, `force: true` for Settings' explicit "Check now"), same never-throws contract, same CapacitorHttp-native/fetch-web split for the CORS-bypass reason Runway's own file documents. Logged under its own `'update'` category (unlike Runway, which folded update-check logging into `'lifecycle'` because a whole new category for two log lines wasn't worth it at the time — Tide's `EventCategory` union is already small and purpose-built per domain, so `'update'` earns its own slot here). `src/screens/Home.tsx` gets the same update card Runway's own Home does (placed first, above everything — meta-app, not day content): *"Update available: v{X}."* / *"You have v{APP_VERSION}."*, **Download** (opens `tide-latest.apk`'s browser download URL) / **Not now** (session-only dismissal, module-level `Set<versionCode>`). `src/screens/Settings.tsx` gets the "Updates" section: version line + **Check for updates** with the three outcome strings (`Up to date.` / `Update available: v{X} — see Home.` / `Could not check. Try again later.`). 20 new tests (7 `parseReleaseName`, 3 `parseAvailableUpdate`, 10 `checkForUpdate`) — mirroring Runway's own coverage shape.
  - **Housekeeping**: `src/lib/appVersion.ts` → `APP_VERSION = '0.2.0'`, `APP_VERSION_CODE = 2`. `android/app/build.gradle` → `versionName "0.2.0"`, `versionCode 2`. Same LOUD three-values-move-together note as Runway's own `appVersion.ts` — nothing enforces the sync yet; a build-time injection remains a v1.5 candidate, not solved here.
  - **Known gap, flagged rather than fixed here**: Tide's Android launcher icon and splash screen are still Capacitor's stock generated template (a generic blue icon), not a Tide-specific motif the way Runway has its own converging-runway-lines icon. Once both apps are installed on the same phone, they'll be visually indistinguishable in the app drawer until this is addressed — a small, deliberate follow-up (see README.md's "Icon and splash" section), not built this increment because it wasn't in this increment's scope and custom SVG art risked scope creep against an already-large change.
  - 47 tests total, up from 18 (increment 1's trend-engine suite) — 9 `eventLog` + 20 `updateCheck` + 18 `trend` (unchanged).
  - `npm run typecheck && npm run test && npm run build` and `npx cap sync android` all pass from `apps/tide`. The Android/Gradle build itself is **verified by reading only** — this environment has no JDK/Android SDK to actually run `gradlew assembleRelease`; the next push to `apps/tide/` is the real test, via `tide-apk.yml`.
  - `versionCode 2` / `versionName "0.2.0"`.

## 0.1.0
- Scaffold + weight-trend engine. Web-only (Vite dev server, no native layer). See `apps/tide/README.md`'s "Increment 1 scope" for the full list.
