import { describe, expect, it } from 'vitest';
import { focusTone } from './focusTone';

const PLANNED = 600; // 10 minutes, in seconds - round numbers make the 25%/10% boundaries exact

describe('focusTone', () => {
  it('is calm well above the 25% boundary', () => {
    expect(focusTone(400, PLANNED)).toEqual({ phase: 'calm', fillFraction: 0 });
  });

  it('is calm just above the 25% boundary (151s of 600 > 25%)', () => {
    expect(focusTone(151, PLANNED)).toEqual({ phase: 'calm', fillFraction: 0 });
  });

  it('is closing exactly at the 25% boundary', () => {
    expect(focusTone(150, PLANNED)).toEqual({ phase: 'closing', fillFraction: 0 });
  });

  it('is closing just above the 10% boundary (61s of 600 > 10%)', () => {
    expect(focusTone(61, PLANNED)).toEqual({ phase: 'closing', fillFraction: 0 });
  });

  it('is critical exactly at the 10% boundary', () => {
    expect(focusTone(60, PLANNED)).toEqual({ phase: 'critical', fillFraction: 0 });
  });

  it('is critical down to zero remaining (not yet overrun)', () => {
    expect(focusTone(0, PLANNED)).toEqual({ phase: 'critical', fillFraction: 0 });
  });

  it('is overrun the instant remaining goes negative', () => {
    const result = focusTone(-1, PLANNED);
    expect(result.phase).toBe('overrun');
    expect(result.fillFraction).toBeCloseTo(1 / 600, 5);
  });

  it('grows fillFraction proportionally to how deep the overrun is', () => {
    expect(focusTone(-300, PLANNED).fillFraction).toBeCloseTo(0.5, 5); // half the planned box, again
  });

  it('reaches fillFraction 1 once the overrun equals the whole planned box', () => {
    expect(focusTone(-600, PLANNED).fillFraction).toBe(1);
  });

  it('caps fillFraction at 1 even when the overrun is many times the planned box', () => {
    expect(focusTone(-6000, PLANNED)).toEqual({ phase: 'overrun', fillFraction: 1 });
  });

  it('treats a 0-planned step with positive elapsed as overrun, fillFraction capped at 1, no divide-by-zero', () => {
    const result = focusTone(-5, 0);
    expect(result.phase).toBe('overrun');
    expect(result.fillFraction).toBe(1);
    expect(Number.isNaN(result.fillFraction)).toBe(false);
  });

  it('treats a 0-planned step at the exact zero instant as critical, not NaN', () => {
    const result = focusTone(0, 0);
    expect(result).toEqual({ phase: 'critical', fillFraction: 0 });
  });
});
