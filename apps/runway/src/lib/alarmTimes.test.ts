import { describe, expect, it } from 'vitest';
import { computeAlarmTimes } from './alarmTimes';
import type { Departure } from '../db/types';

// Well before any alarm in the "normal case" fixture below, so nothing gets
// filtered by the past-time check unless a test moves `now` on purpose.
const NOW = new Date('2026-07-09T06:00:00.000Z');

function makeDeparture(overrides: Partial<Departure> = {}): Pick<
  Departure,
  'appointmentAt' | 'travelMinutes' | 'bufferMinutes' | 'steps' | 'arrivalSteps'
> {
  return {
    appointmentAt: '2026-07-09T09:00:00.000Z',
    travelMinutes: 20,
    bufferMinutes: 10,
    steps: [
      { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: null },
      { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: null },
      { id: 's3', name: 'Pack bag', plannedMinutes: 5, checkedAt: null },
    ],
    arrivalSteps: [],
    ...overrides,
  };
}

describe('computeAlarmTimes', () => {
  it('orders startBy < wrapUp < leaveSoon < leaveNow in the normal case', () => {
    const departure = makeDeparture();
    const alarms = computeAlarmTimes(NOW, departure);

    // Nothing filtered — all four are in the future relative to NOW.
    expect(alarms).toHaveLength(4);
    expect(alarms.map((a) => a.slot)).toEqual([0, 1, 2, 3]);

    const [startBy, wrapUp, leaveSoon, leaveNow] = alarms;
    expect(startBy.at.getTime()).toBeLessThan(wrapUp.at.getTime());
    expect(wrapUp.at.getTime()).toBeLessThan(leaveSoon.at.getTime());
    expect(leaveSoon.at.getTime()).toBeLessThan(leaveNow.at.getTime());

    // Exact values: appointment 09:00, travel 20 -> leaveNow 08:40.
    expect(leaveNow.at.toISOString()).toBe('2026-07-09T08:40:00.000Z');
    // wrapUp = leaveNow - buffer(10) = 08:30.
    expect(wrapUp.at.toISOString()).toBe('2026-07-09T08:30:00.000Z');
    // leaveSoon = leaveNow - 5 = 08:35.
    expect(leaveSoon.at.toISOString()).toBe('2026-07-09T08:35:00.000Z');
    // startBy = wrapUp - totalPrep(30) = 08:00.
    expect(startBy.at.toISOString()).toBe('2026-07-09T08:00:00.000Z');

    expect(alarms.every((a) => a.copy.length > 0)).toBe(true);
  });

  it('carries the exact copy string per slot', () => {
    const alarms = computeAlarmTimes(NOW, makeDeparture());
    expect(alarms.map((a) => a.copy)).toEqual([
      'Start getting ready.',
      'Wrap up. Buffer time begins.',
      'Leave in 5 minutes.',
      'Leave now.',
    ]);
  });

  it('degenerate case: zero prep with a 5-min buffer collapses startBy/wrapUp/leaveSoon together, ordering stays non-strict', () => {
    // bufferMinutes deliberately equals the fixed 5-min leaveSoon offset, so
    // wrapUp (leaveNow - buffer) and leaveSoon (leaveNow - 5) land on the
    // exact same instant, and zero prep collapses startBy onto wrapUp too —
    // three of the four slots coincide. Dedup is NOT expected (all four
    // slots are still present below); this only asserts ordering doesn't
    // break down (no slot is strictly ahead of an earlier one).
    const departure = makeDeparture({
      bufferMinutes: 5,
      steps: [{ id: 's1', name: 'Grab keys', plannedMinutes: 0, checkedAt: null }],
    });
    const alarms = computeAlarmTimes(NOW, departure);

    expect(alarms).toHaveLength(4);
    const [startBy, wrapUp, leaveSoon, leaveNow] = alarms;
    expect(startBy.at.getTime()).toBe(wrapUp.at.getTime());
    expect(wrapUp.at.getTime()).toBe(leaveSoon.at.getTime());
    expect(leaveSoon.at.getTime()).toBeLessThan(leaveNow.at.getTime());
    // Non-strict: <= throughout, no assumption that any pair is strictly ordered.
    for (let i = 1; i < alarms.length; i++) {
      expect(alarms[i - 1].at.getTime()).toBeLessThanOrEqual(alarms[i].at.getTime());
    }
  });

  it('filters out alarm times already in the past at scheduling moment', () => {
    const departure = makeDeparture();
    // "Now" is 08:32 — past startBy(08:00), wrapUp(08:30); future leaveSoon(08:35), leaveNow(08:40).
    const now = new Date('2026-07-09T08:32:00.000Z');
    const alarms = computeAlarmTimes(now, departure);

    expect(alarms.map((a) => a.slot)).toEqual([2, 3]);
    expect(alarms.every((a) => a.at.getTime() > now.getTime())).toBe(true);
  });

  it('buffer < 5 min: wrapUp fires after leaveSoon (accepted copy-order oddity, not a missed alarm)', () => {
    const departure = makeDeparture({ bufferMinutes: 2 });
    const alarms = computeAlarmTimes(NOW, departure);

    const wrapUp = alarms.find((a) => a.slot === 1)!;
    const leaveSoon = alarms.find((a) => a.slot === 2)!;
    const leaveNow = alarms.find((a) => a.slot === 3)!;

    // leaveNow = appointment(09:00) - travel(20) = 08:40.
    expect(leaveNow.at.toISOString()).toBe('2026-07-09T08:40:00.000Z');
    // wrapUp = leaveNow - buffer(2) = 08:38.
    expect(wrapUp.at.toISOString()).toBe('2026-07-09T08:38:00.000Z');
    // leaveSoon = leaveNow - 5 (fixed) = 08:35 - earlier than wrapUp, i.e.
    // "Leave in 5 minutes" fires before "Wrap up" once buffer < 5.
    expect(leaveSoon.at.toISOString()).toBe('2026-07-09T08:35:00.000Z');
    expect(wrapUp.at.getTime()).toBeGreaterThan(leaveSoon.at.getTime());
  });

  it('filters everything when the whole departure is already in the past', () => {
    const departure = makeDeparture();
    const now = new Date('2026-07-09T09:30:00.000Z'); // after the appointment itself
    const alarms = computeAlarmTimes(now, departure);

    expect(alarms).toEqual([]);
  });
});

// Arrival-steps increment: arrival steps use their FULL total (not
// "remaining") because these four alarms are all scheduled once, before a
// single step of either kind has been checked off.
describe('computeAlarmTimes — arrival steps', () => {
  it('shifts every one of the four slots earlier by the total arrival-step minutes', () => {
    const departure = makeDeparture({
      arrivalSteps: [{ id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: null }],
    });
    const alarms = computeAlarmTimes(NOW, departure);
    const bySlot = new Map(alarms.map((a) => [a.slot, a.at.toISOString()]));

    // Baseline (no arrival steps, per the normal-case test above):
    // startBy 08:00, wrapUp 08:30, leaveSoon 08:35, leaveNow 08:40. Every
    // one shifts exactly 8 minutes earlier here.
    expect(bySlot.get(0)).toBe('2026-07-09T07:52:00.000Z'); // startBy
    expect(bySlot.get(1)).toBe('2026-07-09T08:22:00.000Z'); // wrapUp
    expect(bySlot.get(2)).toBe('2026-07-09T08:27:00.000Z'); // leaveSoon
    expect(bySlot.get(3)).toBe('2026-07-09T08:32:00.000Z'); // leaveNow
  });

  it('an explicit empty arrival-steps list leaves the schedule exactly unchanged', () => {
    const withEmpty = computeAlarmTimes(NOW, makeDeparture({ arrivalSteps: [] }));
    const withoutField = computeAlarmTimes(NOW, makeDeparture());

    expect(withEmpty.map((a) => a.at.toISOString())).toEqual(withoutField.map((a) => a.at.toISOString()));
  });

  it('treats a legacy departure (arrivalSteps missing entirely) the same as []', () => {
    const departure = makeDeparture();
    const legacy: Partial<typeof departure> = { ...departure };
    delete legacy.arrivalSteps;

    const legacyAlarms = computeAlarmTimes(NOW, legacy as typeof departure);
    const explicitEmptyAlarms = computeAlarmTimes(NOW, { ...departure, arrivalSteps: [] });

    expect(legacyAlarms.map((a) => a.at.toISOString())).toEqual(
      explicitEmptyAlarms.map((a) => a.at.toISOString()),
    );
  });
});
