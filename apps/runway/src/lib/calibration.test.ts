import { describe, expect, it } from 'vitest';
import { deriveStepActuals, medianMinutes, plannedLeaveBy, slipMinutes } from './calibration';
import type { Departure } from '../db/types';

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
    originalAppointmentAt: '2026-07-09T09:00:00.000Z',
    scheduledForDate: null,
    wasReplanned: false,
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

describe('plannedLeaveBy / slipMinutes', () => {
  it('measures against originalAppointmentAt, not a re-anchored appointmentAt', () => {
    // Re-anchored: appointmentAt moved to 10:00, but originalAppointmentAt
    // (09:00) is what the slip must still be measured against — otherwise a
    // rescued departure could launder its lateness against the new target.
    const departure = makeDeparture({
      appointmentAt: '2026-07-09T10:00:00.000Z',
      originalAppointmentAt: '2026-07-09T09:00:00.000Z',
      travelMinutes: 20,
      leftAt: '2026-07-09T08:45:00.000Z', // 5 min after the ORIGINAL leaveBy of 08:40
    });

    expect(plannedLeaveBy(departure).toISOString()).toBe('2026-07-09T08:40:00.000Z');
    expect(slipMinutes(departure)).toBe(5);
  });

  it('falls back to appointmentAt when originalAppointmentAt is null (never re-anchored)', () => {
    const departure = makeDeparture({
      appointmentAt: '2026-07-09T09:00:00.000Z',
      originalAppointmentAt: null,
      travelMinutes: 20,
      leftAt: '2026-07-09T08:35:00.000Z', // 5 min BEFORE leaveBy of 08:40
    });

    expect(slipMinutes(departure)).toBe(-5);
  });

  it('is undefined when leftAt is missing', () => {
    const departure = makeDeparture({ leftAt: null });
    expect(slipMinutes(departure)).toBeUndefined();
  });

  it('is exactly 0 for a departure that left exactly on its planned leaveBy', () => {
    const departure = makeDeparture({
      appointmentAt: '2026-07-09T09:00:00.000Z',
      originalAppointmentAt: '2026-07-09T09:00:00.000Z',
      travelMinutes: 20,
      leftAt: '2026-07-09T08:40:00.000Z',
    });
    expect(slipMinutes(departure)).toBe(0);
  });
});

