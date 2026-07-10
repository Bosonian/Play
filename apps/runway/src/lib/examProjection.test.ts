import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACE_HOURS_PER_WEEK,
  bestWeekHours,
  examProjection,
  hoursThisWeek,
  loggedHoursByTopic,
  measuredPaceHoursPerWeek,
  milestoneProjection,
  remainingHours,
  sprintMinutes,
} from './examProjection';
import type { Exam, Milestone, Sprint, Topic } from '../db/types';

// Thursday, so the current (excluded) week runs 2026-07-06 (Mon) through
// 2026-07-13 (Mon, exclusive) — a fixed "now" for every test so assertions
// aren't racing the real clock.
const NOW = new Date('2026-07-09T08:00:00.000Z');

function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
  return {
    id: crypto.randomUUID(),
    examId: 'exam-1',
    topicId: 'topic-1',
    plannedMinutes: 50,
    startedAt: '2026-07-01T08:00:00.000Z',
    endedAt: '2026-07-01T08:50:00.000Z',
    ritual: [],
    createdAt: '2026-07-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return { id: 'topic-1', examId: 'exam-1', name: 'Vascular syndromes', estimatedHours: 10, order: 0, ...overrides };
}

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 'exam-1',
    name: 'Facharztprüfung Neurologie',
    windowStart: '2026-11-01',
    examDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'milestone-1',
    examId: 'exam-1',
    name: 'Mock oral with OA Weber',
    at: '2026-08-01T14:00:00.000Z',
    topicIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// A sprint that started `weeksAgo` complete weeks before NOW's current
// week and ran for `hours`. weeksAgo=1 lands inside the most recent
// complete week (2026-06-29 to 2026-07-06); weeksAgo=4 the earliest of the
// 4-week window.
function sprintWeeksAgo(weeksAgo: number, hours: number, topicId = 'topic-1'): Sprint {
  const currentWeekStartMs = Date.parse('2026-07-06T00:00:00.000Z');
  const start = new Date(currentWeekStartMs - weeksAgo * 7 * 24 * 60 * 60_000 + 60 * 60_000); // +1h so it's inside the week, not on its edge
  const end = new Date(start.getTime() + hours * 60 * 60_000);
  return makeSprint({ topicId, startedAt: start.toISOString(), endedAt: end.toISOString() });
}

describe('sprintMinutes', () => {
  it('is endedAt minus startedAt in whole minutes', () => {
    const sprint = makeSprint({ startedAt: '2026-07-01T08:00:00.000Z', endedAt: '2026-07-01T08:31:30.000Z' });
    expect(sprintMinutes(sprint)).toBe(31); // floors the trailing 30s, doesn't round up
  });

  it('floors at 0 rather than going negative', () => {
    const sprint = makeSprint({ startedAt: '2026-07-01T08:30:00.000Z', endedAt: '2026-07-01T08:00:00.000Z' });
    expect(sprintMinutes(sprint)).toBe(0);
  });

  it('is 0 for a still-live sprint (endedAt null)', () => {
    const sprint = makeSprint({ endedAt: null });
    expect(sprintMinutes(sprint)).toBe(0);
  });
});

describe('loggedHoursByTopic', () => {
  it('sums finished sprints per topic and ignores unfinished ones', () => {
    const sprints = [
      makeSprint({ topicId: 'a', startedAt: '2026-07-01T08:00:00.000Z', endedAt: '2026-07-01T08:30:00.000Z' }),
      makeSprint({ topicId: 'a', startedAt: '2026-07-02T08:00:00.000Z', endedAt: '2026-07-02T09:00:00.000Z' }),
      makeSprint({ topicId: 'b', startedAt: '2026-07-01T08:00:00.000Z', endedAt: '2026-07-01T08:15:00.000Z' }),
      makeSprint({ topicId: 'a', startedAt: '2026-07-03T08:00:00.000Z', endedAt: null }), // live, ignored
    ];
    const result = loggedHoursByTopic(sprints);
    expect(result.get('a')).toBe(1.5); // 30 + 60 min = 90 min = 1.5h
    expect(result.get('b')).toBe(0.25); // 15 min = 0.25h
  });
});

describe('remainingHours', () => {
  it('floors each topic at 0 rather than letting it go negative', () => {
    const topics = [
      makeTopic({ id: 'a', estimatedHours: 5 }),
      makeTopic({ id: 'b', estimatedHours: 5 }),
    ];
    const sprints = [
      // Topic 'a' over-studied by 3h; topic 'b' untouched.
      makeSprint({ topicId: 'a', startedAt: '2026-07-01T00:00:00.000Z', endedAt: '2026-07-01T08:00:00.000Z' }),
    ];
    // 'a': max(0, 5 - 8) = 0. 'b': max(0, 5 - 0) = 5. Total 5, not 2 —
    // topic a's overrun never offsets topic b's untouched estimate.
    expect(remainingHours(topics, sprints)).toBe(5);
  });

  it('sums remaining hours across topics with no sprints logged', () => {
    const topics = [makeTopic({ id: 'a', estimatedHours: 3 }), makeTopic({ id: 'b', estimatedHours: 7 })];
    expect(remainingHours(topics, [])).toBe(10);
  });
});

describe('measuredPaceHoursPerWeek', () => {
  it('is null when there are no completed sprints anywhere in the 4-week window', () => {
    expect(measuredPaceHoursPerWeek(NOW, [])).toBeNull();
  });

  it('a sprint logged only long ago (outside the 4-week window) still yields a measured 0, not null (F1)', () => {
    // Studying started 10 weeks ago and has been silent ever since. Once
    // there's a first-ever sprint, weeksSinceFirstSprint clamps to the
    // standard 4-week cap, and every one of those 4 recent weeks is a real
    // silent week that postdates the first sprint -> median([0,0,0,0]) = 0.
    // This is a MEASUREMENT of decline (an honest "Never"), not "no data
    // yet" — only a total absence of any completed sprint, ever, falls
    // back to null (see the empty-sprints test above).
    const sprints = [sprintWeeksAgo(10, 5)];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBe(0);
  });

  it('median over exactly 4 populated weeks', () => {
    // Weekly hours (oldest to newest): 2, 4, 6, 8 -> median (4+6)/2 = 5.
    const sprints = [
      sprintWeeksAgo(4, 2),
      sprintWeeksAgo(3, 4),
      sprintWeeksAgo(2, 6),
      sprintWeeksAgo(1, 8),
    ];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBe(5);
  });

  it('the 4-week cap is unchanged when the first sprint is more than 4 weeks old (F1)', () => {
    // First-ever sprint is 10 weeks ago (well before the 4-week window),
    // plus the same populated last-4-weeks data as the test above. The
    // 10-week-old sprint doesn't fall in any of the 4 recent buckets, so
    // the result is identical to the "exactly 4 populated weeks" test:
    // weeksSinceFirstSprint clamps at 4 regardless of how much older the
    // actual first sprint was.
    const sprints = [
      sprintWeeksAgo(10, 1),
      sprintWeeksAgo(4, 2),
      sprintWeeksAgo(3, 4),
      sprintWeeksAgo(2, 6),
      sprintWeeksAgo(1, 8),
    ];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBe(5);
  });

  it('weeks with zero logged hours inside the window count as 0, not skipped', () => {
    // Only 2 of the 4 weeks have sprints: 10h and 2h. The other two are
    // silent weeks that must count as 0 -> sorted [0, 0, 2, 10], median
    // (0+2)/2 = 1. If empty weeks were skipped instead, the median of
    // [2, 10] would wrongly be 6. (First sprint is exactly 4 weeks ago, so
    // the F1 window scoping doesn't shrink this one below the full 4.)
    const sprints = [sprintWeeksAgo(4, 10), sprintWeeksAgo(1, 2)];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBe(1);
  });

  it('scopes the window to 1 bucket when studying started 1 complete week ago (F1)', () => {
    // The bug this fixes: a fixed 4-week window would zero-pad the 3 weeks
    // before studying began, reading median([0,0,0,5]) = 0 - punishing
    // week one of real effort harder than doing nothing. Scoped to only
    // the complete week(s) since the first-ever sprint, week two of
    // studying (one complete week has passed since starting) reads as
    // median([5]) = 5 instead.
    const sprints = [sprintWeeksAgo(1, 5)];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBe(5);
  });

  it('scopes the window to 2 buckets [x, 0] when one of the two weeks since starting is empty (F1)', () => {
    // First-ever sprint 2 weeks ago (6h); the following week (1 week ago)
    // is a real stall, logged 0. Window is scoped to those 2 complete
    // weeks since starting, not the full 4 -> median([6, 0]) = 3. A silent
    // week that POSTDATES the first sprint still counts as a real 0 (see
    // the next test) - only weeks that PREDATE it are excluded.
    const sprints = [sprintWeeksAgo(2, 6)];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBe(3);
  });

  it('a real stall across the full 4-week window since starting still trends to 0 (F1)', () => {
    // First-ever sprint exactly 4 weeks ago (20h that week), then 3
    // complete weeks of total silence since - unlike the "week two" cases
    // above, all 4 of these weeks genuinely postdate the first sprint, so
    // none of them are excluded as "before studying began". This must
    // still read as decline: median([20,0,0,0]) = 0, not an inflated
    // "healthy" number just because the window happens to be short.
    const sprints = [sprintWeeksAgo(4, 20)];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBe(0);
  });

  it('excludes the current, partial week at its exact Monday 00:00 boundary', () => {
    // Starts exactly at the current week's Monday 00:00 - part of the
    // in-progress week, not a completed one, so it must not count toward
    // ANY bucket. And since it's the first-ever completed sprint, every
    // already-complete week predates the start of studying: there is no
    // measurable week yet, so the function returns null (labeled default
    // carries until the first Monday rollover) rather than measuring a
    // pre-studying week as 0 and projecting "Never" on day one.
    const onBoundary = makeSprint({
      startedAt: '2026-07-06T00:00:00.000Z',
      endedAt: '2026-07-06T05:00:00.000Z',
    });
    expect(measuredPaceHoursPerWeek(NOW, [onBoundary])).toBeNull();

    // One millisecond earlier - the last instant of the previous
    // (completed) week - must count.
    const justBefore = makeSprint({
      startedAt: '2026-07-05T23:59:59.999Z',
      endedAt: '2026-07-06T00:59:59.999Z',
    });
    expect(measuredPaceHoursPerWeek(NOW, [justBefore])).not.toBeNull();
  });

  it('excludes sprints still live (endedAt null) even inside the window', () => {
    const liveSprint = makeSprint({
      startedAt: sprintWeeksAgo(1, 3).startedAt,
      endedAt: null,
    });
    expect(measuredPaceHoursPerWeek(NOW, [liveSprint])).toBeNull();
  });
});

describe('hoursThisWeek', () => {
  it('sums only sprints started in the current Monday-start week', () => {
    const thisWeek = makeSprint({ startedAt: '2026-07-08T08:00:00.000Z', endedAt: '2026-07-08T09:00:00.000Z' });
    const lastWeek = sprintWeeksAgo(1, 5);
    expect(hoursThisWeek(NOW, [thisWeek, lastWeek])).toBe(1);
  });

  it('is 0 with no sprints this week', () => {
    expect(hoursThisWeek(NOW, [sprintWeeksAgo(1, 5)])).toBe(0);
  });
});

describe('bestWeekHours', () => {
  it('is null when there are no completed sprints at all', () => {
    expect(bestWeekHours(NOW, [])).toBeNull();
    const live = makeSprint({ endedAt: null });
    expect(bestWeekHours(NOW, [live])).toBeNull();
  });

  it('is null when every completed sprint falls inside the current, still-in-progress week', () => {
    // A big Monday shouldn't let Tuesday morning's screen claim a "best
    // week" that's really just one or two days old and still growing.
    const thisWeek = makeSprint({ startedAt: '2026-07-06T08:00:00.000Z', endedAt: '2026-07-06T14:00:00.000Z' });
    expect(bestWeekHours(NOW, [thisWeek])).toBeNull();
  });

  it('picks the MAX complete week, not the most recent or the sum', () => {
    // Weekly totals (oldest to newest): 3h, 9h, 2h -> max is 9, not the
    // most recent (2) and not the sum (14).
    const sprints = [sprintWeeksAgo(3, 3), sprintWeeksAgo(2, 9), sprintWeeksAgo(1, 2)];
    expect(bestWeekHours(NOW, sprints)).toBe(9);
  });

  it('sums multiple sprints within the same week before comparing across weeks', () => {
    // Two separate sprints in the week 2 weeks ago (2h + 4h = 6h) beat a
    // single 5h sprint the following week — a week's total, not any one
    // sprint's length, is what gets compared.
    const sprints = [
      sprintWeeksAgo(2, 2), // Monday of that week, +1h, 2h sprint
      makeSprint({ topicId: 'topic-1', startedAt: '2026-06-24T08:00:00.000Z', endedAt: '2026-06-24T12:00:00.000Z' }), // same week (Wed), 4h
      sprintWeeksAgo(1, 5),
    ];
    expect(bestWeekHours(NOW, sprints)).toBe(6);
  });

  it('groups weeks by calendar (startOfWeek), not fixed millisecond width, across the late-October DST boundary', () => {
    // 2026-10-25 is the last Sunday of October — Germany's DST-end. A
    // sprint the Monday before it and one the Monday after sit in
    // adjacent-but-distinct Monday-start weeks; startOfWeek (date-fns
    // calendar arithmetic, not a fixed 7*MS_PER_DAY offset) is what keeps
    // them apart regardless of the wall-clock shift between them — same
    // F6 reasoning as measuredPaceHoursPerWeek/hoursThisWeek above.
    const now = new Date('2026-11-09T08:00:00.000Z'); // safely past both weeks
    const beforeDst = makeSprint({ startedAt: '2026-10-19T08:00:00.000Z', endedAt: '2026-10-19T10:00:00.000Z' }); // 2h
    const afterDst = makeSprint({ startedAt: '2026-10-26T08:00:00.000Z', endedAt: '2026-10-26T13:00:00.000Z' }); // 5h
    expect(bestWeekHours(now, [beforeDst, afterDst])).toBe(5);
  });
});

describe('examProjection', () => {
  it('is "done" once remaining hours hit 0 across REAL, covered topics, with readyDate = now', () => {
    const exam = makeExam();
    const topics = [makeTopic({ estimatedHours: 5 })];
    const sprints = [makeSprint({ startedAt: '2026-07-01T00:00:00.000Z', endedAt: '2026-07-01T05:00:00.000Z' })];
    const result = examProjection(NOW, exam, topics, sprints);

    expect(result.state).toBe('done');
    expect(result.readyDate?.toISOString()).toBe(NOW.toISOString());
    expect(result.remainingHours).toBe(0);
  });

  it('is "empty", not "done", for an exam with zero topics (the vacuous-done bug)', () => {
    // The field screenshot this fixes: an exam with no topics at all used
    // to sail through the same `remaining === 0` branch a genuinely
    // finished exam does — remainingHours([], []) is trivially 0 — and
    // render a confident "Ready by {today}" plus "All topics at their
    // estimated hours." for an exam that has nothing in it yet.
    const exam = makeExam();
    const result = examProjection(NOW, exam, [], []);

    expect(result.state).toBe('empty');
    expect(result.readyDate).toBeNull();
    expect(result.slackDays).toBeNull();
    expect(result.requiredPaceHoursPerWeek).toBeNull();
  });

  it('is "empty" when topics exist but every one has 0 estimated hours', () => {
    // Distinct from the zero-topics case above but the same vacuous shape:
    // a topic list that exists but carries no real hour estimates has
    // nothing for the projection to measure against either.
    const exam = makeExam();
    const topics = [makeTopic({ id: 'a', estimatedHours: 0 }), makeTopic({ id: 'b', estimatedHours: 0 })];
    const result = examProjection(NOW, exam, topics, []);

    expect(result.state).toBe('empty');
    expect(result.readyDate).toBeNull();
  });

  it('an "empty" exam still reports its own remaining hours and pace, just no projection off them', () => {
    // 'empty' only forces readyDate/slackDays/requiredPaceHoursPerWeek to
    // null (there is nothing to project against) — pace/paceIsMeasured/
    // remainingHours stay real, ordinary values in case a future screen
    // wants them.
    const exam = makeExam();
    const result = examProjection(NOW, exam, [], []);

    expect(result.remainingHours).toBe(0);
    expect(result.pace).toBe(DEFAULT_PACE_HOURS_PER_WEEK);
    expect(result.paceIsMeasured).toBe(false);
  });

  it('projects "never" (readyDate null, state late) at a measured pace of exactly 0', () => {
    const exam = makeExam();
    const topics = [makeTopic({ estimatedHours: 20 })];
    // Sprints exist in the window (so pace is measured, not defaulted) but
    // every one of them floors to 0 minutes.
    const sprints = [sprintWeeksAgo(1, 0), sprintWeeksAgo(2, 0)];
    const result = examProjection(NOW, exam, topics, sprints);

    expect(result.pace).toBe(0);
    expect(result.paceIsMeasured).toBe(true);
    expect(result.readyDate).toBeNull();
    expect(result.slackDays).toBeNull();
    expect(result.state).toBe('late');
  });

  it('falls back to the labeled default pace when nothing is measured', () => {
    const exam = makeExam();
    const topics = [makeTopic({ estimatedHours: 8 })]; // 8h remaining
    const result = examProjection(NOW, exam, topics, []);

    expect(result.paceIsMeasured).toBe(false);
    expect(result.pace).toBe(DEFAULT_PACE_HOURS_PER_WEEK);
    // 8h / 4h-per-week = 2 weeks out.
    expect(result.readyDate?.getTime()).toBe(NOW.getTime() + 2 * 7 * 24 * 60 * 60_000);
  });

  it('requiredPaceHoursPerWeek is null once the anchor has already passed', () => {
    const exam = makeExam({ windowStart: '2026-07-01', examDate: null }); // before NOW
    const topics = [makeTopic({ estimatedHours: 8 })];
    const result = examProjection(NOW, exam, topics, []);

    expect(result.requiredPaceHoursPerWeek).toBeNull();
  });

  it('requiredPaceHoursPerWeek divides remaining hours by weeks to the anchor', () => {
    // A midnight `now` (rather than the shared NOW, which carries an 08:00
    // time-of-day) so "2 weeks later" lands on a clean midnight anchor too
    // — windowStart is a date-only string, always parsed at local midnight,
    // so this keeps the arithmetic exact instead of fighting a time-of-day
    // offset that has nothing to do with what this test is checking.
    const midnightNow = new Date('2026-07-09T00:00:00.000Z');
    const exam = makeExam({ windowStart: '2026-07-23', examDate: null }); // exactly 2 weeks later
    const topics = [makeTopic({ estimatedHours: 13 })];
    const result = examProjection(midnightNow, exam, topics, []);

    expect(result.requiredPaceHoursPerWeek).toBe(6.5);
  });

  it('slackDays is positive (margin) when readyDate lands well before the anchor', () => {
    // Anchor far out (windowStart months away), pace is the default 4h/wk,
    // remaining hours small -> readyDate well before the anchor.
    const exam = makeExam({ windowStart: '2026-11-01', examDate: null });
    const topics = [makeTopic({ estimatedHours: 4 })]; // 1 week out
    const result = examProjection(NOW, exam, topics, []);

    expect(result.slackDays).not.toBeNull();
    expect(result.slackDays as number).toBeGreaterThan(0);
    expect(result.state).toBe('calm');
  });

  it('slackDays is negative once readyDate lands after the anchor ("late")', () => {
    // Anchor tomorrow, but 40h remaining at the 4h/week default pace ->
    // readyDate 10 weeks out, long after the anchor.
    const anchorDate = new Date(NOW.getTime() + 24 * 60 * 60_000);
    const exam = makeExam({ windowStart: anchorDate.toISOString().slice(0, 10), examDate: null });
    const topics = [makeTopic({ estimatedHours: 40 })];
    const result = examProjection(NOW, exam, topics, []);

    expect(result.slackDays as number).toBeLessThan(0);
    expect(result.state).toBe('late');
  });

  it('is "tight" just under the 14-day slack boundary, "calm" at and above it', () => {
    // Midnight `now` (see the requiredPaceHoursPerWeek test above for why):
    // 4h remaining at the default 4h/week pace -> readyDate exactly 7 days
    // out, itself at midnight, so anchors built from it land exactly on
    // the day boundaries this test needs.
    const midnightNow = new Date('2026-07-09T00:00:00.000Z');
    const topics = [makeTopic({ estimatedHours: 4 })];
    const readyDate = new Date('2026-07-16T00:00:00.000Z'); // midnightNow + 7 days

    const tightAnchor = new Date(readyDate.getTime() + 13 * 24 * 60 * 60_000);
    const tightExam = makeExam({ windowStart: tightAnchor.toISOString().slice(0, 10), examDate: null });
    const tightResult = examProjection(midnightNow, tightExam, topics, []);
    expect(tightResult.slackDays).toBe(13);
    expect(tightResult.state).toBe('tight');

    const calmAnchor = new Date(readyDate.getTime() + 14 * 24 * 60 * 60_000);
    const calmExam = makeExam({ windowStart: calmAnchor.toISOString().slice(0, 10), examDate: null });
    const calmResult = examProjection(midnightNow, calmExam, topics, []);
    expect(calmResult.slackDays).toBe(14);
    expect(calmResult.state).toBe('calm');
  });

  it('anchor and anchorKind prefer examDate over windowStart once it is set', () => {
    const exam = makeExam({ windowStart: '2026-11-01', examDate: '2026-11-14' });
    const result = examProjection(NOW, exam, [], []);

    expect(result.anchorKind).toBe('exact');
    expect(result.anchor.toISOString()).toBe(new Date('2026-11-14T00:00:00').toISOString());
  });

  it('anchor falls back to windowStart and anchorKind is "window" when examDate is unset', () => {
    const exam = makeExam({ windowStart: '2026-11-01', examDate: null });
    const result = examProjection(NOW, exam, [], []);

    expect(result.anchorKind).toBe('window');
    expect(result.anchor.toISOString()).toBe(new Date('2026-11-01T00:00:00').toISOString());
  });

  it('guards against an overflowed readyDate with the same null-readyDate "never" shape as zero pace (F5)', () => {
    // An extreme estimatedHours (TopicEdit's own clamp should prevent this
    // via the UI, but this guard is defense-in-depth against direct DB
    // edits or a future import path) pushes weeksNeeded * MS_PER_WEEK past
    // what a double can represent, making `new Date(...)` an Invalid Date
    // whose getTime() is NaN. That must not leak out as a broken readyDate.
    const exam = makeExam();
    const topics = [makeTopic({ estimatedHours: Number.MAX_VALUE })];
    const result = examProjection(NOW, exam, topics, []);

    expect(result.readyDate).toBeNull();
    expect(result.slackDays).toBeNull();
    expect(result.state).toBe('late');
  });
});

describe('milestoneProjection', () => {
  it('filters remaining hours to only the topics in topicIds', () => {
    const topics = [
      makeTopic({ id: 'a', estimatedHours: 5 }),
      makeTopic({ id: 'b', estimatedHours: 5 }),
    ];
    const milestone = makeMilestone({ topicIds: ['a'], at: '2026-12-01T00:00:00.000Z' });
    const result = milestoneProjection(NOW, milestone, topics, []);

    // Only topic 'a's 5h counts - topic 'b' is outside the subset entirely,
    // not just under-weighted.
    expect(result.remainingHours).toBe(5);
  });

  it('falls back to the whole exam when topicIds is non-empty but references no existing topic (F7)', () => {
    // Every id in topicIds has been deleted (e.g. a direct DB edit outside
    // TopicEdit's own pruning) - filtering yields zero topics, which is
    // not a real "just these zero topics" selection, so this reads the
    // same as an explicitly-empty topicIds: the whole exam.
    const topics = [
      makeTopic({ id: 'a', estimatedHours: 5 }),
      makeTopic({ id: 'b', estimatedHours: 5 }),
    ];
    const milestone = makeMilestone({ topicIds: ['deleted-topic'], at: '2026-12-01T00:00:00.000Z' });
    const result = milestoneProjection(NOW, milestone, topics, []);

    expect(result.remainingHours).toBe(10);
  });

  it('an empty topicIds subset means the whole exam, not zero topics', () => {
    const topics = [
      makeTopic({ id: 'a', estimatedHours: 5 }),
      makeTopic({ id: 'b', estimatedHours: 5 }),
    ];
    const milestone = makeMilestone({ topicIds: [], at: '2026-12-01T00:00:00.000Z' });
    const result = milestoneProjection(NOW, milestone, topics, []);

    // If an empty subset were read literally (project against zero
    // topics), remainingHours would wrongly be 0 - "done" before a single
    // hour is logged.
    expect(result.remainingHours).toBe(10);
  });

  it('anchors the projection on the milestone\'s own datetime, not the exam\'s', () => {
    const topics = [makeTopic({ id: 'a', estimatedHours: 4 })]; // 1 week out at the default 4h/week pace
    // readyDate lands 2026-07-16T08:00:00.000Z (NOW + 1 week); the anchor
    // below sits ~16 days past that, well clear of the 14-day tight/calm
    // boundary, so this only tests anchoring, not the boundary itself
    // (currentStepElapsed-style boundary tests already live on
    // examProjection above).
    const milestone = makeMilestone({ topicIds: ['a'], at: '2026-08-01T09:00:00.000Z' });
    const result = milestoneProjection(NOW, milestone, topics, []);

    expect(result.anchorKind).toBe('exact');
    expect(result.anchor.toISOString()).toBe('2026-08-01T09:00:00.000Z');
    // readyDate (1 week from NOW) lands well before the milestone's own
    // 1 Aug anchor -> calm, same slack math as examProjection.
    expect(result.state).toBe('calm');
  });

  it('sprints outside the topic subset never count toward its remaining hours', () => {
    const topics = [
      makeTopic({ id: 'a', estimatedHours: 5 }),
      makeTopic({ id: 'b', estimatedHours: 5 }),
    ];
    // 3h logged on topic 'b', which this milestone doesn't cover.
    const sprints = [
      makeSprint({ topicId: 'b', startedAt: '2026-07-01T00:00:00.000Z', endedAt: '2026-07-01T03:00:00.000Z' }),
    ];
    const milestone = makeMilestone({ topicIds: ['a'], at: '2026-12-01T00:00:00.000Z' });
    const result = milestoneProjection(NOW, milestone, topics, sprints);

    // Topic 'a' is untouched by that sprint, so its full 5h is still owed -
    // logged hours on an out-of-subset topic don't leak in.
    expect(result.remainingHours).toBe(5);
  });
});
