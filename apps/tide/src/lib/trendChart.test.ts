import { describe, expect, it } from 'vitest';
import { buildTrendChartGeometry } from './trendChart';
import { MIN_POINTS, type WeighInPoint } from './trend';

// Fixed ISO dates throughout — never Date.now() — same discipline as
// trend.test.ts, so every test is deterministic regardless of when it runs.

const DAY_MS = 24 * 60 * 60 * 1000;
const OPTS = { width: 300, height: 100, padding: 10 };

function at(daysFromEpoch: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + daysFromEpoch * DAY_MS).toISOString();
}

describe('buildTrendChartGeometry — evidence floor', () => {
  it('returns null for no weigh-ins', () => {
    expect(buildTrendChartGeometry([], OPTS)).toBeNull();
  });

  it('returns null one short of MIN_POINTS', () => {
    const points: WeighInPoint[] = Array.from({ length: MIN_POINTS - 1 }, (_, i) => ({
      at: at(i),
      weightKg: 99 - i * 0.1,
    }));
    expect(buildTrendChartGeometry(points, OPTS)).toBeNull();
  });

  it('returns geometry at exactly MIN_POINTS', () => {
    const points: WeighInPoint[] = Array.from({ length: MIN_POINTS }, (_, i) => ({
      at: at(i),
      weightKg: 99 - i * 0.1,
    }));
    const geometry = buildTrendChartGeometry(points, OPTS);
    expect(geometry).not.toBeNull();
    expect(geometry?.isEmpty).toBe(false);
  });
});

describe('buildTrendChartGeometry — dot count', () => {
  it('produces one dot per weigh-in', () => {
    const points: WeighInPoint[] = [
      { at: at(0), weightKg: 100 },
      { at: at(1), weightKg: 99.5 },
      { at: at(3), weightKg: 99.8 },
      { at: at(8), weightKg: 98.9 },
    ];
    const geometry = buildTrendChartGeometry(points, OPTS);
    expect(geometry?.dots).toHaveLength(points.length);
  });
});

describe('buildTrendChartGeometry — x is time-proportional, not index-proportional', () => {
  it('spaces irregular gaps proportionally to elapsed time', () => {
    // Three weigh-ins: day 0, day 1 (a 1-day gap), day 5 (a 4-day gap) —
    // an index-proportional chart would space these EVENLY (1/2 and 1/2 of
    // the width); a time-proportional one must space them 1/5 and 4/5.
    const points: WeighInPoint[] = [
      { at: at(0), weightKg: 100 },
      { at: at(1), weightKg: 99.8 },
      { at: at(5), weightKg: 99 },
    ];
    const geometry = buildTrendChartGeometry(points, OPTS);
    expect(geometry).not.toBeNull();
    const [d0, d1, d2] = geometry!.dots;

    const usableWidth = OPTS.width - 2 * OPTS.padding;
    const expectedX1 = OPTS.padding + (1 / 5) * usableWidth;
    const expectedX2 = OPTS.padding + (5 / 5) * usableWidth;

    expect(d0.x).toBeCloseTo(OPTS.padding, 5);
    expect(d1.x).toBeCloseTo(expectedX1, 5);
    expect(d2.x).toBeCloseTo(expectedX2, 5);

    // The index-proportional alternative this guards against: d1 would sit
    // exactly halfway between d0 and d2. Assert it does NOT.
    const indexProportionalMidpoint = (d0.x + d2.x) / 2;
    expect(Math.abs(d1.x - indexProportionalMidpoint)).toBeGreaterThan(1);
  });

  it('returns isEmpty when every weigh-in shares the same instant (no time axis to plot)', () => {
    const sameInstant = at(3);
    const points: WeighInPoint[] = [
      { at: sameInstant, weightKg: 100 },
      { at: sameInstant, weightKg: 99 },
      { at: sameInstant, weightKg: 101 },
    ];
    const geometry = buildTrendChartGeometry(points, OPTS);
    expect(geometry).not.toBeNull();
    expect(geometry?.isEmpty).toBe(true);
    expect(geometry?.dots).toHaveLength(0);
    expect(geometry?.linePath).toBe('');
  });
});

describe('buildTrendChartGeometry — flat-domain guard', () => {
  it('centres the line instead of dividing by zero when every raw value is identical', () => {
    const points: WeighInPoint[] = [
      { at: at(0), weightKg: 99 },
      { at: at(2), weightKg: 99 },
      { at: at(4), weightKg: 99 },
    ];
    const geometry = buildTrendChartGeometry(points, OPTS);
    expect(geometry).not.toBeNull();
    expect(geometry?.isEmpty).toBe(false);

    const expectedCenterY = OPTS.padding + (OPTS.height - 2 * OPTS.padding) / 2;
    for (const dot of geometry!.dots) {
      expect(dot.y).toBeCloseTo(expectedCenterY, 5);
      expect(Number.isFinite(dot.y)).toBe(true);
    }
  });
});

describe('buildTrendChartGeometry — the line stays within the padded box', () => {
  it('never overshoots above the top padding or below the bottom padding, even with a sharp reversal', () => {
    // A deliberately jagged fixture — a sharp up-down-up reversal is
    // exactly the shape a naive Catmull-Rom spline would overshoot on.
    const points: WeighInPoint[] = [
      { at: at(0), weightKg: 100 },
      { at: at(1), weightKg: 95 },
      { at: at(2), weightKg: 100 },
      { at: at(3), weightKg: 94 },
      { at: at(4), weightKg: 101 },
      { at: at(9), weightKg: 96 },
    ];
    const geometry = buildTrendChartGeometry(points, OPTS);
    expect(geometry).not.toBeNull();

    const samples = sampleCubicPath(geometry!.linePath);
    expect(samples.length).toBeGreaterThan(0);
    for (const { y } of samples) {
      // A small epsilon for floating-point rounding in the path string
      // (values are serialised to 2 decimal places) — not a loosened bound.
      expect(y).toBeGreaterThanOrEqual(OPTS.padding - 0.05);
      expect(y).toBeLessThanOrEqual(OPTS.height - OPTS.padding + 0.05);
    }
  });
});

// --- Test-only cubic Bezier path sampler ---
// Parses the "M x,y C c1x,c1y c2x,c2y x,y C ..." path this file's own
// `monotoneCubicPath` produces and evaluates each segment at several `t`
// values — the only way to check "does the CURVE (not just its control
// points) stay in bounds", since a Bezier's control points can legally sit
// outside the range the curve itself traces.
function sampleCubicPath(d: string): { x: number; y: number }[] {
  if (d === '') return [];
  const tokens = d.match(/[MC][^MC]*/g) ?? [];
  const samples: { x: number; y: number }[] = [];
  let current: { x: number; y: number } | null = null;

  for (const token of tokens) {
    const nums = (token.slice(1).match(/-?\d+\.?\d*/g) ?? []).map(Number);
    if (token.startsWith('M')) {
      current = { x: nums[0], y: nums[1] };
      samples.push(current);
    } else if (token.startsWith('C') && current) {
      const [c1x, c1y, c2x, c2y, x, y] = nums;
      const p0 = current;
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        samples.push(cubicBezierAt(p0, { x: c1x, y: c1y }, { x: c2x, y: c2y }, { x, y }, t));
      }
      current = { x, y };
    }
  }
  return samples;
}

function cubicBezierAt(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  const x = mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x;
  const y = mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y;
  return { x, y };
}
