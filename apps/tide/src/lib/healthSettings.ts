import { db } from '../db/db';

// Settings-table keys for the Health Connect bridge (increment 3) — same
// flat key-value shape as updateCheck.ts's own two settings keys, split into
// its own file rather than folded into healthSync.ts because Settings.tsx
// needs these keys directly (to read the enabled flag and last-sync time for
// display) without importing the sync orchestrator itself.

/** `'true'` once the user has explicitly connected (Settings' "Connect
 * health data" tap succeeded with at least one scope granted) — absent or
 * any other value means "not connected". A plain string, not a boolean,
 * because every settings row in this app stores strings (see db/types.ts's
 * `Setting` doc comment) — `'true'`/absent is the same idiom Runway's own
 * boolean-flag settings rows use. */
export const HEALTH_CONNECT_ENABLED_SETTING = 'healthConnectEnabled';

/** Highest `atMs` of a Health Connect weight/body-fat record already merged
 * into `weighIns` — the dedup boundary healthSync.ts's cursor-based merge
 * reads and advances. Stored as a string (epoch milliseconds), same
 * stringified-number idiom Runway's transitSync.ts uses for its own cursor. */
export const HEALTH_SYNC_CURSOR_SETTING = 'healthWeighInSyncCursorMs';

/** The read-window floor for steps/active-energy syncing — separate from
 * the weigh-in cursor above because movement rows are upserted by `date`
 * (idempotent by construction, see healthSync.ts's own comment), so this
 * cursor's only job is bounding how far back each sync re-reads, not
 * deduping individual records. */
export const HEALTH_MOVEMENT_CURSOR_SETTING = 'healthMovementSyncCursorMs';

/** ISO 8601 datetime of the last successful `syncHealthData()` run — what
 * Settings' "Connected. Last sync: {time}." line reads. */
export const HEALTH_LAST_SYNC_AT_SETTING = 'healthLastSyncAt';

/**
 * Which Health Connect data origins Tide counts for steps/active-energy —
 * issue #20 ("Samsung Health says 6714, Tide shows ~11k"): Health Connect
 * can hold independent step streams from more than one source (the watch's
 * own app, the phone's pedometer, Samsung Health's aggregate...) and summed
 * together they double- or triple-count the same walk. Stored as a
 * COMMA-SEPARATED string of Health Connect package names (e.g.
 * `"com.sec.android.app.shealth"` or, for multiple,
 * `"com.sec.android.app.shealth,com.google.android.apps.fitness"`) — this
 * app's settings table only stores strings (see this file's own comment on
 * `HEALTH_CONNECT_ENABLED_SETTING`), and a source list has no natural
 * numeric encoding the way a cursor timestamp does.
 *
 * EMPTY OR ABSENT MEANS "ALL SOURCES" — deliberately, not a placeholder for
 * "not configured yet". This app must never silently pick a source on the
 * user's behalf (the whole reason issue #20's fix ships a picker instead of
 * a hardcoded package name — see HealthConnectPlugin.kt's readStepSources
 * doc comment): until the user has actually chosen something in Settings'
 * "Step source" picker, Tide keeps counting every origin, exactly like
 * before this setting existed. That means a freshly-connected device is
 * NOT protected from the over-counting bug until the user visits Settings
 * once — an honest tradeoff, not an oversight (auto-selecting "the first
 * source we see" would be exactly the guess this feature exists to avoid).
 */
export const MOVEMENT_STEP_SOURCES_SETTING = 'movementStepSources';

/**
 * The pure parse half of the comma-separated round trip — split out from
 * `readSelectedStepSources` below purely so it has something testable
 * without mocking Dexie (this file's only other exports are constants; this
 * is the first bit of real logic to land here, so it gets the same
 * pure-function-first shape healthSync.ts's own testable helpers use).
 * `undefined` (row absent) and `''` (row present but empty — see
 * `writeSelectedStepSources`'s own comment on why a cleared selection is
 * written this way, not as a deleted row) both parse to `[]`, matching
 * `MOVEMENT_STEP_SOURCES_SETTING`'s "empty/absent = all sources" contract.
 */
export function parseStepSourcesValue(value: string | undefined): string[] {
  if (!value) return [];
  // Trims, drops empty segments, and de-duplicates (review hardening, 0.6.1).
  // Not defensiveness for its own sake: an empty segment would become
  // `DataOrigin("")` in HealthConnectPlugin.dataOriginFilterFrom — a
  // NON-empty filter that matches no records — and a non-empty filter that
  // matches nothing reads as zero steps, the one failure mode this whole
  // feature must never produce. No current writer can emit such a value
  // (only `''` or exact Health Connect package names, which cannot contain
  // commas), so this guards a corrupted/hand-edited row rather than a live
  // bug — cheap insurance against the expensive symptom.
  const unique = new Set<string>();
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (trimmed !== '') unique.add(trimmed);
  }
  return [...unique];
}

/** The pure serialise half — a plain comma-join, but named and exported
 * alongside `parseStepSourcesValue` so the round-trip pairing is obvious at
 * a glance and both halves get tested together. */
export function serializeStepSourcesValue(packageNames: readonly string[]): string {
  return packageNames.join(',');
}

/**
 * Reads `MOVEMENT_STEP_SOURCES_SETTING` back into a package-name array —
 * `[]` (meaning "all sources", see that constant's own comment) for an
 * absent row OR an empty-string row, matching every other read-through
 * helper in this app's settings layer (`readCursor` in healthSync.ts is the
 * closest precedent, though that one defaults to a number, not a list).
 * Named `readSelectedStepSources`, not `readStepSources`, so it can never be
 * confused at a call site with native/healthConnect.ts's `readStepSources`
 * (that one fetches TODAY's live per-source counts from Health Connect;
 * this one reads which of them the user picked to keep counting).
 */
export async function readSelectedStepSources(): Promise<string[]> {
  const row = await db.settings.get(MOVEMENT_STEP_SOURCES_SETTING);
  return parseStepSourcesValue(row?.value);
}

/**
 * Writes the user's chosen sources, comma-joined — an empty array writes
 * `''` (not a deleted row) so `readSelectedStepSources` (and any future
 * direct read of this key) always finds a row shaped exactly the same way,
 * rather than needing to handle "row absent" and "row present but empty" as
 * two different flavours of the same "all sources" meaning.
 */
export async function writeSelectedStepSources(packageNames: readonly string[]): Promise<void> {
  await db.settings.put({ key: MOVEMENT_STEP_SOURCES_SETTING, value: serializeStepSourcesValue(packageNames) });
}

/** Health Connect package name -> a name Deepak would actually recognise —
 * shown next to each row in Settings' "Step source" picker. Deliberately a
 * SHORT, hand-maintained list of the sources this specific setup (Galaxy
 * Watch + Samsung Health + occasionally Google Fit/Health Connect's own
 * app) can plausibly produce, not an attempt at a complete Health Connect
 * origin registry — Health Connect has no such registry to draw from
 * anyway; every source app just writes its own package name. */
const KNOWN_STEP_SOURCE_LABELS: Record<string, string> = {
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.samsung.android.wear.shealth': 'Galaxy Watch',
  'com.google.android.apps.fitness': 'Google Fit',
  'com.google.android.apps.healthdata': 'Health Connect',
};

/** Falls back to the raw package name for anything not in the map above —
 * DELIBERATE, not a gap to fill later: an unrecognised source should be
 * shown to the user honestly (a slightly technical but truthful string),
 * never hidden or silently relabelled "Unknown" — the whole point of this
 * picker (issue #20) is showing REAL sources so the user can make an
 * informed choice, and swallowing one behind a vague label would undercut
 * that. */
export function stepSourceLabel(packageName: string): string {
  return KNOWN_STEP_SOURCE_LABELS[packageName] ?? packageName;
}
