import type { WorkTask } from '../db/types';
import { deriveStepActuals } from './calibration';
import type { StepActual } from './calibration';

export interface TaskProjection {
  projectedFinish: Date;
  remainingUnits: number;
  remainingMinutes: number;
  /** null when the task has no deadline — there's nothing to measure slack
   * against, same "optional, not a degenerate zero" shape TaskProjection's
   * other deadline-only fields use below. */
  slackMinutes: number | null;
  /** null when the task has no deadline — mirrors slackMinutes exactly. */
  state: 'calm' | 'tight' | 'late' | null;
  /** How many of the remaining units, taken in list order, complete before
   * the deadline — null when there's no deadline to fit them against. See
   * this function's own doc comment for why "taken in order" (not "however
   * many minutes fit") is the honest reading. */
  unitsThatFit: number | null;
}

/**
 * Task mode's one equation — the departure equation (projection.ts) with
 * travel, buffer and arrival subtracted out, because a task has none of
 * those: projected finish = now + the sum of remaining (unchecked) units'
 * planned minutes. Pure and clock-free, same reasoning as computeProjection:
 * `now` is an explicit argument so this is testable without mocking the
 * system clock, and re-callable every tick from a live screen with a fresh
 * `now`.
 *
 * slack/state are only meaningful once a deadline exists — a task with no
 * deadline ("befund these when you get to them") genuinely has nothing to
 * measure against, so those fields are `null` rather than a fabricated
 * value. When a deadline IS set, the thresholds are the exact same ones
 * computeProjection uses (late below 0, tight below 5, calm at/above 5) —
 * mirrored here as a literal comment rather than an imported constant
 * because projection.ts doesn't export them as named values; if that ever
 * changes, this should import them instead of re-typing the numbers.
 *
 * `unitsThatFit`: NOT "how many minutes of work fit before the deadline"
 * (a number with no unit-boundary meaning — clinical work isn't divisible
 * mid-unit) but "how many of the remaining units, taken in the order they
 * sit in the list, actually complete by the deadline" — the honest lever
 * CLAUDE.md's task-design note describes: there's no compression for a
 * task, so the only real choice under time pressure is which of the
 * remaining units still fit, not making each one faster.
 */
export function taskProjection(now: Date, task: Pick<WorkTask, 'units' | 'deadlineAt'>): TaskProjection {
  const remainingUnits = task.units.filter((unit) => unit.checkedAt === null);
  const remainingMinutes = remainingUnits.reduce((sum, unit) => sum + unit.plannedMinutes, 0);
  const projectedFinish = new Date(now.getTime() + remainingMinutes * 60_000);

  if (task.deadlineAt === null) {
    return {
      projectedFinish,
      remainingUnits: remainingUnits.length,
      remainingMinutes,
      slackMinutes: null,
      state: null,
      unitsThatFit: null,
    };
  }

  const deadline = new Date(task.deadlineAt);
  // Whole minutes, not fractional — same "a slipping 14:32.7 reads as noise"
  // reasoning computeProjection's own slackMinutes comment gives.
  const slackMinutes = Math.round((deadline.getTime() - projectedFinish.getTime()) / 60_000);
  const state: TaskProjection['state'] = slackMinutes < 0 ? 'late' : slackMinutes < 5 ? 'tight' : 'calm';

  let cursorMs = now.getTime();
  let unitsThatFit = 0;
  for (const unit of remainingUnits) {
    cursorMs += unit.plannedMinutes * 60_000;
    if (cursorMs > deadline.getTime()) break;
    unitsThatFit++;
  }

  return { projectedFinish, remainingUnits: remainingUnits.length, remainingMinutes, slackMinutes, state, unitsThatFit };
}

/**
 * Reconstructs how long each checked-off unit actually took, from
 * check-off timestamps alone — task mode's equivalent of
 * calibration.ts's `deriveStepActuals`. Not a second copy of that chain-
 * attribution algorithm: `TaskUnit` is field-for-field identical to
 * `DepartureStep` (see db/types.ts's own comment on why), so this just
 * calls `deriveStepActuals` with a `{ steps, startedAt, ... }`-shaped
 * object built from the task, `arrivalSteps`/`arrivedAt` pinned to their
 * "nothing here" values — a task has no journey phase, so that second
 * chain never runs (`deriveStepActuals` only walks it when `arrivedAt` is
 * truthy). Zero new math, by construction.
 */
export function deriveTaskUnitActuals(task: Pick<WorkTask, 'units' | 'startedAt'>): StepActual[] {
  return deriveStepActuals({ steps: task.units, startedAt: task.startedAt, arrivalSteps: [], arrivedAt: null });
}
