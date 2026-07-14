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
  /**
   * Estimation-bias increment (0.30.0): whether `minutes` is Deepak's own
   * felt guess ('manual') or a learned prefill ('learned' — applied by
   * StepNameAutocomplete's onSelect in TemplateEdit/DepartureSetup,
   * autoLearn.ts's write-itself update, or Home's suggestion-card Apply).
   * `undefined` on every row written before this field existed.
   *
   * Deliberately NOT this codebase's usual undefined-as-null convention
   * (compare `Template.schedule`/`autoLearn`/`arrivalSteps` above, all read
   * as `?? null`/`=== true`/`?? []`): here, undefined means UNKNOWN, not
   * "manual by default". Auto-learn has existed since the learning
   * increment, well before this field did, so an unknown share of legacy
   * step history is actually learned, not felt — collapsing undefined to
   * 'manual' would tell src/lib/estimateBias.ts's bias math that every
   * pre-increment guess was Deepak's own, poisoning the exact signal this
   * field exists to keep clean. estimateBias.ts's `guessPairs` therefore
   * excludes undefined the same way it excludes 'learned': the bias ledger
   * only builds forward from the first step saved after this field shipped.
   *
   * Copied verbatim wherever a step is copied wholesale rather than
   * re-guessed — Template<->Departure in both directions (materialize.ts's
   * buildDeparture, DepartureSetup's sourceTemplate/save-with-repeat
   * effects, TemplateEdit's "Make repeating" sourceDeparture effect) — a
   * materialized or promoted copy has the same provenance as its source.
   */
  estimateSource?: 'manual' | 'learned';
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
  /**
   * Opt-in automation (learning increment): when true, `applyAutoLearn`
   * (src/lib/autoLearn.ts) rewrites this template's step minutes after each
   * completed departure, whenever the learned P75 estimate has drifted
   * >= 2 min from the current value. This is the one place in the app where
   * a learned value writes itself rather than waiting for a tap — sanctioned
   * because it's opt-in (this flag), visible (TemplateEdit's "learned · N
   * runs" label), and labeled, never a silent background rewrite of a plan
   * the user never agreed to let the app touch.
   *
   * Not indexed — same undefined-as-null treatment as `schedule` above:
   * every read must treat `undefined` (a row saved before this field
   * existed) the same as `false`, never assume the property is present.
   */
  autoLearn: boolean;
  /**
   * Arrival-steps increment: the field-tested insight behind it is that
   * "on time" isn't the hospital door, it's the ward station AFTER
   * changing into scrubs and taking the lift. `steps` above (renamed
   * nowhere, but worth naming precisely here) covers PREP — everything
   * before you leave. `arrivalSteps` covers the OTHER side of travel —
   * whatever still stands between arriving at the building and the actual
   * appointment. Optional and empty by default: most departures (this
   * increment's own field report will tell us how many) have nothing here
   * and behave exactly as before.
   *
   * Copied onto a Departure at creation time exactly like `steps` — see
   * DepartureSetup's handleSave and materialize.ts's buildDeparture — so
   * editing a template's arrival steps later never retroactively rewrites
   * a departure already in progress, same reasoning as `steps` itself.
   *
   * Same undefined-as-null rule as `schedule`/`autoLearn` above: a row
   * saved before this field existed has no `arrivalSteps` property at all,
   * read everywhere as `arrivalSteps ?? []`, never assumed present.
   */
  arrivalSteps: StepTemplate[];
  /**
   * Arrival-detection increment (0.23.0): the Wi-Fi network name (SSID) a
   * departure created from this template should watch for during its
   * journey phase — see `Departure.arrivalWifiSsid`'s own doc comment for
   * how it's used. `null` (not just an empty string) means "not
   * configured", same tri-state shape TemplateSchedule's absence uses:
   * TemplateEdit's optional text field writes `null` when left blank on
   * save, never `''`, so every reader can treat "unset" as one value
   * instead of two.
   *
   * Same undefined-as-null rule as `schedule`/`autoLearn`/`arrivalSteps`
   * above: a row saved before this field existed has no `arrivalWifiSsid`
   * property at all, read everywhere as `arrivalWifiSsid ?? null` (or the
   * equivalent truthiness check), never assumed present.
   */
  arrivalWifiSsid: string | null;
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
  /** Same undefined-as-UNKNOWN rule as `StepTemplate.estimateSource` above
   * (see its own doc comment for the full reasoning) — 'manual' for a felt
   * guess typed or edited by hand, 'learned' for a learned prefill applied
   * and never subsequently hand-edited, `undefined` (excluded from
   * estimateBias.ts's bias math, never assumed 'manual') for a row saved
   * before this field existed. */
  estimateSource?: 'manual' | 'learned';
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
  /**
   * True when this departure's unchecked steps and/or buffer were squeezed
   * by `compressPlan` (replan.ts) and the user tapped Apply — set in
   * Runway.tsx's `applyReplan`, the ONLY writer. Deliberately NOT set by
   * re-anchor (`applyReanchor`): re-anchoring moves the appointment target,
   * it never touches a step's `plannedMinutes`, so a re-anchored run's
   * step actuals are still measurements of the step's real, uncompressed
   * pace.
   *
   * This is the field the two-distribution insight (learning increment)
   * turns on: a compressed run measures how fast a step CAN go under
   * pressure, not how long it naturally takes. Mixing the two would teach
   * the learner that Deepak's normal shower is 6 minutes because one
   * morning he compressed a 15-minute shower down to 6 to make a
   * appointment — true of that morning, false of every other morning.
   * `naturalActualsByStepName` (learning.ts) excludes runs where this is
   * true from the "normal" pool; `rushedActualsByStepName` uses ONLY runs
   * where this is true, to learn what a step can be squeezed to instead.
   *
   * Not indexed — same undefined-as-null rule as every other field on this
   * page: `undefined` (a row saved before this field existed) reads exactly
   * like `false`, everywhere.
   */
  wasReplanned: boolean;
  /**
   * Arrival-steps increment (ward-station insight): optional steps that
   * live AFTER travel and BEFORE `appointmentAt` — changing into scrubs,
   * taking the lift, walking the corridor. `appointmentAt` has always been
   * (and remains) the TRUE target this whole app is built around; these
   * steps just make the projection honest about what still has to happen
   * between "physically at the building" and "physically at the
   * appointment" for a departure where that gap is real and worth
   * tracking. Copied from `Template.arrivalSteps` at creation time exactly
   * like `steps` (DepartureSetup's handleSave, materialize.ts's
   * buildDeparture) — see that field's own doc comment for why a copy, not
   * a reference. Same "empty by default, most departures have none"
   * shape, and same undefined-as-null rule as every other late-added field
   * on this row: `arrivalSteps ?? []` everywhere, never assumed present.
   */
  arrivalSteps: DepartureStep[];
  /**
   * Stamped the moment the arrival phase begins — Runway.tsx's "I'm at the
   * building" button, shown once on first opening a 'left' departure that
   * has arrival steps. `null` until tapped; `undefined` on a row saved
   * before this field existed (undefined-as-null, same rule as
   * `arrivalSteps` above — read as `arrivedAt == null`, never `=== null`).
   *
   * This is a deliberate explicit tap, not an inferred timestamp, because
   * there's no honest signal in this app to guess "arrived" from —
   * `leftAt` only marks when prep ended and the door was walked through,
   * which for a departure with real travel time is minutes to hours before
   * the building is actually reached. Guessing (e.g. `leftAt + travelMinutes`)
   * would silently misattribute the whole journey to the first arrival
   * step's timer. See calibration.ts's `deriveStepActuals` for exactly
   * that anchor split enforced on the read side.
   */
  arrivedAt: string | null;
  /**
   * Arrival-detection increment (0.23.0): the Wi-Fi network Runway.tsx's
   * journey phase watches for to auto-stamp `arrivedAt`, copied from
   * `Template.arrivalWifiSsid` at creation time exactly like `arrivalSteps`
   * — see that field's own doc comment, and Template's for why `null`
   * (never `''`) means "not configured." Editing a template's arrival
   * Wi-Fi field later never retroactively changes a departure already in
   * progress, same reasoning as every other template-copied field on this
   * row.
   *
   * Matched case-insensitively against `WifiBridgePlugin`'s
   * (src/native/wifi.ts) one-shot SSID read — see Runway.tsx's own comment
   * on the polling effect for exactly when that check runs. This is
   * ADDITIVE to the manual "I'm at the building" tap, never a replacement
   * for it: Wi-Fi detection can fail to fire (network takes a moment to
   * associate, the phone's screen stays off past the poll's mount/resume
   * moments, the SSID was mistyped), so the explicit button always stays
   * available as the honest fallback.
   */
  arrivalWifiSsid: string | null;
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

// --- Tasks (tasks increment, Dexie v5) ---
// Timed work WITHOUT travel — "befunden 5 EEGs, ~15 min each, before the
// 16:00 Übergabe." A Task is a Departure with travel, buffer and arrival
// subtracted out: no destination to route to, no keys-and-toilet friction
// to pad for, nowhere to arrive after the work itself. Everything else —
// live projection, per-unit check-off, step-focus, name-keyed learning —
// runs on the exact same machinery a departure's steps already use, because
// a TaskUnit is deliberately shaped identically to a DepartureStep (see its
// own doc comment below). Two things a departure has that a task
// deliberately does NOT get, both stated here so they read as considered
// cuts rather than gaps: no plan compression (a unit of clinical work can't
// be squeezed the way a shower can — the honest lever when time is short is
// "which units still fit", not "make each one faster"), and no scheduled
// notifications (a task starts deliberately, at a desk, with the live
// screen already open — there's no "wake me up to start getting ready"
// moment the way there is before leaving somewhere). See README.md's
// "Tasks" section for both, spelled out for a reader who wasn't in the room
// for the decision.

/**
 * One identical unit of a WorkTask's work — "EEG 3" in the UI. `name` here
 * is always the PARENT TASK's name, the same string on every unit of one
 * task, not a per-unit label — that's what makes the task's name the join
 * key `naturalActualsByStepName`/`stepNameLibrary` (learning.ts) use to
 * pool a task's lived history into the exact same name-keyed pools a
 * departure step's actuals already feed. The UI's per-unit ordinal
 * ("EEG 1", "EEG 2", ...) is a display-time concatenation of this name plus
 * list position (TaskRun.tsx), computed at render, never stored — renaming
 * a task's units is really renaming the one task, not N separate rows.
 *
 * Field-for-field identical to DepartureStep ({id, name, plannedMinutes,
 * checkedAt}) — deliberately, not by coincidence: every step-shaped
 * function this app already has (deriveStepActuals, currentStepAnchor/
 * currentStepElapsed, isBatchedRun, the StepFocus component) reuses
 * verbatim against a task's units with zero new math, by passing a
 * `{ steps: task.units, ... }`-shaped object where those functions already
 * expect `{ steps: DepartureStep[], ... }`. See src/lib/taskProjection.ts's
 * `deriveTaskUnitActuals` for exactly that reuse.
 */
export interface TaskUnit {
  id: string;
  name: string;
  plannedMinutes: number;
  checkedAt: string | null;
  /** Same undefined-as-UNKNOWN rule as `StepTemplate.estimateSource`
   * (db/types.ts, above this section) — 'manual' for a felt guess typed
   * or edited by hand in TaskSetup, 'learned' for a learned prefill applied
   * and never subsequently hand-edited, `undefined` (excluded from
   * estimateBias.ts's bias math) for a row saved before this field
   * existed. */
  estimateSource?: 'manual' | 'learned';
}

export type TaskStatus = 'planned' | 'running' | 'done' | 'abandoned';

/**
 * A block of N identical units of timed work with no travel component. Runs
 * on the departure model's exact machinery (live projection, per-unit
 * check-off, step-focus chain) with travel/buffer/arrival/destination
 * removed — see this section's header comment for why those cuts are
 * deliberate, not partial coverage.
 *
 * `units` are embedded (not a separate table), same reasoning as
 * Departure.steps (db/types.ts, above): always read/written as a whole
 * alongside their parent task, and there's no query in this app that needs
 * "all units across all tasks" independent of which task they belong to.
 */
export interface WorkTask {
  id: string;
  /** "Befunden EEG" — also every unit's `name` (TaskUnit.name above); see
   * that field's own comment for why sharing this exact string is what
   * makes the task's history joinable with departure-step history by name. */
  name: string;
  units: TaskUnit[];
  /** ISO datetime, or null for a task with no deadline. `taskProjection`
   * (src/lib/taskProjection.ts) only computes slack/state/unitsThatFit once
   * this is set — mirroring computeProjection's appointmentAt-driven
   * state, but genuinely optional here: "befund these when you get to
   * them" is a real, deadline-less use a departure's model has no
   * equivalent of. */
  deadlineAt: string | null;
  status: TaskStatus;
  startedAt: string | null;
  createdAt: string;
}

// --- Prüfung mode (exam prep) — RUNWAY_PRUFUNG_PLAN.md §3, Dexie v3 ---
// Additive to everything above; departure mode's tables and types are
// untouched. This increment defines the schema and setup screens only —
// sprints and milestones exist here as rows-in-waiting for increments 3–4.

/**
 * A repeating schedule attached to an Exam (Prüfung rework 2, "armed study
 * blocks" increment) — the study-time analogue of `TemplateSchedule` above,
 * and the structural fix this increment exists for: a departure is a real,
 * chosen commitment with an exact alarm; study time had none of that and
 * relied on a spontaneous decision, which is exactly the kind of decision
 * ADHD declines to make. A study schedule gives study time the same
 * legitimacy — Deepak picking "Tuesday 19:00" here carries the same weight
 * as picking a departure's appointment time, not a softer, easier-to-skip
 * suggestion.
 *
 * `time`/`days` mean exactly what they mean on `TemplateSchedule` (a plain
 * "HH:mm" 24-hour string; ISO weekday numbers, 1 Monday .. 7 Sunday,
 * matching CLAUDE.md's Monday-first week) — `occurrenceDates`
 * (src/lib/recurrence.ts) is reused verbatim for both, since a study
 * schedule and a departure schedule are the same occurrence math over
 * different data. `minutes` is the fixed sprint length (25/50/90,
 * SprintSetup's own SPRINT_LENGTHS) that a materialized block's tap-to-open
 * prefills SprintSetup with — see notifications.ts's
 * scheduleStudyBlockAlarms and nextMove.ts's autoSuggestSelection.
 */
export interface StudySchedule {
  time: string;
  days: number[];
  minutes: 25 | 50 | 90;
}

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
  /**
   * Non-null when this exam has scheduled, alarmed study blocks (Prüfung
   * rework 2 — see `StudySchedule`'s own doc comment above for the "armed
   * vs. spontaneous" rationale). DELIBERATELY not backed by any row-per-
   * occurrence table: see notifications.ts's `scheduleStudyBlockAlarms` doc
   * comment for the full "no ledger" decision — a study block that was
   * never started should vanish without trace, and a block that WAS
   * started already becomes a real `Sprint`, which is the only record that
   * matters.
   *
   * Not indexed — same undefined-as-null discipline as `Template.schedule`
   * (db.ts's `version()` comments explain which fields DO need a Dexie
   * version bump; a non-indexed addition to an EXISTING table needs none):
   * every read must treat `undefined` (an exam saved before this field
   * existed) the same as `null`, via `studySchedule == null`, never
   * `=== null`.
   */
  studySchedule: StudySchedule | null;
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
  /**
   * Activity-log increment: the last 50 lines of the on-device event log
   * (src/lib/eventLog.ts), snapshotted at SAVE time — `null` when the
   * "Attach recent activity log" checkbox (ReportProblem.tsx, default OFF)
   * was unchecked. Stored ON THE REPORT ROW, not re-read from the log at
   * sync time, deliberately: a report can sit `pending` for a while (no
   * token configured, or offline) and by the time `syncPendingReports`
   * finally files it, the live log has moved on — pruned, or full of
   * unrelated events from whatever Deepak did between filing and syncing.
   * The log attached to a report must be the log AS IT STOOD when the bug
   * was fresh in his mind, not whatever the log happens to say later.
   * Undefined-as-null discipline (this file's usual rule): a report row
   * saved before this field existed has no `activityLog` property at all,
   * read everywhere as `activityLog ?? null`.
   */
  activityLog: string[] | null;
}

// --- Activity log (activity-log increment, Dexie v6) ---
// A local, capped record of what the app DID — not what the user saw, not
// every render or query, only real transitions (a departure created, an
// alarm armed, an arrival detected...). Exists because two field bugs this
// week ("finished task vanished", "left departure stranded when Android
// killed the app mid-drive") had to be diagnosed by reading code and
// reconstructing events from memory — there was no record of what actually
// happened. See src/lib/eventLog.ts for the writer/reader and the
// "what did the app DO, never what did the user see" rule stated in full.

/** One event's kind — deliberately a flat, closed string union (not a
 * free-form string) so a typo in a call site's category fails to compile
 * rather than silently fragmenting the log into two spellings of the same
 * thing. */
export type EventCategory =
  | 'lifecycle'
  | 'departure'
  | 'task'
  | 'sprint'
  | 'arrival'
  | 'alarm'
  | 'gauge'
  | 'backup'
  | 'report'
  | 'navigation';

/**
 * One row of the activity log. Deliberately flat — `category` plus one
 * exact sentence, no free-form data blob — for two reasons: a category and
 * a sentence are enough to trace a bug (this is a log, not a second copy of
 * the database), and a flat shape means a log call can never accidentally
 * serialize a whole Departure/Task/Sprint object (with names, destinations,
 * step lists) into a row nobody meant to keep an extra copy of. `message`
 * itself DOES sometimes carry a name (e.g. "Out the door: {name}.") — that's
 * a deliberate, narrow exception (see eventLog.ts's own header comment) for
 * tracing value, not a loophole for dumping structured data here.
 */
export interface RunwayEvent {
  id: string;
  /** ISO 8601 datetime, this file's usual timestamp shape — see the header
   * comment at the top of this file. */
  at: string;
  category: EventCategory;
  message: string;
}
