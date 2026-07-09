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
