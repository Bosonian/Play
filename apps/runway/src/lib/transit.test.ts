import { describe, expect, it } from 'vitest';
import type { Departure, Template } from '../db/types';
import {
  flattenMeasurements,
  matchTransitsToDepartures,
  MIN_DRIVE_MINUTES,
  MIN_TRANSIT_DELTA_MINUTES,
  MIN_TRANSIT_RUNS,
  transitMeasurementSummaries,
  transitSuggestions,
  transitWindows,
} from './transit';
import type { TransitEvent, TransitMatch, TransitMeasurementsByName } from './transit';

function ms(iso: string): number {
  return new Date(iso).getTime();
}

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
    leftAt: '2026-07-09T08:20:00.000Z',
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

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
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
    ...overrides,
  };
}

describe('transitWindows', () => {
  it('pairs a connected event with the next disconnected event', () => {
    const events: TransitEvent[] = [
      { action: 'connected', atMs: ms('2026-07-09T08:20:00.000Z') },
      { action: 'disconnected', atMs: ms('2026-07-09T08:40:00.000Z') },
    ];
    expect(transitWindows(events)).toEqual([
      { startMs: ms('2026-07-09T08:20:00.000Z'), endMs: ms('2026-07-09T08:40:00.000Z') },
    ]);
  });

  it('produces one window per connect/disconnect pair across multiple drives', () => {
    const events: TransitEvent[] = [
      { action: 'connected', atMs: ms('2026-07-09T08:00:00.000Z') },
      { action: 'disconnected', atMs: ms('2026-07-09T08:20:00.000Z') },
      { action: 'connected', atMs: ms('2026-07-09T17:00:00.000Z') },
      { action: 'disconnected', atMs: ms('2026-07-09T17:25:00.000Z') },
    ];
    expect(transitWindows(events)).toHaveLength(2);
  });

  it('drops a dangling connected event with no following disconnected (drive in progress)', () => {
    const events: TransitEvent[] = [{ action: 'connected', atMs: ms('2026-07-09T08:20:00.000Z') }];
    expect(transitWindows(events)).toEqual([]);
  });

  it('drops an orphan disconnected event with no preceding connected (ring truncation)', () => {
    const events: TransitEvent[] = [{ action: 'disconnected', atMs: ms('2026-07-09T08:20:00.000Z') }];
    expect(transitWindows(events)).toEqual([]);
  });

  it('drops a window shorter than MIN_DRIVE_MINUTES', () => {
    const events: TransitEvent[] = [
      { action: 'connected', atMs: ms('2026-07-09T08:00:00.000Z') },
      { action: 'disconnected', atMs: ms('2026-07-09T08:02:00.000Z') }, // 2 min < 3 min floor
    ];
    expect(transitWindows(events)).toEqual([]);
  });

  it('keeps a window exactly at the MIN_DRIVE_MINUTES floor', () => {
    expect(MIN_DRIVE_MINUTES).toBe(3);
    const events: TransitEvent[] = [
      { action: 'connected', atMs: ms('2026-07-09T08:00:00.000Z') },
      { action: 'disconnected', atMs: ms('2026-07-09T08:03:00.000Z') },
    ];
    expect(transitWindows(events)).toHaveLength(1);
  });

  it('sorts unsorted input before pairing', () => {
    const events: TransitEvent[] = [
      { action: 'disconnected', atMs: ms('2026-07-09T08:40:00.000Z') },
      { action: 'connected', atMs: ms('2026-07-09T08:20:00.000Z') },
    ];
    expect(transitWindows(events)).toEqual([
      { startMs: ms('2026-07-09T08:20:00.000Z'), endMs: ms('2026-07-09T08:40:00.000Z') },
    ]);
  });

  it('a second connected before any disconnected replaces the pending start', () => {
    const events: TransitEvent[] = [
      { action: 'connected', atMs: ms('2026-07-09T08:00:00.000Z') },
      { action: 'connected', atMs: ms('2026-07-09T08:10:00.000Z') },
      { action: 'disconnected', atMs: ms('2026-07-09T08:30:00.000Z') },
    ];
    expect(transitWindows(events)).toEqual([
      { startMs: ms('2026-07-09T08:10:00.000Z'), endMs: ms('2026-07-09T08:30:00.000Z') },
    ]);
  });
});

describe('matchTransitsToDepartures', () => {
  it('matches a window whose start falls inside a left departure’s span', () => {
    const departure = makeDeparture({ leftAt: '2026-07-09T08:20:00.000Z', appointmentAt: '2026-07-09T09:00:00.000Z' });
    const window = { startMs: ms('2026-07-09T08:21:00.000Z'), endMs: ms('2026-07-09T08:41:00.000Z') };
    expect(matchTransitsToDepartures([window], [departure])).toEqual([
      { departureName: 'Klinik', minutes: 20, windowStartMs: window.startMs },
    ]);
  });

  it('ignores a departure that never left (status planned)', () => {
    const departure = makeDeparture({ status: 'planned', leftAt: null });
    const window = { startMs: ms('2026-07-09T08:21:00.000Z'), endMs: ms('2026-07-09T08:41:00.000Z') };
    expect(matchTransitsToDepartures([window], [departure])).toEqual([]);
  });

  it('falls back to appointmentAt + 2h when arrivedAt is unset', () => {
    const departure = makeDeparture({
      leftAt: '2026-07-09T08:00:00.000Z',
      appointmentAt: '2026-07-09T09:00:00.000Z',
      arrivedAt: null,
    });
    // 10:30, well past the 09:00 appointment but inside the 2h fallback window
    const window = { startMs: ms('2026-07-09T10:30:00.000Z'), endMs: ms('2026-07-09T10:50:00.000Z') };
    expect(matchTransitsToDepartures([window], [departure])).toHaveLength(1);
  });

  it('does not match a window past the arrivedAt bound', () => {
    const departure = makeDeparture({
      leftAt: '2026-07-09T08:00:00.000Z',
      arrivedAt: '2026-07-09T08:30:00.000Z',
    });
    const window = { startMs: ms('2026-07-09T08:45:00.000Z'), endMs: ms('2026-07-09T09:05:00.000Z') };
    expect(matchTransitsToDepartures([window], [departure])).toEqual([]);
  });

  it('picks the departure whose leftAt is closest to the window start', () => {
    const earlier = makeDeparture({ id: 'd1', name: 'Early one', leftAt: '2026-07-09T08:00:00.000Z' });
    const closer = makeDeparture({ id: 'd2', name: 'Closer one', leftAt: '2026-07-09T08:18:00.000Z' });
    const window = { startMs: ms('2026-07-09T08:20:00.000Z'), endMs: ms('2026-07-09T08:40:00.000Z') };
    const matches = matchTransitsToDepartures([window], [earlier, closer]);
    expect(matches).toHaveLength(1);
    expect(matches[0].departureName).toBe('Closer one');
  });

  it('returns no match for a window with no departure span covering it', () => {
    const departure = makeDeparture({ leftAt: '2026-07-09T08:00:00.000Z', arrivedAt: '2026-07-09T08:10:00.000Z' });
    const window = { startMs: ms('2026-07-09T20:00:00.000Z'), endMs: ms('2026-07-09T20:20:00.000Z') };
    expect(matchTransitsToDepartures([window], [departure])).toEqual([]);
  });
});

describe('flattenMeasurements', () => {
  it('flattens a per-name measurement store into TransitMatch entries', () => {
    const byName: TransitMeasurementsByName = {
      Klinik: [{ minutes: 18, atMs: 1000 }, { minutes: 22, atMs: 2000 }],
    };
    expect(flattenMeasurements(byName)).toEqual([
      { departureName: 'Klinik', minutes: 18, windowStartMs: 1000 },
      { departureName: 'Klinik', minutes: 22, windowStartMs: 2000 },
    ]);
  });

  it('returns an empty array for an empty store', () => {
    expect(flattenMeasurements({})).toEqual([]);
  });
});

describe('transitSuggestions', () => {
  it('requires MIN_TRANSIT_RUNS measured drives before suggesting anything', () => {
    expect(MIN_TRANSIT_RUNS).toBe(3);
    const matches: TransitMatch[] = [
      { departureName: 'Klinik', minutes: 30, windowStartMs: 1 },
      { departureName: 'Klinik', minutes: 32, windowStartMs: 2 },
    ];
    const templates = [makeTemplate({ travelMinutes: 20 })];
    expect(transitSuggestions(matches, templates)).toEqual([]);
  });

  it('suggests the median once evidence clears the floor and drifts enough', () => {
    expect(MIN_TRANSIT_DELTA_MINUTES).toBe(3);
    const matches: TransitMatch[] = [
      { departureName: 'Klinik', minutes: 30, windowStartMs: 1 },
      { departureName: 'Klinik', minutes: 32, windowStartMs: 2 },
      { departureName: 'Klinik', minutes: 31, windowStartMs: 3 },
    ];
    const templates = [makeTemplate({ id: 'tpl1', name: 'Klinik', travelMinutes: 20 })];
    expect(transitSuggestions(matches, templates)).toEqual([
      { templateId: 'tpl1', templateName: 'Klinik', currentTravelMinutes: 20, medianMinutes: 31, runCount: 3 },
    ]);
  });

  it('does not suggest when the measured median is within MIN_TRANSIT_DELTA_MINUTES of the current value', () => {
    const matches: TransitMatch[] = [
      { departureName: 'Klinik', minutes: 21, windowStartMs: 1 },
      { departureName: 'Klinik', minutes: 20, windowStartMs: 2 },
      { departureName: 'Klinik', minutes: 22, windowStartMs: 3 },
    ];
    const templates = [makeTemplate({ travelMinutes: 20 })];
    expect(transitSuggestions(matches, templates)).toEqual([]);
  });

  it('skips a name with no matching template', () => {
    const matches: TransitMatch[] = [
      { departureName: 'Piano', minutes: 30, windowStartMs: 1 },
      { departureName: 'Piano', minutes: 32, windowStartMs: 2 },
      { departureName: 'Piano', minutes: 31, windowStartMs: 3 },
    ];
    const templates = [makeTemplate({ name: 'Klinik' })];
    expect(transitSuggestions(matches, templates)).toEqual([]);
  });
});

describe('transitMeasurementSummaries', () => {
  it('summarizes every name with at least one measurement, below the suggestion floor too', () => {
    const byName: TransitMeasurementsByName = {
      Klinik: [{ minutes: 18, atMs: 1 }],
    };
    expect(transitMeasurementSummaries(byName)).toEqual([{ name: 'Klinik', medianMinutes: 18, runCount: 1 }]);
  });

  it('sorts by runCount descending, name ascending as a tiebreak', () => {
    const byName: TransitMeasurementsByName = {
      Bravo: [{ minutes: 10, atMs: 1 }],
      Alpha: [{ minutes: 10, atMs: 1 }],
      Charlie: [{ minutes: 10, atMs: 1 }, { minutes: 12, atMs: 2 }],
    };
    expect(transitMeasurementSummaries(byName).map((s) => s.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });
});
