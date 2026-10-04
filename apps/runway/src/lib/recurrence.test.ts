import { describe, expect, it } from 'vitest';
import { HORIZON_DAYS, calendarDates, occurrenceDates, scheduleDiffers } from './recurrence';
import type { TemplateSchedule } from '../db/types';

// A fixed "now" for every test so assertions aren't racing the real clock —
// same convention as examProjection.test.ts's NOW. 2026-07-09 08:00 is a
// Thursday (ISO weekday 4); the surrounding week runs Mon 2026-07-06
// through Sun 2026-07-12.
const THURSDAY_0800 = new Date(2026, 6, 9, 8, 0, 0);

function schedule(overrides: Partial<TemplateSchedule> = {}): TemplateSchedule {
  return { time: '08:00', days: [1, 2, 3, 4, 5, 6, 7], ...overrides };
}

describe('occurrenceDates', () => {
  it('filters to only the days the schedule names', () => {
    // Mon/Wed/Fri from a Thursday: the next Fri, Mon, Wed in that order.
    const result = occurrenceDates(THURSDAY_0800, schedule({ days: [1, 3, 5] }), 7);
    expect(result.map((o) => o.date)).toEqual(['2026-07-10', '2026-07-13', '2026-07-15']);
  });

  it("includes today's occurrence when its time is still ahead of now", () => {
    const now = new Date(2026, 6, 9, 7, 0, 0); // Thu 07:00, occurrence at 08:00
    const result = occurrenceDates(now, schedule({ days: [4], time: '08:00' }), 1);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-07-09');
    expect(result[0].at.getTime()).toBe(new Date(2026, 6, 9, 8, 0, 0).getTime());
  });

  it("excludes today's occurrence once its time has already passed", () => {
    const now = new Date(2026, 6, 9, 9, 15, 0); // Thu 09:15, occurrence was at 08:00
    const result = occurrenceDates(now, schedule({ days: [4], time: '08:00' }), 1);
    expect(result).toEqual([]);
  });

  it('respects the horizon boundary — a matching day just past the horizon is excluded', () => {
    // Mon 2026-07-06 08:00; the next Sunday (ISO weekday 7) is offset 6,
    // i.e. day 7 of the horizon (inclusive of today).
    const monday = new Date(2026, 6, 6, 8, 0, 0);
    const daySchedule = schedule({ days: [7], time: '08:00' });

    expect(occurrenceDates(monday, daySchedule, 6)).toEqual([]);
    const withinHorizon = occurrenceDates(monday, daySchedule, 7);
    expect(withinHorizon.map((o) => o.date)).toEqual(['2026-07-12']);
  });

  it('maps Sunday to ISO weekday 7, not JS Date#getDay()\'s 0', () => {
    // Sat 2026-07-11 08:00 -> only Sunday 2026-07-12 should match a
    // days:[7] schedule. If the implementation mistakenly used
    // Date#getDay() (0 = Sunday), a days:[7] schedule would never match
    // any day at all.
    const saturday = new Date(2026, 6, 11, 8, 0, 0);
    const result = occurrenceDates(saturday, schedule({ days: [7], time: '08:00' }), 2);
    expect(result.map((o) => o.date)).toEqual(['2026-07-12']);
  });

  it('returns nothing for an empty days list', () => {
    const result = occurrenceDates(THURSDAY_0800, schedule({ days: [] }), HORIZON_DAYS);
    expect(result).toEqual([]);
  });

  it('preserves the wall-clock hour across the late-October DST change (local-time construction)', () => {
    // 2026-10-21 (Wed) through the following week spans Germany's DST end
    // (the last Sunday of October). Every occurrence is built from its own
    // local y/m/d + schedule.time, never from epoch-arithmetic day
    // addition, so 08:00 stays 08:00 local on every matching day
    // regardless of which day within the horizon the clocks actually
    // change on.
    const now = new Date(2026, 9, 21, 7, 0, 0);
    const result = occurrenceDates(now, schedule({ days: [1, 2, 3, 4, 5, 6, 7], time: '08:00' }), 7);
    expect(result.length).toBeGreaterThan(0);
    for (const occurrence of result) {
      expect(occurrence.at.getHours()).toBe(8);
      expect(occurrence.at.getMinutes()).toBe(0);
    }
  });

  it('returns occurrences in ascending chronological order', () => {
    const result = occurrenceDates(THURSDAY_0800, schedule({ days: [1, 4, 6] }), 10);
    const times = result.map((o) => o.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

// Prüfung rework 2 (armed study blocks): `calendarDates` backs
// `cancelStudyBlockAlarms`'s over-wide cancellation window (notifications.ts)
// — unlike `occurrenceDates` above, it must NOT filter by weekday or by
// whether a time has already passed today, since it's answering "every date
// an id could have been minted for," not "which occurrences a live schedule
// produces."
describe('calendarDates', () => {
  it('returns exactly `days` consecutive local dates starting today, with no weekday filter', () => {
    // THURSDAY_0800 is 2026-07-09; every calendar day should appear, not
    // just the ones a `schedule.days` filter would keep.
    expect(calendarDates(THURSDAY_0800, 5)).toEqual([
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
      '2026-07-13',
    ]);
  });

  it("includes today's date even when `now` is late in the day", () => {
    // occurrenceDates would exclude an already-past time-of-day occurrence;
    // calendarDates has no time-of-day to exclude by, so today's date is
    // always the first entry regardless of what time `now` reads.
    const lateInTheDay = new Date(2026, 6, 9, 23, 45, 0);
    expect(calendarDates(lateInTheDay, 1)).toEqual(['2026-07-09']);
  });

  it('rolls over a month boundary correctly (JS Date normalizes the out-of-range day)', () => {
    const nearMonthEnd = new Date(2026, 0, 30, 8, 0, 0); // 2026-01-30
    expect(calendarDates(nearMonthEnd, 4)).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  });
});

// Field report #12: DepartureSetup's save-with-repeat path reads this to
// decide whether a from-template create's schedule needs writing back to
// the source template.
describe('scheduleDiffers', () => {
  it('is false for identical time and identically-ordered days', () => {
    expect(scheduleDiffers(schedule({ days: [1, 3, 5] }), schedule({ days: [1, 3, 5] }))).toBe(false);
  });

  it('is false when the day sets match but are ordered differently', () => {
    expect(scheduleDiffers(schedule({ days: [1, 3, 5] }), schedule({ days: [5, 1, 3] }))).toBe(false);
  });

  it('is true when the time differs', () => {
    expect(scheduleDiffers(schedule({ time: '08:00' }), schedule({ time: '08:15' }))).toBe(true);
  });

  it('is true when the day sets differ in length', () => {
    expect(scheduleDiffers(schedule({ days: [1, 3, 5] }), schedule({ days: [1, 3] }))).toBe(true);
  });

  it('is true when the day sets are the same length but differ in membership', () => {
    expect(scheduleDiffers(schedule({ days: [1, 3, 5] }), schedule({ days: [1, 3, 6] }))).toBe(true);
  });

  it('is true when the existing schedule is null (template has no schedule yet)', () => {
    expect(scheduleDiffers(null, schedule())).toBe(true);
  });
});
