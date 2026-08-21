import { describe, expect, it } from 'vitest';
import { DELETE_CONFIRM_MIN_MS, DELETE_CONFIRM_WINDOW_MS, isArmStillValid, isConfirmTooSoon } from './deleteArm';

describe('isArmStillValid', () => {
  it('is false when nothing is armed', () => {
    expect(isArmStillValid(null, 1_000)).toBe(false);
  });

  it('is true for a deliberate tap comfortably inside the window', () => {
    expect(isArmStillValid(1_000, 1_000 + 1_500)).toBe(true);
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

  // Review fix (0.7.1): the lower bound is what actually stops an accidental
  // double-tap from deleting — the long upper window never could, since
  // 0..4000ms contains 0..350ms.
  it('is false for an instantaneous second tap (one accidental double-tap, not two decisions)', () => {
    expect(isArmStillValid(1_000, 1_000)).toBe(false);
  });

  it('is false just under the minimum delay', () => {
    expect(isArmStillValid(1_000, 1_000 + DELETE_CONFIRM_MIN_MS - 1)).toBe(false);
  });

  it('is true exactly at the minimum delay (inclusive)', () => {
    expect(isArmStillValid(1_000, 1_000 + DELETE_CONFIRM_MIN_MS)).toBe(true);
  });
});

describe('isConfirmTooSoon', () => {
  it('is false when nothing is armed', () => {
    expect(isConfirmTooSoon(null, 1_000)).toBe(false);
  });

  it('is true for a tap inside the minimum delay', () => {
    expect(isConfirmTooSoon(1_000, 1_000)).toBe(true);
    expect(isConfirmTooSoon(1_000, 1_000 + DELETE_CONFIRM_MIN_MS - 1)).toBe(true);
  });

  it('is false once the minimum delay has passed — including after the window expires, so a late tap is a fresh arm rather than an ignored one', () => {
    expect(isConfirmTooSoon(1_000, 1_000 + DELETE_CONFIRM_MIN_MS)).toBe(false);
    expect(isConfirmTooSoon(1_000, 1_000 + DELETE_CONFIRM_WINDOW_MS + 1)).toBe(false);
  });
});
