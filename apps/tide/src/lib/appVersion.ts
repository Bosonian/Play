// Single source of truth for the version string shown on Settings — same
// role as Runway's own appVersion.ts, trimmed to what increment 1 actually
// needs (no field-report stamping yet; that machinery doesn't exist here
// until increment 2).
//
// LOUD NOTE, carried over from Runway's own file: once increment 2 adds an
// Android build (android/app/build.gradle's versionName/versionCode), this
// constant and that file become TWO hand-maintained values that must move
// TOGETHER on every release — see Runway's appVersion.ts for the full
// reasoning and the "not this increment's problem to solve" call.
export const APP_VERSION = '0.1.0';

/** Mirrors Runway's APP_VERSION_CODE — a plain incrementing integer,
 * independent of the human-readable string above. Not yet compared against
 * anything (no update-check machinery exists in this increment), but
 * defined now so Settings' version line has both numbers from day one,
 * matching Runway's display shape. */
export const APP_VERSION_CODE = 1;
