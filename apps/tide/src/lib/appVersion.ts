// Single source of truth for the version string shown on Settings.
//
// LOUD NOTE, carried over from Runway's own file: this constant,
// `APP_VERSION_CODE` below, and `versionName`/`versionCode` in
// android/app/build.gradle are now THREE separate, hand-maintained values
// (two here, two there, but versionName/APP_VERSION are the same string
// counted once) that must move TOGETHER on every release. Increment 2 adds
// the self-update checker (src/lib/updateCheck.ts): APP_VERSION_CODE is what
// it compares a GitHub release's stamped versionCode against, so a forgotten
// bump here doesn't just mislabel the Settings screen anymore — it means the
// app can never notice its own next update (or, worse, advertises an
// "update" that's actually the build already running). Nothing enforces the
// three moving together today — a build-time injection (reading
// build.gradle's values into this file via a Vite define, or the reverse)
// would remove that manual-sync risk, but that's a v1.5 candidate, not this
// increment's problem to solve (see Runway's own README.md v1.5 list for the
// identical unsolved item).
export const APP_VERSION = '0.4.0';

/** android/app/build.gradle's `versionCode` — a plain incrementing integer
 * Android uses to decide "is this build newer", independent of the
 * human-readable `versionName`/`APP_VERSION` string above. This is the
 * number src/lib/updateCheck.ts's comparisons are actually built on: two
 * strings can't be reliably ordered ("0.10.0" vs "0.9.0" as text), but two
 * versionCodes always can. */
export const APP_VERSION_CODE = 5;
