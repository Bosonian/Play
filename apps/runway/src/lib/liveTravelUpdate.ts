/**
 * Minimum drift, in minutes, between a departure's stored `travelMinutes`
 * and a fresh live fetch before it's worth writing the new value and
 * rescheduling every staged alarm over it (useLiveTravel.ts). Below this,
 * the fetched number is indistinguishable from ordinary traffic noise —
 * cancelling and rescheduling four alarms for a 1-2 minute wobble would be
 * alarm churn that costs more than the noise it's chasing, so smaller
 * drift is shown (useLiveTravel's `liveMinutes`) but never written.
 */
const DRIFT_THRESHOLD_MINUTES = 3;

/**
 * Pure so the threshold rule is independently testable without any Dexie
 * or network involvement — useLiveTravel.ts is the only caller.
 */
export function shouldUpdateTravelMinutes(current: number, live: number): boolean {
  return Math.abs(live - current) >= DRIFT_THRESHOLD_MINUTES;
}
