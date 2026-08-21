import type { Departure } from '../db/types';

export interface CurrentStepElapsed {
  stepId: string;
  elapsedMinutes: number;
}

/**
 * The ISO timestamp the CURRENT step (first in list order with `checkedAt
 * === null`) started from — i.e. the reference instant its own clock counts
 * from. Extracted out of currentStepElapsed (below) so the step-focus
 * increment can get SECONDS precision from the exact same anchor rather
 * than duplicating the "which timestamp counts as the start" judgment call
 * in a second place that could quietly drift from this one.
 *
 * The "current" step is the first one in list order with `checkedAt ===
 * null`. But real prep is nonlinear — any step can be checked in any order
 * — so the clock for the current step can't just be "time since the
 * previous step in the list was checked". Instead it's time since whichever
 * step was checked *most recently by timestamp*, regardless of its list
 * position, or `startedAt` if nothing has been checked yet.
 *
 * Returns null when there's no current step (every step checked) or — a
 * defensive case that shouldn't occur on a running departure — no
 * `startedAt` and nothing checked yet either.
 */
export function currentStepAnchor(departure: Pick<Departure, 'steps' | 'startedAt'>): string | null {
  const currentStep = departure.steps.find((step) => step.checkedAt === null);
  if (!currentStep) return null; // every step is checked - there's no current step, see the leave state instead

  const checkedTimestamps = departure.steps
    .map((step) => step.checkedAt)
    .filter((checkedAt): checkedAt is string => checkedAt !== null);

  // ISO 8601 timestamps compare correctly as plain strings, so this finds
  // "most recent" without parsing every one into a Date first.
  const mostRecentChecked = checkedTimestamps.reduce<string | null>(
    (latest, checkedAt) => (latest === null || checkedAt > latest ? checkedAt : latest),
    null,
  );

  return mostRecentChecked ?? departure.startedAt;
}

/**
 * How long the in-progress step has been running, for the Runway screen's
 * "Xm on this step · planned Ym" line (increment-2 spec §4). Pure and
 * clock-free like projection.ts, for the same reason: `now` is an explicit
 * argument, so this is testable without mocking the system clock and
 * re-callable every tick without any internal notion of time passing.
 *
 * Built on currentStepAnchor above — this just adds the "which step" and
 * "round to whole minutes, clamp at zero" layer on top of the same anchor.
 */
export function currentStepElapsed(
  now: Date,
  departure: Pick<Departure, 'steps' | 'startedAt'>,
): CurrentStepElapsed | null {
  const currentStep = departure.steps.find((step) => step.checkedAt === null);
  if (!currentStep) return null; // every step is checked - there's no current step, see the leave state instead

  const referenceIso = currentStepAnchor(departure);
  if (!referenceIso) return null; // defensive: a running departure always has startedAt stamped

  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - new Date(referenceIso).getTime()) / 60_000));
  return { stepId: currentStep.id, elapsedMinutes };
}

/**
 * Seconds-precision twin of the minutes math above, for the step-focus
 * overlay's live mm:ss countdown — a per-minute tick is too coarse for a
 * countdown that's meant to visibly move. Takes the anchor as a plain ISO
 * string (currentStepAnchor's return type) rather than recomputing it from
 * a full `departure`, so the focus screen can call this every second
 * without re-walking the steps array each tick. Floored and clamped at
 * zero, same reasoning as currentStepElapsed: a reference instant that's
 * (defensively) somehow in the future must never read as negative elapsed
 * time.
 */
export function elapsedSecondsSince(now: Date, anchorIso: string): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(anchorIso).getTime()) / 1000));
}
