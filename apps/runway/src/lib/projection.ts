import type { Departure } from '../db/types';

export interface Projection {
  projectedArrival: Date;
  leaveBy: Date;
  slackMinutes: number;
  state: 'calm' | 'tight' | 'late';
}

/**
 * The one equation the whole app is built around (RUNWAY_PLAN.md §4):
 *
 *   projected arrival = now
 *                      + sum of remaining (unchecked) prep steps
 *                      + friction buffer
 *                      + travel time
 *
 * This is deliberately a pure function — no Dexie access, no `Date.now()`
 * read internally — so `now` is always an explicit argument. That's what
 * makes it possible to unit-test "what does the projection say at 08:47"
 * without mocking the system clock, and it's also what a live-updating
 * screen needs: the caller re-invokes this every tick with a fresh `now`,
 * rather than the function having any internal notion of time passing.
 *
 * leaveBy is a different, simpler line: appointment time minus travel time
 * only. The friction buffer is prep-side (it pads how long getting ready
 * takes, same as a step), not travel-side — so it's folded into
 * projectedArrival above but deliberately left out of leaveBy. leaveBy
 * answers "what time do I physically need to be out the door for the
 * travel time alone to work", independent of how much prep is left.
 */
export function computeProjection(
  now: Date,
  departure: Pick<Departure, 'appointmentAt' | 'travelMinutes' | 'bufferMinutes' | 'steps'>,
): Projection {
  const appointmentAt = new Date(departure.appointmentAt);

  const remainingPrepMinutes = departure.steps
    .filter((step) => step.checkedAt === null)
    .reduce((sum, step) => sum + step.plannedMinutes, 0);

  const totalRemainingMinutes = remainingPrepMinutes + departure.bufferMinutes + departure.travelMinutes;
  const projectedArrival = addMinutes(now, totalRemainingMinutes);
  const leaveBy = addMinutes(appointmentAt, -departure.travelMinutes);

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
 * travel, from computeProjection) minus buffer and the *full* prep total
 * (every step, not just unchecked ones — at setup time nothing has been
 * checked yet, so this is equivalent, but written this way so the meaning
 * — "if you start prep right now with everything ahead of you, this is
 * your last safe start time" — is a function of the plan, not of whatever
 * checkbox state a Departure happens to be in).
 */
export function computeStartBy(
  departure: Pick<Departure, 'appointmentAt' | 'travelMinutes' | 'bufferMinutes' | 'steps'>,
): Date {
  const totalPrepMinutes = departure.steps.reduce((sum, step) => sum + step.plannedMinutes, 0);
  const leaveBy = addMinutes(new Date(departure.appointmentAt), -departure.travelMinutes);
  return addMinutes(leaveBy, -(departure.bufferMinutes + totalPrepMinutes));
}
