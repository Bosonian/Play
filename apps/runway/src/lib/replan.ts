import type { DepartureStep } from '../db/types';

/**
 * "Recover instead of forfeit" (this increment's spec): squeezes the
 * remaining, UNCHECKED portion of a departure's plan down to fit whatever
 * time is actually left before leaveBy. Checked steps are history — they
 * already happened at whatever pace they happened, so this never touches
 * them; only `plannedMinutes` on unchecked steps and `bufferMinutes` are
 * candidates for compression.
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
 */
export function compressPlan(args: {
  availableMinutes: number;
  steps: DepartureStep[];
  bufferMinutes: number;
}): CompressResult {
  const { availableMinutes, steps, bufferMinutes } = args;

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

  // A zero buffer stays zero - it was a deliberate "no padding" choice at
  // setup time, and compression inventing one back would misrepresent that
  // choice, not help keep it.
  const bufferFloor = bufferMinutes === 0 ? 0 : MIN_BUFFER_MINUTES;
  const floorSum = uncheckedSteps.length * MIN_STEP_MINUTES + bufferFloor;

  if (availableMinutes < floorSum) {
    return { fits: false, minimumMinutes: floorSum };
  }

  const factor = availableMinutes / originalTotal;

  // Compressed step values, in the same order as `uncheckedSteps` - order
  // matters below for tie-breaking during overshoot correction (a stable,
  // documented rule beats an arbitrary one for something a test needs to
  // pin down).
  const compressedStepMinutes = uncheckedSteps.map((step) =>
    Math.max(MIN_STEP_MINUTES, Math.floor(step.plannedMinutes * factor)),
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
      if (compressedStepMinutes[i] > MIN_STEP_MINUTES && compressedStepMinutes[i] > largestValue) {
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
