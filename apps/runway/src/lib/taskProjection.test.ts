import { describe, expect, it } from 'vitest';
import { deriveTaskUnitActuals, taskProjection } from './taskProjection';
import type { WorkTask } from '../db/types';

// Fixed "now" for every test, same reasoning as projection.test.ts's own
// NOW constant — assertions aren't racing the real clock.
const NOW = new Date('2026-07-09T08:00:00.000Z');

function makeTask(overrides: Partial<Pick<WorkTask, 'units' | 'deadlineAt' | 'startedAt'>> = {}) {
  return {
    units: [
      { id: 'u1', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: null },
      { id: 'u2', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: null },
      { id: 'u3', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: null },
    ],
    deadlineAt: null as string | null,
    startedAt: null as string | null,
    ...overrides,
  };
}

describe('taskProjection', () => {
  it('sums all remaining units into projectedFinish when none are checked', () => {
    const task = makeTask();
    const { projectedFinish, remainingMinutes, remainingUnits } = taskProjection(NOW, task);

    // 15+15+15 = 45 min -> 08:00 + 45 = 08:45.
    expect(projectedFinish.toISOString()).toBe('2026-07-09T08:45:00.000Z');
    expect(remainingMinutes).toBe(45);
    expect(remainingUnits).toBe(3);
  });

  it('excludes checked units from the remaining sum', () => {
    const task = makeTask({
      units: [
        { id: 'u1', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: '2026-07-09T07:55:00.000Z' },
        { id: 'u2', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: null },
        { id: 'u3', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: null },
      ],
    });
    const { projectedFinish, remainingMinutes, remainingUnits } = taskProjection(NOW, task);

    expect(remainingMinutes).toBe(30);
    expect(remainingUnits).toBe(2);
    expect(projectedFinish.toISOString()).toBe('2026-07-09T08:30:00.000Z');
  });

  it('all units checked leaves projectedFinish equal to now', () => {
    const task = makeTask({
      units: [
        { id: 'u1', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: '2026-07-09T07:50:00.000Z' },
        { id: 'u2', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: '2026-07-09T07:55:00.000Z' },
      ],
    });
    const { projectedFinish, remainingMinutes } = taskProjection(NOW, task);

    expect(remainingMinutes).toBe(0);
    expect(projectedFinish.toISOString()).toBe(NOW.toISOString());
  });

  it('an empty unit list is well-defined (projectedFinish == now, remainingUnits 0)', () => {
    const task = makeTask({ units: [] });
    const { projectedFinish, remainingMinutes, remainingUnits } = taskProjection(NOW, task);

    expect(remainingMinutes).toBe(0);
    expect(remainingUnits).toBe(0);
    expect(projectedFinish.toISOString()).toBe(NOW.toISOString());
  });

  it('slack/state/unitsThatFit are all null when there is no deadline', () => {
    const task = makeTask({ deadlineAt: null });
    const { slackMinutes, state, unitsThatFit } = taskProjection(NOW, task);

    expect(slackMinutes).toBeNull();
    expect(state).toBeNull();
    expect(unitsThatFit).toBeNull();
  });

  it('state is "calm" once slack is at least 5 minutes', () => {
    // 45 min of remaining work; deadline 50 min out -> 5 min slack.
    const task = makeTask({ deadlineAt: '2026-07-09T08:50:00.000Z' });
    const { slackMinutes, state } = taskProjection(NOW, task);

    expect(slackMinutes).toBe(5);
    expect(state).toBe('calm');
  });

  it('state is "tight" at the slack=0 boundary (inclusive) — matches projection.ts\'s own boundary', () => {
    const task = makeTask({ deadlineAt: '2026-07-09T08:45:00.000Z' }); // 45 min out, 45 min of work
    const { slackMinutes, state } = taskProjection(NOW, task);

    expect(slackMinutes).toBe(0);
    expect(state).toBe('tight');
  });

  it('state is "tight" just under the slack=5 boundary', () => {
    const task = makeTask({ deadlineAt: '2026-07-09T08:49:00.000Z' }); // 49 min out, 45 min of work -> 4 slack
    const { slackMinutes, state } = taskProjection(NOW, task);

    expect(slackMinutes).toBe(4);
    expect(state).toBe('tight');
  });

  it('state is "late" once projected finish is after the deadline', () => {
    const task = makeTask({ deadlineAt: '2026-07-09T08:30:00.000Z' }); // 30 min out, 45 min of work -> -15
    const { slackMinutes, state } = taskProjection(NOW, task);

    expect(slackMinutes).toBe(-15);
    expect(state).toBe('late');
  });

  it('unitsThatFit equals remainingUnits when the whole remaining plan fits', () => {
    const task = makeTask({ deadlineAt: '2026-07-09T09:00:00.000Z' }); // 60 min out, 45 min of work
    const { unitsThatFit, remainingUnits } = taskProjection(NOW, task);

    expect(unitsThatFit).toBe(3);
    expect(unitsThatFit).toBe(remainingUnits);
  });

  it('unitsThatFit counts only as many remaining units, IN ORDER, as land before the deadline', () => {
    // 15+15 = 30 lands at 08:30 (fits, deadline 08:35); the third would land
    // at 08:45, past it — so exactly 2 fit, not "however many minutes fit".
    const task = makeTask({ deadlineAt: '2026-07-09T08:35:00.000Z' });
    const { unitsThatFit, remainingUnits } = taskProjection(NOW, task);

    expect(unitsThatFit).toBe(2);
    expect(remainingUnits).toBe(3);
  });

  it('unitsThatFit respects list order, not a sort-by-shortest optimization', () => {
    // A 20-min unit first, then two 5-min units. Only 24 min of budget: the
    // FIRST unit alone (20 min, landing at 08:20) fits; the second would
    // land at 08:25, past the 08:24 deadline — even though swapping order
    // could fit two of the three (5+5=10 min) within the same budget.
    const task = makeTask({
      units: [
        { id: 'u1', name: 'Befunden EEG', plannedMinutes: 20, checkedAt: null },
        { id: 'u2', name: 'Befunden EEG', plannedMinutes: 5, checkedAt: null },
        { id: 'u3', name: 'Befunden EEG', plannedMinutes: 5, checkedAt: null },
      ],
      deadlineAt: '2026-07-09T08:24:00.000Z',
    });
    const { unitsThatFit } = taskProjection(NOW, task);

    expect(unitsThatFit).toBe(1);
  });

  it('unitsThatFit is 0 once the deadline has already passed', () => {
    const task = makeTask({ deadlineAt: '2026-07-09T07:00:00.000Z' }); // an hour ago
    const { unitsThatFit, state } = taskProjection(NOW, task);

    expect(unitsThatFit).toBe(0);
    expect(state).toBe('late');
  });

  it('excludes a checked unit from unitsThatFit\'s remaining walk, same as remainingMinutes', () => {
    const task = makeTask({
      units: [
        { id: 'u1', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: '2026-07-09T07:50:00.000Z' },
        { id: 'u2', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: null },
      ],
      deadlineAt: '2026-07-09T08:16:00.000Z',
    });
    const { unitsThatFit, remainingUnits } = taskProjection(NOW, task);

    expect(remainingUnits).toBe(1);
    expect(unitsThatFit).toBe(1);
  });
});

describe('deriveTaskUnitActuals', () => {
  it('reconstructs each unit\'s actual minutes from the gap since the previous check-off', () => {
    const task = {
      startedAt: '2026-07-09T08:00:00.000Z',
      units: [
        { id: 'u1', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: '2026-07-09T08:12:00.000Z' },
        { id: 'u2', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: '2026-07-09T08:25:00.000Z' },
      ],
    };
    const actuals = deriveTaskUnitActuals(task);

    expect(actuals).toEqual([
      { stepId: 'u1', name: 'Befunden EEG', plannedMinutes: 15, actualMinutes: 12 },
      { stepId: 'u2', name: 'Befunden EEG', plannedMinutes: 15, actualMinutes: 13 },
    ]);
  });

  it('returns [] for a task that was never started — no time axis to reconstruct against', () => {
    const task = {
      startedAt: null,
      units: [{ id: 'u1', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: '2026-07-09T08:12:00.000Z' }],
    };
    expect(deriveTaskUnitActuals(task)).toEqual([]);
  });

  it('attributes actuals in checkedAt order, not list order (units can be checked out of sequence)', () => {
    const task = {
      startedAt: '2026-07-09T08:00:00.000Z',
      units: [
        { id: 'u1', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: '2026-07-09T08:20:00.000Z' },
        { id: 'u2', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: '2026-07-09T08:10:00.000Z' },
      ],
    };
    const actuals = deriveTaskUnitActuals(task);

    // u2 was checked first (08:10, 10 min after start); u1 second (08:20,
    // 10 min after u2) — order in the returned list follows checkedAt, not
    // the original array position.
    expect(actuals).toEqual([
      { stepId: 'u2', name: 'Befunden EEG', plannedMinutes: 15, actualMinutes: 10 },
      { stepId: 'u1', name: 'Befunden EEG', plannedMinutes: 15, actualMinutes: 10 },
    ]);
  });
});
