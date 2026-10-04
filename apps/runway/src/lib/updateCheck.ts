import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db } from '../db/db';
import { APP_VERSION_CODE } from './appVersion';
import { logEvent } from './eventLog';

// Update-check increment (0.42.0). Every release before this one already
// exists on GitHub as a fixed release name ("Runway (latest build)") — this
// module can only ever recognize releases published by the *new* workflow
// step (runway-apk.yml's "Publish / refresh runway-latest release"), so the
// very first version capable of noticing an update is 0.42.0 itself. See
// CHANGELOG.md's 0.42.0 entry for that caveat stated for a person, not just
// a comment.

/** Settings-table keys (db/db.ts v2's key-value `settings` table — same
 * table every other single-flag/single-blob increment in this app uses,
 * e.g. dayGaugeSettings.ts's DAY_GAUGE_ENABLED_SETTING). Exported directly
 * from this module rather than split into a separate `updateCheckSettings.ts`
 * — unlike calendarSettings.ts/dayGaugeSettings.ts (split out because a
 * refresh module and a settings-reading module both need the key without
 * importing each other's heavier logic), nothing here has a reason to avoid
 * importing this file directly: Home.tsx and Settings.tsx both already need
 * `parseAvailableUpdate` from here anyway. */
export const LAST_UPDATE_CHECK_AT_SETTING = 'lastUpdateCheckAt';
export const AVAILABLE_UPDATE_SETTING = 'availableUpdate';

/** Minimum gap between real network checks (spec: "minimum 6h between real
 * network checks"). A Settings "Check now" tap bypasses this via
 * `checkForUpdate(true)` — see that function's `force` param. */
const THROTTLE_MS = 6 * 60 * 60 * 1000;

// logEvent category: 'lifecycle' (db/types.ts's EventCategory), the same
// bucket "App started." already uses — an update check is a startup/
// background concern about the APP itself, not about a departure, task,
// sprint, arrival, alarm, gauge, backup, report, navigation, or transit
// measurement (the rest of the union), so none of the other categories fit
// as well. A new 'update' category was considered and rejected: one more
// category for a feature that logs at most two lines per real check isn't
// worth the extra branch everywhere EventCategory is matched on.

const RELEASE_URL = 'https://api.github.com/repos/Bosonian/Play/releases/tags/runway-latest';
// Same order of magnitude as routesApi.ts's 12s / reportSync.ts's 20s — a
// single small JSON GET, so on the shorter end of that range.
const TIMEOUT_MS = 10_000;

export interface AvailableUpdate {
  version: string;
  versionCode: number;
}

// "Runway v0.42.0 (59)" — the exact shape runway-apk.yml's release step now
// stamps onto the `name` field of every runway-latest publish. The
// versionCode group is intentionally `\S+` (any non-whitespace), not `\d+`
// — a stricter pattern would make it impossible for a malformed-but-present
// versionCode (a hand-edited release, or some future bug in the workflow)
// to ever reach the NaN check below; this way that check is a real branch,
// not dead code guarding against something the regex already ruled out.
const RELEASE_NAME_PATTERN = /^Runway v(\S+) \((\S+)\)$/;

/**
 * Parses a stamped GitHub release `name`. Returns `null` for anything that
 * isn't exactly that shape — most importantly, every release published
 * BEFORE this increment, which carries the old fixed name
 * "Runway (latest build)". That's a normal, expected value, not an error:
 * this function's whole contract is "tell the difference between a release
 * this app can read a version out of, and one it can't" — a `null` must
 * only ever be read by callers as "no update signal available", NEVER as
 * "this build is up to date" (a caller that conflated the two would treat a
 * still-unstamped release, or a genuinely garbled one, as proof nothing has
 * changed, which is the opposite of "no information"). Pure — no network,
 * no Dexie — so it's testable directly.
 */
export function parseReleaseName(name: string): { version: string; versionCode: number } | null {
  const match = RELEASE_NAME_PATTERN.exec(name.trim());
  if (!match) return null;

  const versionCode = Number.parseInt(match[2], 10);
  if (Number.isNaN(versionCode)) return null;

  return { version: match[1], versionCode };
}

/**
 * Reads the `availableUpdate` settings row back into a typed value, `null`
 * for "nothing there" (row missing, cleared to `''`, or — defensively —
 * malformed JSON from some future schema change). Shared by Home.tsx's card
 * and Settings.tsx's "Version ..." line so the JSON shape and its failure
 * handling live in exactly one place rather than being re-parsed at both
 * call sites.
 */
export function parseAvailableUpdate(value: string | undefined): AvailableUpdate | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; versionCode?: unknown };
    if (typeof parsed.version !== 'string' || typeof parsed.versionCode !== 'number') return null;
    return { version: parsed.version, versionCode: parsed.versionCode };
  } catch {
    return null;
  }
}

/**
 * The actual network call, mirroring routesApi.ts's requestRoutes /
 * reportSync.ts's githubRequest split: CapacitorHttp natively (bypasses the
 * WebView's CORS enforcement), plain fetch on web/dev. Unlike those two,
 * this is an unauthenticated GET against a public repo's public release —
 * there's no key/token to attach, just the Accept header GitHub's REST API
 * asks for. Throws on any failure (network error, timeout, non-2xx,
 * unreadable body) — checkForUpdate below is the one place that catches.
 */
async function fetchReleaseName(): Promise<string> {
  const headers = { Accept: 'application/vnd.github+json' };

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url: RELEASE_URL,
      headers,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GitHub API returned status ${response.status}.`);
    }
    return extractName(response.data);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(RELEASE_URL, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`GitHub API returned status ${response.status}.`);
    }
    return extractName(await response.json());
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractName(data: unknown): string {
  const name = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).name : undefined;
  if (typeof name !== 'string') throw new Error('Unexpected response shape from GitHub.');
  return name;
}

/** What actually happened, for the one caller that needs to know (Settings'
 * "Check for updates" inline feedback) — main.tsx's startup call ignores
 * this entirely (`void checkForUpdate()`). Still never a thrown error:
 * 'error' is a normal return value, not an exception, which is what keeps
 * this function's "NEVER throws" contract intact while still giving
 * Settings something to branch its three feedback strings on.
 * 'throttled' is included for completeness (a `force: false` call within
 * the 6h window) but Settings never sees it in practice — its "Check now"
 * always passes `force: true`. */
export type UpdateCheckOutcome = 'available' | 'upToDate' | 'throttled' | 'error';

/**
 * The one call site every startup call (main.tsx) and Settings' "Check for
 * updates" TextAction both use. Never throws — every failure path (offline,
 * GitHub rate-limiting this IP, a malformed response, a Dexie write
 * failing) is caught and swallowed, logged once, so a background update
 * check can never be the reason app startup breaks. `force` is the ONLY
 * thing that bypasses the 6h throttle — it exists specifically for
 * Settings' explicit "Check for updates" tap, where a person just asked and
 * a stale "checked 5 hours ago" shouldn't silently no-op on them.
 */
export async function checkForUpdate(force = false): Promise<UpdateCheckOutcome> {
  try {
    if (!force) {
      const lastCheck = await db.settings.get(LAST_UPDATE_CHECK_AT_SETTING);
      if (lastCheck && Date.now() - new Date(lastCheck.value).getTime() < THROTTLE_MS) {
        return 'throttled'; // checked recently enough — nothing to do until the window passes or Settings forces it
      }
    }

    let releaseName: string;
    try {
      releaseName = await fetchReleaseName();
    } catch (err) {
      // Judgment call: `lastUpdateCheckAt` is stamped even on a FAILED
      // attempt, not only a successful one. The alternative — only stamp on
      // success — sounds safer but means a phone that's offline (or hitting
      // GitHub's unauthenticated 60/h rate limit) retries on every single
      // app open instead of backing off, which defeats the throttle's whole
      // purpose. The tradeoff this creates: if the very first check ever
      // fails, the app waits up to 6h before trying again rather than
      // retrying sooner. `availableUpdate` itself is left completely
      // untouched here — a failed check is not evidence of "up to date",
      // it's an absence of information, and the spec is explicit that this
      // case must never be treated as either.
      await db.settings.put({ key: LAST_UPDATE_CHECK_AT_SETTING, value: new Date().toISOString() });
      void logEvent('lifecycle', `Update check failed: ${err instanceof Error ? err.message : 'unknown error'}.`);
      return 'error';
    }
    await db.settings.put({ key: LAST_UPDATE_CHECK_AT_SETTING, value: new Date().toISOString() });

    const parsed = parseReleaseName(releaseName);
    const isNewer = parsed !== null && parsed.versionCode > APP_VERSION_CODE;

    if (isNewer) {
      await db.settings.put({
        key: AVAILABLE_UPDATE_SETTING,
        value: JSON.stringify({ version: parsed.version, versionCode: parsed.versionCode }),
      });
      void logEvent('lifecycle', `Update check: v${parsed.version} available.`);
      return 'available';
    }

    // Same/older/unknown (an unparseable name, e.g. a legacy unstamped
    // release) all land here, by spec — an unstamped release clears any
    // previously-advertised update rather than leaving a stale one sitting
    // in Dexie, even though it's not proof the build actually matches: the
    // alternative (leaving a possibly-outdated `availableUpdate` row in
    // place) risks nagging Deepak to download an "update" that isn't there
    // anymore, which is worse than briefly saying nothing.
    await db.settings.put({ key: AVAILABLE_UPDATE_SETTING, value: '' });
    void logEvent('lifecycle', 'Update check: up to date.');
    return 'upToDate';
  } catch (err) {
    // Belt-and-braces catch-all for anything unexpected (a Dexie write
    // itself failing, e.g. quota or a locked-down private-browsing mode) —
    // every expected failure path above already returns before reaching
    // here. Matches eventLog.ts's own "never let this be the reason a real
    // action fails" contract; this function is called fire-and-forget from
    // main.tsx and must never surface as an unhandled rejection there.
    console.warn('Runway: checkForUpdate failed', err);
    return 'error';
  }
}
