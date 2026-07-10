import { describe, expect, it } from 'vitest';
import {
  computeBufferSuggestions,
  computeSuggestions,
  isBatchedRun,
  learnedBufferSuggestion,
  learnedEstimate,
  learnedRushedFloor,
  naturalActualsByStepName,
  quantile,
  rushedActualsByStepName,
  stepNameLibrary,
} from './learning';
import type { Departure, Template } from '../db/types';

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

describe('quantile', () => {
  it('p=0 returns the minimum', () => {
    expect(quantile([5, 10, 15], 0)).toBe(5);
  });

  it('p=1 returns the maximum', () => {
    expect(quantile([5, 10, 15], 1)).toBe(15);
  });

  it('p=0.5 on an even-length list matches medianMinutes exactly', () => {
    // [10,20,30,40]: median averages the two middle values (20,30) = 25;
    // quantile at p=0.5 interpolates halfway between the same two values.
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
  });

  it('a single-element array returns that element regardless of p', () => {
    expect(quantile([42], 0)).toBe(42);
    expect(quantile([42], 0.5)).toBe(42);
    expect(quantile([42], 1)).toBe(42);
  });

  it('interpolates a fractional index correctly', () => {
    // index = 0.75 * 3 = 2.25 -> sorted[2] + (sorted[3]-sorted[2]) * 0.25
    // = 30 + 10*0.25 = 32.5
    expect(quantile([10, 20, 30, 40], 0.75)).toBe(32.5);
  });
});

function checkedStep(name: string, checkedAt: string) {
  return { id: name, name, plannedMinutes: 5, checkedAt };
}

describe('isBatchedRun', () => {
  it('true for 3+ steps checked within a 60s span (retroactive door-checking)', () => {
    const departure = {
      steps: [
        checkedStep('a', '2026-07-09T08:00:00.000Z'),
        checkedStep('b', '2026-07-09T08:00:20.000Z'),
        checkedStep('c', '2026-07-09T08:00:50.000Z'),
      ],
    };
    expect(isBatchedRun(departure)).toBe(true);
  });

  it('false at exactly a 60s span (the boundary is strictly less-than)', () => {
    const departure = {
      steps: [
        checkedStep('a', '2026-07-09T08:00:00.000Z'),
        checkedStep('b', '2026-07-09T08:00:30.000Z'),
        checkedStep('c', '2026-07-09T08:01:00.000Z'),
      ],
    };
    expect(isBatchedRun(departure)).toBe(false);
  });

  it('false for only 2 steps checked close together (needs >= 3)', () => {
    const departure = {
      steps: [checkedStep('a', '2026-07-09T08:00:00.000Z'), checkedStep('b', '2026-07-09T08:00:05.000Z')],
    };
    expect(isBatchedRun(departure)).toBe(false);
  });

  it('false for 3 steps spread across more than 60s', () => {
    const departure = {
      steps: [
        checkedStep('a', '2026-07-09T08:00:00.000Z'),
        checkedStep('b', '2026-07-09T08:05:00.000Z'),
        checkedStep('c', '2026-07-09T08:10:00.000Z'),
      ],
    };
    expect(isBatchedRun(departure)).toBe(false);
  });
});

describe('naturalActualsByStepName / rushedActualsByStepName', () => {
  it('a natural (uncompressed) run contributes to naturalActualsByStepName only', () => {
    const natural = makeDeparture({
      id: 'natural',
      wasReplanned: false,
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [checkedStep('Shower', '2026-07-09T08:15:00.000Z')],
    });
    const rushed = makeDeparture({
      id: 'rushed',
      wasReplanned: true,
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [checkedStep('Shower', '2026-07-09T08:06:00.000Z')],
    });

    expect(naturalActualsByStepName([natural, rushed]).get('Shower')).toEqual([15]);
    expect(rushedActualsByStepName([natural, rushed]).get('Shower')).toEqual([6]);
  });

  it('excludes a batched (retroactive check-off) run entirely, from both pools', () => {
    const batched = makeDeparture({
      id: 'batched',
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [
        checkedStep('a', '2026-07-09T08:20:00.000Z'),
        checkedStep('b', '2026-07-09T08:20:10.000Z'),
        checkedStep('c', '2026-07-09T08:20:20.000Z'),
      ],
    });

    expect(naturalActualsByStepName([batched]).size).toBe(0);
    expect(rushedActualsByStepName([batched]).size).toBe(0);
  });

  it('excludes departures that never started, and those not left/done', () => {
    const notStarted = makeDeparture({ id: 'a', status: 'planned', startedAt: null, steps: [] });
    const running = makeDeparture({
      id: 'b',
      status: 'running',
      steps: [checkedStep('Shower', '2026-07-09T08:15:00.000Z')],
    });

    expect(naturalActualsByStepName([notStarted, running]).size).toBe(0);
  });

  it('caps each step name to the most recent 14 occurrences, newest last', () => {
    const departures: Departure[] = [];
    for (let i = 1; i <= 16; i++) {
      // Spaced an hour apart so departureOccurredAtMs orders them
      // unambiguously; actualMinutes == i, by construction (checkedAt is
      // exactly i minutes after startedAt).
      const startedAt = new Date(2026, 6, 1, i, 0, 0).toISOString();
      const checkedAt = new Date(2026, 6, 1, i, i, 0).toISOString();
      departures.push(
        makeDeparture({
          id: `d${i}`,
          startedAt,
          leftAt: checkedAt,
          steps: [checkedStep('Shower', checkedAt)],
        }),
      );
    }

    const actuals = naturalActualsByStepName(departures).get('Shower');
    expect(actuals).toHaveLength(14);
    // The two oldest (1, 2) are dropped; newest (16) is last.
    expect(actuals).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});

describe('learnedEstimate', () => {
  it('returns null under 3 samples', () => {
    expect(learnedEstimate([10, 20])).toBeNull();
  });

  it('computes rounded P75/P25/P90 from a 5-sample list', () => {
    // sorted [10,12,14,16,20]; P75 index=3 -> 16 (exact); P25 index=1 -> 12
    // (exact); P90 index=3.6 -> 16 + (20-16)*0.6 = 18.4 -> rounds to 18.
    const result = learnedEstimate([20, 10, 16, 12, 14]);
    expect(result).toEqual({ minutes: 16, runCount: 5, low: 12, high: 18 });
  });
});

describe('learnedRushedFloor', () => {
  it('returns null under 2 samples', () => {
    expect(learnedRushedFloor([5])).toBeNull();
  });

  it('computes the rounded P25 of the rushed actuals', () => {
    // sorted [4,5,6,7]; P25 index=0.75 -> 4 + (5-4)*0.75 = 4.75 -> rounds to 5.
    expect(learnedRushedFloor([7, 4, 6, 5])).toBe(5);
  });

  it('never returns below 1, even when the data technically supports less', () => {
    expect(learnedRushedFloor([0, 0])).toBe(1);
  });
});

function slippedDeparture(id: string, slip: number, dayIso: string): Departure {
  // appointmentAt 09:00 on `dayIso`'s date, travel 20 -> plannedLeaveBy is
  // always that day's 08:40; leftAt is offset from that by exactly `slip`
  // minutes. Varying the date (not just the id) per call is what gives each
  // departure a genuinely distinct, orderable `leftAt` - the field
  // learnedBufferSuggestion actually sorts "most recent" by.
  const day = dayIso.slice(0, 10);
  return makeDeparture({
    id,
    appointmentAt: `${day}T09:00:00.000Z`,
    originalAppointmentAt: `${day}T09:00:00.000Z`,
    travelMinutes: 20,
    steps: [],
    startedAt: `${day}T08:00:00.000Z`,
    leftAt: new Date(new Date(`${day}T08:40:00.000Z`).getTime() + slip * 60_000).toISOString(),
  });
}

describe('learnedBufferSuggestion', () => {
  it('returns null under 5 eligible runs', () => {
    const departures = [
      slippedDeparture('a', 10, '2026-07-01T08:00:00.000Z'),
      slippedDeparture('b', 10, '2026-07-02T08:00:00.000Z'),
      slippedDeparture('c', 10, '2026-07-03T08:00:00.000Z'),
      slippedDeparture('d', 10, '2026-07-04T08:00:00.000Z'),
    ];
    expect(learnedBufferSuggestion(departures)).toBeNull();
  });

  it('returns null when the median slip is at or below the 2-minute threshold', () => {
    const departures = Array.from({ length: 5 }, (_, i) =>
      slippedDeparture(`d${i}`, 2, `2026-07-0${i + 1}T08:00:00.000Z`),
    );
    expect(learnedBufferSuggestion(departures)).toBeNull();
  });

  it('surfaces the median slip when persistently late with enough evidence', () => {
    const departures = Array.from({ length: 6 }, (_, i) =>
      slippedDeparture(`d${i}`, 5, `2026-07-0${i + 1}T08:00:00.000Z`),
    );
    expect(learnedBufferSuggestion(departures)).toEqual({ minutes: 5, runCount: 6 });
  });

  it('caps evidence to the most recent 10 runs even when more are eligible', () => {
    const departures = Array.from({ length: 15 }, (_, i) =>
      slippedDeparture(`d${i}`, 5, `2026-07-${String(i + 1).padStart(2, '0')}T08:00:00.000Z`),
    );
    const result = learnedBufferSuggestion(departures);
    expect(result?.runCount).toBe(10);
    expect(result?.minutes).toBe(5);
  });
});

describe('computeSuggestions', () => {
  const template: Template = {
    id: 'tpl1',
    name: 'Klinik',
    destination: 'Klinikum',
    travelMinutes: 20,
    bufferMinutes: 10,
    steps: [
      { id: 'st1', name: 'Shower', minutes: 15 },
      { id: 'st2', name: 'Dress', minutes: 10 },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schedule: null,
    autoLearn: false,
    arrivalSteps: [],
    arrivalWifiSsid: null,
  };

  function showeredRun(id: string, showerMinutes: number): Departure {
    return makeDeparture({
      id,
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [
        {
          id: 's1',
          name: 'Shower',
          plannedMinutes: 15,
          checkedAt: new Date(new Date('2026-07-09T08:00:00.000Z').getTime() + showerMinutes * 60_000).toISOString(),
        },
      ],
    });
  }

  it('suggests at exactly 3 runs and exactly a 3-minute delta (both thresholds inclusive)', () => {
    const departures = [showeredRun('d1', 18), showeredRun('d2', 18), showeredRun('d3', 18)];
    const suggestions = computeSuggestions([template], departures);

    expect(suggestions).toEqual([
      {
        templateId: 'tpl1',
        templateName: 'Klinik',
        stepName: 'Shower',
        plannedMinutes: 15,
        learnedMinutes: 18,
        runCount: 3,
      },
    ]);
  });

  it('does not suggest with only 2 runs, even with a large delta', () => {
    const departures = [showeredRun('d1', 25), showeredRun('d2', 25)];
    expect(computeSuggestions([template], departures)).toEqual([]);
  });

  it('does not suggest with 3 runs but only a 2-minute delta', () => {
    const departures = [showeredRun('d1', 17), showeredRun('d2', 17), showeredRun('d3', 17)];
    expect(computeSuggestions([template], departures)).toEqual([]);
  });

  it('skips a step name no longer present in the template (renamed step orphans old history)', () => {
    const renamedTemplate: Template = {
      ...template,
      steps: [{ id: 'st1', name: 'Wash up', minutes: 15 }], // was "Shower"
    };
    const departures = [showeredRun('d1', 25), showeredRun('d2', 25), showeredRun('d3', 25)];

    expect(computeSuggestions([renamedTemplate], departures)).toEqual([]);
  });

  it('ignores departures that never started, and those not left/done', () => {
    const departures = [
      showeredRun('d1', 25),
      showeredRun('d2', 25),
      makeDeparture({ id: 'd3', status: 'planned', startedAt: null }),
      { ...showeredRun('d4', 25), status: 'running' as const },
    ];

    expect(computeSuggestions([template], departures)).toEqual([]);
  });

  it('ignores departures belonging to a different template', () => {
    const departures = [
      showeredRun('d1', 25),
      showeredRun('d2', 25),
      { ...showeredRun('d3', 25), templateId: 'other-template' },
    ];

    expect(computeSuggestions([template], departures)).toEqual([]);
  });

  it('excludes a compressed (wasReplanned) run from the natural pool entirely', () => {
    // Only 2 genuinely natural runs plus 1 compressed one - the compressed
    // one must not count toward the 3-run threshold.
    const departures = [
      showeredRun('d1', 25),
      showeredRun('d2', 25),
      { ...showeredRun('d3', 6), wasReplanned: true },
    ];
    expect(computeSuggestions([template], departures)).toEqual([]);
  });
});

describe('computeBufferSuggestions', () => {
  it('surfaces a per-template buffer suggestion mirroring learnedBufferSuggestion', () => {
    const template: Template = {
      id: 'tpl1',
      name: 'Klinik',
      destination: 'Klinikum',
      travelMinutes: 20,
      bufferMinutes: 10,
      steps: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schedule: null,
      autoLearn: false,
      arrivalSteps: [],
      arrivalWifiSsid: null,
    };
    const departures = Array.from({ length: 6 }, (_, i) =>
      slippedDeparture(`d${i}`, 5, `2026-07-0${i + 1}T08:00:00.000Z`),
    );

    expect(computeBufferSuggestions([template], departures)).toEqual([
      { templateId: 'tpl1', templateName: 'Klinik', currentBufferMinutes: 10, slipMinutes: 5, runCount: 6 },
    ]);
  });

  it('is empty when no template has enough slip evidence', () => {
    const template: Template = {
      id: 'tpl1',
      name: 'Klinik',
      destination: 'Klinikum',
      travelMinutes: 20,
      bufferMinutes: 10,
      steps: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schedule: null,
      autoLearn: false,
      arrivalSteps: [],
      arrivalWifiSsid: null,
    };
    expect(computeBufferSuggestions([template], [])).toEqual([]);
  });
});

describe('stepNameLibrary', () => {
  it('sorts by run count descending, attaching a learned estimate only where >= 3 samples exist', () => {
    const departures = [
      makeDeparture({
        id: 'd1',
        startedAt: '2026-07-01T08:00:00.000Z',
        leftAt: '2026-07-01T08:15:00.000Z',
        steps: [checkedStep('Shower', '2026-07-01T08:15:00.000Z')],
      }),
      makeDeparture({
        id: 'd2',
        startedAt: '2026-07-02T08:00:00.000Z',
        leftAt: '2026-07-02T08:15:00.000Z',
        steps: [checkedStep('Shower', '2026-07-02T08:15:00.000Z')],
      }),
      makeDeparture({
        id: 'd3',
        startedAt: '2026-07-03T08:00:00.000Z',
        leftAt: '2026-07-03T08:15:00.000Z',
        steps: [checkedStep('Shower', '2026-07-03T08:15:00.000Z')],
      }),
      makeDeparture({
        id: 'd4',
        startedAt: '2026-07-04T08:00:00.000Z',
        leftAt: '2026-07-04T08:05:00.000Z',
        steps: [checkedStep('Dress', '2026-07-04T08:05:00.000Z')],
      }),
    ];
    const template: Template = {
      id: 'tpl1',
      name: 'Klinik',
      destination: '',
      travelMinutes: 20,
      bufferMinutes: 10,
      steps: [{ id: 'st1', name: 'Shoes', minutes: 5 }], // never run - 0 samples
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schedule: null,
      autoLearn: false,
      arrivalSteps: [],
      arrivalWifiSsid: null,
    };

    const library = stepNameLibrary(departures, [template]);
    expect(library.map((entry) => entry.name)).toEqual(['Shower', 'Dress', 'Shoes']);
    expect(library[0]).toEqual({ name: 'Shower', learnedMinutes: 15, runCount: 3 });
    expect(library[1]).toEqual({ name: 'Dress', learnedMinutes: null, runCount: 1 });
    expect(library[2]).toEqual({ name: 'Shoes', learnedMinutes: null, runCount: 0 });
  });

  it('deduplicates a name that appears in both history and a template', () => {
    const departures = [
      makeDeparture({
        id: 'd1',
        steps: [checkedStep('Shower', '2026-07-01T08:15:00.000Z')],
      }),
    ];
    const template: Template = {
      id: 'tpl1',
      name: 'Klinik',
      destination: '',
      travelMinutes: 20,
      bufferMinutes: 10,
      steps: [{ id: 'st1', name: 'Shower', minutes: 15 }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schedule: null,
      autoLearn: false,
      arrivalSteps: [],
      arrivalWifiSsid: null,
    };

    const library = stepNameLibrary(departures, [template]);
    expect(library.filter((entry) => entry.name === 'Shower')).toHaveLength(1);
  });
});
