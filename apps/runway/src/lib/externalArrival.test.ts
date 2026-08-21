import { describe, expect, it } from 'vitest';
import { selectArrivalCandidate } from './externalArrival';
import type { Departure } from '../db/types';

// Fixed "now" for every test so assertions aren't racing the real clock —
// same pattern projection.test.ts/alarmTimes.test.ts use.
const NOW = new Date('2026-07-09T14:00:00.000Z');

function makeDeparture(overrides: Partial<Departure> = {}): Departure {
  return {
    id: 'd1',
    templateId: 'tpl1',
    name: 'Klinik',
    destination: 'Klinikum',
    appointmentAt: '2026-07-09T14:30:00.000Z', // 30 min after NOW, well inside the window
    travelMinutes: 20,
    bufferMinutes: 10,
    steps: [],
    status: 'left',
    startedAt: '2026-07-09T13:00:00.000Z',
    leftAt: '2026-07-09T13:40:00.000Z',
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: '2026-07-09T12:00:00.000Z',
    originalAppointmentAt: '2026-07-09T14:30:00.000Z',
    scheduledForDate: null,
    wasReplanned: false,
    arrivalSteps: [{ id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: null }],
    arrivedAt: null,
    arrivalWifiSsid: null,
    ...overrides,
  };
}

describe('selectArrivalCandidate', () => {
  it('picks the single eligible departure', () => {
    const departure = makeDeparture();
    expect(selectArrivalCandidate([departure], NOW)).toBe(departure);
  });

  it('returns null when there is nothing to match at all', () => {
    expect(selectArrivalCandidate([], NOW)).toBeNull();
  });

  it('excludes a departure whose status is not "left"', () => {
    const running = makeDeparture({ id: 'running', status: 'running' });
    const done = makeDeparture({ id: 'done', status: 'done' });
    expect(selectArrivalCandidate([running, done], NOW)).toBeNull();
  });

  it('excludes a departure whose arrival was already recorded', () => {
    const alreadyArrived = makeDeparture({ arrivedAt: '2026-07-09T13:55:00.000Z' });
    expect(selectArrivalCandidate([alreadyArrived], NOW)).toBeNull();
  });

  it('excludes a departure with no arrival steps at all', () => {
    const noArrivalSteps = makeDeparture({ arrivalSteps: [] });
    expect(selectArrivalCandidate([noArrivalSteps], NOW)).toBeNull();
  });

  it('excludes a departure whose appointment is more than 12 hours away, in either direction', () => {
    const tooFarFuture = makeDeparture({ id: 'future', appointmentAt: '2026-07-10T02:30:01.000Z' }); // 12h30m01s after NOW
    const tooFarPast = makeDeparture({ id: 'past', appointmentAt: '2026-07-09T01:29:59.000Z' }); // 12h30m01s before NOW
    expect(selectArrivalCandidate([tooFarFuture, tooFarPast], NOW)).toBeNull();
  });

  it('includes a departure exactly at the 12-hour boundary (inclusive)', () => {
    const atBoundary = makeDeparture({ appointmentAt: '2026-07-10T02:00:00.000Z' }); // exactly 12h after NOW
    expect(selectArrivalCandidate([atBoundary], NOW)).toBe(atBoundary);
  });

  it('picks the soonest-appointment departure when multiple qualify', () => {
    const sooner = makeDeparture({ id: 'sooner', appointmentAt: '2026-07-09T14:15:00.000Z' });
    const later = makeDeparture({ id: 'later', appointmentAt: '2026-07-09T18:00:00.000Z' });
    // Order shouldn't matter — pass the later one first to make sure sort,
    // not array order, decides.
    expect(selectArrivalCandidate([later, sooner], NOW)).toBe(sooner);
  });

  it('ignores an unrelated ancient "left" departure nobody ever resolved', () => {
    const zombie = makeDeparture({
      id: 'zombie',
      appointmentAt: '2026-06-01T09:00:00.000Z', // over a month before NOW
      arrivalSteps: [{ id: 'a1', name: 'Walk in', plannedMinutes: 2, checkedAt: null }],
    });
    expect(selectArrivalCandidate([zombie], NOW)).toBeNull();
  });
});
