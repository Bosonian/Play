export interface FocusTone {
  phase: 'calm' | 'closing' | 'critical' | 'overrun';
  /** 0 in every pre-overrun phase; grows from 0 to 1 as the overrun on the
   * current step deepens, for the focus screen's rising red fill layer. */
  fillFraction: number;
}

// Thresholds are fractions of the planned box REMAINING, not elapsed - "25%
// left" reads the same whether the step is 4 minutes or 40. Named constants
// rather than inline 0.25/0.1 so the boundary tests below read as "at the
// named threshold" instead of two unexplained magic numbers.
const CLOSING_AT_FRACTION_REMAINING = 0.25;
const CRITICAL_AT_FRACTION_REMAINING = 0.1;

/**
 * Which visual phase the step-focus countdown is in, and (for the overrun
 * phase only) how far the rising fill layer should have climbed. Pure and
 * clock-free like projection.ts/currentStepElapsed.ts — the caller passes
 * in `remainingSeconds` (planned minus elapsed) already computed, so this
 * has no notion of "now" of its own and is trivially testable at exact
 * second boundaries.
 *
 * `plannedSeconds` of 0 is a real (if unusual) case — a step someone set to
 * 0 planned minutes — and is guarded against dividing by zero: any positive
 * elapsed time on a 0-planned step makes `remainingSeconds` negative, which
 * already routes to the overrun branch below, and the overrun fill fraction
 * is defined as a flat 1 (fully filled) rather than a NaN from 1/0.
 */
export function focusTone(remainingSeconds: number, plannedSeconds: number): FocusTone {
  if (remainingSeconds < 0) {
    const fillFraction = plannedSeconds > 0 ? Math.min(1, Math.abs(remainingSeconds) / plannedSeconds) : 1;
    return { phase: 'overrun', fillFraction };
  }

  // Not overrun. `plannedSeconds <= 0` here only happens at the exact
  // instant a 0-planned step starts (elapsed 0, remaining 0 too) - treated
  // as the most urgent non-overrun phase (critical) rather than dividing
  // 0/0, since a step with no planned time left to give is never "calm".
  const remainingFraction = plannedSeconds > 0 ? remainingSeconds / plannedSeconds : 0;
  const phase: FocusTone['phase'] =
    remainingFraction <= CRITICAL_AT_FRACTION_REMAINING
      ? 'critical'
      : remainingFraction <= CLOSING_AT_FRACTION_REMAINING
        ? 'closing'
        : 'calm';

  return { phase, fillFraction: 0 };
}
