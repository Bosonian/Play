import type { DepartureStep } from '../db/types';

/**
 * Where a step inserted mid-run lands relative to the CURRENT step (the
 * first with `checkedAt === null`, list order — currentStepElapsed.ts's own
 * definition) — see this file's header comment for why the choice between
 * the two carries real time-attribution meaning, not just a display-order
 * preference.
 */
export type InsertStepPosition = 'now' | 'after-current';

/**
 * Field report, paraphrased: a "Punctual to work" template has Toilet,
 * Bath, Brush — but SOMETIMES there's also a shave, not every day, so it
 * isn't in the template. Until this existed there was no way to record
 * that, so the shaving minutes got silently absorbed by whichever step
 * happened to be running — a 15-minute bath plus a 10-minute shave read
 * back as one 25-minute bath, and the learning system (learning.ts) then
 * planned every future morning around an inflated bath. Deepak's own
 * words: "so that the statistics of the other steps won't get polluted."
 *
 * This is what makes the fix cheap. currentStepAnchor
 * (currentStepElapsed.ts) already hands the "current" step — the first one
 * in LIST ORDER with `checkedAt === null` — whatever clock has been
 * running since the most recently checked step, with no anchor logic keyed
 * on step identity, only list position. So inserting a new step immediately
 * BEFORE the current one makes the new step current and hands it that same
 * already-running clock for free: the minutes since the last check-off get
 * attributed to the new step instead of inflating its neighbour. No new
 * anchor logic is needed — only where in the array the new row lands.
 *
 * `'now'`: insert immediately BEFORE the current step (at the current
 * step's own index) — the new step becomes current and takes over the
 * clock already running. This is the common case Deepak described: he's
 * just checked off Toilet and decides to shave before the bath.
 *
 * `'after-current'`: insert immediately AFTER the current step (current
 * step's index + 1) — the current step keeps its own clock; the new step
 * only becomes current, and starts its own clock, once the current one is
 * checked off. This is the "already mid-bath, remembered I want to shave
 * next" case.
 *
 * No current step (every step already checked — `currentIndex === -1`, the
 * same state currentStepAnchor's own doc comment calls "see the leave state
 * instead"): both positions collapse to the SAME behaviour, append to the
 * end. There is no running clock left for 'now' to take over, and no
 * current step for 'after-current' to follow — appending is the only
 * placement that doesn't silently invent one. The step just sits there
 * unchecked, exactly like a step added at setup that hasn't been reached
 * yet. Runway.tsx doesn't actually offer this action once every step is
 * checked (the "Leave now" panel takes over the screen at that point), so
 * this branch is reachable by this function and its tests, not by the live
 * UI — kept as a defined, non-crashing answer anyway rather than an
 * unreachable assumption.
 *
 * `newStep.checkedAt` is the caller's responsibility, not enforced here —
 * every real caller passes a freshly created step with `checkedAt: null`
 * (a step that's already "checked" before it's ever been inserted makes no
 * sense), but this function only decides WHERE the step lands, not what
 * shape it arrives in.
 *
 * Per-run only, deliberately: this returns a new steps array for ONE
 * Departure row and never touches the Template it came from. DO NOT add a
 * "save this to the template" option here, or in any caller — an ad-hoc
 * step (the whole point of this feature) is not a daily step, and offering
 * to promote it would be a second, bigger decision that's explicitly out
 * of scope for this increment.
 */
export function insertStepIntoRun(
  steps: DepartureStep[],
  newStep: DepartureStep,
  position: InsertStepPosition,
): DepartureStep[] {
  const currentIndex = steps.findIndex((step) => step.checkedAt === null);
  if (currentIndex === -1) return [...steps, newStep];

  const insertAt = position === 'now' ? currentIndex : currentIndex + 1;
  const next = [...steps];
  next.splice(insertAt, 0, newStep);
  return next;
}
