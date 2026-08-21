import { describe, expect, it } from 'vitest';
import { resolveCarArrival } from './bluetoothArrival';
import type { Departure } from '../db/types';

// Fixed "now" for every test, same pattern externalArrival.test.ts uses so
// assertions aren't racing the real clock.
const NOW = new Date('2026-07-21T08:00:00.000Z');
const NOW_MS = NOW.getTime();
const LEFT_AT = '2026-07-21T07:30:00.000Z';
const LEFT_AT_MS = new Date(LEFT_AT).getTime();

function makeDeparture(overrides: Partial<Departure> = {}): Departure {
  return {
    id: 'd1',
    templateId: 'tpl1',
    name: 'Klinik',
    destination: 'Klinikum',
    appointmentAt: '2026-07-21T08:30:00.000Z',
    travelMinutes: 20,
    bufferMinutes: 10,
    steps: [],
    status: 'left',
    startedAt: '2026-07-21T07:00:00.000Z',
    leftAt: LEFT_AT,
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: '2026-07-21T06:00:00.000Z',
    originalAppointmentAt: '2026-07-21T08:30:00.000Z',
    scheduledForDate: null,
    wasReplanned: false,
    arrivalSteps: [{ id: 'a1', name: 'Get to Spind', plannedMinutes: 5, checkedAt: null }],
    arrivedAt: null,
    arrivalWifiSsid: null,
    ...overrides,
  };
}

describe('resolveCarArrival', () => {
  it('returns null when there are no disconnect events at all', () => {
    expect(resolveCarArrival(makeDeparture(), [], NOW)).toBeNull();
  });

  it('returns null when status is not "left"', () => {
    const running = makeDeparture({ status: 'running' });
    const disconnectMs = LEFT_AT_MS + 5 * 60_000;
    expect(resolveCarArrival(running, [disconnectMs], NOW)).toBeNull();
  });

  it('returns null when arrivalSteps is empty', () => {
    const noSteps = makeDeparture({ arrivalSteps: [] });
    const disconnectMs = LEFT_AT_MS + 5 * 60_000;
    expect(resolveCarArrival(noSteps, [disconnectMs], NOW)).toBeNull();
  });

  it('returns null when leftAt is not set', () => {
    const noLeftAt = makeDeparture({ leftAt: null });
    const disconnectMs = LEFT_AT_MS + 5 * 60_000;
    expect(resolveCarArrival(noLeftAt, [disconnectMs], NOW)).toBeNull();
  });

  it('ignores a disconnect at or before leftAt', () => {
    const atLeftAt = LEFT_AT_MS;
    const beforeLeftAt = LEFT_AT_MS - 60_000;
    expect(resolveCarArrival(makeDeparture(), [atLeftAt, beforeLeftAt], NOW)).toBeNull();
  });

  it('ignores a stale disconnect outside ARRIVAL_MATCH_WINDOW_MS of now', () => {
    // Over 12h before NOW, even though it's after leftAt (a leftAt from a
    // much older, unrelated departure record wouldn't normally coexist with
    // this NOW, but the guard must hold regardless).
    const staleMs = NOW_MS - 13 * 60 * 60_000;
    expect(resolveCarArrival(makeDeparture({ leftAt: '2026-07-20T18:00:00.000Z' }), [staleMs], NOW)).toBeNull();
  });

  it('starts the arrival phase from a fresh disconnect when arrivedAt is null', () => {
    const disconnectMs = LEFT_AT_MS + 5 * 60_000; // 07:35
    const result = resolveCarArrival(makeDeparture({ arrivedAt: null }), [disconnectMs], NOW);
    expect(result).toEqual({ arrivedAtMs: disconnectMs });
  });

  it('re-anchors forward when Wi-Fi fired early and nothing has been checked yet', () => {
    const earlyWifiArrival = LEFT_AT_MS + 3 * 60_000; // 07:33, in the car park
    const disconnectMs = LEFT_AT_MS + 8 * 60_000; // 07:38, actually got out
    const departure = makeDeparture({ arrivedAt: new Date(earlyWifiArrival).toISOString() });
    const result = resolveCarArrival(departure, [disconnectMs], NOW);
    expect(result).toEqual({ arrivedAtMs: disconnectMs });
  });

  it('does NOT re-anchor once an arrival step has been checked', () => {
    const earlyWifiArrival = LEFT_AT_MS + 3 * 60_000;
    const disconnectMs = LEFT_AT_MS + 8 * 60_000;
    const departure = makeDeparture({
      arrivedAt: new Date(earlyWifiArrival).toISOString(),
      arrivalSteps: [{ id: 'a1', name: 'Get to Spind', plannedMinutes: 5, checkedAt: '2026-07-21T07:36:00.000Z' }],
    });
    expect(resolveCarArrival(departure, [disconnectMs], NOW)).toBeNull();
  });

  it('does NOT re-anchor when arrivedAt is already at or after the disconnect', () => {
    const lateArrival = LEFT_AT_MS + 10 * 60_000; // 07:40, e.g. a manual tap after getting out
    const disconnectMs = LEFT_AT_MS + 8 * 60_000; // 07:38, earlier than arrivedAt
    const departure = makeDeparture({ arrivedAt: new Date(lateArrival).toISOString() });
    expect(resolveCarArrival(departure, [disconnectMs], NOW)).toBeNull();
  });

  it('does NOT re-anchor when arrivedAt exactly equals the disconnect', () => {
    const sameMs = LEFT_AT_MS + 8 * 60_000;
    const departure = makeDeparture({ arrivedAt: new Date(sameMs).toISOString() });
    expect(resolveCarArrival(departure, [sameMs], NOW)).toBeNull();
  });

  it('picks the earliest qualifying disconnect when several exist', () => {
    const first = LEFT_AT_MS + 5 * 60_000; // 07:35 — the real "got out" moment
    const second = LEFT_AT_MS + 20 * 60_000; // 07:50 — e.g. a petrol-stop re-entry/exit
    const third = LEFT_AT_MS + 25 * 60_000;
    // Passed out of order to confirm sorting, not array order, decides.
    const result = resolveCarArrival(makeDeparture(), [third, first, second], NOW);
    expect(result).toEqual({ arrivedAtMs: first });
  });

  it('treats undefined arrivalSteps the same as an empty array', () => {
    const legacyRow = makeDeparture();
    // Simulate a pre-arrival-steps row: the property is entirely absent,
    // not just an empty array — same undefined-as-null discipline every
    // other reader of this field follows.
    delete (legacyRow as { arrivalSteps?: unknown }).arrivalSteps;
    const disconnectMs = LEFT_AT_MS + 5 * 60_000;
    expect(resolveCarArrival(legacyRow, [disconnectMs], NOW)).toBeNull();
  });
});
