// Data model for Tide — TIDE_PLAN.md §4, "first cut". Additive-only from
// here per that plan; check TIDE_PLAN.md before adding fields.
//
// All timestamps are ISO 8601 strings (e.g. `new Date().toISOString()`),
// never Date objects — same convention as apps/runway (see its db/types.ts
// header comment): keeping everything as strings in the DB means there's
// exactly one place code turns a string into a Date, which makes
// timezone/parsing behaviour easy to reason about and to test.
//
// Undefined-as-null discipline (carried over from Runway, stated once here
// rather than repeated at every field): a field added to an EXISTING table
// after rows already exist needs no Dexie version() bump UNLESS it's
// indexed — but every reader must then treat `undefined` (a row written
// before the field existed) the same as `null`, via `field == null`
// (loose equality, deliberately), never `field === null`. See Runway's
// db/db.ts `version()` comments for the full "which fields need a bump"
// reasoning — that logic is identical here and isn't repeated per-field.

/** A single weigh-in — the trend engine's raw input (src/lib/trend.ts).
 * `source` distinguishes a Health Connect read (increment 3,
 * src/lib/healthSync.ts) from a hand-typed entry (increment 1's
 * WeighInEntry screen) — both feed the same trend math identically; the
 * field exists for provenance/debugging, not because the two are treated
 * differently anywhere yet. */
export interface WeighIn {
  id: string;
  /** ISO 8601 datetime the weigh-in was taken (or entered, for a manual
   * row with no better timestamp). */
  at: string;
  weightKg: number;
  /** Body-fat percentage from a BIA scale, or `null` when not measured —
   * most scales report it alongside weight, but a manual entry may skip
   * it. `null`, not `undefined`, for "measured this reading, no reading":
   * see this file's header comment on the undefined-as-null discipline —
   * `undefined` is reserved for "field didn't exist when this row was
   * written", `null` is the deliberate, always-available "not present"
   * value for every row going forward. */
  bodyFatPct: number | null;
  source: 'healthconnect' | 'manual';
}

/** Composition tiers for a plate check-in (TIDE_PLAN.md §4, §6) — a 3-tap
 * estimate, never a gram count. Written by src/screens/PlateCheckIn.tsx and
 * read (via src/lib/plateEstimate.ts) by that screen and by
 * src/screens/PlatesToday.tsx, as of the plate check-in increment (0.4.0)
 * — previously a rows-in-waiting type with no reader/writer yet, same
 * treatment Runway's Sprint/Milestone tables got in its own increment 1. */
export type PortionTier = 'none' | 'some' | 'lot';

export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'skipped';

/** One plate check-in — TIDE_PLAN.md §4/§5.3/§6. `estimatedKcal` is
 * deliberately secondary and derived (computed from the portion tiers
 * against the INDB/ICMR-NIN table — src/lib/plateEstimate.ts, plate
 * check-in increment 0.4.0), never the primary record — the composition
 * tiers below ARE the record; the kcal estimate is a downstream, rough,
 * honest-about-its-roughness display value layered on top. Written by
 * src/screens/PlateCheckIn.tsx, read by src/screens/PlatesToday.tsx. */
export interface Meal {
  id: string;
  at: string;
  kind: MealKind;
  carbPortion: PortionTier;
  protein: PortionTier;
  veg: PortionTier;
  fried: boolean;
  sugary: boolean;
  /** Reference to a stored photo, or `null` — the storage mechanism
   * (IndexedDB blob vs. filesystem) is a future-increment decision, not
   * fixed by this type. */
  photoRef: string | null;
  /** Derived, secondary — see this interface's header comment. `null`
   * until the estimate is computed. */
  estimatedKcal: number | null;
}

/** Passive movement data for one calendar day (TIDE_PLAN.md §4/§5.4) —
 * written by the Health Connect bridge (increment 3, src/lib/healthSync.ts),
 * with an optional manual fallback tier for a day with no watch data (that
 * manual-entry path itself is still a future increment — TIDE_PLAN.md §7's
 * plate-check-in/daily-shape work — healthSync.ts only ever preserves an
 * existing `manualTier` on write, it never sets one).
 * `date` is an ISO date (YYYY-MM-DD, CLAUDE.md's storage-format rule), not
 * a datetime — movement is inherently a whole-day aggregate, never a
 * point-in-time reading the way a WeighIn is. Home's quiet "Steps today"
 * line (increment 3) is the first screen to read this table. */
export interface Movement {
  id: string;
  date: string;
  source: 'healthconnect' | 'manual';
  steps: number | null;
  activeKcal: number | null;
  /** A rough self-reported tier for a day with no watch data at all — not
   * a substitute for real step counts, just better than a blank day. */
  manualTier: 'walk' | 'stairs' | 'home' | null;
}

/** A flat key-value row for small app-level flags — same shape and same
 * reasoning as Runway's `Setting` (targets, feature toggles, unit
 * preferences; nothing here yet this increment). Values are always
 * strings, same "one consistent representation" reasoning as Runway's own
 * doc comment on this type. */
export interface Setting {
  key: string;
  value: string;
}

// --- Field reports (increment 5, Dexie v3) ---
// In-app bug/improvement reports, ported from apps/runway/src/db/types.ts's
// own field-reports section. Unlike the `events` table above (v2), which is
// a genuinely new store, THIS section is also a genuinely new table, so it
// needs its own Dexie version bump — see db.ts's version(3) comment.

export type FieldReportStatus = 'pending' | 'synced' | 'failed';

/**
 * A single "report a problem" submission — ReportProblem.tsx's save path,
 * synced (best-effort) to GitHub Issues by src/lib/reportSync.ts. Written
 * to Dexie unconditionally on submit, regardless of whether a sync token
 * exists or the device is online — the local write IS the feature; sync is
 * an enhancement on top of it, not a precondition for it.
 */
export interface FieldReport {
  id: string;
  createdAt: string;
  description: string;
  /** The Screen union's `name` that was active when the report form was
   * opened from — 'home' or 'settings' today, but stored as a plain string
   * rather than a narrowed union so this table never needs a schema change
   * if a third entry point is added later. */
  screenName: string;
  /** APP_VERSION (src/lib/appVersion.ts) at submit time — a fixed fact
   * about the report, not a live lookup, so an old report still shows the
   * version it was actually filed under after the app has since updated. */
  appVersion: string;
  /** Base64-encoded image bytes with the `data:...;base64,` prefix already
   * stripped (ReportProblem.tsx's FileReader path strips it before writing
   * here) — null when no screenshot was attached. */
  screenshotBase64: string | null;
  screenshotMime: string | null;
  /**
   * 'pending': not yet synced (no token configured, offline, or a
   * transient/network failure — see reportSync.ts's classifySyncError).
   * Retried on every app open. 'synced': filed as a GitHub issue,
   * `syncedIssueUrl` set, `screenshotBase64`/`screenshotMime` cleared (the
   * bytes now live in the target repo). 'failed': permanent — a 4xx from
   * GitHub's API (bad token, bad repo, validation error) that retrying with
   * the same input would only repeat; `syncError` holds why. Only a manual
   * "Retry" (ReportProblem.tsx) re-attempts a 'failed' row, and only after
   * whatever made it fail (usually the token/repo settings) has changed.
   */
  status: FieldReportStatus;
  syncedIssueUrl: string | null;
  syncError: string | null;
  /**
   * The last 50 lines of the on-device event log (src/lib/eventLog.ts),
   * snapshotted at SAVE time — `null` when the "Attach recent activity log"
   * checkbox (ReportProblem.tsx, default OFF) was unchecked. Stored ON THE
   * REPORT ROW, not re-read from the log at sync time, deliberately: a
   * report can sit `pending` for a while (no token configured, or offline)
   * and by the time `syncPendingReports` finally files it, the live log has
   * moved on — pruned, or full of unrelated events from whatever Deepak did
   * between filing and syncing. The log attached to a report must be the
   * log AS IT STOOD when the bug was fresh in his mind, not whatever the
   * log happens to say later. Undefined-as-null discipline (this file's
   * usual rule): a report row saved before this field existed has no
   * `activityLog` property at all, read everywhere as `activityLog ??
   * null`.
   */
  activityLog: string[] | null;
}

// --- Activity log (increment 2, Dexie v2) ---
// Ported from apps/runway/src/db/types.ts's own activity-log section — same
// rule, restated here rather than merely imported: this log answers "what
// did the app DO", never "what did the user see" — a render, a query
// resolving, a screen mounting are NOT events. See src/lib/eventLog.ts for
// the writer/reader.

/** One event's kind — a flat, closed string union (not a free-form string)
 * so a typo in a call site's category fails to compile rather than silently
 * fragmenting the log into two spellings of the same thing. Deliberately
 * small compared to Runway's own EventCategory (ten-plus variants,
 * accumulated over many increments): Tide has exactly three domains worth
 * logging as of increment 2 — 'lifecycle' (app started/resumed/backgrounded,
 * a caught screen error), 'weighin' (a weigh-in saved), and 'update' (the
 * self-update checker, TIDE_PLAN.md increment 2). More join this union as
 * later increments (plate check-ins, movement, Health Connect) add their own
 * real transitions worth tracing — grow it then, not preemptively now. */
export type EventCategory =
  | 'lifecycle'
  | 'weighin'
  | 'update'
  // Health Connect bridge increment (0.3.0): a sync merged new
  // weight/body-fat/steps/active-energy rows, skipped a body-fat reading
  // with no matching weight instant, or the connect/permission flow itself
  // changed state — see src/lib/healthSync.ts.
  | 'health'
  // Plate check-in increment (0.4.0): a plate (or a skipped meal) was
  // logged — see src/screens/PlateCheckIn.tsx. Named 'meal', not
  // 'plate'/'plateCheckIn', to match the `meals` table this reports on
  // (db/db.ts) rather than the screen's own name.
  | 'meal'
  // Field-reports increment (increment 5): a report was submitted or
  // synced to GitHub Issues — see src/lib/reportSync.ts and
  // src/screens/ReportProblem.tsx.
  | 'report';

/**
 * One row of the activity log. Deliberately flat — `category` plus one
 * exact sentence, no free-form data blob — same reasoning as Runway's own
 * RunwayEvent: enough to trace a bug, and a shape that can never
 * accidentally serialize a whole WeighIn/Meal/Movement row into a log
 * nobody meant to keep a second copy of.
 */
export interface TideEvent {
  id: string;
  /** ISO 8601 datetime — this file's usual timestamp shape (see the header
   * comment at the top of this file). */
  at: string;
  category: EventCategory;
  message: string;
}
