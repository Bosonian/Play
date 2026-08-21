/**
 * Pure double-tap detection for StepFocus's whole-screen check-off gate
 * (see that component's own comment on why: a pocket brush must never
 * silently check off a real step). Deliberately clock-free and
 * side-effect-free, same idiom as focusTone.ts/currentStepElapsed.ts - the
 * caller owns all state (the last-tap timestamp, resetting it after a
 * confirmed double-tap), this only ever answers "does `nowMs` complete a
 * double-tap against `lastTapAtMs`?".
 */

/** Max gap between two taps, in milliseconds, for the second to count as
 * completing a double-tap. 350ms is fast enough that two unrelated stray
 * touches (fabric catching the screen twice as a phone is pulled from a
 * pocket, say) are unlikely to land this close together, but slow enough
 * that a deliberate double-tap doesn't feel rushed. */
export const DOUBLE_TAP_WINDOW_MS = 350;

/**
 * True when `lastTapAtMs` is set AND `nowMs` falls within
 * `DOUBLE_TAP_WINDOW_MS` of it - i.e. THIS tap completes a double-tap.
 * `lastTapAtMs === null` (no prior tap recorded yet, or the caller already
 * reset it after a confirmed double-tap) always reads as a fresh first tap,
 * never a second one.
 *
 * The CALLER owns resetting `lastTapAtMs` - this function never mutates
 * anything. Two resets matter, and both fall out of how the caller is
 * expected to use this rather than needing any logic here:
 *   - after a CONFIRMED double-tap, the caller sets it back to `null` so a
 *     third stray tap doesn't chain into a second false double-tap.
 *   - after the window simply EXPIRES with no second tap, the caller
 *     overwrites it with the new tap's own timestamp (StepFocus's "first
 *     tap" branch) - there's no separate expiry timer anywhere, because a
 *     tap that arrives too late just fails this check and gets treated as
 *     a new first tap on its own. A tap 10s after the last one is
 *     therefore automatically a fresh first tap, no extra bookkeeping
 *     required.
 */
export function isSecondTap(lastTapAtMs: number | null, nowMs: number): boolean {
  if (lastTapAtMs === null) return false;
  return nowMs - lastTapAtMs <= DOUBLE_TAP_WINDOW_MS;
}
