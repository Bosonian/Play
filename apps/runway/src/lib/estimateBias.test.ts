import { describe, expect, it } from 'vitest';
import { biasFromPairs, globalBias, guessPairs } from './estimateBias';
import type { Departure, DepartureStep, TaskUnit, WorkTask } from '../db/types';

function makeDeparture(overrides: Partial<Departure> = {}): Departure {
  return {
    id: 'd1',
    templateId: 'tpl1',
    name: 'Klinik',
    destination: 'Klinikum',
    appointmentAt: '2026-07-09T09:00:00.000Z',
    travelMinutes: 20,
    bufferMinutes: 10,
    steps: [],
    status: 'done',
    startedAt: '2026-07-09T08:00:00.000Z',
    leftAt: '2026-07-09T08:40:00.000Z',
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: '2026-07-09T07:00:00.000Z',
    originalAppointmentAt: '2026-07-09T09:00:00.000Z',
    scheduledForDate: null,
    wasReplanned: false,
    arrivalSteps: [],
    arrivedAt: null,
    arrivalWifiSsid: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<WorkTask> = {}): WorkTask {
  return {
    id: 't1',
    name: 'Befunden EEG',
    units: [],
    deadlineAt: null,
    status: 'done',
    startedAt: '2026-07-09T08:00:00.000Z',
    createdAt: '2026-07-09T07:00:00.000Z',
    ...overrides,
  };
}

function step(
  name: string,
  plannedMinutes: number,
  checkedAt: string,
  estimateSource: 'manual' | 'learned' | undefined,
): DepartureStep {
  return { id: `${name}-${checkedAt}`, name, plannedMinutes, checkedAt, estimateSource };
}

function unit(
  name: string,
  plannedMinutes: number,
  checkedAt: string,
  estimateSource: 'manual' | 'learned' | undefined,
): TaskUnit {
  return { id: `${name}-${checkedAt}`, name, plannedMinutes, checkedAt, estimateSource };
}

describe('guessPairs', () => {
  it('pairs a manual step\'s planned minutes with its derived actual', () => {
    const departure = makeDeparture({
      steps: [step('Shower', 15, '2026-07-09T08:20:00.000Z', 'manual')],
    });
    const pairs = guessPairs([departure], []);
    expect(pairs.get('Shower')).toEqual([{ guessed: 15, actual: 20 }]);
  });

  it('excludes a learned step from pairing', () => {
    const departure = makeDeparture({
      steps: [step('Shower', 15, '2026-07-09T08:20:00.000Z', 'learned')],
    });
    expect(guessPairs([departure], []).has('Shower')).toBe(false);
  });

  it('excludes a step with undefined (legacy, unknown) provenance', () => {
    const departure = makeDeparture({
      steps: [step('Shower', 15, '2026-07-09T08:20:00.000Z', undefined)],
    });
    expect(guessPairs([departure], []).has('Shower')).toBe(false);
  });

  it('excludes a replanned (compressed) run entirely, even for a manual step', () => {
    const departure = makeDeparture({
      wasReplanned: true,
      steps: [step('Shower', 15, '2026-07-09T08:20:00.000Z', 'manual')],
    });
    expect(guessPairs([departure], []).has('Shower')).toBe(false);
  });

  it('excludes a batched (retroactive) check-off run', () => {
    const departure = makeDeparture({
      steps: [
        step('Shower', 15, '2026-07-09T08:00:00.000Z', 'manual'),
        step('Dress', 10, '2026-07-09T08:00:10.000Z', 'manual'),
        step('Shoes', 5, '2026-07-09T08:00:20.000Z', 'manual'),
      ],
    });
    expect(guessPairs([departure], []).has('Shower')).toBe(false);
  });

  it('excludes a manual step whose guess was 0 minutes (no honest ratio to build)', () => {
    const departure = makeDeparture({
      steps: [step('Wait', 0, '2026-07-09T08:20:00.000Z', 'manual')],
    });
    expect(guessPairs([departure], []).has('Wait')).toBe(false);
  });

  it('pairs a manual task unit the same way as a departure step', () => {
    const task = makeTask({
      units: [unit('Befunden EEG', 15, '2026-07-09T08:20:00.000Z', 'manual')],
    });
    expect(guessPairs([], [task]).get('Befunden EEG')).toEqual([{ guessed: 15, actual: 20 }]);
  });

  it('pools departures and tasks under the same name', () => {
    const departure = makeDeparture({
      steps: [step('Shower', 15, '2026-07-09T08:15:00.000Z', 'manual')],
    });
    const task = makeTask({
      id: 't2',
      units: [unit('Shower', 10, '2026-07-09T08:12:00.000Z', 'manual')],
    });
    expect(guessPairs([departure], [task]).get('Shower')).toEqual([
      { guessed: 15, actual: 15 },
      { guessed: 10, actual: 12 },
    ]);
  });

  it('returns an empty map for no departures and no tasks', () => {
    expect(guessPairs([], []).size).toBe(0);
  });
});

describe('biasFromPairs', () => {
  it('is null under the default floor of 5 pairs', () => {
    const pairs = Array.from({ length: 4 }, () => ({ guessed: 10, actual: 15 }));
    expect(biasFromPairs(pairs)).toBeNull();
  });

  it('computes the median of each pair\'s own actual/guessed ratio at exactly 5 pairs', () => {
    // ratios: 1.0, 1.2, 1.5, 2.0, 3.0 -> median 1.5
    const pairs = [
      { guessed: 10, actual: 10 },
      { guessed: 10, actual: 12 },
      { guessed: 10, actual: 15 },
      { guessed: 10, actual: 20 },
      { guessed: 10, actual: 30 },
    ];
    expect(biasFromPairs(pairs)).toEqual({ ratio: 1.5, count: 5 });
  });

  it('accepts a lower minPairs override for the tighter per-name question', () => {
    const pairs = [
      { guessed: 10, actual: 15 },
      { guessed: 10, actual: 15 },
      { guessed: 10, actual: 15 },
    ];
    expect(biasFromPairs(pairs, 3)).toEqual({ ratio: 1.5, count: 3 });
    expect(biasFromPairs(pairs)).toBeNull(); // still null at the default floor of 5
  });

  it('is null for an empty pair list', () => {
    expect(biasFromPairs([])).toBeNull();
  });

  it('ratio below 1 means guesses ran long, not short', () => {
    const pairs = Array.from({ length: 5 }, () => ({ guessed: 20, actual: 16 }));
    expect(biasFromPairs(pairs)).toEqual({ ratio: 0.8, count: 5 });
  });
});

describe('globalBias', () => {
  it('flattens every name\'s pairs into one ratio', () => {
    const byName = new Map([
      ['Shower', [{ guessed: 10, actual: 12 }, { guessed: 10, actual: 12 }]],
      ['Dress', [{ guessed: 5, actual: 6 }, { guessed: 5, actual: 6 }, { guessed: 5, actual: 6 }]],
    ]);
    // 5 pairs total, all ratio 1.2 -> median 1.2, count 5.
    expect(globalBias(byName)).toEqual({ ratio: 1.2, count: 5 });
  });

  it('is null under 5 pairs across the whole map', () => {
    const byName = new Map([['Shower', [{ guessed: 10, actual: 12 }]]]);
    expect(globalBias(byName)).toBeNull();
  });

  it('is null for an empty map', () => {
    expect(globalBias(new Map())).toBeNull();
  });
});
