import { describe, expect, it } from 'vitest';
import {
  BODY_FAT_MATCH_WINDOW_MS,
  formatMovementLine,
  localDateKey,
  localDayBoundsIso,
  mergeBodyFat,
  mergeMovementDays,
  newRecordsSinceCursor,
  unmatchedBodyFat,
} from './healthSync';

// Only the pure functions in healthSync.ts are tested here — the
// Dexie-touching orchestrator (syncHealthData/syncWeighIns/syncMovement)
// has no dedicated test, matching apps/runway's transitSync.ts precedent
// (its own transit.ts pure math is heavily tested; transitSync.ts itself
// isn't) rather than eventLog.ts/updateCheck.ts's mocked-db style. See
// healthSync.ts's own header comment.

describe('newRecordsSinceCursor', () => {
  it('keeps only records strictly newer than the cursor', () => {
    const records = [{ atMs: 100 }, { atMs: 200 }, { atMs: 300 }];
    expect(newRecordsSinceCursor(records, 200)).toEqual([{ atMs: 300 }]);
  });

  it('excludes a record exactly AT the cursor (strict >, not >=)', () => {
    // The load-bearing case: a record already merged on a previous sync
    // must never be re-inserted just because the native `sinceMs` boundary
    // happened to include it again.
    const records = [{ atMs: 200 }];
    expect(newRecordsSinceCursor(records, 200)).toEqual([]);
  });

  it('returns everything when the cursor is 0 (first-ever sync)', () => {
    const records = [{ atMs: 1 }, { atMs: 2 }];
    expect(newRecordsSinceCursor(records, 0)).toEqual(records);
  });

  it('returns an empty array unchanged', () => {
    expect(newRecordsSinceCursor([], 0)).toEqual([]);
  });
});

describe('mergeBodyFat', () => {
  it('attaches a body-fat reading to a weight record with the exact same atMs (regression)', () => {
    const weight = [{ atMs: 1000, weightKg: 98.4 }];
    const bodyFat = [{ atMs: 1000, bodyFatPct: 27.1 }];
    expect(mergeBodyFat(weight, bodyFat)).toEqual([{ atMs: 1000, weightKg: 98.4, bodyFatPct: 27.1 }]);
  });

  it('matches a body-fat reading 30s off from its weight — the whole point of the window', () => {
    const weight = [{ atMs: 100_000, weightKg: 98.4 }];
    const bodyFat = [{ atMs: 130_000, bodyFatPct: 27.1 }]; // 30s later
    expect(mergeBodyFat(weight, bodyFat)).toEqual([{ atMs: 100_000, weightKg: 98.4, bodyFatPct: 27.1 }]);
  });

  it('does NOT match a body-fat reading 5 minutes off (outside the 2-minute window)', () => {
    const weight = [{ atMs: 100_000, weightKg: 98.4 }];
    const bodyFat = [{ atMs: 100_000 + 5 * 60_000, bodyFatPct: 27.1 }];
    expect(mergeBodyFat(weight, bodyFat)).toEqual([{ atMs: 100_000, weightKg: 98.4, bodyFatPct: null }]);
  });

  it('matches exactly AT the 120_000ms boundary (inclusive)', () => {
    const weight = [{ atMs: 100_000, weightKg: 98.4 }];
    const bodyFat = [{ atMs: 100_000 + BODY_FAT_MATCH_WINDOW_MS, bodyFatPct: 27.1 }];
    expect(mergeBodyFat(weight, bodyFat)).toEqual([{ atMs: 100_000, weightKg: 98.4, bodyFatPct: 27.1 }]);
  });

  it('does NOT match one millisecond past the boundary', () => {
    const weight = [{ atMs: 100_000, weightKg: 98.4 }];
    const bodyFat = [{ atMs: 100_000 + BODY_FAT_MATCH_WINDOW_MS + 1, bodyFatPct: 27.1 }];
    expect(mergeBodyFat(weight, bodyFat)).toEqual([{ atMs: 100_000, weightKg: 98.4, bodyFatPct: null }]);
  });

  it('gives two nearby weigh-ins each their own nearest body-fat reading, never cross-matched', () => {
    // Two weigh-ins 90s apart (both realistic on their own), each with a
    // body-fat reading close to itself but still technically within the
    // window of the OTHER weigh-in too — the greedy-nearest, claim-once
    // algorithm must still pair each with its own, not let the first
    // weight processed steal the second's closer reading.
    const weight = [
      { atMs: 0, weightKg: 98.4 },
      { atMs: 90_000, weightKg: 97.9 }, // a different, later weigh-in
    ];
    const bodyFat = [
      { atMs: 5_000, bodyFatPct: 27.1 }, // close to the first weigh-in
      { atMs: 85_000, bodyFatPct: 26.9 }, // close to the second weigh-in
    ];
    expect(mergeBodyFat(weight, bodyFat)).toEqual([
      { atMs: 0, weightKg: 98.4, bodyFatPct: 27.1 },
      { atMs: 90_000, weightKg: 97.9, bodyFatPct: 26.9 },
    ]);
  });

  it('never fabricates a weight-less row for an unmatched body-fat record', () => {
    // No weight records at all — mergeBodyFat has nothing to attach a
    // body-fat reading TO, so the result is empty, not a phantom row.
    expect(mergeBodyFat([], [{ atMs: 1000, bodyFatPct: 27.1 }])).toEqual([]);
  });

  it('returns rows in ascending atMs order regardless of input order', () => {
    const weight = [
      { atMs: 2000, weightKg: 98.1 },
      { atMs: 1000, weightKg: 98.4 },
    ];
    const result = mergeBodyFat(weight, []);
    expect(result.map((r) => r.atMs)).toEqual([1000, 2000]);
  });
});

describe('unmatchedBodyFat', () => {
  it('returns body-fat records with no weight anywhere within the window', () => {
    const weight = [{ atMs: 1000 }];
    const bodyFat = [{ atMs: 1000 }, { atMs: 1000 + 10 * 60_000 }]; // 10 min away — nothing nearby
    expect(unmatchedBodyFat(weight, bodyFat)).toEqual([{ atMs: 1000 + 10 * 60_000 }]);
  });

  it('treats a body-fat reading within the window of some weight as matched, not just exact instants', () => {
    const weight = [{ atMs: 100_000 }];
    const bodyFat = [{ atMs: 130_000 }]; // 30s away — within the window
    expect(unmatchedBodyFat(weight, bodyFat)).toEqual([]);
  });

  it('returns an empty array when every body-fat record has a nearby weight', () => {
    const weight = [{ atMs: 1000 }, { atMs: 2000 }];
    const bodyFat = [{ atMs: 1000 }, { atMs: 2000 }];
    expect(unmatchedBodyFat(weight, bodyFat)).toEqual([]);
  });
});

describe('mergeMovementDays', () => {
  it('combines a day present in both lists into one row', () => {
    const steps = [{ date: '2026-07-24', steps: 6412 }];
    const energy = [{ date: '2026-07-24', activeKcal: 320 }];
    expect(mergeMovementDays(steps, energy)).toEqual([{ date: '2026-07-24', steps: 6412, activeKcal: 320 }]);
  });

  it('fills the missing side with null rather than dropping a day present in only one list', () => {
    const steps = [{ date: '2026-07-24', steps: 6412 }];
    expect(mergeMovementDays(steps, [])).toEqual([{ date: '2026-07-24', steps: 6412, activeKcal: null }]);

    const energy = [{ date: '2026-07-24', activeKcal: 320 }];
    expect(mergeMovementDays([], energy)).toEqual([{ date: '2026-07-24', steps: null, activeKcal: 320 }]);
  });

  it('sorts the combined result ascending by date', () => {
    const steps = [
      { date: '2026-07-25', steps: 1000 },
      { date: '2026-07-23', steps: 2000 },
    ];
    const energy = [{ date: '2026-07-24', activeKcal: 150 }];
    const result = mergeMovementDays(steps, energy);
    expect(result.map((r) => r.date)).toEqual(['2026-07-23', '2026-07-24', '2026-07-25']);
  });

  it('returns an empty array when both lists are empty', () => {
    expect(mergeMovementDays([], [])).toEqual([]);
  });
});

describe('localDateKey', () => {
  it('formats as YYYY-MM-DD from local date components', () => {
    expect(localDateKey(new Date(2026, 6, 24, 23, 59))).toBe('2026-07-24'); // 24 Jul 2026, local
  });

  it('zero-pads single-digit month and day', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('localDayBoundsIso', () => {
  // TZ-robust assertions on purpose: these hold under ANY device timezone
  // (the test runner's, whatever it is) rather than pinning one, so they
  // stay green everywhere and still fail loudly if the bounds ever regress
  // to UTC-date bucketing (which would drift a day off for part of every
  // Stuttgart evening — the exact bug this half-open local-day range exists
  // to prevent).
  it('brackets its input instant: startIso <= input < endIso', () => {
    const input = new Date(2026, 6, 24, 19, 30); // 24 Jul 2026 19:30 local
    const { startIso, endIso } = localDayBoundsIso(input);
    expect(startIso <= input.toISOString()).toBe(true);
    expect(input.toISOString() < endIso).toBe(true);
  });

  it('is half-open — end of day N equals start of day N+1 (no gap, no overlap)', () => {
    const dayN = localDayBoundsIso(new Date(2026, 6, 24, 8, 0));
    const dayNplus1 = localDayBoundsIso(new Date(2026, 6, 25, 8, 0));
    expect(dayN.endIso).toBe(dayNplus1.startIso);
  });

  it('excludes the very last instant before local midnight from the NEXT day', () => {
    // 23:59:59.999 local belongs to its own day, never the following one.
    const lastMoment = new Date(2026, 6, 24, 23, 59, 59, 999);
    const { startIso, endIso } = localDayBoundsIso(lastMoment);
    expect(startIso <= lastMoment.toISOString()).toBe(true);
    expect(lastMoment.toISOString() < endIso).toBe(true);
  });

  it('places local midnight (00:00:00.000) at the start boundary, inclusive', () => {
    const midnight = new Date(2026, 6, 24, 0, 0, 0, 0);
    const { startIso } = localDayBoundsIso(midnight);
    expect(startIso).toBe(midnight.toISOString());
  });
});

describe('formatMovementLine', () => {
  it('formats both steps and active energy present', () => {
    expect(formatMovementLine({ steps: 6412, activeKcal: 320 })).toBe('Steps today: 6,412 · active 320 kcal.');
  });

  it('uses a thousands separator for larger step counts', () => {
    expect(formatMovementLine({ steps: 12345, activeKcal: 500 })).toBe('Steps today: 12,345 · active 500 kcal.');
  });

  it('rounds a fractional active-energy value', () => {
    expect(formatMovementLine({ steps: 100, activeKcal: 320.6 })).toBe('Steps today: 100 · active 321 kcal.');
  });

  it('reads a null steps count as "not yet", not zero', () => {
    expect(formatMovementLine({ steps: null, activeKcal: 320 })).toBe('Steps today: not yet · active 320 kcal.');
  });

  it('reads a null active-energy value as "not yet", not zero', () => {
    expect(formatMovementLine({ steps: 6412, activeKcal: null })).toBe('Steps today: 6,412 · active not yet.');
  });

  it('returns null (no line at all) when both fields are null', () => {
    expect(formatMovementLine({ steps: null, activeKcal: null })).toBeNull();
  });
});
