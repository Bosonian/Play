// Single source of truth for the version string stamped onto every field
// report (ReportProblem.tsx's save path) as `FieldReport.appVersion` — so a
// bug report carries proof of which build produced it, the same way a stack
// trace would.
//
// LOUD NOTE: this constant, `APP_VERSION_CODE` below, and `versionName` +
// `versionCode` in android/app/build.gradle are now THREE separate,
// hand-maintained values (two here, two there, but versionName/APP_VERSION
// are the same string counted once) that must move TOGETHER on every
// release. Update check increment (0.42.0): APP_VERSION_CODE is what
// src/lib/updateCheck.ts compares a GitHub release's stamped versionCode
// against, so a forgotten bump here doesn't just mislabel a field report
// anymore — it means the app can never notice its own next update (or,
// worse, advertises an "update" that's actually the build already
// running). Nothing enforces the three moving together today — a
// build-time injection (e.g. reading build.gradle's values into this file
// via a Vite define, or the reverse) would remove the duplication, but
// that's a v1.5 candidate, not this increment's problem to solve (see
// README.md's v1.5 list).
export const APP_VERSION = '0.44.0';

/** android/app/build.gradle's `versionCode` — a plain incrementing integer
 * Android uses to decide "is this build newer", independent of the
 * human-readable `versionName`/`APP_VERSION` string above. This is the
 * number updateCheck.ts's comparisons are actually built on: two strings
 * can't be reliably ordered ("0.42.0" vs "0.9.0" as text), but two
 * versionCodes always can. */
export const APP_VERSION_CODE = 63;
