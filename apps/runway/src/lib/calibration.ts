import type { Departure } from '../db/types';
import { computeProjection } from './projection';

export interface StepActual {
  stepId: string;
  name: string;
  plannedMinutes: number;
  actualMinutes: number;
}

/**
 * Reconstructs how long each checked-off step actually took, from
 * check-off timestamps alone (RUNWAY_PLAN.md §5.4: "per-step actuals are
 * captured free from check-off timestamps").
 *
 * Attribution assumption (the one thing worth flagging in a reader's
 * comment, not just here): the gap between two check-offs is attributed
 * *entirely* to the later-checked step. If Deepak checks "Shower" at 08:15
 * and "Dress" at 08:28, "Dress" is recorded as 13 minutes — even though
 * some of that 13 minutes might really have been him standing around
 * between the two, not dressing. There's no signal in the data to split
 * that time any other way (no step-start timestamp, only step-*done*
 * timestamps), so this approximation is the only one the data supports.
 * It's honest enough for calibration, which only needs "roughly how long
 * does this step take", not forensic precision.
 *
 * Steps are ordered by `checkedAt` (not list position) because prep is
 * nonlinear in practice — any step can be checked in any order — and the
 * first event boundary is always `startedAt`, the moment the departure
 * began. A departure that was never started (no `startedAt`) has no time
 * axis to reconstruct anything against, so it contributes nothing.
 *
 * Arrival-steps increment: arrival-step actuals are reconstructed by the
 * exact same chain-attribution logic, but anchored from `arrivedAt` — NOT
 * from the prep chain's last check-off, and NOT chained onto the prep
 * steps at all. The gap between "last prep step checked" and "arrived at
 * the building" IS the journey (travel time, possibly hours for some
 * appointments) — attributing that gap to the first arrival step would
 * teach the learner that, say, "Change into scrubs" takes 40 minutes,
 * when 38 of those were spent driving. Two independent chains, two
 * independent anchors, same reasoning `deriveChain` below is shared for.
 * A departure whose arrival phase never began (`arrivedAt` still
 * null/undefined — true of every departure without arrival steps, and of
 * one that has them but hasn't reached the "I'm at the building" tap yet)
 * contributes no arrival actuals at all: same "no time axis, no data" rule
 * `startedAt` above already applies to the whole function, just applied a
 * second time to the second chain.
 */
export function deriveStepActuals(
  departure: Pick<Departure, 'steps' | 'startedAt' | 'arrivalSteps' | 'arrivedAt'>,
): StepActual[] {
  if (!departure.startedAt) return [];

  const prepActuals = deriveChain(departure.startedAt, departure.steps);
  const arrivalActuals = departure.arrivedAt
    ? deriveChain(departure.arrivedAt, departure.arrivalSteps ?? [])
    : [];

  return [...prepActuals, ...arrivalActuals];
}

/**
 * Shared chain-attribution walk behind deriveStepActuals' two independent
 * chains (prep, anchored at `startedAt`; arrival, anchored at `arrivedAt`)
 * — see that function's own doc comment for why they're kept apart rather
 * than one continuous chain. ISO 8601 timestamps sort correctly as plain
 * strings; Array#sort is stable (guaranteed since ES2019), so steps
 * checked at the exact same instant keep their original relative order —
 * irrelevant to the result either way, since a 0-minute gap is 0-minute
 * regardless of which of the tied steps is treated as "later".
 */
function deriveChain(anchorIso: string, steps: readonly { id: string; name: string; plannedMinutes: number; checkedAt: string | null }[]): StepActual[] {
  const checked = steps
    .filter((step): step is typeof step & { checkedAt: string } => step.checkedAt !== null)
    .slice()
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));

  const actuals: StepActual[] = [];
  let previousIso = anchorIso;
  for (const step of checked) {
    const actualMinutes = Math.round(
      (new Date(step.checkedAt).getTime() - new Date(previousIso).getTime()) / 60_000,
    );
    actuals.push({
      stepId: step.id,
      name: step.name,
      plannedMinutes: step.plannedMinutes,
      actualMinutes,
    });
    previousIso = step.checkedAt;
  }
  return actuals;
}

/** Standard median: middle value for an odd-length list, average of the two
 * middle values for an even-length list. `null` for an empty list — there's
 * no meaningful median of nothing, and callers should treat that as "not
 * enough data" rather than coercing it to 0. */
export function medianMinutes(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * leaveBy (appointment minus travel minus arrival steps — see
 * projection.ts) doesn't depend on `now`, so any Date works as the
 * evaluation anchor; `appointmentAt` is passed for both so the result is a
 * fixed fact about the appointment, not something that would read
 * differently depending on when it's computed.
 *
 * `originalAppointmentAt ?? appointmentAt`, not `appointmentAt` alone: this
 * is exactly the slip/lateness anchor db/types.ts's `originalAppointmentAt`
 * comment describes — measuring against whatever `appointmentAt` happens to
 * be NOW would let a re-anchored departure launder its lateness against the
 * rescued target instead of the one it actually missed. `travelMinutes` is
 * still the departure's CURRENT value (it may have been live-updated since
 * the original commitment) — an accepted imprecision, since re-anchoring
 * changes the appointment, not travel time, and there is no separate
 * "travel time as of the original commitment" to fall back on. Same
 * treatment for `arrivalSteps`: whatever the departure's current arrival
 * plan is, not a frozen snapshot from the original commitment — arrival
 * steps aren't touched by re-anchoring any more than travelMinutes is.
 *
 * Lifted out of History.tsx (learning increment) so `learnedBufferSuggestion`
 * (learning.ts) can measure the exact same "out the door" slip History
 * already shows on screen, rather than a second, subtly different
 * definition of "slip" living in two files.
 */
export function plannedLeaveBy(
  departure: Pick<
    Departure,
    'appointmentAt' | 'originalAppointmentAt' | 'travelMinutes' | 'bufferMinutes' | 'steps' | 'arrivalSteps'
  >,
): Date {
  const anchor = departure.originalAppointmentAt ?? departure.appointmentAt;
  return computeProjection(new Date(anchor), { ...departure, appointmentAt: anchor }).leaveBy;
}

/** `leftAt` minus planned leaveBy, in whole minutes. Positive = left later
 * than planned (late); negative = left earlier (early). `undefined` when
 * `leftAt` is missing — shouldn't happen for a 'left'/'done' departure in
 * practice, but the write (Runway.tsx's handleLeave) and this read are two
 * different code paths and nothing enforces that invariant at the type
 * level, so this stays defensive rather than assuming it. */
export function slipMinutes(departure: Departure): number | undefined {
  if (!departure.leftAt) return undefined;
  return Math.round((new Date(departure.leftAt).getTime() - plannedLeaveBy(departure).getTime()) / 60_000);
}
