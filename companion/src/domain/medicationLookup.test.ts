import { describe, expect, it } from 'vitest';
import {
  customMedicationKey,
  medicationLookupOptions,
  normalizeMedicationName,
  type CustomMedication,
} from './medicationLookup';

const saved: CustomMedication[] = [{
  id: 'custom-1',
  name: 'Pramipexole',
  formulation: 'Immediate-release tablet',
  normalizedKey: customMedicationKey('Pramipexole', 'Immediate-release tablet'),
  createdAt: '2026-09-05T00:00:00Z',
}];

describe('medication lookup', () => {
  it('normalizes case and repeated whitespace while keeping formulation in identity', () => {
    expect(normalizeMedicationName('  PRAMIPEXOLE  ')).toBe('pramipexole');
    expect(customMedicationKey(' Pramipexole ', ' IR  tablet')).toBe(
      customMedicationKey('pramipexole', 'ir tablet'),
    );
    expect(customMedicationKey('Pramipexole', 'IR tablet')).not.toBe(
      customMedicationKey('Pramipexole', 'retard tablet'),
    );
  });

  it('finds built-ins by brand and saved medicines by name or formulation', () => {
    expect(medicationLookupOptions('Neupro', saved)[0]).toMatchObject({
      kind: 'catalog',
      drug: 'rotigotine',
    });
    expect(medicationLookupOptions('immediate-release', saved)).toEqual([
      expect.objectContaining({ kind: 'saved', customMedicationId: 'custom-1' }),
    ]);
  });
});
