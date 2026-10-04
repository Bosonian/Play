import { describe, expect, it } from 'vitest';
import { isoWeekday, sprintsCompletedOn, todayLine } from './dailyShape';
import type { DailyTarget, Sprint } from '../db/types';

// A Thursday, matching examProjection.test.ts's own fixed NOW — kept
// consistent so any future cross-file reasoning about "today" lines up.
const NOW = new Date('2026-07-09T08:00:00.000Z'); // Thursday, ISO weekday 4

function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
  return {
    id: crypto.randomUUID(),
    examId: 'exam-1',
    topicId: 'topic-1',
    plannedMinutes: 50,
    startedAt: '2026-07-09T07:00:00.000Z',
    endedAt: '2026-07-09T07:50:00.000Z',
    ritual: [],
    createdAt: '2026-07-09T07:00:00.000Z',
    ...overrides,
  };
}

function makeDailyTarget(overrides: Partial<DailyTarget> = {}): DailyTarget {
  return { sprints: 3, restDay: null, ...overrides };
}

describe('isoWeekday', () => {
  it('reads Monday as 1', () => {
    expect(isoWeekday(new Date('2026-07-06T12:00:00.000Z'))).toBe(1);
  });

  it('reads Sunday as 7, not 0', () => {
    expect(isoWeekday(new Date('2026-07-12T12:00:00.000Z'))).toBe(7);
  });
});

describe('sprintsCompletedOn', () => {
  it('counts a sprint that ended on the given date', () => {
    const sprints = [makeSprint({ endedAt: '2026-07-09T07:50:00.000Z' })];
    expect(sprintsCompletedOn(NOW, sprints)).toBe(1);
  });

  it('excludes a sprint that ended on a different calendar date', () => {
    const sprints = [makeSprint({ endedAt: '2026-07-08T07:50:00.000Z' })];
    expect(sprintsCompletedOn(NOW, sprints)).toBe(0);
  });

  it('excludes a sprint still live (endedAt null)', () => {
    const sprints = [makeSprint({ endedAt: null })];
    expect(sprintsCompletedOn(NOW, sprints)).toBe(0);
  });

  it('counts a sprint of any length, including a very short one', () => {
    const sprints = [
      makeSprint({ startedAt: '2026-07-09T07:00:00.000Z', endedAt: '2026-07-09T07:01:30.000Z', plannedMinutes: 25 }),
    ];
    expect(sprintsCompletedOn(NOW, sprints)).toBe(1);
  });

  it('sums multiple sprints ended on the same date', () => {
    const sprints = [
      makeSprint({ id: 'a', endedAt: '2026-07-09T07:50:00.000Z' }),
      makeSprint({ id: 'b', endedAt: '2026-07-09T12:00:00.000Z' }),
      makeSprint({ id: 'c', endedAt: '2026-07-08T12:00:00.000Z' }), // different day, excluded
    ];
    expect(sprintsCompletedOn(NOW, sprints)).toBe(2);
  });

  it('matches on local calendar dates built directly, not a UTC/ISO-string slice', () => {
    // Both `date` and every sprint's `endedAt` are constructed via local
    // Y/M/D/H/M/S parts (`new Date(y, m, d, hh, mm)`), the same idiom
    // recurrence.ts uses for exactly this reason — this stays correct
    // regardless of which timezone the test runner itself is in, unlike a
    // fixed-offset ISO string, while still pinning that a sprint just
    // after local midnight and one just before the NEXT local midnight
    // both count for the same local day, and a sprint just after that
    // next local midnight does not.
    const day = new Date(2026, 6, 9, 9, 0, 0); // 2026-07-09, local
    const sprints = [
      makeSprint({ id: 'early', endedAt: new Date(2026, 6, 9, 0, 5, 0).toISOString() }),
      makeSprint({ id: 'late', endedAt: new Date(2026, 6, 9, 23, 55, 0).toISOString() }),
      makeSprint({ id: 'next-day', endedAt: new Date(2026, 6, 10, 0, 5, 0).toISOString() }),
    ];
    expect(sprintsCompletedOn(day, sprints)).toBe(2);
  });
});

describe('todayLine', () => {
  it('is null when no dailyTarget is set', () => {
    expect(todayLine(NOW, null, [])).toBeNull();
  });

  it('reads "Rest day." with met: true on the configured rest day', () => {
    const restDay = isoWeekday(NOW); // Thursday = 4
    const target = makeDailyTarget({ restDay });
    const result = todayLine(NOW, target, []);
    expect(result).toEqual({ text: 'Rest day.', met: true });
  });

  it('does not treat a non-matching restDay as a rest day', () => {
    const target = makeDailyTarget({ restDay: isoWeekday(NOW) === 1 ? 2 : 1 }); // any day other than NOW's
    const result = todayLine(NOW, target, []);
    expect(result?.text).not.toBe('Rest day.');
  });

  it('reports "Today: n of target sprints." with met: false when short of the target', () => {
    const target = makeDailyTarget({ sprints: 3 });
    const sprints = [makeSprint({ endedAt: '2026-07-09T07:50:00.000Z' })];
    const result = todayLine(NOW, target, sprints);
    expect(result).toEqual({ text: 'Today: 1 of 3 sprints.', met: false });
  });

  it('reports met: true exactly at the target', () => {
    const target = makeDailyTarget({ sprints: 2 });
    const sprints = [
      makeSprint({ id: 'a', endedAt: '2026-07-09T07:50:00.000Z' }),
      makeSprint({ id: 'b', endedAt: '2026-07-09T12:00:00.000Z' }),
    ];
    const result = todayLine(NOW, target, sprints);
    expect(result).toEqual({ text: 'Today: 2 of 2 sprints.', met: true });
  });

  it('does not cap the count past the target — "4 of 3" shows honestly', () => {
    const target = makeDailyTarget({ sprints: 3 });
    const sprints = [
      makeSprint({ id: 'a', endedAt: '2026-07-09T06:00:00.000Z' }),
      makeSprint({ id: 'b', endedAt: '2026-07-09T07:00:00.000Z' }),
      makeSprint({ id: 'c', endedAt: '2026-07-09T08:00:00.000Z' }),
      makeSprint({ id: 'd', endedAt: '2026-07-09T09:00:00.000Z' }),
    ];
    const result = todayLine(NOW, target, sprints);
    expect(result).toEqual({ text: 'Today: 4 of 3 sprints.', met: true });
  });

  it('reports "Today: 0 of n sprints." with met: false when nothing is logged yet today', () => {
    const target = makeDailyTarget({ sprints: 3 });
    const result = todayLine(NOW, target, []);
    expect(result).toEqual({ text: 'Today: 0 of 3 sprints.', met: false });
  });
});
