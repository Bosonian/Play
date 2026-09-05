import { describe, expect, it } from 'vitest';
import { analyseTapping, type TapSample } from './tapping';

function tap(atMs: number, actualTarget: TapSample['actualTarget']): TapSample {
  return {
    atMs,
    x: actualTarget === 'b' ? 80 : 20,
    y: 50,
    // Analysis reconstructs the sequence from accepted touches instead of
    // trusting UI render state captured with the event.
    expectedTarget: 'a',
    actualTarget,
  };
}

describe('analyseTapping', () => {
  it('derives v2 attempt, success, timing and temporal-rate features', () => {
    const samples = [
      tap(100, 'a'),
      tap(500, 'outside'),
      tap(900, 'a'),
      tap(1_100, 'b'),
      tap(2_100, 'a'),
      tap(7_100, 'b'),
      tap(7_500, 'b'),
      tap(8_000, 'outside'),
      tap(9_000, 'a'),
    ];

    const result = analyseTapping('right', samples, 10_000);

    expect(result.quality).toBe('valid');
    expect(result.qualityReasons).toEqual([]);
    expect(result.features).toEqual({
      side: 'right',
      durationMs: 10_000,
      attemptedTapCount: 9,
      successfulTapCount: 5,
      attemptedTapsPerSecond: 0.9,
      successfulTapsPerSecond: 0.5,
      medianSuccessfulIntervalMs: 1_450,
      successfulIntervalCv: 0.739,
      alternationErrors: 2,
      outsideTargetCount: 2,
      firstThirdSuccessfulRate: 0.9,
      lastThirdSuccessfulRate: 0.6,
      rateChangePercent: -33.333,
    });
  });

  it('does not advance the accepted target after outside or repeated touches', () => {
    const result = analyseTapping('left', [
      tap(100, 'outside'),
      tap(200, 'b'),
      tap(300, 'a'),
      tap(400, 'a'),
      tap(500, 'b'),
    ], 10_000);

    expect(result.features.attemptedTapCount).toBe(5);
    expect(result.features.successfulTapCount).toBe(2);
    expect(result.features.alternationErrors).toBe(2);
    expect(result.features.outsideTargetCount).toBe(1);
    expect(result.features.medianSuccessfulIntervalMs).toBe(200);
  });

  it('requires an exact ten-second acquisition', () => {
    expect(analyseTapping('left', [], 10_000).quality).toBe('valid');
    expect(analyseTapping('left', [], 9_999).qualityReasons).toEqual(['test-incomplete']);
    expect(analyseTapping('left', [], 10_001).qualityReasons).toEqual(['duration-outside-protocol']);
  });

  it('keeps poor motor performance technically valid with null derived statistics', () => {
    const result = analyseTapping('left', [
      tap(100, 'b'),
      tap(200, 'b'),
      tap(300, 'outside'),
    ], 10_000);

    expect(result.quality).toBe('valid');
    expect(result.features.attemptedTapCount).toBe(3);
    expect(result.features.successfulTapCount).toBe(0);
    expect(result.features.attemptedTapsPerSecond).toBe(0.3);
    expect(result.features.successfulTapsPerSecond).toBe(0);
    expect(result.features.alternationErrors).toBe(2);
    expect(result.features.outsideTargetCount).toBe(1);
    expect(result.features.firstThirdSuccessfulRate).toBe(0);
    expect(result.features.lastThirdSuccessfulRate).toBe(0);
    expect(result.features.medianSuccessfulIntervalMs).toBeNull();
    expect(result.features.successfulIntervalCv).toBeNull();
    expect(result.features.rateChangePercent).toBeNull();
  });

  it('reports a median but no variability from a single successful interval', () => {
    const result = analyseTapping('right', [tap(100, 'a'), tap(500, 'b')], 10_000);

    expect(result.features.medianSuccessfulIntervalMs).toBe(400);
    expect(result.features.successfulIntervalCv).toBeNull();
  });

  it('invalidates malformed, out-of-window and non-monotonic timestamps', () => {
    const result = analyseTapping('right', [
      tap(100, 'a'),
      tap(90, 'b'),
      tap(Number.NaN, 'a'),
      tap(10_000, 'outside'),
    ], 10_000);

    expect(result.quality).toBe('invalid');
    expect(result.qualityReasons).toEqual(['invalid-timestamps']);
  });
});
