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
 * `source` distinguishes a Health Connect read (increment 3, once the
 * native bridge exists) from a hand-typed entry (this increment's
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
 * estimate, never a gram count. Defined here as a rows-in-waiting type
 * (TIDE_PLAN.md's increment roadmap: plate check-ins are increment 4) —
 * not read or written by any screen this increment, same treatment
 * Runway's Sprint/Milestone tables got in its own increment 1. */
export type PortionTier = 'none' | 'some' | 'lot';

export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'skipped';

/** One plate check-in — TIDE_PLAN.md §4/§5.3/§6. `estimatedKcal` is
 * deliberately secondary and derived (computed from the portion tiers
 * against the INDB/ICMR-NIN table in a future increment), never the
 * primary record — the composition tiers below ARE the record; the kcal
 * estimate is a downstream, rough, honest-about-its-roughness display
 * value layered on top. Not used by any screen yet. */
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
 * mostly written by the Health Connect bridge (increment 3), with an
 * optional manual fallback tier for a day with no watch data.
 * `date` is an ISO date (YYYY-MM-DD, CLAUDE.md's storage-format rule), not
 * a datetime — movement is inherently a whole-day aggregate, never a
 * point-in-time reading the way a WeighIn is. Not used by any screen yet. */
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
export type EventCategory = 'lifecycle' | 'weighin' | 'update';

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
