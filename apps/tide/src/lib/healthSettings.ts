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
