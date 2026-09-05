import { DRUG_CATALOG, type DrugId } from './drugs';

export interface CustomMedication {
  id: string;
  name: string;
  formulation: string;
  normalizedKey: string;
  createdAt: string;
}

export type MedicationLookupOption =
  | { kind: 'catalog'; drug: DrugId; name: string; detail: string }
  | { kind: 'saved'; drug: 'custom'; customMedicationId: string; name: string; detail: string };

export function normalizeMedicationName(value: string): string {
  // Use locale-independent casing because this value is persisted as a
  // uniqueness key and must not change if the device locale changes.
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function customMedicationKey(name: string, formulation: string): string {
  return `${normalizeMedicationName(name)}\u001f${normalizeMedicationName(formulation)}`;
}

export function medicationLookupOptions(
  query: string,
  saved: CustomMedication[],
): MedicationLookupOption[] {
  const needle = normalizeMedicationName(query);
  const catalog = (Object.keys(DRUG_CATALOG) as DrugId[])
    .filter((drug) => DRUG_CATALOG[drug].drugClass !== 'ddci')
    .map((drug) => ({
      kind: 'catalog' as const,
      drug,
      name: DRUG_CATALOG[drug].generic,
      detail: DRUG_CATALOG[drug].brands.join(', '),
    }))
    .filter((option) =>
      needle === '' ||
      normalizeMedicationName(`${option.name} ${option.detail}`).includes(needle),
    );
  const custom = saved
    .map((profile) => ({
      kind: 'saved' as const,
      drug: 'custom' as const,
      customMedicationId: profile.id,
      name: profile.name,
      detail: profile.formulation,
    }))
    .filter((option) =>
      needle === '' ||
      normalizeMedicationName(`${option.name} ${option.detail}`).includes(needle),
    );
  return [...catalog, ...custom];
}
