import { describe, it, expect } from 'vitest';
import { DRUG_CATALOG, type DrugId, type EngineHandling, type LedFactor } from './drugs';

const VALID_ENGINE_HANDLING: EngineHandling[] = [
  'own-curve',
  'own-curve-fast-ka',
  'modifies-levodopa-clearance-per-dose',
  'modifies-levodopa-clearance-all-day',
  'modifies-levodopa-effect',
  'parallel-agonist',
  'ddci-baseline',
  'log-only',
];

const VALID_LED_KINDS: LedFactor['kind'][] = ['reference', 'per-mg', 'fraction', 'fixed', 'none'];

describe('DRUG_CATALOG', () => {
  it('has exactly 9 entries', () => {
    expect(Object.keys(DRUG_CATALOG)).toHaveLength(9);
  });

  it('every record key matches its entry id', () => {
    for (const [key, spec] of Object.entries(DRUG_CATALOG)) {
      expect(spec.id).toBe(key as DrugId);
    }
  });

  it('every entry has a valid engineHandling', () => {
    for (const spec of Object.values(DRUG_CATALOG)) {
      expect(VALID_ENGINE_HANDLING).toContain(spec.engineHandling);
    }
  });

  it('every entry has a valid ledFactor.kind', () => {
    for (const spec of Object.values(DRUG_CATALOG)) {
      expect(VALID_LED_KINDS).toContain(spec.ledFactor.kind);
    }
  });

  it('baclofen is log-only with no LEDD contribution', () => {
    const spec = DRUG_CATALOG.baclofen;
    expect(spec.engineHandling).toBe('log-only');
    expect(spec.ledFactor.kind).toBe('none');
  });

  it('both DDCIs (benserazide, carbidopa) are ddci-baseline with no LEDD contribution', () => {
    for (const id of ['benserazide', 'carbidopa'] as const) {
      const spec = DRUG_CATALOG[id];
      expect(spec.engineHandling).toBe('ddci-baseline');
      expect(spec.ledFactor.kind).toBe('none');
      expect(spec.drugClass).toBe('ddci');
    }
  });

  it('levodopa and madopar-lt are the only reference-kind LED drugs (the levodopa base)', () => {
    const referenceDrugs = Object.values(DRUG_CATALOG).filter((s) => s.ledFactor.kind === 'reference');
    expect(referenceDrugs.map((s) => s.id).sort()).toEqual(['levodopa', 'madopar-lt']);
  });

  it('there is no standalone CR drug entry (levodopa is IR-basis only)', () => {
    expect(Object.keys(DRUG_CATALOG)).not.toContain('levodopa-cr');
    expect(DRUG_CATALOG.levodopa.formulation).toBe('oral-ir');
  });

  it('levodopa carries populationPk; rotigotine and madopar-lt do not (deferred models)', () => {
    expect(DRUG_CATALOG.levodopa.populationPk).toBeDefined();
    expect(DRUG_CATALOG.rotigotine.populationPk).toBeUndefined();
    expect(DRUG_CATALOG['madopar-lt'].populationPk).toBeUndefined();
  });
});
