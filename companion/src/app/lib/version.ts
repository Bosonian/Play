// Keep in sync with package.json "version" — bump BOTH in the same edit.
// A hand-maintained constant, not a package.json import: see SPEC RISK E.
export const APP_VERSION = '0.10.0';

// The CI build number (github.run_number = the APK versionCode), injected at
// web-build time via VITE_APP_BUILD. 0 in local/dev builds (env unset). The
// in-app update check compares this against the latest published build.
export const APP_BUILD = Number(import.meta.env.VITE_APP_BUILD ?? 0) || 0;
