import type { Departure, DepartureStep } from '../db/types';

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

/**
 * "Change into scrubs · Lift · Ward station — 12 min." — the RUNNING-state
 * "After arrival" preview line on Runway.tsx (field report, verbatim: "now
 * the after arrival steps are all missing. i had saved them, they seem to
 * be hidden"). Before this, a departure's saved arrival steps were
 * genuinely invisible anywhere on the Runway screen until the moment
 * "I'm out the door" was tapped — nothing wrong had happened to them, they
 * were simply never shown, which reads exactly like "lost" from the other
 * side of the screen. This line is that fix: a quiet, read-only preview
 * during the RUNNING (prep) phase, so what was saved is visible the whole
 * time it's waiting its turn.
 *
 * Names in list order, not re-sorted — list order IS the intended
 * chronological order (the reorder increment this same release ships is
 * what lets that order be corrected from either editor), so this line is
 * just a straight read of it, not a second judgment about sequence.
 *
 * Pulled out as a pure function, not written inline in Runway.tsx, for the
 * same reason strandedArrivalLine above is: the exact tally string is
 * something a test can pin down directly, without going through Dexie or
 * React.
 *
 * Returns '' for an empty list. The only real caller (Runway.tsx) already
 * length-guards before ever rendering this line, so an empty result is
 * never actually shown on screen — but a pure function that silently
 * produced "— 0 min." for an input its own caller promised never to pass
 * would be a worse trap than just returning the honest empty string.
 */
export function arrivalPreviewLine(steps: Pick<DepartureStep, 'name' | 'plannedMinutes'>[]): string {
  if (steps.length === 0) return '';
  const names = steps.map((step) => step.name || 'Step').join(' · ');
  const totalMinutes = steps.reduce((sum, step) => sum + step.plannedMinutes, 0);
  return `${names} — ${totalMinutes} min.`;
}
