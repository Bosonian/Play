import { describe, expect, it } from 'vitest';
import { computeSuggestions, deriveStepActuals, medianMinutes } from './calibration';
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
    steps: [
      { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: null },
      { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: null },
      { id: 's3', name: 'Pack bag', plannedMinutes: 5, checkedAt: null },
    ],
    status: 'done',
    startedAt: '2026-07-09T08:00:00.000Z',
    leftAt: '2026-07-09T08:40:00.000Z',
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: '2026-07-09T07:00:00.000Z',
    ...overrides,
  };
}

describe('deriveStepActuals', () => {
  it('attributes the gap between consecutive check-offs to the later-checked step, first gap from startedAt', () => {
    const departure = makeDeparture({
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [
        { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T08:12:00.000Z' },
        { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: '2026-07-09T08:25:00.000Z' },
        { id: 's3', name: 'Pack bag', plannedMinutes: 5, checkedAt: '2026-07-09T08:30:00.000Z' },
      ],
    });

    expect(deriveStepActuals(departure)).toEqual([
      { stepId: 's1', name: 'Shower', plannedMinutes: 15, actualMinutes: 12 },
      { stepId: 's2', name: 'Dress', plannedMinutes: 10, actualMinutes: 13 },
      { stepId: 's3', name: 'Pack bag', plannedMinutes: 5, actualMinutes: 5 },
    ]);
  });

  it('orders by checkedAt, not list position, for out-of-order check-offs', () => {
    const departure = makeDeparture({
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [
        // Listed Shower, Dress, Pack bag - but checked Dress first, then Shower, then Pack bag.
        { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T08:20:00.000Z' },
        { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: '2026-07-09T08:05:00.000Z' },
        { id: 's3', name: 'Pack bag', plannedMinutes: 5, checkedAt: '2026-07-09T08:30:00.000Z' },
      ],
    });

    expect(deriveStepActuals(departure)).toEqual([
      { stepId: 's2', name: 'Dress', plannedMinutes: 10, actualMinutes: 5 },
      { stepId: 's1', name: 'Shower', plannedMinutes: 15, actualMinutes: 15 },
      { stepId: 's3', name: 'Pack bag', plannedMinutes: 5, actualMinutes: 10 },
    ]);
  });

  it('excludes steps that were never checked', () => {
    const departure = makeDeparture({
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [
        { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T08:12:00.000Z' },
        { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: null },
      ],
    });

    expect(deriveStepActuals(departure)).toEqual([
      { stepId: 's1', name: 'Shower', plannedMinutes: 15, actualMinutes: 12 },
    ]);
  });

  it('returns an empty array when startedAt is missing, regardless of checked steps', () => {
    const departure = makeDeparture({
      startedAt: null,
      steps: [{ id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T08:12:00.000Z' }],
    });

    expect(deriveStepActuals(departure)).toEqual([]);
  });

  it('produces a legitimate 0-minute duration for simultaneous timestamps', () => {
    const departure = makeDeparture({
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [
        { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T08:10:00.000Z' },
        { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: '2026-07-09T08:10:00.000Z' },
      ],
    });

    const actuals = deriveStepActuals(departure);
    expect(actuals[0].actualMinutes).toBe(10);
    expect(actuals[1].actualMinutes).toBe(0);
  });

  it('rounds fractional minutes to whole minutes', () => {
    const departure = makeDeparture({
      startedAt: '2026-07-09T08:00:00.000Z',
      steps: [{ id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T08:12:40.000Z' }],
    });

    // 12 min 40 sec -> rounds to 13.
    expect(deriveStepActuals(departure)[0].actualMinutes).toBe(13);
  });
});

describe('medianMinutes', () => {
  it('returns the middle value for an odd-length list', () => {
    expect(medianMinutes([10, 30, 20])).toBe(20);
  });

  it('averages the two middle values for an even-length list', () => {
    expect(medianMinutes([10, 20, 30, 40])).toBe(25);
  });

  it('returns null for an empty list', () => {
    expect(medianMinutes([])).toBeNull();
  });

  it('handles a single value', () => {
    expect(medianMinutes([42])).toBe(42);
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
        medianActualMinutes: 18,
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
});
