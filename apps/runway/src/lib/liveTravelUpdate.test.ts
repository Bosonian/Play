import { describe, expect, it } from 'vitest';
import { shouldUpdateTravelMinutes } from './liveTravelUpdate';

describe('shouldUpdateTravelMinutes', () => {
  it('is false for no drift at all', () => {
    expect(shouldUpdateTravelMinutes(20, 20)).toBe(false);
  });

  it('is false just under the 3-minute threshold, in either direction', () => {
    expect(shouldUpdateTravelMinutes(20, 22)).toBe(false);
    expect(shouldUpdateTravelMinutes(20, 18)).toBe(false);
  });

  it('is true exactly at the 3-minute threshold', () => {
    expect(shouldUpdateTravelMinutes(20, 23)).toBe(true);
    expect(shouldUpdateTravelMinutes(20, 17)).toBe(true);
  });

  it('is true well past the threshold', () => {
    expect(shouldUpdateTravelMinutes(20, 35)).toBe(true);
    expect(shouldUpdateTravelMinutes(35, 20)).toBe(true);
  });
});
