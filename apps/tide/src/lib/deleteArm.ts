/**
 * Pure arm/confirm timing for the "tap Remove twice to delete a row"
 * interaction (increment 6 — History.tsx's weigh-ins, PlatesToday.tsx's
 * plates/skips). Mirrors the SHAPE of apps/runway's doubleTap.ts
 * (`isSecondTap`, StepFocus's check-off guard) per this increment's own
 * spec, which names that file as the precedent to follow rather than
 * inventing a new pattern: clock-free, side-effect-free, the caller owns
 * all state (when a row was armed, resetting it after a confirmed delete or
 * an expiry) and this only ever answers "is `armedAtMs` still within the
 * confirm window at `nowMs`?".
 *
 * Deliberately NOT the same function or the same window as `isSecondTap`,
 * despite the shared shape — two real differences, not an oversight:
 *   1. The window is two orders of magnitude longer. `isSecondTap`'s 350ms
 *      exists to CATCH an accidental double-tap (a pocket brush) as a
 *      false positive to filter out; reusing that window here would make
 *      an accidental double-tap the very thing that deletes a weigh-in,
 *      exactly backwards from what this increment's delete-confirm exists
 *      to prevent. `DELETE_CONFIRM_WINDOW_MS` is long enough to read "Tap
 *      again to remove" and decide, short enough that walking away
 *      mid-thought doesn't leave a row silently armed indefinitely.
 *   2. The UI here needs a REAL timer (`setTimeout` in the calling
 *      screen), not just a value checked on the next tap — the visible
 *      label ("Remove" vs "Tap again to remove") must revert on its own
 *      after the window even if no second tap ever comes, whereas
 *      StepFocus's hint text is a separate, independently-timed affordance
 *      layered on top of `isSecondTap`'s own tap-only check. This function
 *      stays clock-free regardless (the screen's timer is what drives the
 *      label; this predicate is the authoritative, timer-independent
 *      answer to "does THIS tap confirm?", used as a belt-and-braces check
 *      against the (unlikely, but not impossible) case where a tap lands
 *      after the window but before the timer callback has actually fired).
 */
export const DELETE_CONFIRM_WINDOW_MS = 4000;

/**
 * True when `armedAtMs` is set AND `nowMs` still falls within
 * `DELETE_CONFIRM_WINDOW_MS` of it — i.e. THIS tap on "Tap again to remove"
 * completes the confirm and should delete. `armedAtMs === null` (no row
 * armed yet, or the caller already reset it after a confirmed delete, an
 * expiry, or switching to a different row) always reads as a fresh first
 * tap, never a confirming one — same "no prior tap recorded" contract as
 * `isSecondTap(null, ...)`.
 *
 * The CALLER owns `armedAtMs` and any timer built on top of it — this
 * function never mutates anything. A tap that arrives once the window has
 * expired simply fails this check and is treated by the caller as a fresh
 * arm, not a special "expired" case needing its own branch — the same
 * "no extra bookkeeping for a late tap" property `isSecondTap` documents
 * for its own window.
 */
export function isArmStillValid(armedAtMs: number | null, nowMs: number): boolean {
  if (armedAtMs === null) return false;
  return nowMs - armedAtMs <= DELETE_CONFIRM_WINDOW_MS;
}
