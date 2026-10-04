import { describe, expect, it } from 'vitest';
import { decideMerge } from './mergeTemplates';
import type { Departure } from '../db/types';

const NOW_MS = new Date('2026-07-31T12:00:00.000Z').getTime();
const LOSER = 'loser-template';
const WINNER = 'winner-template';

function makeDeparture(overrides: Partial<Departure> = {}): Departure {
  return {
    id: 'd1',
    templateId: LOSER,
    name: 'Punctual to work',
    destination: 'RKH Klinikum Ludwigsburg',
    appointmentAt: '2026-08-01T08:00:00.000Z', // future relative to NOW_MS
    travelMinutes: 26,
    bufferMinutes: 10,
    steps: [],
    status: 'planned',
    startedAt: null,
    leftAt: null,
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: '2026-07-25T06:00:00.000Z',
    originalAppointmentAt: '2026-08-01T08:00:00.000Z',
    scheduledForDate: '2026-08-01',
    wasReplanned: false,
    arrivalSteps: [],
    arrivedAt: null,
    arrivalWifiSsid: null,
    ...overrides,
  };
}

describe('decideMerge', () => {
  it('deletes a future, not-yet-started, materialized occurrence of the loser', () => {
    const departure = makeDeparture();
    const result = decideMerge(LOSER, [departure], NOW_MS);
    expect(result.toDelete).toEqual([departure]);
    expect(result.toRepoint).toEqual([]);
  });

  it('re-points a completed (done) departure — the learning history that must survive', () => {
    const departure = makeDeparture({ status: 'done', startedAt: '2026-07-25T07:00:00.000Z', leftAt: '2026-07-25T07:30:00.000Z' });
    const result = decideMerge(LOSER, [departure], NOW_MS);
    expect(result.toRepoint).toEqual([departure]);
    expect(result.toDelete).toEqual([]);
  });

  it('re-points a completed (left) departure', () => {
    const departure = makeDeparture({ status: 'left', startedAt: '2026-07-25T07:00:00.000Z', leftAt: '2026-07-25T07:30:00.000Z' });
    const result = decideMerge(LOSER, [departure], NOW_MS);
    expect(result.toRepoint).toEqual([departure]);
    expect(result.toDelete).toEqual([]);
  });

  it('re-points an abandoned departure rather than deleting it', () => {
    const departure = makeDeparture({ status: 'abandoned' });
    const result = decideMerge(LOSER, [departure], NOW_MS);
    expect(result.toRepoint).toEqual([departure]);
    expect(result.toDelete).toEqual([]);
  });

  it('re-points a running (already started) departure rather than deleting it', () => {
    const departure = makeDeparture({ status: 'running', startedAt: '2026-07-31T11:00:00.000Z' });
    const result = decideMerge(LOSER, [departure], NOW_MS);
    expect(result.toRepoint).toEqual([departure]);
    expect(result.toDelete).toEqual([]);
  });

  it('re-points a manually-created (non-materialized) planned departure, even if it is in the future', () => {
    const departure = makeDeparture({ scheduledForDate: null });
    const result = decideMerge(LOSER, [departure], NOW_MS);
    expect(result.toRepoint).toEqual([departure]);
    expect(result.toDelete).toEqual([]);
  });

  it('re-points a past-due planned departure (materialized, but appointmentAt already passed)', () => {
    const departure = makeDeparture({ appointmentAt: '2026-07-27T08:00:00.000Z', scheduledForDate: '2026-07-27' });
    const result = decideMerge(LOSER, [departure], NOW_MS);
    expect(result.toRepoint).toEqual([departure]);
    expect(result.toDelete).toEqual([]);
  });

  it('ignores departures pointing at a different template entirely', () => {
    const departure = makeDeparture({ templateId: WINNER });
    const result = decideMerge(LOSER, [departure], NOW_MS);
    expect(result.toRepoint).toEqual([]);
    expect(result.toDelete).toEqual([]);
  });

  it('ignores a departure with no templateId at all', () => {
    const departure = makeDeparture({ templateId: null });
    const result = decideMerge(LOSER, [departure], NOW_MS);
    expect(result.toRepoint).toEqual([]);
    expect(result.toDelete).toEqual([]);
  });

  it('splits a mixed set correctly, preserving relative order within each list', () => {
    const completed = makeDeparture({ id: 'd-completed', status: 'done', startedAt: '2026-07-20T07:00:00.000Z' });
    const futureOne = makeDeparture({ id: 'd-future-1', appointmentAt: '2026-08-01T08:00:00.000Z', scheduledForDate: '2026-08-01' });
    const abandoned = makeDeparture({ id: 'd-abandoned', status: 'abandoned' });
    const futureTwo = makeDeparture({ id: 'd-future-2', appointmentAt: '2026-08-02T08:00:00.000Z', scheduledForDate: '2026-08-02' });

    const result = decideMerge(LOSER, [completed, futureOne, abandoned, futureTwo], NOW_MS);

    expect(result.toRepoint.map((d) => d.id)).toEqual(['d-completed', 'd-abandoned']);
    expect(result.toDelete.map((d) => d.id)).toEqual(['d-future-1', 'd-future-2']);
  });
});
