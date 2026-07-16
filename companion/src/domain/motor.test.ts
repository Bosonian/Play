import { describe, it, expect } from 'vitest';
import { mapPatientTap, type MotorState, type PrimaryTap, type DyskinesiaRefinement } from './motor';

describe('mapPatientTap — 3-tap patient flow → canonical MotorState', () => {
  it('maps off → off', () => {
    expect(mapPatientTap('off')).toBe('off');
  });

  it('maps on → on', () => {
    expect(mapPatientTap('on')).toBe('on');
  });

  it('maps on-dyskinesia with no refinement → on-dyskinesia-unspecified', () => {
    expect(mapPatientTap('on-dyskinesia')).toBe('on-dyskinesia-unspecified');
  });

  it('maps on-dyskinesia + troublesome → on-dyskinesia-troublesome', () => {
    expect(mapPatientTap('on-dyskinesia', 'troublesome')).toBe('on-dyskinesia-troublesome');
  });

  it('maps on-dyskinesia + nontroublesome → on-dyskinesia-nontroublesome', () => {
    expect(mapPatientTap('on-dyskinesia', 'nontroublesome')).toBe('on-dyskinesia-nontroublesome');
  });

  it('ignores a refinement passed alongside off/on primaries', () => {
    expect(mapPatientTap('off', 'troublesome')).toBe('off');
    expect(mapPatientTap('on', 'nontroublesome')).toBe('on');
  });

  it('never produces asleep from any combination of primary tap + refinement', () => {
    const primaries: PrimaryTap[] = ['on', 'off', 'on-dyskinesia'];
    const refinements: (DyskinesiaRefinement | undefined)[] = [
      undefined,
      'troublesome',
      'nontroublesome',
    ];
    const results = new Set<MotorState>();
    for (const p of primaries) {
      for (const r of refinements) {
        results.add(mapPatientTap(p, r));
      }
    }
    expect(results.has('asleep')).toBe(false);
  });
});
