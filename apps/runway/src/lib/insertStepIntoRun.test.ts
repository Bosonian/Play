import { describe, expect, it } from 'vitest';
import { insertStepIntoRun } from './insertStepIntoRun';
import type { DepartureStep } from '../db/types';

function makeStep(id: string, checkedAt: string | null): DepartureStep {
  return { id, name: id, plannedMinutes: 10, checkedAt, estimateSource: 'manual' };
}

const NEW_STEP: DepartureStep = { id: 'new', name: 'Shave', plannedMinutes: 8, checkedAt: null, estimateSource: 'manual' };

describe('insertStepIntoRun', () => {
  it('inserts before the current step when several steps are already checked', () => {
    // Toilet, Bath checked; Brush is current; Dress unchecked after it.
    const steps = [
      makeStep('toilet', '2026-08-07T07:00:00.000Z'),
      makeStep('bath', '2026-08-07T07:10:00.000Z'),
      makeStep('brush', null),
      makeStep('dress', null),
    ];
    const result = insertStepIntoRun(steps, NEW_STEP, 'now');
    expect(result.map((s) => s.id)).toEqual(['toilet', 'bath', 'new', 'brush', 'dress']);
    // The new step lands exactly where 'brush' was - it is now current.
    expect(result.findIndex((s) => s.checkedAt === null)).toBe(2);
  });

  it('inserts after the current step, leaving the current step current', () => {
    const steps = [
      makeStep('toilet', '2026-08-07T07:00:00.000Z'),
      makeStep('bath', null),
      makeStep('brush', null),
    ];
    const result = insertStepIntoRun(steps, NEW_STEP, 'after-current');
    expect(result.map((s) => s.id)).toEqual(['toilet', 'bath', 'new', 'brush']);
    // 'bath' is still the current (first unchecked) step - its clock is undisturbed.
    expect(result.findIndex((s) => s.checkedAt === null)).toBe(1);
  });

  it('inserts before the current step when the current step is the first step (nothing checked yet)', () => {
    const steps = [makeStep('toilet', null), makeStep('bath', null)];
    const result = insertStepIntoRun(steps, NEW_STEP, 'now');
    expect(result.map((s) => s.id)).toEqual(['new', 'toilet', 'bath']);
    expect(result.findIndex((s) => s.checkedAt === null)).toBe(0);
  });

  it('inserts after the current step when the current step is the LAST step', () => {
    const steps = [
      makeStep('toilet', '2026-08-07T07:00:00.000Z'),
      makeStep('bath', '2026-08-07T07:10:00.000Z'),
      makeStep('brush', null),
    ];
    const result = insertStepIntoRun(steps, NEW_STEP, 'after-current');
    expect(result.map((s) => s.id)).toEqual(['toilet', 'bath', 'brush', 'new']);
  });

  it('inserts before the current step when the current step is the LAST step', () => {
    const steps = [
      makeStep('toilet', '2026-08-07T07:00:00.000Z'),
      makeStep('bath', '2026-08-07T07:10:00.000Z'),
      makeStep('brush', null),
    ];
    const result = insertStepIntoRun(steps, NEW_STEP, 'now');
    expect(result.map((s) => s.id)).toEqual(['toilet', 'bath', 'new', 'brush']);
    expect(result.findIndex((s) => s.checkedAt === null)).toBe(2);
  });

  it('appends when every step is already checked (no current step), for both positions', () => {
    const steps = [
      makeStep('toilet', '2026-08-07T07:00:00.000Z'),
      makeStep('bath', '2026-08-07T07:10:00.000Z'),
    ];
    const now = insertStepIntoRun(steps, NEW_STEP, 'now');
    const after = insertStepIntoRun(steps, NEW_STEP, 'after-current');
    expect(now.map((s) => s.id)).toEqual(['toilet', 'bath', 'new']);
    expect(after.map((s) => s.id)).toEqual(['toilet', 'bath', 'new']);
  });

  it('does not crash on an empty steps array (defensive - no current step)', () => {
    expect(insertStepIntoRun([], NEW_STEP, 'now').map((s) => s.id)).toEqual(['new']);
    expect(insertStepIntoRun([], NEW_STEP, 'after-current').map((s) => s.id)).toEqual(['new']);
  });

  it('never disturbs already-checked steps or their checkedAt values', () => {
    const steps = [
      makeStep('toilet', '2026-08-07T07:00:00.000Z'),
      makeStep('bath', '2026-08-07T07:10:00.000Z'),
      makeStep('brush', null),
    ];
    const result = insertStepIntoRun(steps, NEW_STEP, 'now');
    const toilet = result.find((s) => s.id === 'toilet');
    const bath = result.find((s) => s.id === 'bath');
    expect(toilet?.checkedAt).toBe('2026-08-07T07:00:00.000Z');
    expect(bath?.checkedAt).toBe('2026-08-07T07:10:00.000Z');
  });

  it("the new step's checkedAt is null after insertion, regardless of position", () => {
    const steps = [makeStep('toilet', '2026-08-07T07:00:00.000Z'), makeStep('bath', null)];
    const now = insertStepIntoRun(steps, NEW_STEP, 'now');
    const after = insertStepIntoRun(steps, NEW_STEP, 'after-current');
    expect(now.find((s) => s.id === 'new')?.checkedAt).toBeNull();
    expect(after.find((s) => s.id === 'new')?.checkedAt).toBeNull();
  });

  it('does not mutate the input array', () => {
    const steps = [makeStep('toilet', null)];
    const original = [...steps];
    insertStepIntoRun(steps, NEW_STEP, 'now');
    expect(steps).toEqual(original);
  });
});
