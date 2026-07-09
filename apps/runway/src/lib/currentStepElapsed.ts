import type { Departure } from '../db/types';

export interface CurrentStepElapsed {
  stepId: string;
  elapsedMinutes: number;
}

/**
 * How long the in-progress step has been running, for the Runway screen's
 * "Xm on this step · planned Ym" line (increment-2 spec §4). Pure and
 * clock-free like projection.ts, for the same reason: `now` is an explicit
 * argument, so this is testable without mocking the system clock and
 * re-callable every tick without any internal notion of time passing.
 *
 * The "current" step is the first one in list order with `checkedAt ===
 * null`. But real prep is nonlinear — any step can be checked in any order
 * — so the clock for the current step can't just be "time since the
 * previous step in the list was checked". Instead it's time since whichever
 * step was checked *most recently by timestamp*, regardless of its list
 * position, or `startedAt` if nothing has been checked yet.
 */
export function currentStepElapsed(
  now: Date,
  departure: Pick<Departure, 'steps' | 'startedAt'>,
): CurrentStepElapsed | null {
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

  const referenceIso = mostRecentChecked ?? departure.startedAt;
  if (!referenceIso) return null; // defensive: a running departure always has startedAt stamped

  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - new Date(referenceIso).getTime()) / 60_000));
  return { stepId: currentStep.id, elapsedMinutes };
}
