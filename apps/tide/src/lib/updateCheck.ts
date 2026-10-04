import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db } from '../db/db';
import { APP_VERSION_CODE } from './appVersion';
import { logEvent } from './eventLog';

// Ported from apps/runway/src/lib/updateCheck.ts — same mechanism, pointed
// at THIS repo's `tide-latest` release instead of `runway-latest`. Unlike
// Runway (whose update checker only recognizes releases published by ITS
// OWN workflow's later "stamped name" step, because older unstamped
// `runway-latest` releases already existed), Tide's very first `tide-latest`
// release is already stamped correctly (see .github/workflows/tide-apk.yml's
// "Publish / refresh tide-latest release" step) — there is no legacy
// unstamped release to be compatible with here.

/** Settings-table keys (db/db.ts v2's key-value `settings` table). Exported
 * directly from this module, same call Runway's own file makes — Home.tsx
 * and Settings.tsx both need `parseAvailableUpdate` from here anyway, so
 * there's no reason to split this into a separate settings-only module. */
export const LAST_UPDATE_CHECK_AT_SETTING = 'lastUpdateCheckAt';
export const AVAILABLE_UPDATE_SETTING = 'availableUpdate';

/** Minimum gap between real network checks. A Settings "Check now" tap
 * bypasses this via `checkForUpdate(true)` — see that function's `force`
 * param. Same value as Runway's own THROTTLE_MS — no reason for Tide's
 * update checker to poll GitHub any more or less eagerly than its sibling. */
const THROTTLE_MS = 6 * 60 * 60 * 1000;

const RELEASE_URL = 'https://api.github.com/repos/Bosonian/Play/releases/tags/tide-latest';
// Same order of magnitude as Runway's own TIMEOUT_MS — a single small JSON
// GET, so on the shorter end of what this monorepo's other network calls use.
const TIMEOUT_MS = 10_000;

export interface AvailableUpdate {
  version: string;
  versionCode: number;
}

// "Tide v0.2.0 (2)" — the exact shape tide-apk.yml's release step stamps
// onto the `name` field of every tide-latest publish. The versionCode group
// is intentionally `\S+` (any non-whitespace), not `\d+` — same reasoning as
// Runway's own RELEASE_NAME_PATTERN: a stricter pattern would make it
// impossible for a malformed-but-present versionCode to ever reach the NaN
// check below, turning that check into dead code.
const RELEASE_NAME_PATTERN = /^Tide v(\S+) \((\S+)\)$/;

/**
 * Parses a stamped GitHub release `name`. Returns `null` for anything that
 * isn't exactly that shape — a caller must only ever read `null` as "no
 * update signal available", NEVER as "this build is up to date" (see
 * Runway's own parseReleaseName doc comment for why conflating the two is
 * the actual bug this contract exists to prevent). Pure — no network, no
 * Dexie — so it's testable directly.
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
 * handling live in exactly one place.
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
 * The actual network call, same CapacitorHttp/fetch split as Runway's own
 * fetchReleaseName: CapacitorHttp natively (bypasses the WebView's CORS
 * enforcement), plain fetch on web/dev. Unauthenticated GET against a
 * public repo's public release — there's no key/token to attach. Throws on
 * any failure (network error, timeout, non-2xx, unreadable body) —
 * checkForUpdate below is the one place that catches.
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
 * this function's "NEVER throws" contract intact. 'throttled' is included
 * for completeness (a `force: false` call within the 6h window) but
 * Settings never sees it in practice — its "Check now" always passes
 * `force: true`. */
export type UpdateCheckOutcome = 'available' | 'upToDate' | 'throttled' | 'error';

/**
 * The one call site every startup call (main.tsx) and Settings' "Check for
 * updates" TextAction both use. Never throws — every failure path (offline,
 * GitHub rate-limiting this IP, a malformed response, a Dexie write
 * failing) is caught and swallowed, logged once, so a background update
 * check can never be the reason app startup breaks. `force` is the ONLY
 * thing that bypasses the 6h throttle — it exists specifically for
 * Settings' explicit "Check for updates" tap.
 *
 * Logs under the 'update' category (db/types.ts's EventCategory) —
 * deliberately its own category here, unlike Runway (which folded its
 * update-check logging into 'lifecycle' because a new category for one
 * feature's two log lines wasn't worth the branch at the time). Tide's own
 * EventCategory is already small and purpose-built per domain (see that
 * type's doc comment), so 'update' gets its own slot rather than borrowing
 * 'lifecycle''s.
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
      // Judgment call, carried over from Runway's own reasoning:
      // `lastUpdateCheckAt` is stamped even on a FAILED attempt, not only a
      // successful one — the alternative (only stamp on success) means a
      // phone that's offline retries on every single app open instead of
      // backing off, defeating the throttle's purpose. `availableUpdate`
      // itself is left untouched — a failed check is an absence of
      // information, never treated as "up to date".
      await db.settings.put({ key: LAST_UPDATE_CHECK_AT_SETTING, value: new Date().toISOString() });
      void logEvent('update', `Update check failed: ${err instanceof Error ? err.message : 'unknown error'}.`);
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
      void logEvent('update', `Update check: v${parsed.version} available.`);
      return 'available';
    }

    // Same/older/unknown (an unparseable name) all land here, by spec — an
    // unparseable release clears any previously-advertised update rather
    // than leaving a stale one sitting in Dexie, same reasoning Runway's own
    // checkForUpdate documents.
    await db.settings.put({ key: AVAILABLE_UPDATE_SETTING, value: '' });
    void logEvent('update', 'Update check: up to date.');
    return 'upToDate';
  } catch (err) {
    // Belt-and-braces catch-all for anything unexpected (a Dexie write
    // itself failing) — every expected failure path above already returns
    // before reaching here. Matches eventLog.ts's own "never let this be
    // the reason a real action fails" contract; this function is called
    // fire-and-forget from main.tsx and must never surface as an unhandled
    // rejection there.
    console.warn('Tide: checkForUpdate failed', err);
    return 'error';
  }
}
