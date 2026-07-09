import { startOfWeek } from 'date-fns';
import type { Exam, Sprint, Topic } from '../db/types';

// Prüfung mode's one equation (RUNWAY_PRUFUNG_PLAN.md §2), the exam-prep
// analog of projection.ts's departure-mode math: pure functions, `now`
// always an explicit argument (never read internally) so every number here
// is testable without mocking the system clock and re-derivable every tick
// from a live-updating screen.

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Actual minutes worked on one sprint, floored at 0. `endedAt` is `null`
 * while a sprint is still live — per the increment spec, an unfinished
 * sprint has no measured duration yet, so this returns 0 for one rather
 * than throwing; every caller in this file filters those out before they'd
 * ever reach here anyway (see loggedHoursByTopic), but a defensive 0 keeps
 * this function honest on its own if that invariant ever slips.
 */
export function sprintMinutes(sprint: Pick<Sprint, 'startedAt' | 'endedAt'>): number {
  if (sprint.endedAt === null) return 0;
  const minutes = Math.floor(
    (new Date(sprint.endedAt).getTime() - new Date(sprint.startedAt).getTime()) / MS_PER_MINUTE,
  );
  return Math.max(0, minutes);
}

/** Summed actual hours per topic, from finished sprints only. Fractional
 * (not rounded) — remainingHours below needs the precision, and the UI
 * rounds to one decimal only at the point it's displayed (format.ts's job,
 * not this one). */
export function loggedHoursByTopic(sprints: Sprint[]): Map<string, number> {
  const hoursByTopic = new Map<string, number>();
  for (const sprint of sprints) {
    if (sprint.endedAt === null) continue;
    const hours = sprintMinutes(sprint) / 60;
    hoursByTopic.set(sprint.topicId, (hoursByTopic.get(sprint.topicId) ?? 0) + hours);
  }
  return hoursByTopic;
}

/**
 * Hours still needed across every topic. Summed per-topic at
 * max(0, estimated − logged) rather than max(0, sum(estimated) −
 * sum(logged)) — an hour spent past one topic's estimate says that
 * estimate was wrong, not that some other, unrelated chapter got easier.
 * Over-studying Vascular syndromes never subsidizes Neuromuscular disease.
 */
export function remainingHours(topics: Topic[], sprints: Sprint[]): number {
  const logged = loggedHoursByTopic(sprints);
  return topics.reduce(
    (sum, topic) => sum + Math.max(0, topic.estimatedHours - (logged.get(topic.id) ?? 0)),
    0,
  );
}

/** The labeled assumption used before any sprint has been logged
 * (RUNWAY_PRUFUNG_PLAN.md §2) — never an aspirational pace, a modest,
 * named-as-a-guess one. */
export const DEFAULT_PACE_HOURS_PER_WEEK = 4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Median logged hours/week over the last 4 COMPLETE Monday-start ISO weeks
 * — deliberately excludes the current, still-in-progress week (a Tuesday
 * would otherwise always read as a slow week purely because most of it
 * hasn't happened yet, which would make the measured pace look worse than
 * reality every single day except Sunday night).
 *
 * A week with zero logged hours inside the 4-week window counts as a 0 in
 * the median, not as "no data" to skip — skipping empty weeks would hide
 * exactly the avoidance this whole mode exists to make visible. The only
 * case that falls back to `null` (letting the caller use the labeled
 * default instead) is when there isn't a single completed sprint anywhere
 * in the 4-week window: at that point there's no measurement to report at
 * all, as opposed to a measurement of "zero pace" — those are different
 * facts and the UI treats them differently (default-and-labeled vs.
 * measured-and-zero).
 */
export function measuredPaceHoursPerWeek(now: Date, sprints: Sprint[]): number | null {
  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 }).getTime();
  const windowStart = currentWeekStart - 4 * MS_PER_WEEK;

  const completedInWindow = sprints.filter((sprint) => {
    if (sprint.endedAt === null) return false;
    const startedAtMs = new Date(sprint.startedAt).getTime();
    return startedAtMs >= windowStart && startedAtMs < currentWeekStart;
  });

  if (completedInWindow.length === 0) return null;

  const weeklyHours: number[] = [];
  for (let weeksAgo = 4; weeksAgo >= 1; weeksAgo--) {
    const weekStart = currentWeekStart - weeksAgo * MS_PER_WEEK;
    const weekEnd = weekStart + MS_PER_WEEK;
    const hours = completedInWindow
      .filter((sprint) => {
        const startedAtMs = new Date(sprint.startedAt).getTime();
        return startedAtMs >= weekStart && startedAtMs < weekEnd;
      })
      .reduce((sum, sprint) => sum + sprintMinutes(sprint) / 60, 0);
    weeklyHours.push(hours);
  }

  return median(weeklyHours);
}

/** Logged hours in the current Monday-start week — the actionable line's
 * "This week: y of x" figure. Unlike measuredPaceHoursPerWeek, this one
 * *is* the partial week; it's read as "so far", not as a rate. */
export function hoursThisWeek(now: Date, sprints: Sprint[]): number {
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }).getTime();
  const weekEnd = weekStart + MS_PER_WEEK;
  return sprints
    .filter((sprint) => sprint.endedAt !== null)
    .filter((sprint) => {
      const startedAtMs = new Date(sprint.startedAt).getTime();
      return startedAtMs >= weekStart && startedAtMs < weekEnd;
    })
    .reduce((sum, sprint) => sum + sprintMinutes(sprint) / 60, 0);
}

export interface ExamProjectionResult {
  readyDate: Date | null;
  anchor: Date;
  anchorKind: 'window' | 'exact';
  /** Whole days between readyDate and anchor; negative means the readyDate
   * falls after the exam. `null` only alongside a `null` readyDate — there's
   * no margin to report against an anchor when there's no projected date. */
  slackDays: number | null;
  state: 'calm' | 'tight' | 'late' | 'done';
  /** hours/week actually used for this projection — measured pace when
   * available, DEFAULT_PACE_HOURS_PER_WEEK otherwise. */
  pace: number;
  paceIsMeasured: boolean;
  remainingHours: number;
  /** hours/week needed to be ready exactly at the anchor date; `null` once
   * the anchor is here or past (dividing remaining hours by zero or
   * negative weeks isn't a rate) — the screen shows "the exam window is
   * open" instead of a number in that case. */
  requiredPaceHoursPerWeek: number | null;
}

/** Same reasoning as format.ts's formatExamAnchorLine: a bare
 * `new Date('2026-11-01')` parses as UTC midnight, which can land on the
 * previous calendar day once JS shifts it into a timezone behind UTC. This
 * file can't just import that helper (it's private inside a formatter
 * built for display strings, not Date math) so the same three-line fix is
 * repeated here rather than reaching across layers for it. */
function parseLocalDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * The whole mode's one equation (RUNWAY_PRUFUNG_PLAN.md §2):
 *
 *   projected ready date = now + (remaining study hours ÷ measured pace)
 *
 * anchor is examDate once it's known, windowStart until then — same
 * override rule as format.ts's formatExamAnchorLine, restated here because
 * this function needs the parsed Date, not just the display string.
 */
export function examProjection(
  now: Date,
  exam: Pick<Exam, 'windowStart' | 'examDate'>,
  topics: Topic[],
  sprints: Sprint[],
): ExamProjectionResult {
  const anchorKind: ExamProjectionResult['anchorKind'] = exam.examDate ? 'exact' : 'window';
  const anchor = parseLocalDate(exam.examDate ?? exam.windowStart);

  const remaining = remainingHours(topics, sprints);
  const measuredPace = measuredPaceHoursPerWeek(now, sprints);
  const paceIsMeasured = measuredPace !== null;
  const pace = measuredPace ?? DEFAULT_PACE_HOURS_PER_WEEK;

  const weeksUntilAnchor = (anchor.getTime() - now.getTime()) / MS_PER_WEEK;
  // Once the anchor is today or in the past, "hours needed per week to get
  // there" no longer means anything (zero or negative weeks to divide by)
  // — the screen has its own copy for an open exam window instead.
  const requiredPaceHoursPerWeek = weeksUntilAnchor > 0 ? remaining / weeksUntilAnchor : null;

  if (remaining === 0) {
    return {
      readyDate: now,
      anchor,
      anchorKind,
      slackDays: daysBetween(now, anchor),
      state: 'done',
      pace,
      paceIsMeasured,
      remainingHours: 0,
      requiredPaceHoursPerWeek,
    };
  }

  if (pace === 0) {
    // A measured pace of exactly zero (the last 4 complete weeks logged no
    // hours at all) can't be projected forward — dividing remaining hours
    // by a zero rate is undefined, and even a very large finite number
    // would misrepresent what's actually true: at zero hours/week, the
    // honest projection is "never", not "eventually, very late". The
    // screen renders this state as the word "Never", not a date far in the
    // future.
    return {
      readyDate: null,
      anchor,
      anchorKind,
      slackDays: null,
      state: 'late',
      pace,
      paceIsMeasured,
      remainingHours: remaining,
      requiredPaceHoursPerWeek,
    };
  }

  const weeksNeeded = remaining / pace;
  const readyDate = new Date(now.getTime() + weeksNeeded * MS_PER_WEEK);
  const slackDays = daysBetween(readyDate, anchor);
  const state: ExamProjectionResult['state'] = slackDays < 0 ? 'late' : slackDays < 14 ? 'tight' : 'calm';

  return {
    readyDate,
    anchor,
    anchorKind,
    slackDays,
    state,
    pace,
    paceIsMeasured,
    remainingHours: remaining,
    requiredPaceHoursPerWeek,
  };
}
