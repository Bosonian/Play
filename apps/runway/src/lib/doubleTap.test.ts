import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_WINDOW_MS, isSecondTap } from './doubleTap';

describe('isSecondTap', () => {
  it('is false when there is no prior tap (null)', () => {
    expect(isSecondTap(null, 1000)).toBe(false);
  });

  it('is true for a second tap well within the window', () => {
    expect(isSecondTap(1000, 1100)).toBe(true);
  });

  it('is true exactly at the window boundary (inclusive)', () => {
    expect(isSecondTap(1000, 1000 + DOUBLE_TAP_WINDOW_MS)).toBe(true);
  });

  it('is false just past the window boundary', () => {
    expect(isSecondTap(1000, 1000 + DOUBLE_TAP_WINDOW_MS + 1)).toBe(false);
  });

  it('is false for a tap long after the last one (e.g. 10s later)', () => {
    expect(isSecondTap(1000, 1000 + 10_000)).toBe(false);
  });

  it('treats nowMs equal to lastTapAtMs as a valid (zero-gap) second tap', () => {
    expect(isSecondTap(1000, 1000)).toBe(true);
  });
});
