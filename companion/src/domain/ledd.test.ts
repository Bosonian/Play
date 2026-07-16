import { describe, it, expect } from 'vitest';
import { computeLedd } from './ledd';
import type { DoseEvent, DrugId } from './types';

let seq = 0;
const dose = (drug: DrugId, doseMg: number, at = '2026-07-16T08:00:00Z'): DoseEvent => ({
  id: `dose-${++seq}`,
  patient: 'P-01',
  at,
  kind: 'dose',
  drug,
  doseMg,
});

describe('computeLedd', () => {
  it('reference: levodopa contributes at ×1 (its own mg)', () => {
    const result = computeLedd([dose('levodopa', 100)]);
    expect(result.levodopaBaseMg).toBe(100);
    expect(result.byDrug.levodopa).toBe(100);
    expect(result.totalMg).toBe(100);
  });

  it('per-mg: rotigotine 8mg → 240 (×30 factor)', () => {
    const result = computeLedd([dose('rotigotine', 8)]);
    expect(result.byDrug.rotigotine).toBe(240);
    expect(result.totalMg).toBe(240);
    // rotigotine is not a levodopa reference — it doesn't add to the base.
    expect(result.levodopaBaseMg).toBe(0);
  });

  it('fixed: safinamide contributes 100mg once, even across two doses that day', () => {
    const result = computeLedd([dose('safinamide', 50), dose('safinamide', 50)]);
    expect(result.byDrug.safinamide).toBe(100);
    expect(result.totalMg).toBe(100);
  });

  it('fraction: entacapone on a levodopa day contributes 0.33 × the day\'s levodopa base', () => {
    const result = computeLedd([dose('levodopa', 100), dose('levodopa', 100), dose('entacapone', 200)]);
    expect(result.levodopaBaseMg).toBe(200);
    expect(result.byDrug.entacapone).toBeCloseTo(0.33 * 200, 6);
    expect(result.totalMg).toBeCloseTo(200 + 0.33 * 200, 6);
  });

  it('fraction is counted once per day even with multiple entacapone doses', () => {
    const result = computeLedd([
      dose('levodopa', 100),
      dose('entacapone', 200),
      dose('entacapone', 200),
    ]);
    expect(result.byDrug.entacapone).toBeCloseTo(0.33 * 100, 6);
  });

  it('Stalevo-like day: levodopa + carbidopa + entacapone', () => {
    const result = computeLedd([dose('levodopa', 100), dose('carbidopa', 25), dose('entacapone', 200)]);
    expect(result.levodopaBaseMg).toBe(100);
    expect(result.byDrug.levodopa).toBe(100);
    expect(result.byDrug.carbidopa).toBe(0);
    expect(result.byDrug.entacapone).toBeCloseTo(33, 6);
    expect(result.totalMg).toBeCloseTo(133, 6);
  });

  it('baclofen-only day → totalMg 0', () => {
    const result = computeLedd([dose('baclofen', 10)]);
    expect(result.totalMg).toBe(0);
    expect(result.byDrug.baclofen).toBe(0);
  });

  it('fraction with zero levodopa that day → 0', () => {
    const result = computeLedd([dose('entacapone', 200)]);
    expect(result.levodopaBaseMg).toBe(0);
    expect(result.byDrug.entacapone).toBe(0);
    expect(result.totalMg).toBe(0);
  });

  it('empty day → all zero', () => {
    const result = computeLedd([]);
    expect(result.totalMg).toBe(0);
    expect(result.levodopaBaseMg).toBe(0);
    expect(result.byDrug).toEqual({});
  });
});
