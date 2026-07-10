import { addWeeks, startOfWeek, subWeeks } from 'date-fns';
import type { Exam, Milestone, Sprint, Topic } from '../db/types';

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
 * Median logged hours/week, over the complete Monday-start ISO weeks that
 * POSTDATE the first-ever completed sprint — capped at the last 4 complete
 * weeks. Deliberately excludes the current, still-in-progress week (a
 * Tuesday would otherwise always read as a slow week purely because most
 * of it hasn't happened yet, which would make the measured pace look worse
 * than reality every single day except Sunday night).
 *
 * Why "postdate the first sprint" (F1 fix): a fixed 4-week window measured
 * from `now`, unconditionally, zero-pads every week before Deepak's first
 * sprint too — so in week two of actually studying, the window would read
 * [0, 0, 0, x] (three weeks that predate any studying, plus the one real
 * week) and median() of that is 0. That punishes the first week of real
 * effort harder than doing nothing at all, which is exactly backwards.
 * Scoping the window to start no earlier than the first sprint's own week
 * fixes that: week two reads as median([x, 0]) instead, and week one reads
 * as median([x]) — both meaningfully above zero for someone who just
 * started.
 *
 * A week with zero logged hours WITHIN that (now correctly scoped) window
 * still counts as a 0 in the median, not as "no data" to skip — once
 * studying has started, a silent week is a real stall and must read as
 * decline, not be hidden by shrinking the window further. This is the
 * distinction that matters: weeks that PREDATE the first sprint are
 * excluded (there was nothing to measure yet), but weeks that POSTDATE it
 * are never excluded just because they're empty — an empty week after
 * starting is real avoidance, and hiding it would defeat the whole point
 * of this mode.
 *
 * Two cases fall back to `null` (letting the caller use the labeled
 * default instead): no completed sprint anywhere, ever (nothing to scope a
 * window from), and a first sprint so recent that no complete week has
 * finished since it (nothing measurable has elapsed yet — see the inline
 * comment below). Once at least one complete week postdates the first
 * sprint, this always returns a measured number, even if that number is 0
 * (one sprint logged 10 weeks ago and total silence since reads as a
 * measured 0 h/week — an honest "Never", not a default-pace guess dressed
 * up as one — because at that point it IS a measurement, just of decline).
 *
 * Week boundaries are built via date-fns's startOfWeek/subWeeks (calendar
 * arithmetic), not fixed millisecond subtraction (F6) — Europe/Berlin's
 * DST-end (last Sunday of October, inside this exam's prep window) makes
 * one week 25 hours long in wall-clock terms; subtracting a fixed
 * `7 * MS_PER_DAY` across that boundary lands on the wrong instant instead
 * of the actual next/previous Monday 00:00 local.
 */
export function measuredPaceHoursPerWeek(now: Date, sprints: Sprint[]): number | null {
  const completed = sprints.filter((sprint) => sprint.endedAt !== null);
  if (completed.length === 0) return null;

  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });

  const firstSprintStartMs = Math.min(...completed.map((sprint) => new Date(sprint.startedAt).getTime()));
  const firstSprintWeekStart = startOfWeek(new Date(firstSprintStartMs), { weekStartsOn: 1 });

  // How many complete weeks separate the week studying started in from
  // "now"'s current (excluded) week — capped at 4 (the standard window
  // width; older history than that still only ever contributes 4 buckets).
  let weeksSinceFirstSprint = 0;
  let cursor = currentWeekStart;
  while (weeksSinceFirstSprint < 4 && cursor.getTime() > firstSprintWeekStart.getTime()) {
    weeksSinceFirstSprint++;
    cursor = subWeeks(cursor, 1);
  }

  // Zero complete weeks since the first sprint means the first-ever sprint
  // happened in the still-in-progress current week: every already-complete
  // week PREDATES the start of studying, which is exactly the class this
  // window exists to exclude ("there was nothing to measure yet").
  // Measuring one of those weeks anyway would read as 0 and put "Never" on
  // the screen on the very first day of use — the week-one twin of the
  // week-two bug this scoping fixes. No measurable week yet → null → the
  // caller's labeled default carries until the first Monday rollover.
  if (weeksSinceFirstSprint === 0) return null;
  const weeksToMedian = weeksSinceFirstSprint;

  const weeklyHours: number[] = [];
  for (let weeksAgo = weeksToMedian; weeksAgo >= 1; weeksAgo--) {
    const weekStart = subWeeks(currentWeekStart, weeksAgo);
    const weekEnd = subWeeks(currentWeekStart, weeksAgo - 1);
    const hours = completed
      .filter((sprint) => {
        const startedAtMs = new Date(sprint.startedAt).getTime();
        return startedAtMs >= weekStart.getTime() && startedAtMs < weekEnd.getTime();
      })
      .reduce((sum, sprint) => sum + sprintMinutes(sprint) / 60, 0);
    weeklyHours.push(hours);
  }

  return median(weeklyHours);
}

/** Logged hours in the current Monday-start week — the actionable line's
 * "This week: y of x" figure. Unlike measuredPaceHoursPerWeek, this one
 * *is* the partial week; it's read as "so far", not as a rate. Boundaries
 * built via startOfWeek/addWeeks (F6), same DST reasoning as
 * measuredPaceHoursPerWeek above — a fixed `weekStart + MS_PER_WEEK` would
 * land an hour off the real next Monday 00:00 across Europe/Berlin's
 * DST-end. */
export function hoursThisWeek(now: Date, sprints: Sprint[]): number {
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = addWeeks(weekStart, 1);
  return sprints
    .filter((sprint) => sprint.endedAt !== null)
    .filter((sprint) => {
      const startedAtMs = new Date(sprint.startedAt).getTime();
      return startedAtMs >= weekStart.getTime() && startedAtMs < weekEnd.getTime();
    })
    .reduce((sum, sprint) => sum + sprintMinutes(sprint) / 60, 0);
}

/**
 * The most hours ever logged in a single Monday-start week, across every
 * completed sprint in this exam's history — the self-Competitor line
 * (CLAUDE.md: secondary play personality) on ExamOverview: "Best week: N h."
 * Deliberately NOT the last-4-week window measuredPaceHoursPerWeek uses —
 * that window measures CURRENT pace; this measures a personal best over all
 * of history, so a strong week from two months ago still counts.
 *
 * The current, still-in-progress week is excluded — same reasoning as
 * measuredPaceHoursPerWeek's own exclusion of it (this file's header
 * comment on that function): "best week" is a claim about a completed
 * record, and a partial week is still accumulating. Without this exclusion,
 * a big Monday could make Tuesday morning's screen claim a "best week"
 * that's really just two days old and likely to be revised — the exact
 * kind of approximate claim CLAUDE.md's copy rule ("exact, not
 * approximate") warns against.
 *
 * `null` when there's no complete week to report on: no completed sprint
 * anywhere, or every completed sprint so far falls inside the current
 * (excluded) week — both read as "no best week yet" rather than 0, since 0
 * would falsely claim a real, finished week that logged nothing.
 *
 * Week boundaries use startOfWeek (F6, same DST reasoning as
 * measuredPaceHoursPerWeek/hoursThisWeek above) rather than fixed
 * millisecond bucketing, so grouping stays correct across Europe/Berlin's
 * DST transitions.
 */
export function bestWeekHours(now: Date, sprints: Sprint[]): number | null {
  const completed = sprints.filter((sprint) => sprint.endedAt !== null);
  if (completed.length === 0) return null;

  const currentWeekStartMs = startOfWeek(now, { weekStartsOn: 1 }).getTime();

  const hoursByWeekStartMs = new Map<number, number>();
  for (const sprint of completed) {
    const weekStartMs = startOfWeek(new Date(sprint.startedAt), { weekStartsOn: 1 }).getTime();
    if (weekStartMs >= currentWeekStartMs) continue; // still in progress, not yet a "week" to compare
    hoursByWeekStartMs.set(weekStartMs, (hoursByWeekStartMs.get(weekStartMs) ?? 0) + sprintMinutes(sprint) / 60);
  }

  if (hoursByWeekStartMs.size === 0) return null;
  return Math.max(...hoursByWeekStartMs.values());
}

export interface ExamProjectionResult {
  readyDate: Date | null;
  anchor: Date;
  anchorKind: 'window' | 'exact';
  /** Whole days between readyDate and anchor; negative means the readyDate
   * falls after the exam. `null` only alongside a `null` readyDate — there's
   * no margin to report against an anchor when there's no projected date. */
  slackDays: number | null;
  state: 'calm' | 'tight' | 'late' | 'done' | 'empty';
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
 * The shared core behind both examProjection and milestoneProjection below —
 * everything the equation needs once it already has a resolved `anchor`
 * Date and `anchorKind` to attach to the result. Split out so
 * milestoneProjection doesn't have to fake up an `Exam`-shaped object just
 * to reuse this math: a milestone's anchor is a full ISO datetime (`at`),
 * not a date-only string like Exam's `windowStart`/`examDate`, so it can't
 * go through parseLocalDate the way examProjection's anchor does.
 */
function projectFromAnchor(
  now: Date,
  anchor: Date,
  anchorKind: ExamProjectionResult['anchorKind'],
  topics: Topic[],
  sprints: Sprint[],
): ExamProjectionResult {
  const remaining = remainingHours(topics, sprints);
  const measuredPace = measuredPaceHoursPerWeek(now, sprints);
  const paceIsMeasured = measuredPace !== null;
  const pace = measuredPace ?? DEFAULT_PACE_HOURS_PER_WEEK;

  // Empty-exam honesty (field screenshot: an exam with ZERO topics rendered
  // "Ready by 10 Jul" plus an emerald "All topics at their estimated
  // hours." — a confident, fully-done-looking screen for an exam with
  // nothing in it). remainingHours() sums to 0 over an empty topic list, or
  // over a list where every topic's estimatedHours is 0, exactly the same
  // way it does once real topics are genuinely finished — the `remaining
  // === 0` branch below can't tell "nothing to study" apart from "studied
  // everything" on its own. 'empty' is checked first and short-circuits
  // before that branch so the two can never be confused: 'done' now means
  // real topics, with real hour estimates, actually covered — not merely
  // "the number happens to be zero". readyDate/slackDays/
  // requiredPaceHoursPerWeek are all null here (there is no projection to
  // report against topics that don't exist yet), and this applies to
  // milestoneProjection's fallback-to-whole-exam case too, not just
  // examProjection directly — a milestone that resolves to an empty topic
  // set is exactly as vacuous as the exam-level case.
  if (topics.length === 0 || topics.reduce((sum, topic) => sum + topic.estimatedHours, 0) === 0) {
    return {
      readyDate: null,
      anchor,
      anchorKind,
      slackDays: null,
      state: 'empty',
      pace,
      paceIsMeasured,
      remainingHours: remaining,
      requiredPaceHoursPerWeek: null,
    };
  }

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

  // Shared by the zero-pace branch below and the overflow guard further
  // down (F5) — both are "no projection is possible" and render identically
  // (the screen shows the word "Never", not a date), so they share one
  // result shape rather than two copies that could drift apart.
  const neverReady = (): ExamProjectionResult => ({
    readyDate: null,
    anchor,
    anchorKind,
    slackDays: null,
    state: 'late',
    pace,
    paceIsMeasured,
    remainingHours: remaining,
    requiredPaceHoursPerWeek,
  });

  if (pace === 0) {
    // A measured pace of exactly zero (the last 4 complete weeks logged no
    // hours at all) can't be projected forward — dividing remaining hours
    // by a zero rate is undefined, and even a very large finite number
    // would misrepresent what's actually true: at zero hours/week, the
    // honest projection is "never", not "eventually, very late". The
    // screen renders this state as the word "Never", not a date far in the
    // future.
    return neverReady();
  }

  const weeksNeeded = remaining / pace;
  const readyDate = new Date(now.getTime() + weeksNeeded * MS_PER_WEEK);
  if (!Number.isFinite(readyDate.getTime())) {
    // Overflow guard (F5): an extreme `remaining` (e.g. a corrupted or
    // otherwise-out-of-range estimatedHours that slipped past TopicEdit's
    // clamp — direct DB edits, a future import feature, ...) can push
    // `weeksNeeded * MS_PER_WEEK` past what a double can represent, making
    // `readyDate` an Invalid Date whose getTime() is NaN. Every date
    // comparison downstream (daysBetween, formatDateMedium, ...) would
    // silently produce NaN or garbage instead of a visible error, so this
    // is caught here and treated exactly like the zero-pace "Never" case.
    return neverReady();
  }
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
  return projectFromAnchor(now, anchor, anchorKind, topics, sprints);
}

/**
 * A milestone's own mini ready-date projection (RUNWAY_PRUFUNG_PLAN.md §4.1,
 * increment 4) — the same equation as examProjection, but scoped to the
 * subset of topics the milestone actually covers and anchored to the
 * milestone's own date+time instead of the exam's.
 *
 * Topic scoping: `milestone.topicIds` filters the exam's full topic list
 * down to the ones this milestone is about (a mock oral on "Vascular
 * syndromes" only needs that chapter ready, not the whole exam). An EMPTY
 * `topicIds` means "no explicit subset was chosen" — MilestoneEdit's UI
 * copy states this directly ("No topics selected: covers the whole exam."),
 * and this function is where that meaning is actually implemented: falling
 * through to the full topic list rather than projecting against zero
 * topics (which would otherwise trivially read as "done" — remainingHours
 * of an empty topic list is 0 — a wrong answer dressed up as a right one).
 *
 * The same fallback applies when `topicIds` is NON-empty but every id it
 * references has since been deleted (F7) — TopicEdit prunes a deleted
 * topic out of every milestone's `topicIds` on save (see its own comment),
 * so this should be rare, but it's not the only writer of a Milestone row
 * (a future bulk-edit, a direct DB fix, ...), and a stale reference here
 * would fail exactly the same way an empty subset would: filtering to zero
 * topics reads as trivially "done" rather than as "no valid subset was
 * actually selected". Both cases get the same whole-exam fallback.
 *
 * Pace is NOT scoped to the subset — it stays the same measured (or
 * default) pace examProjection uses, because "how fast am I actually
 * studying" is one number about the whole prep effort, not a per-milestone
 * fact. Only the numerator (remaining hours) changes with the subset; the
 * denominator (hours/week) doesn't. `sprints` is passed through unfiltered
 * for the same reason: remainingHours/loggedHoursByTopic already only
 * attribute a sprint's hours to sprint.topicId, so a sprint on a topic
 * outside the subset simply never contributes to this projection's
 * remaining-hours sum — no separate filtering of `sprints` is needed for
 * that to be correct, only of `topics`.
 */
export function milestoneProjection(
  now: Date,
  milestone: Pick<Milestone, 'at' | 'topicIds'>,
  topics: Topic[],
  sprints: Sprint[],
): ExamProjectionResult {
  const referencedTopics = topics.filter((topic) => milestone.topicIds.includes(topic.id));
  const subsetTopics = milestone.topicIds.length === 0 || referencedTopics.length === 0 ? topics : referencedTopics;
  const anchor = new Date(milestone.at);
  return projectFromAnchor(now, anchor, 'exact', subsetTopics, sprints);
}

// --- Zombie-sprint reconciliation (F3) ---
//
// A sprint's live screen is the only place `endedAt` ever gets set. If
// that screen never gets the chance to do it — the app is force-closed, the
// phone dies, the tab is closed mid-sprint — the sprint row sits forever
// with `endedAt: null`, indistinguishable from one that's still genuinely
// running. Two screens need to agree on when "still running" stops being
// plausible and becomes "this needs manual reconciliation": ExamOverview
// (which shows a quiet pointer back to a genuinely live sprint, and a
// reconciliation card for a zombie one) and SprintSetup (which must refuse
// to start a second concurrent sprint while a live one exists, but must NOT
// refuse just because a zombie is sitting unresolved). Both live off this
// one shared threshold and these two shared queries, so they can't quietly
// drift into disagreeing with each other about which is which.

/** How long an unfinished sprint (`endedAt === null`) still counts as
 * genuinely "currently running" rather than a zombie needing manual
 * reconciliation. A crash or force-close can leave a sprint stuck with no
 * `endedAt` forever; without a cutoff, that dead row would look "live"
 * indefinitely, blocking a new sprint from ever starting and inviting a tap
 * into a sprint that isn't actually happening. 12 hours comfortably exceeds
 * the longest real sprint (90 min planned, plus generous overrun) while
 * still being short enough that "still running" and "abandoned" are never
 * ambiguous in practice for a single-user app. */
export const LIVE_SPRINT_THRESHOLD_MS = 12 * 60 * 60_000;

/** The most recently started unfinished sprint still within
 * LIVE_SPRINT_THRESHOLD_MS of its start, if any — "genuinely still
 * running" from the user's point of view. Sorts by `startedAt` rather than
 * assuming `sprints` arrives pre-sorted, and picks the most recent
 * candidate to stay deterministic if more than one somehow qualifies (in
 * practice SprintSetup's own gate and this same threshold prevent a second
 * concurrent live sprint from ever being created, but this function
 * doesn't itself enforce that invariant, so it stays defensive rather than
 * assuming it). */
export function findLiveSprint(sprints: Sprint[], now: Date): Sprint | undefined {
  return sprints
    .filter(
      (sprint) => sprint.endedAt === null && now.getTime() - new Date(sprint.startedAt).getTime() < LIVE_SPRINT_THRESHOLD_MS,
    )
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
}

/** Unfinished sprints (`endedAt === null`) started LIVE_SPRINT_THRESHOLD_MS
 * or longer ago — sprints the live screen crashed out of, or that were
 * simply forgotten, rather than ones genuinely still in progress. Returned
 * oldest-first so ExamOverview's reconciliation card resolves the
 * longest-outstanding one first; the caller takes just the first entry so
 * the card only ever surfaces one at a time, and the next appears once the
 * current one is resolved. */
export function zombieSprints(sprints: Sprint[], now: Date): Sprint[] {
  return sprints
    .filter(
      (sprint) => sprint.endedAt === null && now.getTime() - new Date(sprint.startedAt).getTime() >= LIVE_SPRINT_THRESHOLD_MS,
    )
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}
