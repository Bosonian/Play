import { describe, expect, it } from 'vitest';
import { currentStepElapsed } from './currentStepElapsed';
import type { Departure } from '../db/types';

const NOW = new Date('2026-07-09T08:30:00.000Z');

function makeDeparture(
  overrides: Partial<Pick<Departure, 'steps' | 'startedAt'>> = {},
): Pick<Departure, 'steps' | 'startedAt'> {
  return {
    startedAt: '2026-07-09T08:00:00.000Z',
    steps: [
      { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: null },
      { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: null },
      { id: 's3', name: 'Pack bag', plannedMinutes: 5, checkedAt: null },
    ],
    ...overrides,
  };
}

describe('currentStepElapsed', () => {
  it('returns null once every step is checked - no current step', () => {
    const departure = makeDeparture({
      steps: [
        { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T08:10:00.000Z' },
        { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: '2026-07-09T08:20:00.000Z' },
      ],
    });
    expect(currentStepElapsed(NOW, departure)).toBeNull();
  });

  it('with no steps checked, elapsed is measured from startedAt', () => {
    const departure = makeDeparture(); // startedAt 08:00, NOW 08:30 -> 30 min
    expect(currentStepElapsed(NOW, departure)).toEqual({ stepId: 's1', elapsedMinutes: 30 });
  });

  it('uses the most recently checked step by timestamp, not by list position (out-of-order check-offs)', () => {
    // s2 (later in the list) was actually checked most recently, even
    // though s1 (earlier in the list) is still unchecked and is "current".
    // s3's earlier checkedAt must not win just because it's later in list order.
    const departure = makeDeparture({
      steps: [
        { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: null },
        { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: '2026-07-09T08:25:00.000Z' },
        { id: 's3', name: 'Pack bag', plannedMinutes: 5, checkedAt: '2026-07-09T08:15:00.000Z' },
      ],
    });
    // Reference is s2's 08:25 (the max checkedAt) -> 5 min elapsed on s1.
    expect(currentStepElapsed(NOW, departure)).toEqual({ stepId: 's1', elapsedMinutes: 5 });
  });

  it('is exactly at the overrun boundary when elapsed equals planned minutes', () => {
    const departure = makeDeparture({
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [{ id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: null }],
    });
    const result = currentStepElapsed(new Date('2026-07-09T08:15:00.000Z'), departure);
    expect(result).toEqual({ stepId: 's1', elapsedMinutes: 15 });
  });

  it('is one minute past the boundary once elapsed exceeds planned minutes', () => {
    const departure = makeDeparture({
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [{ id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: null }],
    });
    const result = currentStepElapsed(new Date('2026-07-09T08:16:00.000Z'), departure);
    expect(result).toEqual({ stepId: 's1', elapsedMinutes: 16 });
  });

  it('returns null with no startedAt and nothing checked (defensive: should not occur on a running departure)', () => {
    const departure = makeDeparture({ startedAt: null });
    expect(currentStepElapsed(NOW, departure)).toBeNull();
  });

  it('never returns a negative elapsed figure, even if the reference timestamp is after now', () => {
    // Defensive against clock skew / a stale reference somehow in the future.
    const departure = makeDeparture({ startedAt: '2026-07-09T09:00:00.000Z' });
    expect(currentStepElapsed(NOW, departure)).toEqual({ stepId: 's1', elapsedMinutes: 0 });
  });
});
