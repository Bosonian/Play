import { describe, expect, it } from 'vitest';
import { computeProjection, computeStartBy } from './projection';
import type { Departure } from '../db/types';

// Fixed "now" for every test so assertions aren't racing the real clock.
const NOW = new Date('2026-07-09T08:00:00.000Z');

function makeDeparture(overrides: Partial<Departure> = {}): Pick<
  Departure,
  'appointmentAt' | 'travelMinutes' | 'bufferMinutes' | 'steps' | 'arrivalSteps'
> {
  return {
    appointmentAt: '2026-07-09T09:00:00.000Z', // 60 min after NOW
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

describe('computeProjection', () => {
  it('sums all steps when none are checked: 15+10+5 prep + 10 buffer + 20 travel = 60 min out', () => {
    const departure = makeDeparture();
    const { projectedArrival, slackMinutes } = computeProjection(NOW, departure);

    // 08:00 + 60 min = 09:00, exactly matching the 09:00 appointment.
    expect(projectedArrival.toISOString()).toBe('2026-07-09T09:00:00.000Z');
    expect(slackMinutes).toBe(0);
  });

  it('excludes checked steps from the remaining-prep sum', () => {
    const departure = makeDeparture({
      steps: [
        { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T07:55:00.000Z' },
        { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: null },
        { id: 's3', name: 'Pack bag', plannedMinutes: 5, checkedAt: null },
      ],
    });
    const { projectedArrival, slackMinutes } = computeProjection(NOW, departure);

    // Remaining: 10 + 5 prep + 10 buffer + 20 travel = 45 min -> 08:45.
    expect(projectedArrival.toISOString()).toBe('2026-07-09T08:45:00.000Z');
    expect(slackMinutes).toBe(15);
  });

  it('all steps checked leaves only buffer + travel', () => {
    const departure = makeDeparture({
      steps: [
        { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T07:50:00.000Z' },
        { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: '2026-07-09T07:55:00.000Z' },
        { id: 's3', name: 'Pack bag', plannedMinutes: 5, checkedAt: '2026-07-09T07:58:00.000Z' },
      ],
    });
    const { projectedArrival, slackMinutes } = computeProjection(NOW, departure);

    // Remaining: 0 prep + 10 buffer + 20 travel = 30 min -> 08:30.
    expect(projectedArrival.toISOString()).toBe('2026-07-09T08:30:00.000Z');
    expect(slackMinutes).toBe(30);
  });

  it('produces negative slack once projected arrival is after the appointment', () => {
    // Same steps as the "none checked" case (60 min out) but the
    // appointment is only 30 min away -> 30 min late.
    const departure = makeDeparture({ appointmentAt: '2026-07-09T08:30:00.000Z' });
    const { slackMinutes, state } = computeProjection(NOW, departure);

    expect(slackMinutes).toBe(-30);
    expect(state).toBe('late');
  });

  it('state is "calm" at the slack=5 boundary (inclusive)', () => {
    // 65 min to appointment, 60 min of work -> exactly 5 min slack.
    const departure = makeDeparture({ appointmentAt: '2026-07-09T09:05:00.000Z' });
    const { slackMinutes, state } = computeProjection(NOW, departure);

    expect(slackMinutes).toBe(5);
    expect(state).toBe('calm');
  });

  it('state is "tight" just under the slack=5 boundary', () => {
    // 64 min to appointment, 60 min of work -> 4 min slack.
    const departure = makeDeparture({ appointmentAt: '2026-07-09T09:04:00.000Z' });
    const { slackMinutes, state } = computeProjection(NOW, departure);

    expect(slackMinutes).toBe(4);
    expect(state).toBe('tight');
  });

  it('state is "tight" at the slack=0 boundary (inclusive), "late" just under it', () => {
    const onTime = computeProjection(NOW, makeDeparture({ appointmentAt: '2026-07-09T09:00:00.000Z' }));
    expect(onTime.slackMinutes).toBe(0);
    expect(onTime.state).toBe('tight');

    const oneMinuteLate = computeProjection(
      NOW,
      makeDeparture({ appointmentAt: '2026-07-09T08:59:00.000Z' }),
    );
    expect(oneMinuteLate.slackMinutes).toBe(-1);
    expect(oneMinuteLate.state).toBe('late');
  });

  it('leaveBy is appointment minus travel only, independent of buffer or prep', () => {
    const departure = makeDeparture({
      appointmentAt: '2026-07-09T09:00:00.000Z',
      travelMinutes: 20,
      bufferMinutes: 999, // deliberately large, to prove it's excluded
    });
    const { leaveBy } = computeProjection(NOW, departure);

    expect(leaveBy.toISOString()).toBe('2026-07-09T08:40:00.000Z');
  });

  it('an empty step list still accounts for buffer and travel', () => {
    const departure = makeDeparture({ steps: [] });
    const { projectedArrival, slackMinutes } = computeProjection(NOW, departure);

    // 0 prep + 10 buffer + 20 travel = 30 min -> 08:30, 30 min of slack.
    expect(projectedArrival.toISOString()).toBe('2026-07-09T08:30:00.000Z');
    expect(slackMinutes).toBe(30);
  });
});

// Arrival-steps increment (ward-station insight): appointmentAt is the TRUE
// target, arrival steps are the optional gap between the building and it.
describe('computeProjection — arrival steps', () => {
  it('adds remaining (unchecked) arrival-step minutes to projectedArrival', () => {
    const departure = makeDeparture({
      arrivalSteps: [{ id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: null }],
    });
    const { projectedArrival, slackMinutes } = computeProjection(NOW, departure);

    // 30 prep + 10 buffer + 20 travel + 8 arrival = 68 min -> 08:00 + 68 = 09:08.
    expect(projectedArrival.toISOString()).toBe('2026-07-09T09:08:00.000Z');
    expect(slackMinutes).toBe(-8);
  });

  it('subtracts remaining (unchecked) arrival-step minutes from leaveBy too', () => {
    const departure = makeDeparture({
      arrivalSteps: [{ id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: null }],
    });
    const { leaveBy } = computeProjection(NOW, departure);

    // 09:00 appointment - 20 travel - 8 arrival = 08:32.
    expect(leaveBy.toISOString()).toBe('2026-07-09T08:32:00.000Z');
  });

  it('excludes a CHECKED arrival step from the remaining sum in both projectedArrival and leaveBy', () => {
    const departure = makeDeparture({
      arrivalSteps: [
        { id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: '2026-07-09T09:05:00.000Z' },
        { id: 'a2', name: 'Take the lift', plannedMinutes: 5, checkedAt: null },
      ],
    });
    const { projectedArrival, leaveBy } = computeProjection(NOW, departure);

    // Only the unchecked 5-min "Take the lift" counts as remaining: 30 prep
    // + 10 buffer + 20 travel + 5 arrival = 65 min -> 09:05.
    expect(projectedArrival.toISOString()).toBe('2026-07-09T09:05:00.000Z');
    // 09:00 - 20 travel - 5 remaining arrival = 08:35.
    expect(leaveBy.toISOString()).toBe('2026-07-09T08:35:00.000Z');
  });

  it('a departure with zero arrival steps reduces exactly to the original four-term equation', () => {
    const withEmpty = computeProjection(NOW, makeDeparture({ arrivalSteps: [] }));
    const withoutField = computeProjection(NOW, makeDeparture());

    expect(withEmpty.projectedArrival.toISOString()).toBe('2026-07-09T09:00:00.000Z');
    expect(withEmpty.leaveBy.toISOString()).toBe(withoutField.leaveBy.toISOString());
  });

  it('treats a legacy departure (arrivalSteps missing entirely, not just empty) the same as []', () => {
    const departure = makeDeparture();
    const legacy: Partial<typeof departure> = { ...departure };
    delete legacy.arrivalSteps;

    const legacyResult = computeProjection(NOW, legacy as typeof departure);
    const explicitEmptyResult = computeProjection(NOW, { ...departure, arrivalSteps: [] });

    expect(legacyResult.projectedArrival.toISOString()).toBe(explicitEmptyResult.projectedArrival.toISOString());
    expect(legacyResult.leaveBy.toISOString()).toBe(explicitEmptyResult.leaveBy.toISOString());
  });
});

describe('computeStartBy', () => {
  it('equals appointment minus travel minus buffer minus total prep', () => {
    const departure = makeDeparture();
    const startBy = computeStartBy(departure);

    // 09:00 - 20 travel - 10 buffer - 30 prep(15+10+5) = 08:00.
    expect(startBy.toISOString()).toBe('2026-07-09T08:00:00.000Z');
  });

  it('is unaffected by checkedAt — it always reasons about the full plan', () => {
    const allChecked = makeDeparture({
      steps: [
        { id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: '2026-07-09T07:00:00.000Z' },
        { id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: '2026-07-09T07:00:00.000Z' },
        { id: 's3', name: 'Pack bag', plannedMinutes: 5, checkedAt: '2026-07-09T07:00:00.000Z' },
      ],
    });
    const unchecked = makeDeparture();

    expect(computeStartBy(allChecked).toISOString()).toBe(computeStartBy(unchecked).toISOString());
  });

  it('also subtracts the FULL arrival-step total, arrival-steps increment (setup-time preview, nothing checked yet)', () => {
    const departure = makeDeparture({
      arrivalSteps: [{ id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: null }],
    });
    const startBy = computeStartBy(departure);

    // 09:00 - 20 travel - 8 arrival - 10 buffer - 30 prep = 07:52.
    expect(startBy.toISOString()).toBe('2026-07-09T07:52:00.000Z');
  });
});
