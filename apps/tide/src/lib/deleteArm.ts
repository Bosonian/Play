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
 *   1. The confirm window is BOUNDED AT BOTH ENDS, and the upper bound is
 *      two orders of magnitude longer than `isSecondTap`'s 350ms. The upper
 *      bound is long enough to read "Tap again to remove" and decide, short
 *      enough that walking away mid-thought doesn't leave a row silently
 *      armed indefinitely. The LOWER bound (review fix, 0.7.1) is what
 *      actually stops an accidental double-tap — a pocket brush, a stutter
 *      tap, a bouncy touchscreen — from being the very thing that deletes a
 *      weigh-in. An earlier version of this comment claimed the long window
 *      prevented that; it did not, because 0–4000ms trivially contains
 *      0–350ms. Only a minimum delay does, so there is now one: a confirm
 *      tap that lands sooner than `DELETE_CONFIRM_MIN_MS` after arming is
 *      ignored, not treated as confirmation. A DELIBERATE confirm is never
 *      caught by this — reading the label and deciding takes far longer
 *      than 350ms.
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

/** The lower bound described above — a confirm tap landing within this many
 * ms of arming is ignored as an accidental double-tap rather than honoured
 * as confirmation. 350ms deliberately matches Runway's own `isSecondTap`
 * threshold, which is the value that project settled on for "these two taps
 * were one physical event, not two decisions". */
export const DELETE_CONFIRM_MIN_MS = 350;

/**
 * True when `armedAtMs` is set AND `nowMs` falls inside the confirm window —
 * at least `DELETE_CONFIRM_MIN_MS` after arming (so an accidental
 * double-tap cannot confirm) and no more than `DELETE_CONFIRM_WINDOW_MS`
 * after it. Only then does THIS tap on "Tap again to remove" complete the
 * confirm and delete. `armedAtMs === null` (no row armed yet, or the caller
 * already reset it after a confirmed delete, an expiry, or switching to a
 * different row) always reads as a fresh first tap, never a confirming one
 * — same "no prior tap recorded" contract as `isSecondTap(null, ...)`.
 *
 * A too-SOON tap returns false and, like a too-late one, is simply not a
 * confirmation. The caller must NOT re-arm on it (that would reset the
 * clock and make a stutter-tap delay the delete rather than be ignored) —
 * see the call sites' own handling.
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
  const elapsed = nowMs - armedAtMs;
  return elapsed >= DELETE_CONFIRM_MIN_MS && elapsed <= DELETE_CONFIRM_WINDOW_MS;
}

/** True when a tap arrived so soon after arming that it reads as half of one
 * accidental double-tap. Exposed separately so a call site can tell "ignore
 * this tap, stay armed" apart from "the window expired, treat it as a fresh
 * first tap" — two outcomes that both make `isArmStillValid` false but must
 * NOT be handled the same way. */
export function isConfirmTooSoon(armedAtMs: number | null, nowMs: number): boolean {
  if (armedAtMs === null) return false;
  return nowMs - armedAtMs < DELETE_CONFIRM_MIN_MS;
}
