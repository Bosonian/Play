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
