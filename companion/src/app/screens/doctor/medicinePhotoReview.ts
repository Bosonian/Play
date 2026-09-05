import type { MedicationId } from '../../../domain/drugs';
import type { ParsedMedicineCandidate } from '../../../domain/medicineImport';
import { sortDoseTimes, validateRegimenItem, type RegimenItem } from '../../../domain/regimen';

export interface MedicinePhotoReviewDraft {
  query: string;
  drug?: MedicationId;
  customName: string;
  customFormulation: string;
  customMedicationId?: string;
  mode: 'scheduled' | 'prn' | 'freeText';
  requiresManualDirections?: boolean;
  rows: Array<{ time: string; dose: string }>;
  prnDose: string;
  indication: string;
  instructions: string;
}

export function candidateToReviewDraft(
  candidate: ParsedMedicineCandidate,
): MedicinePhotoReviewDraft {
  const requiresManualDirections = candidate.unresolved.some((field) =>
    field.startsWith('unsupported or qualified') || field.startsWith('conflicting')
      || field === 'mixed scheduled and PRN directions');
  return {
    query: candidate.nameSuggestion?.value ?? '',
    customName: candidate.nameSuggestion?.value ?? '',
    customFormulation: candidate.formulationSuggestion?.value ?? '',
    mode: requiresManualDirections ? 'freeText' : candidate.prnSuggestion?.value ? 'prn' : 'scheduled',
    requiresManualDirections,
    rows: candidate.explicitDoses
      ? candidate.explicitDoses.value.map((dose) => ({ time: dose.time, dose: String(dose.doseMg) }))
      : [{ time: '', dose: '' }],
    prnDose: candidate.prnDoseSuggestion ? String(candidate.prnDoseSuggestion.value) : '',
    indication: candidate.indicationSuggestion?.value ?? '',
    instructions: candidate.instructionsSuggestion.value,
  };
}

export function ocrResultBelongsToRequest(
  activeRequestId: string | null,
  result: { requestId: string },
): boolean {
  return activeRequestId !== null && result.requestId === activeRequestId;
}

export function unresolvedReviewFields(draft: MedicinePhotoReviewDraft): string[] {
  const unresolved: string[] = [];
  if (!draft.drug) unresolved.push('medicine identity');
  if (draft.drug === 'custom' && draft.customFormulation.trim() === '') {
    unresolved.push('formulation');
  }
  if (draft.mode === 'scheduled') {
    if (draft.rows.length === 0 || draft.rows.every((row) => row.time.trim() === '')) {
      unresolved.push('dose time');
    }
    if (draft.rows.length === 0 || draft.rows.every((row) => row.dose.trim() === '')) {
      unresolved.push('dose in mg');
    }
  } else if (draft.mode === 'freeText') {
    if (!draft.instructions.trim()) unresolved.push('prescriber instructions');
  } else {
    if (draft.prnDose.trim() === '') unresolved.push('when-needed dose in mg');
    if (draft.indication.trim() === '') unresolved.push('when-needed indication');
  }
  return unresolved;
}

export function buildReviewedRegimenItem(
  draft: MedicinePhotoReviewDraft,
  patient: string,
  id: string,
  updatedAt: string,
): { item?: RegimenItem; errors: string[] } {
  if (!draft.drug) {
    return { errors: ['Choose a built-in or saved medicine, or explicitly add it as another medicine.'] };
  }
  if (draft.requiresManualDirections && draft.mode !== 'freeText') {
    return { errors: ['These source directions need free-text review. Preserve the complete instructions, or add the prescription manually from the regimen editor.'] };
  }
  const item: RegimenItem = {
    id,
    patient,
    drug: draft.drug,
    ...(draft.drug === 'custom' ? {
      customName: draft.customName.trim(),
      customFormulation: draft.customFormulation.trim(),
      ...(draft.customMedicationId ? { customMedicationId: draft.customMedicationId } : {}),
    } : {}),
    times: draft.mode === 'scheduled'
      ? sortDoseTimes(draft.rows
        .filter((row) => row.time.trim() !== '' || row.dose.trim() !== '')
        .map((row) => ({
          time: row.time,
          doseMg: Number(row.dose.trim().replace(',', '.')),
        })))
      : [],
    ...(draft.mode === 'freeText' ? { freeText: draft.instructions.trim() } : {}),
    ...(draft.mode === 'prn' ? {
      prn: {
        doseMg: Number(draft.prnDose.trim().replace(',', '.')),
        indication: draft.indication.trim(),
        ...(draft.instructions.trim() ? { instructions: draft.instructions.trim() } : {}),
      },
    } : {}),
    updatedAt,
  };
  const errors = validateRegimenItem(item);
  return errors.length > 0 ? { errors } : { item, errors: [] };
}
