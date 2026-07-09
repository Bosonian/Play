import type { Sprint, Topic } from '../db/types';
import { loggedHoursByTopic } from './examProjection';

// The "guided layer" increment's core mechanic (RUNWAY_PRUFUNG_PLAN.md §1's
// psychology contract, restated in the increment brief): reduce the number
// of decisions between "I have a moment" and "a sprint is running", without
// inventing a schedule the app has no business inventing. nextMove() never
// picks a day or a time — only which topic and what length, both derived
// from data that already exists (recent sprints, topic estimates), and the
// UI always shows its reasoning alongside the suggestion (ExamOverview.tsx)
// so this reads as "a suggestion with its work shown", never an oracle.

const MS_PER_HOUR = 60 * 60_000;

/** How recently a topic must have been sprinted to still count as "warm"
 * (RUNWAY_PRUFUNG_PLAN.md's MOMENTUM rule). 48h, not 24h: a topic worked on
 * yesterday evening is still the natural thing to continue this morning —
 * a same-calendar-day-only window would call that a cold start when it
 * plainly isn't. */
const MOMENTUM_WINDOW_MS = 48 * MS_PER_HOUR;

/** The three fixed sprint lengths (SprintSetup.tsx's SPRINT_LENGTHS) —
 * duplicated here rather than imported because SprintSetup's copy is a
 * screen-local constant, not something lib/ code should depend on; this is
 * the pure-logic layer's own source of truth for the same three numbers. */
const SPRINT_LENGTHS = [25, 50, 90] as const;
export type SprintLength = (typeof SPRINT_LENGTHS)[number];

export type NextMoveReason = 'momentum' | 'behind' | 'start';

export interface NextMove {
  topicId: string;
  topicName: string;
  plannedMinutes: SprintLength;
  reason: NextMoveReason;
}

/** Per-topic remaining hours, floored at 0 — the same arithmetic as
 * examProjection.ts's remainingHours, but kept keyed by topic instead of
 * summed across all of them. The exam-wide total only needs "how much is
 * left overall"; next-move selection needs to compare topics against each
 * other, so the per-topic shape is what's useful here. */
function remainingHoursByTopic(topics: Topic[], sprints: Sprint[]): Map<string, number> {
  const logged = loggedHoursByTopic(sprints);
  const remaining = new Map<string, number>();
  for (const topic of topics) {
    remaining.set(topic.id, Math.max(0, topic.estimatedHours - (logged.get(topic.id) ?? 0)));
  }
  return remaining;
}

/**
 * Median plannedMinutes of the last 5 completed sprints, snapped DOWN to
 * the nearest of {25, 50, 90} — 25 (the lowest initiation bar: the shortest
 * box there is) when there's no completed-sprint history yet, so the very
 * first suggestion never asks for more than the smallest possible
 * commitment. Snapping down rather than to the nearest value is deliberate:
 * a recent pattern of, say, 30–40 minutes (a median between 25 and 50)
 * rounding UP to 50 would suggest a longer sprint than what's actually been
 * typical, which works against the point of a card that exists to lower
 * the bar, not raise it.
 */
export function suggestedPlannedMinutes(sprints: Sprint[]): SprintLength {
  const recentCompleted = sprints
    .filter((sprint) => sprint.endedAt !== null)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 5);

  if (recentCompleted.length === 0) return 25;

  const sortedMinutes = recentCompleted.map((sprint) => sprint.plannedMinutes).sort((a, b) => a - b);
  const mid = Math.floor(sortedMinutes.length / 2);
  const median =
    sortedMinutes.length % 2 === 0 ? (sortedMinutes[mid - 1] + sortedMinutes[mid]) / 2 : sortedMinutes[mid];

  // Largest of {25, 50, 90} that doesn't exceed the median — SPRINT_LENGTHS
  // is ascending, so the last one that still fits is the snap-down result.
  // 25 is always reachable (the loop's starting value), so this can never
  // fall through to something outside the three valid lengths.
  let snapped: SprintLength = 25;
  for (const length of SPRINT_LENGTHS) {
    if (length <= median) snapped = length;
  }
  return snapped;
}

/**
 * The next-move card's suggestion (increment brief §1) — which topic to
 * work on and for how long, in priority order:
 *
 *   a. MOMENTUM — a topic sprinted (and finished) within the last 48h that
 *      still has remaining hours. Staying in a topic that's already warm
 *      beats a context-switch, so this outranks everything else. Ties
 *      (more than one topic sprinted recently) resolve to whichever was
 *      sprinted most recently.
 *   b. START — no sprint has ever been logged at all: the first topic by
 *      `order`, i.e. "wherever your list starts", rather than reaching for
 *      whichever topic happens to have the biggest hour estimate. Checked
 *      before BEHIND (even though it's listed after it in the spec) because
 *      its precondition — zero sprints, ever — is a strict subset of what
 *      BEHIND would otherwise also match, and a genuinely blank slate reads
 *      as "first thing in your list", not "the biggest chapter is furthest
 *      behind" (a technically-true but strange thing to say about a topic
 *      nothing has been done on yet).
 *   c. BEHIND — otherwise, the topic with the largest remaining hours
 *      (estimated − logged, floored at 0). Ties → lowest `order`. Absolute
 *      hours, not fractional-remaining (e.g. not "80% left"): a topic with
 *      40h left out of 40h estimated and one with 5h left out of 5h are
 *      equally "0% done", but the first is the one actually holding the
 *      exam back — visible, explainable logic beats a cleverer fraction
 *      that would rank them the same.
 *
 * Returns null when there's nothing to suggest: no topics at all, or every
 * topic already has 0 remaining hours (fully studied to estimate).
 */
export function nextMove(now: Date, topics: Topic[], sprints: Sprint[]): NextMove | null {
  if (topics.length === 0) return null;

  const remaining = remainingHoursByTopic(topics, sprints);
  const anyRemaining = topics.some((topic) => (remaining.get(topic.id) ?? 0) > 0);
  if (!anyRemaining) return null;

  const plannedMinutes = suggestedPlannedMinutes(sprints);

  // a. MOMENTUM
  const recentSprintOnWarmTopic = sprints
    .filter((sprint) => sprint.endedAt !== null)
    .filter((sprint) => now.getTime() - new Date(sprint.startedAt).getTime() < MOMENTUM_WINDOW_MS)
    .filter((sprint) => (remaining.get(sprint.topicId) ?? 0) > 0)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

  if (recentSprintOnWarmTopic) {
    const topic = topics.find((t) => t.id === recentSprintOnWarmTopic.topicId);
    // topic can only be missing here if a sprint outlived its topic (F7-style
    // dangling reference, same class TopicEdit already guards against on
    // delete) — falls through to START/BEHIND below rather than suggesting
    // a topic that no longer exists.
    if (topic) {
      return { topicId: topic.id, topicName: topic.name, plannedMinutes, reason: 'momentum' };
    }
  }

  // b. START
  if (sprints.length === 0) {
    const first = [...topics].sort((a, b) => a.order - b.order)[0];
    return { topicId: first.id, topicName: first.name, plannedMinutes, reason: 'start' };
  }

  // c. BEHIND
  const behindOrdered = topics
    .filter((topic) => (remaining.get(topic.id) ?? 0) > 0)
    .sort((a, b) => {
      const byRemaining = (remaining.get(b.id) ?? 0) - (remaining.get(a.id) ?? 0);
      return byRemaining !== 0 ? byRemaining : a.order - b.order;
    });

  const behindTopic = behindOrdered[0];
  return { topicId: behindTopic.id, topicName: behindTopic.name, plannedMinutes, reason: 'behind' };
}
