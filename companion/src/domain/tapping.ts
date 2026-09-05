// v3 is self-paced fixed-target alternation. v2 used a changing visual cue,
// which added reaction/choice latency to the primary motor measurement.
export const TAPPING_PROTOCOL_VERSION = 3;
export const TAPPING_FEATURE_VERSION = 2;
export const TAPPING_DURATION_MS = 10_000;
export type HandSide = 'left' | 'right';
export type TapTarget = 'a' | 'b';

export interface TapSample {
  atMs: number;
  x: number;
  y: number;
  // null on the first in-target touch in protocol v3 because either fixed
  // target is a valid self-paced starting side.
  expectedTarget: TapTarget | null;
  actualTarget: TapTarget | 'outside';
}

export interface TappingFeatures {
  side: HandSide;
  durationMs: number;
  attemptedTapCount: number;
  successfulTapCount: number;
  attemptedTapsPerSecond: number;
  successfulTapsPerSecond: number;
  medianSuccessfulIntervalMs: number | null;
  successfulIntervalCv: number | null;
  alternationErrors: number;
  outsideTargetCount: number;
  firstThirdSuccessfulRate: number;
  lastThirdSuccessfulRate: number;
  rateChangePercent: number | null;
}
export interface TappingResult {
  quality: 'valid' | 'invalid';
  qualityReasons: string[];
  features: TappingFeatures;
}
const round = (n: number) => Math.round(n * 1000) / 1000;

// Poor motor performance is an observation, not a technical exclusion.
// Reconstruct alternation from accepted touches, not UI render timing. The
// patient may start on either fixed target; outside/repeated touches do not
// advance the accepted sequence.
export function analyseTapping(side: HandSide, samples: TapSample[], durationMs: number,
  technicalReasons: string[] = []): TappingResult {
  const reasons = new Set(technicalReasons);
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (duration < TAPPING_DURATION_MS) reasons.add('test-incomplete');
  if (duration > TAPPING_DURATION_MS) reasons.add('duration-outside-protocol');
  const hasInvalidTimestamp = samples.some((s) => !Number.isFinite(s.atMs)
    || s.atMs < 0 || s.atMs >= duration);
  const hasInvalidSample = samples.some((s) => !Number.isFinite(s.x)
    || !Number.isFinite(s.y) || !['a', 'b', 'outside'].includes(s.actualTarget));
  if (hasInvalidTimestamp) reasons.add('invalid-timestamps');
  if (hasInvalidSample) reasons.add('invalid-sample');
  const usable = samples.filter((s) => Number.isFinite(s.atMs) && Number.isFinite(s.x)
    && Number.isFinite(s.y) && s.atMs >= 0 && s.atMs < duration
    && ['a', 'b', 'outside'].includes(s.actualTarget));
  if (usable.some((s, i) => i > 0 && s.atMs <= usable[i - 1].atMs)) reasons.add('invalid-timestamps');
  let expected: TapTarget | null = null;
  let outsideTargetCount = 0;
  let alternationErrors = 0;
  const accepted: TapSample[] = [];
  for (const sample of usable) {
    if (sample.actualTarget === 'outside') outsideTargetCount++;
    else if (expected !== null && sample.actualTarget !== expected) alternationErrors++;
    else {
      accepted.push(sample);
      expected = sample.actualTarget === 'a' ? 'b' : 'a';
    }
  }
  const intervals = accepted.slice(1).map((s, i) => s.atMs - accepted[i].atMs).filter((n) => n > 0);
  const sorted = [...intervals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null;
  const mean = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
  const cv = intervals.length >= 2 && mean > 0
    ? Math.sqrt(intervals.reduce((sum, n) => sum + (n - mean) ** 2, 0) / intervals.length) / mean : null;
  const third = duration / 3;
  const rate = (n: number, ms = duration) => ms > 0 ? round(n * 1000 / ms) : 0;
  const first = rate(accepted.filter((s) => s.atMs < third).length, third);
  const last = rate(accepted.filter((s) => s.atMs >= 2 * third).length, third);
  return {
    quality: reasons.size ? 'invalid' : 'valid', qualityReasons: [...reasons],
    features: {
      side, durationMs: duration, attemptedTapCount: usable.length,
      successfulTapCount: accepted.length, attemptedTapsPerSecond: rate(usable.length),
      successfulTapsPerSecond: rate(accepted.length),
      medianSuccessfulIntervalMs: median === null ? null : round(median),
      successfulIntervalCv: cv === null ? null : round(cv), alternationErrors, outsideTargetCount,
      firstThirdSuccessfulRate: first, lastThirdSuccessfulRate: last,
      // Temporal rate change only; this is not movement-amplitude decrement.
      rateChangePercent: first > 0 ? round((last - first) / first * 100) : null,
    },
  };
}
