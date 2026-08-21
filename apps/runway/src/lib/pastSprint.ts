import type { Sprint } from '../db/types';

// Past-sprint increment: SprintSetup's only write path (`db.sprints.add`)
// starts a LIVE sprint — running from the moment "Begin sprint" is tapped.
// There was no way to record work that had already happened before this
// file existed. Real study time went completely unlogged, which meant
// examProjection.ts's remainingHours() and the weekly pace line quietly
// understated how much progress had actually been made — both factually
// wrong and exactly the shame surface CLAUDE.md forbids (an honest "you did
// nothing this week" screen for a day that had 3 real hours of work). This
// module is the pure logic behind ExamOverview's quiet "Log a sprint you
// already did" action: validating an entry, then building the Sprint row.

/**
 * Upper bound on a single past-sprint entry, in minutes. TRADEOFF: a
 * genuine multi-hour marathon session (the kind of day this feature exists
 * for — see the field report that prompted it) has to be split into more
 * than one entry once it crosses this line. 8 hours is chosen deliberately
 * generous — long enough to cover a full day of real exam prep logged in
 * one sitting without friction — while still catching the failure mode
 * this bound actually exists for: a fat-fingered duration (480 typed where
 * 48 was meant, an end time picked on the wrong day) silently fabricating
 * a week's worth of progress in one tap. There is nothing physically
 * enforced about 8h; it is a plausibility ceiling, not a law of nature.
 */
export const MAX_PAST_SPRINT_MINUTES = 8 * 60;

/** What buildPastSprint needs to construct a Sprint row for work that
 * already happened. `endedAt` is when it finished; `startedAt` is derived
 * (endedAt minus duration), never collected directly — the Sprint schema
 * has no separate duration field (db/types.ts's Sprint doc comment: actual
 * minutes worked is always startedAt/endedAt's difference, computed rather
 * than stored redundantly), and asking for both a start time and an end
 * time would just invite the two to disagree with the duration the user
 * actually means. */
export interface PastSprintInput {
  examId: string;
  topicId: string;
  endedAt: Date;
  durationMinutes: number;
}

export type PastSprintValidation =
  | { ok: true; startedAt: Date }
  | {
      ok: false;
      reason:
        | 'in-future'
        | 'non-positive-duration'
        | 'duration-too-long'
        | 'before-exam-created'
        | 'overlaps-existing-sprint';
    };

/**
 * Whether `input` describes an honest, loggable past sprint, and the
 * derived `startedAt` if so. Same "clamped result, named reason on
 * failure" shape as backdate.ts's clampBackdate, deliberately — this is
 * the same class of problem ("is this timeline physically possible") in a
 * different shape. Not built ON TOP of clampBackdate, though: that
 * function's contract is "correct one existing chain event against a
 * lowerBound taken from the previous event in the same chain"; this one is
 * "does a brand-new, freestanding entry make sense at all" against a
 * different set of constraints (exam creation, overlap with other
 * sprints). Different callers, different failure vocabulary — not worth
 * coupling the two just because both return a tagged ok/reason result.
 *
 * Checked in order:
 *
 *   1. `endedAt` in the future — a sprint that has not happened yet cannot
 *      be logged as done.
 *   2. Duration must be strictly positive — zero or negative minutes is
 *      not a sprint, it is a no-op or nonsense.
 *   3. Duration must not exceed MAX_PAST_SPRINT_MINUTES (see its own doc
 *      comment for the bound and its tradeoff).
 *   4. The derived `startedAt` must not fall before the exam itself was
 *      created. DECISION (flagged per the increment brief, not a hard
 *      requirement — a judgment call): rejected outright rather than
 *      allowed. Topics and their hour estimates only exist scoped to an
 *      exam row that has to already exist for a sprint to log hours
 *      against; a sprint dated before the exam row existed is attributing
 *      work to a topic list that, at that moment in the app's own history,
 *      did not exist yet. The real cost of this choice: a resident who
 *      studied for this exam for weeks before ever opening the app cannot
 *      backfill that earlier work through this control. Judged acceptable
 *      — the field report this feature answers is same-day forgetfulness
 *      ("I studied today and never started a sprint"), not multi-week
 *      historical import, and someone who wants that earlier effort
 *      reflected can lower the topic's estimatedHours instead of inventing
 *      sprint rows for days the exam didn't exist in yet.
 *   5. The resulting [startedAt, endedAt) window must not overlap any
 *      existing sprint. DECISION: rejected outright rather than allowed.
 *      Every hour figure downstream (remainingHours, hoursThisWeek,
 *      measuredPaceHoursPerWeek — examProjection.ts) is a plain sum of
 *      sprintMinutes() across rows; two sprints sharing the same instant
 *      would double-count that instant toward "hours worked", which is
 *      false no matter how ordinary the double-booking looks on screen. A
 *      still-open sprint (`endedAt === null` — genuinely live, or a
 *      zombie awaiting reconciliation, see examProjection.ts) is treated
 *      as ongoing through `now` for this check: its real end is not known
 *      yet, so the safe assumption is that it could still be running, not
 *      that it silently ended the moment it started.
 */
export function validatePastSprint(
  input: Pick<PastSprintInput, 'endedAt' | 'durationMinutes'>,
  now: Date,
  examCreatedAt: Date,
  existingSprints: Pick<Sprint, 'startedAt' | 'endedAt'>[],
): PastSprintValidation {
  if (input.endedAt.getTime() > now.getTime()) return { ok: false, reason: 'in-future' };
  if (!(input.durationMinutes > 0)) return { ok: false, reason: 'non-positive-duration' };
  if (input.durationMinutes > MAX_PAST_SPRINT_MINUTES) return { ok: false, reason: 'duration-too-long' };

  const startedAt = new Date(input.endedAt.getTime() - input.durationMinutes * 60_000);
  if (startedAt.getTime() < examCreatedAt.getTime()) return { ok: false, reason: 'before-exam-created' };

  const overlapsExisting = existingSprints.some((sprint) => {
    const sprintStartMs = new Date(sprint.startedAt).getTime();
    const sprintEndMs = sprint.endedAt === null ? now.getTime() : new Date(sprint.endedAt).getTime();
    return startedAt.getTime() < sprintEndMs && sprintStartMs < input.endedAt.getTime();
  });
  if (overlapsExisting) return { ok: false, reason: 'overlaps-existing-sprint' };

  return { ok: true, startedAt };
}

/**
 * Builds the Sprint row for a validated past entry. Callers MUST have
 * already checked `validatePastSprint(...).ok` — this never re-validates
 * (the screen owns the guard, this owns the shape, same division as every
 * other build-a-row helper in this app) — and takes the already-derived
 * `startedAt` rather than recomputing it, so there is exactly one place
 * (validatePastSprint) doing that arithmetic.
 *
 * `ritual: []` — verified, not assumed: nothing downstream reads
 * Sprint.ritual outside SprintSetup.tsx, which only ever WRITES it (copied
 * from the settings-backed default ritual at start time, never read back
 * from an existing sprint). An empty array is the honest value for a
 * sprint that never had a start ritual, not a placeholder standing in for
 * one it should have had.
 *
 * `plannedMinutes: input.durationMinutes` — DECISION: there was no "box"
 * (25/50/90) chosen at setup for a sprint that already happened, so the
 * actual duration stands in for it. The one real consumer of a *completed*
 * sprint's plannedMinutes, nextMove.ts's suggestedPlannedMinutes, medians
 * the last 5 completed sprints' plannedMinutes and snaps DOWN to the
 * nearest of {25, 50, 90} — a large backfilled duration can only ever pull
 * that suggestion up to 90 at most (the snap-down loop's own ceiling),
 * never invent a fictional larger box, so reusing the actual duration here
 * is safe rather than fabricating a separate "closest standard box" figure
 * that would misrepresent something that was never actually planned.
 *
 * `createdAt: now.toISOString()` — the instant this row is actually being
 * written (when Deepak taps save), deliberately NOT the same as `endedAt`.
 * This keeps an honest audit trail: `createdAt` landing well after
 * `startedAt`/`endedAt` is exactly what marks a row as backfilled, the
 * same "createdAt means when this ROW was written" meaning every other
 * entity in this app already uses — it is not read anywhere downstream
 * today, but there is no reason to make it lie.
 */
export function buildPastSprint(input: PastSprintInput, startedAt: Date, now: Date): Sprint {
  return {
    id: crypto.randomUUID(),
    examId: input.examId,
    topicId: input.topicId,
    plannedMinutes: input.durationMinutes,
    startedAt: startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    ritual: [],
    createdAt: now.toISOString(),
  };
}
