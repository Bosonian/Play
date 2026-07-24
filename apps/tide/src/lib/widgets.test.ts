import { describe, expect, it } from 'vitest';
import { buildTideWidgetSnapshot } from './widgets';
import { currentTrend, formatTrendLine, MIN_POINTS, type WeighInPoint } from './trend';
import type { DailyShapeTarget } from './dailyShape';

// Only buildTideWidgetSnapshot (the pure snapshot builder) is tested here —
// refreshWidgets is the Dexie-touching orchestrator around it, untested per
// this increment's own instruction (matches healthSync.ts's own
// syncHealthData/syncWeighIns precedent: pure functions get fixtures, the
// orchestrator doesn't). Fixed ISO dates throughout, never Date.now(), so
// every test is deterministic regardless of when it runs.

const NOW = new Date('2026-07-24T12:00:00.000Z');

/** Builds `count` weigh-ins spaced exactly `stepDays` apart, ending at `now`
 * — same idea as trend.test.ts's own `linearFixture`, but anchored to end AT
 * `now` (rather than starting from an arbitrary date) since this file's own
 * fixtures care about "as of today", matching what `buildTideWidgetSnapshot`
 * is actually called with in `refreshWidgets`. */
function weighInsEndingNow(count: number, stepDays: number, startKg: number, perStep: number): WeighInPoint[] {
  const points: WeighInPoint[] = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(NOW.getTime() - (count - 1 - i) * stepDays * 24 * 60 * 60 * 1000);
    points.push({ at: at.toISOString(), weightKg: startKg + perStep * i });
  }
  return points;
}

describe('buildTideWidgetSnapshot — trend fields', () => {
  it('empty state: no weigh-ins at all', () => {
    const snapshot = buildTideWidgetSnapshot(NOW, [], null, { checkIns: 0, steps: null });
    expect(snapshot.trendValue).toBe('');
    expect(snapshot.trendLine).toBe('Add your first weigh-in to start the trend.');
  });

  it('evidence-floor state: below MIN_POINTS but not empty', () => {
    const weighIns = weighInsEndingNow(MIN_POINTS - 1, 3, 100, -0.3);
    const snapshot = buildTideWidgetSnapshot(NOW, weighIns, null, { checkIns: 0, steps: null });
    expect(snapshot.trendValue).toBe('');
    // MIN_POINTS - (MIN_POINTS - 1) = 1 remaining weigh-in — singular wording.
    expect(snapshot.trendLine).toBe('1 more weigh-in to a trend.');
  });

  it('evidence-floor state pluralises correctly with more than one remaining', () => {
    // A single weigh-in is MIN_POINTS - 1 short whenever MIN_POINTS > 2 —
    // true for the current MIN_POINTS=3, asserted here rather than assumed,
    // so this test fails loudly (not silently) if MIN_POINTS is ever
    // lowered to 2 or below.
    expect(MIN_POINTS).toBeGreaterThan(2);
    const weighIns = weighInsEndingNow(1, 3, 100, 0);
    const snapshot = buildTideWidgetSnapshot(NOW, weighIns, null, { checkIns: 0, steps: null });
    expect(snapshot.trendLine).toBe(`${MIN_POINTS - 1} more weigh-ins to a trend.`);
  });

  it('trend state: at/above the evidence floor, mirrors currentTrend/formatTrendLine exactly', () => {
    const weighIns = weighInsEndingNow(MIN_POINTS, 3, 100, -0.3);
    const snapshot = buildTideWidgetSnapshot(NOW, weighIns, null, { checkIns: 0, steps: null });

    const trend = currentTrend(weighIns);
    expect(trend).not.toBeNull();
    // Reuses the SAME functions Home.tsx calls — the widget must say
    // exactly what Home says, so the expected value here is computed via
    // those functions too, not a hand-typed literal that could quietly
    // drift from what Home actually renders.
    expect(snapshot.trendValue).toBe(`${trend!.smoothedKg.toFixed(1)} kg`);
    expect(snapshot.trendLine).toBe(formatTrendLine(trend!));
  });
});

describe('buildTideWidgetSnapshot — daily-shape fields', () => {
  const someWeighIns = weighInsEndingNow(MIN_POINTS, 3, 100, -0.3);

  it('no target set: both shape lines empty, shapeMet false', () => {
    const snapshot = buildTideWidgetSnapshot(NOW, someWeighIns, null, { checkIns: 2, steps: 5000 });
    expect(snapshot.shapeLine1).toBe('');
    expect(snapshot.shapeLine2).toBe('');
    expect(snapshot.shapeMet).toBe('false');
  });

  it('target set, unmet: both lines populated, shapeMet false, no fabricated claim of success', () => {
    const target: DailyShapeTarget = { checkIns: 3, steps: 6000 };
    const snapshot = buildTideWidgetSnapshot(NOW, someWeighIns, target, { checkIns: 1, steps: 2000 });
    expect(snapshot.shapeLine1).toBe('1 of 3 check-ins.');
    expect(snapshot.shapeLine2).toBe('2,000 of 6,000 steps.');
    expect(snapshot.shapeMet).toBe('false');
  });

  it('target set, both components met: shapeMet true', () => {
    const target: DailyShapeTarget = { checkIns: 3, steps: 6000 };
    const snapshot = buildTideWidgetSnapshot(NOW, someWeighIns, target, { checkIns: 3, steps: 6500 });
    expect(snapshot.shapeLine1).toBe('3 of 3 check-ins.');
    expect(snapshot.shapeLine2).toBe('6,500 of 6,000 steps.');
    expect(snapshot.shapeMet).toBe('true');
  });

  it('a component opted out at 0 renders no line for that component, not "0 of 0"', () => {
    // Steps opted out (target.steps === 0) — dailyShape.ts's own
    // formatStepsLine returns null for this, which this function collapses
    // to "" (never a fabricated "0 of 0 steps." sentence).
    const target: DailyShapeTarget = { checkIns: 3, steps: 0 };
    const snapshot = buildTideWidgetSnapshot(NOW, someWeighIns, target, { checkIns: 3, steps: null });
    expect(snapshot.shapeLine1).toBe('3 of 3 check-ins.');
    expect(snapshot.shapeLine2).toBe('');
    // Steps is opted out (met: true, nothing to fall short of) and checkIns
    // is met too, so the WHOLE shape reads met even with steps rendering no
    // line at all — matches dailyShapeProgress's own "opted-out component
    // can't fail" contract.
    expect(snapshot.shapeMet).toBe('true');
  });

  it('a null steps reading (not yet synced) never reads as met, unlike a real zero', () => {
    const target: DailyShapeTarget = { checkIns: 0, steps: 6000 };
    const snapshot = buildTideWidgetSnapshot(NOW, someWeighIns, target, { checkIns: 0, steps: null });
    expect(snapshot.shapeLine1).toBe(''); // checkIns opted out
    expect(snapshot.shapeLine2).toBe('No steps reading yet — target 6,000.');
    expect(snapshot.shapeMet).toBe('false');
  });
});

describe('buildTideWidgetSnapshot — updatedAt', () => {
  it('carries the `now` argument as ISO, for on-device debugging only', () => {
    const snapshot = buildTideWidgetSnapshot(NOW, [], null, { checkIns: 0, steps: null });
    expect(snapshot.updatedAt).toBe(NOW.toISOString());
  });
});
