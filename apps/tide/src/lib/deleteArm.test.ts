import { describe, expect, it } from 'vitest';
import { DELETE_CONFIRM_WINDOW_MS, isArmStillValid } from './deleteArm';

describe('isArmStillValid', () => {
  it('is false when nothing is armed', () => {
    expect(isArmStillValid(null, 1_000)).toBe(false);
  });

  it('is true for a tap arriving immediately after arming', () => {
    expect(isArmStillValid(1_000, 1_000)).toBe(true);
  });

  it('is true for a tap partway through the window', () => {
    expect(isArmStillValid(1_000, 1_000 + DELETE_CONFIRM_WINDOW_MS / 2)).toBe(true);
  });

  it('is true exactly at the window boundary (inclusive)', () => {
    expect(isArmStillValid(1_000, 1_000 + DELETE_CONFIRM_WINDOW_MS)).toBe(true);
  });

  it('is false just past the window boundary', () => {
    expect(isArmStillValid(1_000, 1_000 + DELETE_CONFIRM_WINDOW_MS + 1)).toBe(false);
  });

  it('is false long after the window (a stray tap minutes later is a fresh arm, not a confirm)', () => {
    expect(isArmStillValid(1_000, 1_000 + 10 * 60_000)).toBe(false);
  });
});
