import { getISODay, isSameDay } from 'date-fns';
import type { DailyTarget, Sprint } from '../db/types';

/**
 * Daily-shape increment: the day-sized floor beside Prüfung mode's honest
 * weekly math. CLAUDE.md, verbatim, is the brief for this whole file:
 * "Three 50-min sprints daily, one full rest day: 2.5 h × 6 = 15 h. you
 * know my adhd brain sees the big numbers and dont even start." The exam
 * overview leads with strategy-sized numbers — a 310 h total, an 18.7
 * h/week required pace, a red ready-by date — genuinely correct, and
 * genuinely paralyzing at zero data. "Today: 1 of 3 sprints." is a number a
 * single day can actually hold.
 *
 * See `db/types.ts`'s `DailyTarget` doc comment for the CRITICAL HONESTY
 * CONSTRAINT this file exists to respect: nothing here computes hours, and
 * nothing here is read by `examProjection.ts`. `sprintsCompletedOn` counts
 * SPRINTS, never their duration — nothing in this file could feed the pace
 * equation even by accident, because it never produces an hours figure at
 * all.
 */

/**
 * ISO weekday (1 Monday .. 7 Sunday — CLAUDE.md's Monday-first week,
 * matching every other weekday-numbered field in this app:
 * `TemplateSchedule.days`, `StudySchedule.days`, `DailyTarget.restDay`).
 * `recurrence.ts` calls date-fns's `getISODay` directly inline rather than
 * through a named wrapper, so there's no existing helper to reuse — this is
 * the first call site in this app that wants one as its own named,
 * independently testable function.
 */
export function isoWeekday(date: Date): number {
  return getISODay(date);
}

/**
 * How many sprints ENDED on `date`'s LOCAL calendar day, regardless of how
 * long any of them ran. Deliberately any-length: this counts starts (and
 * honest finishes), the psychology this increment is built around — a
 * 4-minute false start still got Deepak into the ritual and back out the
 * other side, and still counts here, even though it would barely move
 * `examProjection.ts`'s hour math. Measuring actual duration is that file's
 * job (`sprintMinutes`/`loggedHoursByTopic`), not this one's — see this
 * file's header comment for why the two must never be conflated.
 *
 * Compares `endedAt` as a local `Date` (date-fns's `isSameDay`) rather than
 * an ISO-string slice, same reasoning as every other local-calendar-day
 * comparison in this app (`recurrence.ts`'s `isoDateString` comment): a
 * UTC-based slice would silently misattribute a sprint finished late at
 * night or very early in the morning to the wrong calendar day for anyone
 * not on UTC — Central European Time included.
 */
export function sprintsCompletedOn(date: Date, sprints: Sprint[]): number {
  return sprints.filter((sprint) => sprint.endedAt !== null && isSameDay(new Date(sprint.endedAt), date)).length;
}

/**
 * The Today line ExamOverview.tsx, Sprint.tsx's PostSprintView, and the
 * Prüfung widget all build on — `null` when Deepak hasn't set a
 * `dailyTarget` at all (every caller omits the line entirely in that case,
 * never a dash or a bare "0 of 0").
 *
 * Rest day short-circuits to a fixed, unconditionally-acknowledging
 * sentence — `met: true`, since a rest day has nothing to fall short of —
 * before the sprint count is even read. Every other day reads
 * `sprintsCompletedOn(now, sprints)` against `dailyTarget.sprints`, with
 * the count never capped against the target: 4 sprints logged against a
 * target of 3 reads honestly as "Today: 4 of 3 sprints.", not silently
 * clamped to "3 of 3." — CLAUDE.md's "UI copy should be exact, not
 * approximate" rule, applied to a number instead of a sentence.
 */
export function todayLine(
  now: Date,
  dailyTarget: DailyTarget | null,
  sprints: Sprint[],
): { text: string; met: boolean } | null {
  if (dailyTarget == null) return null;

  if (dailyTarget.restDay !== null && isoWeekday(now) === dailyTarget.restDay) {
    return { text: 'Rest day.', met: true };
  }

  const completed = sprintsCompletedOn(now, sprints);
  return {
    text: `Today: ${completed} of ${dailyTarget.sprints} sprints.`,
    met: completed >= dailyTarget.sprints,
  };
}
