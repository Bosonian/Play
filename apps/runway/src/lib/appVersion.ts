// Single source of truth for the version string stamped onto every field
// report (ReportProblem.tsx's save path) as `FieldReport.appVersion` — so a
// bug report carries proof of which build produced it, the same way a stack
// trace would.
//
// LOUD NOTE: this constant and `versionName` in
// android/app/build.gradle are two separate, hand-maintained strings that
// must be bumped TOGETHER on every release. Nothing enforces that today — a
// build-time injection (e.g. reading build.gradle's versionName into this
// file via a Vite define, or the reverse) would remove the duplication, but
// that's a v1.5 candidate, not this increment's problem to solve (see
// README.md's v1.5 list).
export const APP_VERSION = '0.40.1';
