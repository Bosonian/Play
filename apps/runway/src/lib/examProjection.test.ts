import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACE_HOURS_PER_WEEK,
  examProjection,
  hoursThisWeek,
  loggedHoursByTopic,
  measuredPaceHoursPerWeek,
  remainingHours,
  sprintMinutes,
} from './examProjection';
import type { Exam, Sprint, Topic } from '../db/types';

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

  it('is null when sprints exist only outside the 4-week window', () => {
    const sprints = [sprintWeeksAgo(10, 5)];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBeNull();
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

  it('weeks with zero logged hours inside the window count as 0, not skipped', () => {
    // Only 2 of the 4 weeks have sprints: 10h and 2h. The other two are
    // silent weeks that must count as 0 -> sorted [0, 0, 2, 10], median
    // (0+2)/2 = 1. If empty weeks were skipped instead, the median of
    // [2, 10] would wrongly be 6.
    const sprints = [sprintWeeksAgo(4, 10), sprintWeeksAgo(1, 2)];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBe(1);
  });

  it('median over fewer weeks of actual data (one week has sprints, three are zero-padded)', () => {
    // sorted [0, 0, 0, 3] -> median (0+0)/2 = 0. A single hard-working
    // week doesn't average out to a healthy-looking pace.
    const sprints = [sprintWeeksAgo(2, 3)];
    expect(measuredPaceHoursPerWeek(NOW, sprints)).toBe(0);
  });

  it('excludes the current, partial week at its exact Monday 00:00 boundary', () => {
    // Starts exactly at the current week's Monday 00:00 - part of the
    // in-progress week, not a completed one, so it must not count.
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

describe('examProjection', () => {
  it('is "done" once remaining hours hit 0, with readyDate = now', () => {
    const exam = makeExam();
    const topics = [makeTopic({ estimatedHours: 5 })];
    const sprints = [makeSprint({ startedAt: '2026-07-01T00:00:00.000Z', endedAt: '2026-07-01T05:00:00.000Z' })];
    const result = examProjection(NOW, exam, topics, sprints);

    expect(result.state).toBe('done');
    expect(result.readyDate?.toISOString()).toBe(NOW.toISOString());
    expect(result.remainingHours).toBe(0);
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
});
