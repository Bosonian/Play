import type { DepartureStep } from '../db/types';

/**
 * "Recover instead of forfeit" (this increment's spec): squeezes the
 * remaining, UNCHECKED portion of a departure's plan down to fit whatever
 * time is actually left before leaveBy. Checked steps are history — they
 * already happened at whatever pace they happened, so this never touches
 * them; only `plannedMinutes` on unchecked steps and `bufferMinutes` are
 * candidates for compression.
 *
 * Arrival-steps increment: `steps` here is always PREP steps — Runway.tsx's
 * replan panel only ever passes `departure.steps`, never `arrivalSteps`.
 * Arrival steps are deliberately NOT compressible by this function: you
 * can't rush the lift from your bathroom, and by the time an arrival step
 * would even be checkable (after leaving, after arriving at the building)
 * the pre-door replan panel this powers is no longer on screen at all —
 * see Runway.tsx's own arrival-phase render branch, which offers no
 * replan/compress action of its own. The available-minutes window this
 * function squeezes prep steps into is `leaveBy − now` (Runway.tsx), and
 * leaveBy (projection.ts) already subtracts remaining arrival-step minutes
 * before this function ever sees the number — so a departure with arrival
 * steps naturally gets LESS room to compress prep into, without this file
 * needing to know arrival steps exist at all.
 *
 * `fits: false` is the honest refusal (CLAUDE.md: "the honest 'no'"
 * throughout this app's other pure-math modules) — some available windows
 * are just too small for the remaining steps to make any sense at all, and
 * the caller (Runway.tsx) is expected to say so plainly rather than produce
 * a compressed plan that's really "2 min to shower" dressed up as help.
 */
export type CompressResult =
  | { fits: true; steps: DepartureStep[]; bufferMinutes: number }
  | { fits: false; minimumMinutes: number };

/** No unchecked step compresses below one minute — a step that reads "0
 * min" isn't a step anymore, it's a step that got silently deleted. */
const MIN_STEP_MINUTES = 1;

/** A compressed buffer never drops below 2 min UNLESS the original buffer
 * was already 0 — see the zero-buffer branch below. 2, not 1, because the
 * buffer's whole purpose (the setup screen's own hint: "keys, toilet, one
 * more thing") needs slightly more slack than a single prep step to mean
 * anything at all. */
const MIN_BUFFER_MINUTES = 2;

/**
 * Squeezes `steps`' unchecked entries and `bufferMinutes` to fit inside
 * `availableMinutes` (the whole minutes between now and leaveBy, computed
 * by the caller — this function has no notion of "now" itself, same
 * "pure, explicit inputs" shape as projection.ts and alarmTimes.ts).
 *
 * Algorithm:
 *  1. If there's nothing to compress (no unchecked steps and a zero
 *     buffer) or the plan already fits (`availableMinutes` covers the
 *     unchecked total + buffer as-is), return it unchanged. Compression
 *     only ever shrinks a plan, never grows one — a factor >= 1 case
 *     handing back a padded plan would be a surprise, not a help.
 *  2. Work out the absolute floor: every unchecked step forced to
 *     MIN_STEP_MINUTES, buffer forced to its own floor (MIN_BUFFER_MINUTES,
 *     or 0 if the original buffer was 0). If `availableMinutes` can't even
 *     cover that floor, refuse outright (`fits: false`) rather than return
 *     a plan that's technically "compressed" but lies about being
 *     workable.
 *  3. Otherwise scale every unchecked step and the buffer by
 *     `factor = availableMinutes / (uncheckedTotal + bufferMinutes)`,
 *     flooring each to a whole minute and clamping up to its own floor
 *     from step 2. Flooring alone can only ever undershoot `availableMinutes`
 *     (floor(x) <= x for every term, and the unrounded terms already sum to
 *     exactly `availableMinutes`) — but clamping small terms UP to their
 *     floor can push the total back OVER `availableMinutes` (e.g. two tiny
 *     steps that both round to 0 both get forced up to 1, adding 2 minutes
 *     nothing in the budget accounted for). Step 4 corrects exactly that.
 *  4. If the floor-clamped sum overshoots `availableMinutes`, repeatedly
 *     take one minute off whichever compressed item (a step or the buffer)
 *     currently holds the largest value above its own floor, until the sum
 *     no longer exceeds `availableMinutes`. This is guaranteed to terminate
 *     without ever refusing mid-way: step 2 already proved the sum of pure
 *     floors is <= `availableMinutes`, so there's always room to give back.
 *
 * `floorsByStepName` (learning increment): a step's floor defaults to
 * MIN_STEP_MINUTES, but when the caller has a learned rushed floor for that
 * step NAME (learning.ts's `learnedRushedFloor`, over that step's own
 * `wasReplanned` history — see learning.ts's header comment on why rushed
 * and natural actuals are never mixed), that value is used instead. This
 * only ever raises a step's floor above the generic 1-minute one — a step
 * genuinely proven to need at least 5 minutes even under real pressure
 * before now got compressed to 1 anyway, which the personalized floor
 * fixes. The parameter is optional and keyed by name (not id) for the same
 * reason calibration.ts's own step-name join is: a DepartureStep's id has
 * no relationship to which template step it came from, but its name does.
 */
export function compressPlan(args: {
  availableMinutes: number;
  steps: DepartureStep[];
  bufferMinutes: number;
  floorsByStepName?: Map<string, number>;
}): CompressResult {
  const { availableMinutes, steps, bufferMinutes, floorsByStepName } = args;

  const uncheckedSteps = steps.filter((step) => step.checkedAt === null);
  const uncheckedTotal = uncheckedSteps.reduce((sum, step) => sum + step.plannedMinutes, 0);
  const originalTotal = uncheckedTotal + bufferMinutes;

  // Nothing to squeeze (every step already checked and buffer already 0),
  // or the plan already fits inside what's left - either way, hand the
  // plan back untouched rather than "compress" something that doesn't need
  // it. Guards the factor computation below against a divide-by-zero too.
  if (originalTotal === 0 || availableMinutes >= originalTotal) {
    return { fits: true, steps, bufferMinutes };
  }

  // Per-step floors (learning increment): MIN_STEP_MINUTES unless
  // `floorsByStepName` has a learned, personalized floor for that step's
  // name - see this function's own doc comment above. `Math.max` with
  // MIN_STEP_MINUTES is a defensive floor-on-the-floor: learnedRushedFloor
  // already never returns below 1, but this keeps the invariant true here
  // too even if a caller hands in something smaller by mistake.
  const stepFloors = uncheckedSteps.map((step) =>
    Math.max(MIN_STEP_MINUTES, floorsByStepName?.get(step.name) ?? MIN_STEP_MINUTES),
  );

  // A zero buffer stays zero - it was a deliberate "no padding" choice at
  // setup time, and compression inventing one back would misrepresent that
  // choice, not help keep it.
  const bufferFloor = bufferMinutes === 0 ? 0 : MIN_BUFFER_MINUTES;
  const floorSum = stepFloors.reduce((sum, floor) => sum + floor, 0) + bufferFloor;

  if (availableMinutes < floorSum) {
    return { fits: false, minimumMinutes: floorSum };
  }

  const factor = availableMinutes / originalTotal;

  // Compressed step values, in the same order as `uncheckedSteps` - order
  // matters below for tie-breaking during overshoot correction (a stable,
  // documented rule beats an arbitrary one for something a test needs to
  // pin down).
  const compressedStepMinutes = uncheckedSteps.map((step, i) =>
    Math.max(stepFloors[i], Math.floor(step.plannedMinutes * factor)),
  );
  let compressedBuffer = Math.max(bufferFloor, Math.floor(bufferMinutes * factor));

  // Step 4: claw back any overshoot introduced by clamping small terms up
  // to their floor. Treats the buffer as just one more item in the same
  // pool as the steps - whichever value is currently largest (and still
  // above its own floor) gives back a minute first, buffer included.
  let overshoot =
    compressedStepMinutes.reduce((sum, minutes) => sum + minutes, 0) + compressedBuffer - availableMinutes;

  while (overshoot > 0) {
    let largestIndex = -1; // -1 means "the buffer", 0..n-1 means a step index
    let largestValue = compressedBuffer > bufferFloor ? compressedBuffer : -1;

    for (let i = 0; i < compressedStepMinutes.length; i++) {
      if (compressedStepMinutes[i] > stepFloors[i] && compressedStepMinutes[i] > largestValue) {
        largestValue = compressedStepMinutes[i];
        largestIndex = i;
      }
    }

    // Reachable only if every item is already at its floor while overshoot
    // is still positive - impossible given floorSum <= availableMinutes was
    // already checked above, so this is a defensive break, not a real path.
    if (largestValue === -1) break;

    if (largestIndex === -1) {
      compressedBuffer -= 1;
    } else {
      compressedStepMinutes[largestIndex] -= 1;
    }
    overshoot -= 1;
  }

  // Reassemble the full step list in original order: checked steps carry
  // their history forward untouched, unchecked steps get their compressed
  // value spliced back in by matching id (uncheckedSteps and
  // compressedStepMinutes share an index because both were built from the
  // same filter/map pass above).
  const compressedById = new Map(uncheckedSteps.map((step, i) => [step.id, compressedStepMinutes[i]]));
  const newSteps = steps.map((step) =>
    step.checkedAt === null ? { ...step, plannedMinutes: compressedById.get(step.id)! } : step,
  );

  return { fits: true, steps: newSteps, bufferMinutes: compressedBuffer };
}

const FIVE_MINUTES_MS = 5 * 60_000;

/** Rounds `date` up to the next 5-minute boundary. A date already sitting
 * exactly on one (seconds and milliseconds both zero) is left alone —
 * `Math.ceil` of an exact multiple is that same multiple, so this never
 * pushes an already-clean time (e.g. 18:35:00.000) forward to 18:40. */
function roundUpToFiveMinutes(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS);
}

/**
 * "Re-anchor" (this increment's spec): once `leaveBy` has already passed,
 * compression has nothing left to offer — compressPlan's own floor check
 * above refuses outright, and rightly so, because there is no version of
 * the OLD target that's still reachable. The honest move at that point
 * isn't a smaller old plan, it's a new target: "I'm still going — new
 * target 18:30" instead of a dead-end refusal.
 *
 * This proposes that new target: `now`, plus whatever prep genuinely still
 * remains (the caller computes `remainingPlanMinutes` as unchecked steps +
 * buffer — same inputs compressPlan's `availableMinutes` is measured
 * against), plus travel. Rounded UP to the next 5-minute boundary because a
 * target of 18:32 reads like noise (why not 18:31, why not 18:33?) while
 * 18:35 reads like an actual plan someone chose on purpose.
 *
 * Pure and caller-fed, same shape as compressPlan above and projection.ts:
 * no Dexie access, no internal `Date.now()`, so "what would this suggest at
 * 18:14" is trivial to pin down in a test without mocking the clock.
 */
export function suggestNewTarget(now: Date, remainingPlanMinutes: number, travelMinutes: number): Date {
  const raw = new Date(now.getTime() + (remainingPlanMinutes + travelMinutes) * 60_000);
  return roundUpToFiveMinutes(raw);
}
