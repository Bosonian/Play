import { describe, expect, it } from 'vitest';
import {
  bodyFatTrend,
  type BodyFatPoint,
  currentTrend,
  formatBodyFatTrendLine,
  formatTrendLine,
  MIN_POINTS,
  trendSeries,
  type WeighInPoint,
} from './trend';

// Fixed ISO dates throughout — never Date.now() — so every test is
// deterministic regardless of when it runs (same discipline as Runway's
// fixture-based tests).

/** Builds `count` weigh-ins spaced exactly `stepDays` apart, starting at
 * `startAt`, changing by `perStep` kg each reading. Used for the
 * monotonic/direction tests below, where only the SIGN of the resulting
 * slope matters, not its exact magnitude — see the "known kg/week" test
 * further down for a fixture whose magnitude is hand-verified instead. */
function linearFixture(
  startAt: string,
  count: number,
  stepDays: number,
  startKg: number,
  perStep: number,
): WeighInPoint[] {
  const start = new Date(startAt).getTime();
  const points: WeighInPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      at: new Date(start + i * stepDays * 24 * 60 * 60 * 1000).toISOString(),
      weightKg: startKg + perStep * i,
    });
  }
  return points;
}

describe('currentTrend — evidence floor', () => {
  it('returns null for no weigh-ins', () => {
    expect(currentTrend([])).toBeNull();
  });

  it('returns null for a single weigh-in', () => {
    expect(currentTrend([{ at: '2026-01-01T00:00:00.000Z', weightKg: 99 }])).toBeNull();
  });

  it('returns null below MIN_POINTS (one short of the floor)', () => {
    const points = linearFixture('2026-01-01T00:00:00.000Z', MIN_POINTS - 1, 7, 100, -0.5);
    expect(currentTrend(points)).toBeNull();
  });

  it('returns a trend at exactly MIN_POINTS', () => {
    const points = linearFixture('2026-01-01T00:00:00.000Z', MIN_POINTS, 7, 100, -0.5);
    const trend = currentTrend(points);
    expect(trend).not.toBeNull();
    expect(trend?.points).toBe(MIN_POINTS);
  });
});

describe('currentTrend — direction', () => {
  it('reports a negative slope for a monotonically decreasing series', () => {
    const points = linearFixture('2026-01-01T00:00:00.000Z', 10, 7, 100, -0.4);
    const trend = currentTrend(points);
    expect(trend?.slopeKgPerWeek).toBeLessThan(0);
  });

  it('reports a positive slope for a monotonically increasing series', () => {
    const points = linearFixture('2026-01-01T00:00:00.000Z', 10, 7, 90, 0.4);
    const trend = currentTrend(points);
    expect(trend?.slopeKgPerWeek).toBeGreaterThan(0);
  });
});

describe('trendSeries — smoothing behaviour', () => {
  it('seeds the first point at its own raw value (nothing to smooth against yet)', () => {
    const series = trendSeries([{ at: '2026-01-01T00:00:00.000Z', weightKg: 101.3 }]);
    expect(series[0].smoothed).toBe(101.3);
  });

  it('reduces variance for a noisy-but-flat series (EMA denoises around a constant)', () => {
    // A fixed pseudo-random noise pattern (not Math.random — determinism),
    // oscillating +/-1.5 kg around a flat 100 kg baseline with no real
    // trend. If the smoothing is doing its job, the smoothed series should
    // vary far less than the raw one even though neither has any real
    // change to track.
    const noise = [0.8, -1.2, 1.4, -0.6, 0.3, -1.5, 1.1, -0.2, 0.9, -1.0, 0.5, -0.4, 1.3, -0.8, 0.2];
    const points: WeighInPoint[] = noise.map((n, i) => ({
      at: new Date(Date.UTC(2026, 0, 1) + i * 24 * 60 * 60 * 1000).toISOString(),
      weightKg: 100 + n,
    }));
    const series = trendSeries(points);

    const variance = (values: number[]) => {
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    };
    const rawVariance = variance(points.map((p) => p.weightKg));
    const smoothedVariance = variance(series.map((p) => p.smoothed));

    expect(smoothedVariance).toBeLessThan(rawVariance / 2);
  });

  it("doesn't let a single spike dominate the smoothed tail", () => {
    // 20 daily readings, flat at 100 kg, except one +5 kg outlier at index
    // 10 (a scale misread, standing on it with shoes on, whatever the real
    // cause). EMA_ALPHA=0.1 means the spike can move the smoothed value by
    // at most 10% of its own size the instant it lands (100 -> 100.5, not
    // 105) and the series relaxes back toward the true 100 kg baseline
    // from there — the spike should be a small, decaying blip, never a
    // lasting distortion of "where the trend actually is."
    const points: WeighInPoint[] = Array.from({ length: 20 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 0, 1) + i * 24 * 60 * 60 * 1000).toISOString(),
      weightKg: i === 10 ? 105 : 100,
    }));
    const series = trendSeries(points);

    // The instant the spike lands, the smoothed value moves by at most
    // EMA_ALPHA * (spike size) = 0.1 * 5 = 0.5 kg — not the full 5 kg.
    expect(series[10].smoothed).toBeCloseTo(100.5, 6);
    // By the last reading (9 steps after the spike), the series has
    // relaxed back to within 0.2 kg of the true 100 kg baseline.
    expect(Math.abs(series[series.length - 1].smoothed - 100)).toBeLessThan(0.2);
  });

  it('sorts unsorted input before smoothing, producing the same series as pre-sorted input', () => {
    const sortedInput: WeighInPoint[] = [
      { at: '2026-01-01T00:00:00.000Z', weightKg: 100 },
      { at: '2026-01-08T00:00:00.000Z', weightKg: 99.5 },
      { at: '2026-01-15T00:00:00.000Z', weightKg: 99 },
    ];
    const shuffledInput: WeighInPoint[] = [sortedInput[2], sortedInput[0], sortedInput[1]];

    const fromSorted = trendSeries(sortedInput);
    const fromShuffled = trendSeries(shuffledInput);

    expect(fromShuffled).toEqual(fromSorted);
    // Belt and braces: the output itself is in ascending `at` order.
    expect(fromShuffled.map((p) => p.at)).toEqual([sortedInput[0].at, sortedInput[1].at, sortedInput[2].at]);
  });
});

describe('currentTrend — date-span slope math', () => {
  it('computes the expected kg/week for a known, hand-verified fixture', () => {
    // Four weekly readings, exactly 7 days apart, losing 1 kg/week raw:
    // 100, 99, 98, 97 kg. Hand-worked EMA (alpha=0.1), seeded at the first
    // raw value:
    //   s0 = 100
    //   s1 = 0.1*99 + 0.9*100    = 99.9
    //   s2 = 0.1*98 + 0.9*99.9   = 99.71
    //   s3 = 0.1*97 + 0.9*99.71  = 99.439
    // OLS slope of (day, smoothed) over days=[0,7,14,21] (mean day 10.5,
    // mean weight 99.7622...5):
    //   slope/day = sum((day-meanDay)*(w-meanW)) / sum((day-meanDay)^2)
    //             = -6.5555 / 245 = -0.0267551...
    //   slope/week = slope/day * 7 = -0.187286 (see this file's own
    //   calibration derivation; verified independently in a scratch node
    //   script alongside this increment's implementation).
    const points: WeighInPoint[] = [
      { at: '2026-01-01T00:00:00.000Z', weightKg: 100 },
      { at: '2026-01-08T00:00:00.000Z', weightKg: 99 },
      { at: '2026-01-15T00:00:00.000Z', weightKg: 98 },
      { at: '2026-01-22T00:00:00.000Z', weightKg: 97 },
    ];
    const trend = currentTrend(points);
    expect(trend).not.toBeNull();
    expect(trend?.smoothedKg).toBeCloseTo(99.439, 6);
    expect(trend?.slopeKgPerWeek).toBeCloseTo(-0.1873, 3);
    expect(trend?.points).toBe(4);
  });

  // An earlier version of this file fit the slope across the ENTIRE
  // smoothed history, which meant a genuine, steady trend was understated
  // for a surprisingly long time (an 8-week-old -0.4 kg/week trend
  // measured as only -0.13 kg/week) — every early, still-EMA-lagging
  // reading stayed in the regression forever and permanently dragged it
  // toward zero. `TREND_WINDOW_DAYS` (trend.ts) fixed that by fitting only
  // the most recent ~3 weeks: once the trend has been running long enough
  // for the window to sit entirely past the initial EMA transient, the
  // fitted slope should closely recover the true underlying rate, not
  // just the right sign. This is the "bias is gone" replacement for that
  // earlier "bias is documented" test.
  it('recovers close to the true rate once a trend has been running long enough (windowed fit)', () => {
    const rawRatePerWeek = -0.4;
    const points = linearFixture('2026-01-01T00:00:00.000Z', 90, 1, 100, rawRatePerWeek / 7);
    const trend = currentTrend(points);
    expect(trend).not.toBeNull();
    expect(trend!.slopeKgPerWeek).toBeCloseTo(rawRatePerWeek, 1); // within 0.05 kg/week
    expect(Math.abs(trend!.slopeKgPerWeek - rawRatePerWeek)).toBeLessThan(0.08);
  });

  // Deepak won't weigh in daily — TREND_WINDOW_DAYS (21) can easily
  // contain fewer than MIN_POINTS readings for someone checking in every
  // couple of weeks. `selectSlopeWindow`'s fallback widens to the most
  // recent MIN_POINTS points regardless of age rather than fitting a
  // near-meaningless one- or two-point line. Three weigh-ins, ~20 days
  // apart (40 days total span) — only the last one is inside the 21-day
  // window on its own, so this exercises the fallback path directly.
  it('still yields a sensible, correctly-signed slope for sparse weigh-ins via the widen-to-MIN_POINTS fallback', () => {
    const points: WeighInPoint[] = [
      { at: '2026-01-01T00:00:00.000Z', weightKg: 100 },
      { at: '2026-01-21T00:00:00.000Z', weightKg: 98.57 },
      { at: '2026-02-10T00:00:00.000Z', weightKg: 97.14 }, // ~40 days after the first
    ];
    const trend = currentTrend(points);
    expect(trend).not.toBeNull();
    expect(trend!.points).toBe(3);
    // Correct direction (losing weight) and within a sane order of
    // magnitude — NOT a tight tolerance: with only 3 widely-spaced points,
    // EMA's own lag still dominates the exact number (see EMA_ALPHA's own
    // doc comment on that tradeoff). Sign and sanity are what the fallback
    // exists to guarantee, not precision an evidence-floor case like this
    // one can't actually support.
    expect(trend!.slopeKgPerWeek).toBeLessThan(0);
    expect(trend!.slopeKgPerWeek).toBeGreaterThan(-1);
  });

  // The whole point of windowing: a trend that reversed direction should
  // read as its CURRENT direction, not a net average across a phase that's
  // over. 60 days losing weight at -0.4 kg/week, then 30 days GAINING at
  // +0.6 kg/week (daily readings, so the window has plenty of in-window
  // points to work with once the reversal is more than ~3 weeks old).
  // Net across the whole 90 days is still clearly downward — a full-span
  // fit (this file's earlier, since-replaced behaviour) measured this
  // exact fixture at -0.22 kg/week, the wrong sign entirely for "what's
  // happening now." The windowed fit measures +0.46 kg/week: right sign,
  // reasonably close to the true +0.6 kg/week current rate, and
  // unambiguously NOT the net.
  it('tracks the current rate after a reversal, not the net across the whole history', () => {
    const down = linearFixture('2026-01-01T00:00:00.000Z', 60, 1, 100, -0.4 / 7);
    const lastDown = down[down.length - 1];
    const up = linearFixture(
      new Date(new Date(lastDown.at).getTime() + 24 * 60 * 60 * 1000).toISOString(),
      30,
      1,
      lastDown.weightKg + 0.6 / 7,
      0.6 / 7,
    );
    const trend = currentTrend([...down, ...up]);
    expect(trend).not.toBeNull();
    expect(trend!.points).toBe(90);
    // Unambiguously positive (gaining), not merely "less negative" — this
    // is the sign flip that proves the window, not the net, drives the
    // number.
    expect(trend!.slopeKgPerWeek).toBeGreaterThan(0.2);
  });
});

describe('formatTrendLine', () => {
  it('formats a downward trend with a unicode minus sign', () => {
    expect(formatTrendLine({ slopeKgPerWeek: -0.4, points: 12 })).toBe('Trend: −0.4 kg/week over 12 weigh-ins.');
  });

  it('formats an upward trend with a leading plus sign', () => {
    expect(formatTrendLine({ slopeKgPerWeek: 0.3, points: 5 })).toBe('Trend: +0.3 kg/week over 5 weigh-ins.');
  });

  it('reads a slope that rounds to 0.0 as "holding steady", not a signed zero', () => {
    expect(formatTrendLine({ slopeKgPerWeek: 0.02, points: 8 })).toBe('Trend: holding steady over 8 weigh-ins.');
    expect(formatTrendLine({ slopeKgPerWeek: -0.03, points: 8 })).toBe('Trend: holding steady over 8 weigh-ins.');
  });

  it('uses singular "weigh-in" for exactly one point', () => {
    // Not reachable through currentTrend today (MIN_POINTS is 3), but
    // formatTrendLine is a separate, independently-testable pure function
    // per TIDE_PLAN.md's brief — it should still read correctly if ever
    // called with a single-point trend.
    expect(formatTrendLine({ slopeKgPerWeek: 0, points: 1 })).toBe('Trend: holding steady over 1 weigh-in.');
  });
});

// Health Connect increment (0.3.0): bodyFatTrend reuses trendSeries'
// underlying EMA/regression machinery (see trend.ts's own header comment on
// that section) — these tests exercise the parts that are genuinely NEW
// (the null-filtering, the separate evidence floor, the distinct copy),
// not the smoothing/regression math itself, which the weight-trend suite
// above already covers exhaustively against the exact same code path.
describe('bodyFatTrend — filters and evidence floor', () => {
  it('returns null when no row carries a body-fat reading', () => {
    const rows: BodyFatPoint[] = [
      { at: '2026-01-01T00:00:00.000Z', bodyFatPct: null },
      { at: '2026-01-08T00:00:00.000Z', bodyFatPct: null },
      { at: '2026-01-15T00:00:00.000Z', bodyFatPct: null },
    ];
    expect(bodyFatTrend(rows)).toBeNull();
  });

  it('counts only rows with an actual reading toward the evidence floor, not every weigh-in', () => {
    // 5 weigh-ins, only 2 carry a body-fat reading — below MIN_POINTS (3)
    // once the nulls are filtered out, even though the raw row count isn't.
    const rows: BodyFatPoint[] = [
      { at: '2026-01-01T00:00:00.000Z', bodyFatPct: 28 },
      { at: '2026-01-08T00:00:00.000Z', bodyFatPct: null },
      { at: '2026-01-15T00:00:00.000Z', bodyFatPct: null },
      { at: '2026-01-22T00:00:00.000Z', bodyFatPct: 27.5 },
      { at: '2026-01-29T00:00:00.000Z', bodyFatPct: null },
    ];
    expect(bodyFatTrend(rows)).toBeNull();
  });

  it('returns a trend once at least MIN_POINTS rows carry a reading', () => {
    const rows: BodyFatPoint[] = [
      { at: '2026-01-01T00:00:00.000Z', bodyFatPct: 28 },
      { at: '2026-01-08T00:00:00.000Z', bodyFatPct: null }, // weight-only row, ignored here
      { at: '2026-01-15T00:00:00.000Z', bodyFatPct: 27.6 },
      { at: '2026-01-22T00:00:00.000Z', bodyFatPct: 27.2 },
    ];
    const trend = bodyFatTrend(rows);
    expect(trend).not.toBeNull();
    expect(trend?.points).toBe(3); // the null row doesn't count
    expect(trend?.slopePctPerWeek).toBeLessThan(0); // falling body fat
  });
});

describe('formatBodyFatTrendLine', () => {
  it('formats a downward trend with a unicode minus sign and "pts/week"', () => {
    expect(formatBodyFatTrendLine({ slopePctPerWeek: -0.3, points: 6 })).toBe(
      'Body fat: −0.3 pts/week over 6 readings.',
    );
  });

  it('formats an upward trend with a leading plus sign', () => {
    expect(formatBodyFatTrendLine({ slopePctPerWeek: 0.2, points: 4 })).toBe('Body fat: +0.2 pts/week over 4 readings.');
  });

  it('reads a slope that rounds to 0.0 as "holding steady"', () => {
    expect(formatBodyFatTrendLine({ slopePctPerWeek: 0.02, points: 5 })).toBe('Body fat: holding steady over 5 readings.');
  });

  it('uses singular "reading" for exactly one point', () => {
    expect(formatBodyFatTrendLine({ slopePctPerWeek: 0, points: 1 })).toBe('Body fat: holding steady over 1 reading.');
  });
});
