import { describe, expect, it } from 'vitest';
import { buildObservationStudy, observationProgress, plannedEndAt } from './observation';

describe('observation study', () => {
  it('calculates a 14-day collection window', () => {
    expect(plannedEndAt('2026-09-01T10:00:00.000Z', 14)).toBe('2026-09-15T10:00:00.000Z');
  });

  it('copies the regimen and reports bounded progress', () => {
    const regimen = [{
      id: 'r1', patient: 'P-01', drug: 'levodopa' as const,
      times: [{ time: '08:00', doseMg: 100 }], updatedAt: '2026-09-01T00:00:00.000Z',
    }];
    const study = buildObservationStudy({
      id: 's1', patient: 'P-01', durationDays: 14,
      startedAt: '2026-09-01T00:00:00.000Z', regimen,
      timeZone: 'Europe/London',
    });
    regimen[0].times[0].doseMg = 150;
    expect(study.regimenSnapshot[0].times[0].doseMg).toBe(100);
    expect(study.timeZone).toBe('Europe/London');
    expect(observationProgress(study, new Date('2026-09-03T12:00:00.000Z'))).toEqual({
      dayNumber: 3, durationDays: 14, percent: 18, collectionComplete: false,
    });
    expect(observationProgress(study, new Date('2026-09-20T00:00:00.000Z')).percent).toBe(100);
  });

  it('deep-copies nested when-needed instructions in the regimen snapshot', () => {
    const regimen = [{
      id: 'prn-1', patient: 'P-01', drug: 'levodopa' as const, times: [],
      prn: { doseMg: 0.088, indication: 'OFF symptoms', instructions: 'Wait two hours.' },
      updatedAt: '2026-09-01T00:00:00.000Z',
    }];
    const study = buildObservationStudy({
      id: 's-prn', patient: 'P-01', durationDays: 14,
      startedAt: '2026-09-01T00:00:00.000Z', regimen,
    });
    regimen[0].prn.instructions = 'mutated';
    expect(study.regimenSnapshot[0].prn).toEqual({
      doseMg: 0.088,
      indication: 'OFF symptoms',
      instructions: 'Wait two hours.',
    });
  });
});
