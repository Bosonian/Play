import type { Departure } from '../db/types';

/**
 * Field bug, real user report: tapped "I'm out the door" on a departure
 * WITH arrival steps, drove, and Android killed the backgrounded app
 * mid-drive. On relaunch the departure was unreachable — Home's own
 * `waitingOnArrival` query (Home.tsx) deliberately EXCLUDES exactly this
 * set (see that query's comment: Runway.tsx's arrival phase resolves an
 * arrival-steps departure more precisely, so the plan was to let people
 * reach it by staying on the Runway screen through the whole arrival
 * phase). That assumption holds for a foregrounded app and breaks the
 * instant Android reclaims it — the departure is still `status: 'left'`
 * in Dexie, `leftAt` stamped, arrival steps still there to finish, but
 * nothing on Home pointed back to it. This predicate is that missing
 * surface's filter.
 *
 * True for a `left` departure that still has arrival steps to resolve,
 * whether or not the arrival phase has even been started yet
 * (`arrivedAt == null`) — a checklist abandoned half-done when the app
 * died is exactly as stranded as one that was never opened.
 *
 * `arrivalSteps ?? []` — same undefined-as-null rule as every other
 * late-added `Departure` field (see db/types.ts's own comments): a row
 * saved before arrival steps existed has no `arrivalSteps` property at
 * all, and must read exactly like "no arrival steps," not throw.
 */
export function strandedInArrival(departure: Pick<Departure, 'status' | 'arrivalSteps'>): boolean {
  return departure.status === 'left' && (departure.arrivalSteps ?? []).length > 0;
}

/**
 * "En route · arrival steps waiting." / "Arrived · 2 of 3 arrival steps
 * done." — the state line on a stranded-arrival card (Home.tsx). Pulled out
 * of the component so the exact tally shown on screen is something a test
 * can exercise directly, without going through Dexie or React. Only
 * meaningful for a departure `strandedInArrival` already returned true for
 * — callers are expected to have checked that first.
 */
export function strandedArrivalLine(departure: Pick<Departure, 'arrivedAt' | 'arrivalSteps'>): string {
  const steps = departure.arrivalSteps ?? [];
  if (departure.arrivedAt == null) return 'En route · arrival steps waiting.';
  const checkedCount = steps.filter((step) => step.checkedAt !== null).length;
  return `Arrived · ${checkedCount} of ${steps.length} arrival steps done.`;
}
