import { describe, expect, it } from 'vitest';
import { computeProjection, computeStartBy } from './projection';
import type { Departure } from '../db/types';

// Fixed "now" for every test so assertions aren't racing the real clock.
const NOW = new Date('2026-07-09T08:00:00.000Z');

function makeDeparture(overrides: Partial<Departure> = {}): Pick<
  Departure,
  'appointmentAt' | 'travelMinutes' | 'bufferMinutes' | 'steps' | 'arrivalSteps' | 'leftAt' | 'arrivedAt'
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
    // Not-yet-left is the default phase for every existing test above —
    // the post-departure describe block below overrides these explicitly.
    leftAt: null,
    arrivedAt: null,
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

// Post-departure fix (0.45.2): before this, projectedArrival used the
// not-yet-left four-term equation unconditionally, in every phase — which
// silently re-added already-spent buffer/travel minutes once `leftAt`/
// `arrivedAt` were set, and re-anchored the travel term to `now` on every
// tick while driving instead of measuring it from `leftAt`, so the ETA
// slid forward continuously instead of converging. This block is the
// regression coverage that never existed for that: projection.test.ts had
// zero cases with `leftAt` or `arrivedAt` set before this increment.
describe('computeProjection — post-departure phases', () => {
  it('not-yet-left behaviour is unchanged (leftAt/arrivedAt both null, guards the pre-fix branch)', () => {
    // Identical numbers and expectation to the very first test in this
    // file ("sums all steps when none are checked") — restated here,
    // explicitly under the new phase-aware code path, as a regression
    // guard against the branch that already worked.
    const departure = makeDeparture({ leftAt: null, arrivedAt: null });
    const { projectedArrival, slackMinutes, state } = computeProjection(NOW, departure);

    expect(projectedArrival.toISOString()).toBe('2026-07-09T09:00:00.000Z');
    expect(slackMinutes).toBe(0);
    expect(state).toBe('tight');
  });

  it('arrived: projectedArrival is exactly now + remaining arrival minutes — travel, buffer and an unchecked prep step all contribute nothing', () => {
    const departure = makeDeparture({
      leftAt: '2026-07-09T07:30:00.000Z',
      arrivedAt: '2026-07-09T07:55:00.000Z',
      travelMinutes: 20,
      bufferMinutes: 10,
      // Unchecked on purpose: proves an unchecked prep step is excluded
      // once arrived, not just that checked ones already summed to zero.
      steps: [{ id: 's2', name: 'Dress', plannedMinutes: 10, checkedAt: null }],
      arrivalSteps: [{ id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: null }],
    });
    const { projectedArrival } = computeProjection(NOW, departure);

    // NOW (08:00) + 8 remaining arrival minutes = 08:08. Not 08:00 + 8 +
    // 10 buffer + 20 travel + 10 prep = 08:48, which is what the pre-fix
    // formula would have said.
    expect(projectedArrival.toISOString()).toBe('2026-07-09T08:08:00.000Z');
  });

  it('arrived with all arrival steps checked: projectedArrival === now', () => {
    const departure = makeDeparture({
      leftAt: '2026-07-09T07:30:00.000Z',
      arrivedAt: '2026-07-09T07:55:00.000Z',
      arrivalSteps: [
        { id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: '2026-07-09T07:58:00.000Z' },
        { id: 'a2', name: 'Take the lift', plannedMinutes: 5, checkedAt: '2026-07-09T07:59:00.000Z' },
      ],
    });
    const { projectedArrival } = computeProjection(NOW, departure);

    expect(projectedArrival.toISOString()).toBe(NOW.toISOString());
  });

  it('left, mid-drive: leftAt 5 min ago + 20 min travel = 15 min from now, plus remaining arrival minutes', () => {
    const departure = makeDeparture({
      leftAt: '2026-07-09T07:55:00.000Z', // 5 min before NOW
      arrivedAt: null,
      travelMinutes: 20,
      arrivalSteps: [{ id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: null }],
    });
    const { projectedArrival } = computeProjection(NOW, departure);

    // driveEnds = 07:55 + 20 = 08:15 (15 min after NOW). + 8 arrival = 08:23.
    expect(projectedArrival.toISOString()).toBe('2026-07-09T08:23:00.000Z');
  });

  it('left, mid-drive: projectedArrival stays FIXED as now advances (regression test for the sliding-window bug)', () => {
    // Same leftAt/travelMinutes as the previous case: driveEnds = 08:15,
    // still in the future at both `now`s below, so both reads should
    // anchor to the same fixed driveEnds instant rather than to `now`.
    const departure = makeDeparture({
      leftAt: '2026-07-09T07:55:00.000Z',
      arrivedAt: null,
      travelMinutes: 20,
      arrivalSteps: [],
    });

    const atNow = computeProjection(NOW, departure).projectedArrival;
    const twoMinutesLater = computeProjection(new Date('2026-07-09T08:02:00.000Z'), departure).projectedArrival;

    // Pre-fix, this would have been 08:15 vs 08:17 — sliding forward with
    // `now` instead of converging on the actual drive.
    expect(atNow.toISOString()).toBe('2026-07-09T08:15:00.000Z');
    expect(twoMinutesLater.toISOString()).toBe('2026-07-09T08:15:00.000Z');
  });

  it('left, drive overrun: anchor is now (not the past), and projectedArrival keeps slipping as now advances', () => {
    // leftAt 40 min ago, 20 min travel -> the drive was "due" 20 min ago
    // (07:40); max(driveEnds, now) must not let the projection land there.
    const departure = makeDeparture({
      leftAt: '2026-07-09T07:20:00.000Z',
      arrivedAt: null,
      travelMinutes: 20,
      arrivalSteps: [],
    });

    const atNow = computeProjection(NOW, departure).projectedArrival;
    expect(atNow.toISOString()).toBe(NOW.toISOString());

    const tenMinutesLater = new Date('2026-07-09T08:10:00.000Z');
    const laterProjection = computeProjection(tenMinutesLater, departure).projectedArrival;
    // Still overrunning at the later `now`, so the projection slips right
    // along with it rather than staying pinned to the stale driveEnds.
    expect(laterProjection.toISOString()).toBe(tenMinutesLater.toISOString());
  });

  it('slackMinutes/state are correct while driving: on pace reads calm, not the old always-recomputed figure', () => {
    const departure = makeDeparture({
      appointmentAt: '2026-07-09T08:30:00.000Z',
      leftAt: '2026-07-09T07:55:00.000Z', // 5 min before NOW
      arrivedAt: null,
      travelMinutes: 20, // driveEnds 08:15
      arrivalSteps: [],
    });
    const { projectedArrival, slackMinutes, state } = computeProjection(NOW, departure);

    expect(projectedArrival.toISOString()).toBe('2026-07-09T08:15:00.000Z');
    expect(slackMinutes).toBe(15);
    expect(state).toBe('calm');
  });

  it('a departure reported "late" under the old inflated post-arrival math is genuinely "calm" once arrived, under the new math — the case this fix exists for', () => {
    const departure = makeDeparture({
      appointmentAt: '2026-07-09T08:25:00.000Z',
      leftAt: '2026-07-09T07:50:00.000Z',
      arrivedAt: '2026-07-09T07:58:00.000Z',
      travelMinutes: 20,
      bufferMinutes: 10,
      // Left unchecked deliberately: the old formula would have added its
      // 15 minutes on top of buffer and travel too.
      steps: [{ id: 's1', name: 'Shower', plannedMinutes: 15, checkedAt: null }],
      arrivalSteps: [],
    });

    // What the OLD (pre-fix) unconditional formula would have said:
    // now + 15 prep + 10 buffer + 20 travel + 0 arrival = 08:00 + 45 = 08:45.
    // Appointment 08:25 - 08:45 = -20 min slack -> 'late'.
    //
    // What the fixed, arrived-phase formula actually says:
    const { projectedArrival, slackMinutes, state } = computeProjection(NOW, departure);

    expect(projectedArrival.toISOString()).toBe(NOW.toISOString()); // 08:00, nothing left but arrival steps (none)
    expect(slackMinutes).toBe(25); // 08:25 - 08:00
    expect(state).toBe('calm');
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
