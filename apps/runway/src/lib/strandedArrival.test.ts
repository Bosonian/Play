import { describe, expect, it } from 'vitest';
import { strandedArrivalLine, strandedInArrival } from './strandedArrival';
import type { DepartureStep } from '../db/types';

function makeStep(overrides: Partial<DepartureStep> = {}): DepartureStep {
  return { id: 'step-1', name: 'Scrubs', plannedMinutes: 5, checkedAt: null, ...overrides };
}

describe('strandedInArrival', () => {
  it('is true for a left departure with arrival steps', () => {
    expect(strandedInArrival({ status: 'left', arrivalSteps: [makeStep()] })).toBe(true);
  });

  it('is false for a left departure with no arrival steps', () => {
    expect(strandedInArrival({ status: 'left', arrivalSteps: [] })).toBe(false);
  });

  it('is false for a legacy row with arrivalSteps undefined (pre-increment row, never assumed present)', () => {
    expect(strandedInArrival({ status: 'left', arrivalSteps: undefined as unknown as DepartureStep[] })).toBe(false);
  });

  it('is false for a non-left status even with arrival steps present', () => {
    expect(strandedInArrival({ status: 'running', arrivalSteps: [makeStep()] })).toBe(false);
    expect(strandedInArrival({ status: 'done', arrivalSteps: [makeStep()] })).toBe(false);
  });
});

describe('strandedArrivalLine', () => {
  it('reads "En route" before the arrival phase has been opened (arrivedAt null)', () => {
    expect(strandedArrivalLine({ arrivedAt: null, arrivalSteps: [makeStep()] })).toBe(
      'En route · arrival steps waiting.',
    );
  });

  it('counts checked vs. total arrival steps once arrived, checklist untouched', () => {
    const steps = [makeStep({ id: 'a' }), makeStep({ id: 'b' }), makeStep({ id: 'c' })];
    expect(strandedArrivalLine({ arrivedAt: '2026-07-14T08:00:00.000Z', arrivalSteps: steps })).toBe(
      'Arrived · 0 of 3 arrival steps done.',
    );
  });

  it('counts checked vs. total arrival steps once arrived, checklist partly done', () => {
    const steps = [
      makeStep({ id: 'a', checkedAt: '2026-07-14T08:05:00.000Z' }),
      makeStep({ id: 'b' }),
      makeStep({ id: 'c' }),
    ];
    expect(strandedArrivalLine({ arrivedAt: '2026-07-14T08:00:00.000Z', arrivalSteps: steps })).toBe(
      'Arrived · 1 of 3 arrival steps done.',
    );
  });

  it('treats a legacy row with arrivalSteps undefined as zero steps, not a throw', () => {
    expect(
      strandedArrivalLine({ arrivedAt: '2026-07-14T08:00:00.000Z', arrivalSteps: undefined as unknown as DepartureStep[] }),
    ).toBe('Arrived · 0 of 0 arrival steps done.');
  });
});
