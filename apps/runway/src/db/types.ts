// Data model for Runway. Fixed by the increment-1 spec — do not add fields
// here without checking against docs/RUNWAY_PLAN.md first.
//
// All timestamps are ISO 8601 strings (e.g. `new Date().toISOString()`),
// never Date objects — Dexie can store Date objects, but keeping everything
// as strings in the DB means there's exactly one place (src/lib/format.ts,
// src/lib/projection.ts) where a string becomes a Date, which makes the
// timezone/parsing behaviour easy to reason about and to test.

/** One step inside a Template's reusable routine, e.g. "Shower", 15 minutes. */
export interface StepTemplate {
  id: string;
  name: string;
  minutes: number;
}

/**
 * A repeating schedule attached to a Template — "reach work at 08:00
 * Mon-Fri" — that src/lib/materialize.ts reads to auto-plan real
 * Departures ahead of time (recurring-departures increment). `time` is a
 * plain "HH:mm" 24-hour string, not a Date, because a schedule is not
 * anchored to any one day: it's evaluated fresh against each future
 * calendar date it matches. `days` uses ISO weekday numbers (1 Monday .. 7
 * Sunday, see src/lib/recurrence.ts's occurrenceDates) to match CLAUDE.md's
 * Monday-first week convention, and is non-empty whenever a schedule
 * exists — an empty-days schedule would mean "repeats on no day", which is
 * indistinguishable from no schedule at all, so TemplateEdit's validation
 * never lets one be saved.
 */
export interface TemplateSchedule {
  time: string;
  days: number[];
}

/**
 * A reusable departure blueprint: a destination, how long it takes to get
 * there, and the prep routine that precedes leaving. Templates exist so a
 * repeat outing ("Klinik", "piano lesson") takes seconds to set up, per
 * RUNWAY_PLAN.md §5.1.
 */
export interface Template {
  id: string;
  name: string;
  destination: string;
  travelMinutes: number;
  bufferMinutes: number;
  steps: StepTemplate[];
  createdAt: string;
  updatedAt: string;
  /**
   * Non-null when this template auto-plans real departures on a repeating
   * schedule (recurring-departures increment). Not indexed — same
   * "document, no Dexie version bump" treatment as Departure's
   * `originalAppointmentAt` (see db.ts's version() comments for which
   * fields DO need one) — so **every** read of this field must treat
   * `undefined` (a row written before this field existed) the same as
   * `null` (== null, never === null), exactly the class of bug the
   * v0.13.0 review caught and fixed for `originalAppointmentAt`. Don't
   * repeat it here.
   */
  schedule: TemplateSchedule | null;
}

/**
 * One step inside a live Departure. Copied (not referenced) from a
 * Template's steps at setup time, then mutated independently — editing a
 * Template later must not retroactively change a Departure already in
 * progress. `checkedAt` is null until the step is checked off; the
 * timestamp is what powers per-step calibration in a later increment.
 */
export interface DepartureStep {
  id: string;
  name: string;
  plannedMinutes: number;
  checkedAt: string | null;
}

export type DepartureStatus = 'planned' | 'running' | 'left' | 'done' | 'abandoned';

/**
 * A single real occurrence of getting out the door for a specific
 * appointment. Steps are embedded (not a separate table with a foreign
 * key) because a Departure's steps are only ever read or written as a
 * whole alongside their parent — there's no query in this app that needs
 * "all steps across all departures" independent of the departure they
 * belong to, so a relational join would add ceremony without earning it.
 */
export interface Departure {
  id: string;
  templateId: string | null;
  name: string;
  destination: string;
  appointmentAt: string;
  travelMinutes: number;
  bufferMinutes: number;
  steps: DepartureStep[];
  status: DepartureStatus;
  startedAt: string | null;
  leftAt: string | null;
  arrivalResult: 'early' | 'onTime' | 'late' | null;
  arrivalLateMinutes: number | null;
  createdAt: string;
  /**
   * The appointment time as it stood when this departure's commitment was
   * first made. CREATED equal to `appointmentAt` (DepartureSetup's add
   * path) — the two start out identical and only diverge once one of the
   * things below happens.
   *
   * Semantics rule (re-anchor spec): the slip/lateness record (History.tsx,
   * Runway.tsx's justLeft summary) always measures against this field, not
   * against whatever `appointmentAt` happens to be right now. Two different
   * writers touch `appointmentAt`, and only one of them is allowed to move
   * this field too:
   *   - A deliberate Edit (DepartureSetup's save on a 'planned' or
   *     'running' departure) UPDATES `originalAppointmentAt` to match the
   *     new `appointmentAt` — an edit means reality moved (the Termin got
   *     pushed back), so the "original" commitment moves with it.
   *   - The re-anchor quick action (Runway.tsx's leaveBy-has-passed panel)
   *     changes `appointmentAt` WITHOUT touching this field — re-anchor
   *     rescues a departure that's already blown its original target, and
   *     the whole point is that the record stays true: a re-anchored
   *     departure that arrives "on time" against its NEW target should
   *     still show up in History as late against the one it actually
   *     missed, not quietly launder itself into an on-time run.
   *
   * `null` on rows written before this field existed — Dexie needs no
   * schema-version bump to add a field that isn't indexed (see db.ts's
   * `version()` comments for which fields DO need one). Every slip-reading
   * call site reads `originalAppointmentAt ?? appointmentAt`, which is
   * exactly correct for a legacy row that's never been re-anchored (the two
   * are still the same value there by definition). The FIRST re-anchor of a
   * legacy row backfills this field with whatever `appointmentAt` was the
   * moment before that re-anchor — see Runway.tsx's `applyReanchor` for why
   * that backfill is the correct one-time fix rather than leaving the field
   * null forever (a null here would silently fall back to the RESCUED
   * appointmentAt for a legacy row that gets re-anchored twice, defeating
   * the whole point of this field for exactly the rows it exists to help).
   */
  originalAppointmentAt: string | null;
  /**
   * ISO date ("YYYY-MM-DD") this departure was auto-created for by
   * src/lib/materialize.ts's materializer, or `null` for a departure
   * someone actually typed in through DepartureSetup (recurring-departures
   * increment). This is the field the materializer's "never re-create an
   * abandoned occurrence" rule (see materialize.ts) reads: it looks for an
   * existing departure with the SAME templateId and scheduledForDate
   * before creating a new one, regardless of that existing row's current
   * `status` — a date that's already been materialized once is never
   * materialized again, even after the user removes it.
   *
   * Same undefined-as-null rule as `schedule` on Template above: `null` on
   * every pre-existing row (this field didn't exist before them), read
   * everywhere as `scheduledForDate == null`, never `=== null`.
   */
  scheduledForDate: string | null;
}

/**
 * A flat key-value row for small app-level flags that don't warrant their
 * own table — added in increment 6 for the first-run setup card's dismissal
 * ("has Deepak seen and closed it once"). Values are always strings; a
 * boolean flag is stored as the literal string `'true'`, not as a JS
 * boolean, because Dexie can store either but a single consistent
 * representation means every future settings key reads the same way
 * without a per-key convention to remember.
 */
export interface Setting {
  key: string;
  value: string;
}

// --- Prüfung mode (exam prep) — RUNWAY_PRUFUNG_PLAN.md §3, Dexie v3 ---
// Additive to everything above; departure mode's tables and types are
// untouched. This increment defines the schema and setup screens only —
// sprints and milestones exist here as rows-in-waiting for increments 3–4.

/**
 * Prüfung mode's deadline anchor — the exam the mode's math points at.
 * `windowStart` is the earliest the exam could fall (usually all that's
 * known for a long-lead exam like the Facharztprüfung, e.g. "November
 * 2026" becomes '2026-11-01'); `examDate` is set once the exact date is
 * announced and from then on overrides `windowStart` as the anchor
 * everywhere else reads a date from. v1 supports exactly one exam at a
 * time — ExamSetup won't offer creating a second while one exists — but
 * the table stays plural regardless: cheap to declare now, and it avoids a
 * schema migration later if that one-exam limit is ever lifted.
 */
export interface Exam {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD) the exam window opens. */
  windowStart: string;
  /** ISO date once the exact date is known; null until then. */
  examDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One chapter of exam material. A first-class row — unlike
 * StepTemplate/DepartureStep, which are embedded arrays copied wholesale
 * between Template and Departure — because a Topic is long-lived reference
 * data that a Sprint points at by id for the entire months-long prep
 * window, and its `estimatedHours` gets revised in place as understanding
 * of the material improves. Embedding it on Exam would mean either
 * duplicating topics into every future Sprint (losing the shared "this is
 * the current estimate" meaning) or being unable to edit an estimate
 * without rewriting history — the same tradeoff `templateId` on Departure
 * already makes by reference rather than by copy.
 */
export interface Topic {
  id: string;
  examId: string;
  name: string;
  estimatedHours: number;
  /** Manual sort position, written by TopicEdit's up/down reorder. Explicit
   * here (unlike StepTemplate's implicit array-order) because Topic is a
   * separate table, not an array Dexie already keeps in insertion order. */
  order: number;
}

/** One item in a Sprint's start ritual checklist, e.g. "Clear desk". Copied
 * onto the Sprint at start time — editing the ritual template later (a
 * future increment) must not rewrite a sprint already logged. */
export interface SprintRitualItem {
  name: string;
  checkedAt: string | null;
}

/**
 * One logged unit of exam prep work — the "sprint" the mode is named for
 * (RUNWAY_PRUFUNG_PLAN.md §2, §4). `plannedMinutes` is the fixed box
 * (25/50/90) chosen at setup; actual minutes worked is `endedAt` minus
 * `startedAt`, computed rather than stored — same reasoning as Departure
 * not storing a redundant duration alongside its own timestamps.
 * `endedAt` is null while the sprint is live. Schema only in this
 * increment: the sprint flow itself (setup, ritual, live screen, logging)
 * is increment 3.
 */
export interface Sprint {
  id: string;
  examId: string;
  topicId: string;
  plannedMinutes: number;
  startedAt: string;
  endedAt: string | null;
  ritual: SprintRitualItem[];
  createdAt: string;
}

/**
 * A real external commitment — a booked mock oral exam, not a
 * self-invented checkpoint (RUNWAY_PRUFUNG_PLAN.md §7: the app renders
 * these dates, it cannot create them; the UI copy says so explicitly).
 * `at` is a full ISO datetime, not just a date, because a milestone like
 * "Mock oral with OA Weber" has a specific time the morning-of alarm (a
 * future increment) needs to anchor to. `topicIds` scopes which topics
 * that milestone's mini ready-date projection (also a future increment)
 * covers. Schema only in this increment.
 */
export interface Milestone {
  id: string;
  examId: string;
  name: string;
  at: string;
  topicIds: string[];
  createdAt: string;
}

// --- Field reports (field-reports increment, Dexie v4) ---
// In-app bug/improvement reports. Unlike every non-indexed addition above
// (Template.schedule, Departure.scheduledForDate), this is a genuinely new
// TABLE, so it needs an actual Dexie version bump (see db.ts's version(4))
// rather than the "no migration needed" treatment those got.

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
}
