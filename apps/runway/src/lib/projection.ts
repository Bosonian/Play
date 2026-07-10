import type { Departure } from '../db/types';

export interface Projection {
  projectedArrival: Date;
  leaveBy: Date;
  slackMinutes: number;
  state: 'calm' | 'tight' | 'late';
}

/**
 * The one equation the whole app is built around (RUNWAY_PLAN.md §4),
 * extended by the arrival-steps increment (ward-station insight: "on time"
 * isn't the hospital door, it's the ward station after changing into
 * scrubs and taking the lift — `appointmentAt` is that TRUE target, and
 * arrival steps are whatever real gap sits between the building and it):
 *
 *   projected arrival = now
 *                      + sum of remaining (unchecked) prep steps
 *                      + friction buffer
 *                      + travel time
 *                      + sum of remaining (unchecked) arrival steps
 *
 * This is deliberately a pure function — no Dexie access, no `Date.now()`
 * read internally — so `now` is always an explicit argument. That's what
 * makes it possible to unit-test "what does the projection say at 08:47"
 * without mocking the system clock, and it's also what a live-updating
 * screen needs: the caller re-invokes this every tick with a fresh `now`,
 * rather than the function having any internal notion of time passing.
 *
 * A departure with no arrival steps (`arrivalSteps` empty or missing —
 * `?? []` treats a row saved before this field existed the same as an
 * empty list, same undefined-as-null rule as every other late-added field
 * on Departure) reduces this exactly to the original four-term equation —
 * nothing changes for the overwhelming majority of departures that never
 * touch the new section.
 *
 * leaveBy answers "what time do I physically need to be out the door for
 * the travel AND arrival-steps time to still land on the true target" —
 * appointment minus travel minus REMAINING (unchecked) arrival-step
 * minutes. The friction buffer stays prep-side only (it pads how long
 * getting ready takes, same as a prep step) and is deliberately left out
 * of leaveBy, unchanged from before this increment.
 *
 * "Remaining", not "total", for the arrival term in leaveBy is a
 * deliberate choice, not an oversight: before the departure has actually
 * left, no arrival step CAN be checked yet, so remaining === total and the
 * two read identically. But this same computeProjection call is also what
 * powers the arrival phase's own live centerpiece (Runway.tsx, once
 * status is 'left') — at that point arrival steps genuinely do get
 * checked off one at a time, and "remaining" is what keeps leaveBy (and by
 * extension slackMinutes/state) still measuring against what's honestly
 * left to do, rather than freezing at a stale total computed before any of
 * this walk had happened.
 */
export function computeProjection(
  now: Date,
  departure: Pick<Departure, 'appointmentAt' | 'travelMinutes' | 'bufferMinutes' | 'steps' | 'arrivalSteps'>,
): Projection {
  const appointmentAt = new Date(departure.appointmentAt);

  const remainingPrepMinutes = departure.steps
    .filter((step) => step.checkedAt === null)
    .reduce((sum, step) => sum + step.plannedMinutes, 0);

  // `?? []` — see this function's own doc comment above for why.
  const remainingArrivalMinutes = (departure.arrivalSteps ?? [])
    .filter((step) => step.checkedAt === null)
    .reduce((sum, step) => sum + step.plannedMinutes, 0);

  const totalRemainingMinutes =
    remainingPrepMinutes + departure.bufferMinutes + departure.travelMinutes + remainingArrivalMinutes;
  const projectedArrival = addMinutes(now, totalRemainingMinutes);
  const leaveBy = addMinutes(appointmentAt, -(departure.travelMinutes + remainingArrivalMinutes));

  // Whole minutes, not a fractional value — a slipping "14:32.7" reads as
  // noise, not signal, and the spec calls for whole-minute slack.
  const slackMinutes = Math.round((appointmentAt.getTime() - projectedArrival.getTime()) / 60_000);

  const state: Projection['state'] =
    slackMinutes < 0 ? 'late' : slackMinutes < 5 ? 'tight' : 'calm';

  return { projectedArrival, leaveBy, slackMinutes, state };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * "Start getting ready by" — used only on the DepartureSetup preview line,
 * before any step has been checked off. It's `leaveBy` (appointment minus
 * travel minus arrival steps, from computeProjection) minus buffer and the
 * *full* prep total (every step, not just unchecked ones — at setup time
 * nothing has been checked yet, so this is equivalent, but written this way
 * so the meaning — "if you start prep right now with everything ahead of
 * you, this is your last safe start time" — is a function of the plan, not
 * of whatever checkbox state a Departure happens to be in).
 *
 * Arrival steps (ward-station increment) use their *full* total here for
 * the same reason prep does — this is a setup-time preview of the whole
 * plan, always evaluated as if nothing has happened yet, never a live
 * "what's actually left" reading (that's computeProjection's job).
 */
export function computeStartBy(
  departure: Pick<Departure, 'appointmentAt' | 'travelMinutes' | 'bufferMinutes' | 'steps' | 'arrivalSteps'>,
): Date {
  const totalPrepMinutes = departure.steps.reduce((sum, step) => sum + step.plannedMinutes, 0);
  const totalArrivalMinutes = (departure.arrivalSteps ?? []).reduce((sum, step) => sum + step.plannedMinutes, 0);
  const leaveBy = addMinutes(new Date(departure.appointmentAt), -(departure.travelMinutes + totalArrivalMinutes));
  return addMinutes(leaveBy, -(departure.bufferMinutes + totalPrepMinutes));
}
