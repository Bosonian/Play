import { describe, expect, it } from 'vitest';
import { compressPlan, suggestNewTarget } from './replan';
import type { DepartureStep } from '../db/types';

function step(id: string, plannedMinutes: number, checkedAt: string | null = null): DepartureStep {
  return { id, name: id, plannedMinutes, checkedAt };
}

describe('compressPlan', () => {
  it('proportional case: compresses unchecked steps + buffer to fit, sum never exceeds available', () => {
    // Unchecked total 30 (15+10+5) + buffer 10 = 40 "wants", but only 20 min
    // left -> factor 0.5.
    const result = compressPlan({
      availableMinutes: 20,
      steps: [step('a', 15), step('b', 10), step('c', 5)],
      bufferMinutes: 10,
    });

    expect(result.fits).toBe(true);
    if (!result.fits) throw new Error('expected fits');
    const total = result.steps.reduce((sum, s) => sum + s.plannedMinutes, 0) + result.bufferMinutes;
    expect(total).toBeLessThanOrEqual(20);
    // floor(15*0.5)=7, floor(10*0.5)=5, floor(5*0.5)=2, floor(10*0.5)=5 -> 7+5+2+5=19, no overshoot correction needed.
    expect(result.steps.map((s) => s.plannedMinutes)).toEqual([7, 5, 2]);
    expect(result.bufferMinutes).toBe(5);
  });

  it('respects the per-step floor of 1 minute and the buffer floor of 2', () => {
    const result = compressPlan({
      availableMinutes: 10,
      steps: [step('a', 100), step('b', 100), step('c', 100)],
      bufferMinutes: 100,
    });

    expect(result.fits).toBe(true);
    if (!result.fits) throw new Error('expected fits');
    for (const s of result.steps) {
      expect(s.plannedMinutes).toBeGreaterThanOrEqual(1);
    }
    expect(result.bufferMinutes).toBeGreaterThanOrEqual(2);
    const total = result.steps.reduce((sum, s) => sum + s.plannedMinutes, 0) + result.bufferMinutes;
    expect(total).toBeLessThanOrEqual(10);
  });

  it('distributes overshoot: two tiny steps both clamp to their floor and push the largest step down to compensate', () => {
    // uncheckedTotal = 1 + 1 + 1000 = 1002, buffer 0, available 6.
    // factor = 6/1002 ~= 0.005988.
    // floor(1*f)=0 -> clamped to 1 (x2 = +2 over their fair share of ~0).
    // floor(1000*f)=5. Raw sum = 1+1+5 = 7, one over budget.
    // Expect the overshoot (1) taken from the largest item (the 1000-step),
    // landing it at 4, for a total of exactly 6.
    const result = compressPlan({
      availableMinutes: 6,
      steps: [step('tiny1', 1), step('tiny2', 1), step('big', 1000)],
      bufferMinutes: 0,
    });

    expect(result.fits).toBe(true);
    if (!result.fits) throw new Error('expected fits');
    expect(result.steps.map((s) => s.plannedMinutes)).toEqual([1, 1, 4]);
    expect(result.bufferMinutes).toBe(0);
    const total = result.steps.reduce((sum, s) => sum + s.plannedMinutes, 0) + result.bufferMinutes;
    expect(total).toBe(6);
  });

  it('leaves an already-fitting plan completely unchanged (factor >= 1 never expands)', () => {
    const steps = [step('a', 15), step('b', 10)];
    const result = compressPlan({ availableMinutes: 100, steps, bufferMinutes: 10 });

    expect(result.fits).toBe(true);
    if (!result.fits) throw new Error('expected fits');
    expect(result.steps).toBe(steps); // same reference, not just equal values
    expect(result.bufferMinutes).toBe(10);
  });

  it('fits exactly at the floor-sum boundary', () => {
    // 2 unchecked steps (floor 1 each) + buffer floor 2 = 4.
    const result = compressPlan({
      availableMinutes: 4,
      steps: [step('a', 50), step('b', 50)],
      bufferMinutes: 50,
    });

    expect(result.fits).toBe(true);
    if (!result.fits) throw new Error('expected fits');
    expect(result.steps.map((s) => s.plannedMinutes)).toEqual([1, 1]);
    expect(result.bufferMinutes).toBe(2);
  });

  it('refuses one minute below the floor-sum boundary', () => {
    const result = compressPlan({
      availableMinutes: 3,
      steps: [step('a', 50), step('b', 50)],
      bufferMinutes: 50,
    });

    expect(result.fits).toBe(false);
    if (result.fits) throw new Error('expected refusal');
    expect(result.minimumMinutes).toBe(4);
  });

  it('a zero buffer stays zero after compression, never invents padding', () => {
    const result = compressPlan({
      availableMinutes: 5,
      steps: [step('a', 50), step('b', 50)],
      bufferMinutes: 0,
    });

    expect(result.fits).toBe(true);
    if (!result.fits) throw new Error('expected fits');
    expect(result.bufferMinutes).toBe(0);
  });

  it('checked steps are never touched: values, ids, and checkedAt survive compression untouched', () => {
    const checkedStep = step('done', 20, '2026-07-09T08:00:00.000Z');
    const result = compressPlan({
      availableMinutes: 5,
      steps: [checkedStep, step('a', 50)],
      bufferMinutes: 10,
    });

    expect(result.fits).toBe(true);
    if (!result.fits) throw new Error('expected fits');
    const survivor = result.steps.find((s) => s.id === 'done');
    expect(survivor).toEqual(checkedStep);
  });

  it('refuses when even the floors do not fit (available minutes < floor sum)', () => {
    const result = compressPlan({
      availableMinutes: 1,
      steps: [step('a', 50), step('b', 50), step('c', 50)],
      bufferMinutes: 10,
    });

    expect(result.fits).toBe(false);
    if (result.fits) throw new Error('expected refusal');
    // 3 steps * 1 + buffer floor 2 = 5.
    expect(result.minimumMinutes).toBe(5);
  });

  it('no unchecked steps left and zero buffer: nothing to compress, trivially fits', () => {
    const checkedStep = step('done', 20, '2026-07-09T08:00:00.000Z');
    const result = compressPlan({
      availableMinutes: 0,
      steps: [checkedStep],
      bufferMinutes: 0,
    });

    expect(result.fits).toBe(true);
    if (!result.fits) throw new Error('expected fits');
    expect(result.steps).toEqual([checkedStep]);
    expect(result.bufferMinutes).toBe(0);
  });
});

describe('suggestNewTarget', () => {
  it('rounds up to the next 5-minute boundary when the raw sum lands off-grid', () => {
    // 18:14 + 0 remaining + 5 travel = 18:19 -> rounds up to 18:20.
    const now = new Date('2026-07-09T18:14:00.000Z');
    const target = suggestNewTarget(now, 0, 5);
    expect(target.toISOString()).toBe('2026-07-09T18:20:00.000Z');
  });

  it('leaves an exact 5-minute boundary untouched (does not push it forward a whole 5 min)', () => {
    // 18:00 + 30 remaining + 5 travel = 18:35:00.000 exactly.
    const now = new Date('2026-07-09T18:00:00.000Z');
    const target = suggestNewTarget(now, 30, 5);
    expect(target.toISOString()).toBe('2026-07-09T18:35:00.000Z');
  });

  it('zero remaining plan and zero travel: rounds `now` itself up to the next boundary', () => {
    const now = new Date('2026-07-09T18:14:00.000Z');
    const target = suggestNewTarget(now, 0, 0);
    expect(target.toISOString()).toBe('2026-07-09T18:15:00.000Z');
  });

  it('travel minutes are included in the sum, not dropped', () => {
    const now = new Date('2026-07-09T18:00:00.000Z');
    const withoutTravel = suggestNewTarget(now, 10, 0); // 18:10 -> 18:10
    const withTravel = suggestNewTarget(now, 10, 20); // 18:30 -> 18:30
    expect(withoutTravel.toISOString()).toBe('2026-07-09T18:10:00.000Z');
    expect(withTravel.toISOString()).toBe('2026-07-09T18:30:00.000Z');
  });

  it('sub-minute now (seconds/ms) still rounds up correctly, never rounding down', () => {
    // 18:14:30.500 + 0 + 0 -> raw 18:14:30.500, rounds up to 18:15, not down to 18:10.
    const now = new Date('2026-07-09T18:14:30.500Z');
    const target = suggestNewTarget(now, 0, 0);
    expect(target.toISOString()).toBe('2026-07-09T18:15:00.000Z');
  });
});
