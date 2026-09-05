import { describe, expect, it } from 'vitest';
import { parseMedicineSourceV1, type ParsedMedicineCandidate } from '../../../domain/medicineImport';
import {
  buildReviewedRegimenItem,
  candidateToReviewDraft,
  ocrResultBelongsToRequest,
  unresolvedReviewFields,
} from './medicinePhotoReview';

const candidate = (overrides: Partial<ParsedMedicineCandidate> = {}): ParsedMedicineCandidate => ({
  sourceLineIds: ['l1', 'l2'],
  sourceText: 'Medicine: Pramipexole\n08:00 — 0.088 mg',
  nameSuggestion: { value: 'Pramipexole', evidence: [{ lineId: 'l1', substring: 'Pramipexole' }] },
  formulationSuggestion: {
    value: 'Immediate-release tablet',
    evidence: [{ lineId: 'l1', substring: 'Immediate-release tablet' }],
  },
  strengthSuggestion: { value: '0.18 mg', evidence: [{ lineId: 'l1', substring: '0.18 mg' }] },
  explicitDoses: {
    value: [{ time: '08:00', doseMg: 0.088 }],
    evidence: [{ lineId: 'l2', substring: '08:00 — 0.088 mg' }],
  },
  instructionsSuggestion: {
    value: 'Medicine: Pramipexole\n08:00 — 0.088 mg',
    evidence: [
      { lineId: 'l1', substring: 'Medicine: Pramipexole' },
      { lineId: 'l2', substring: '08:00 — 0.088 mg' },
    ],
  },
  unresolved: [],
  ...overrides,
});

describe('medicine photo review state', () => {
  it('preserves explicit decimal doses and leaves unresolved directions blank', () => {
    const exact = candidateToReviewDraft(candidate());
    expect(exact.rows).toEqual([{ time: '08:00', dose: '0.088' }]);
    expect(exact.drug).toBeUndefined();
    expect(unresolvedReviewFields(exact)).toContain('medicine identity');

    const unresolved = candidateToReviewDraft(candidate({ explicitDoses: undefined }));
    expect(unresolved.rows).toEqual([{ time: '', dose: '' }]);
    expect(unresolvedReviewFields(unresolved)).toEqual([
      'medicine identity',
      'dose time',
      'dose in mg',
    ]);
  });

  it('uses current regimen validation and preserves PRN source instructions', () => {
    const draft = candidateToReviewDraft(candidate({
      explicitDoses: undefined,
      prnSuggestion: { value: true, evidence: [{ lineId: 'l2', substring: 'PRN' }] },
      prnDoseSuggestion: { value: 0.088, evidence: [{ lineId: 'l2', substring: '0.088 mg PRN' }] },
      indicationSuggestion: { value: 'OFF episode', evidence: [{ lineId: 'l2', substring: 'OFF episode' }] },
    }));
    draft.drug = 'custom';
    const result = buildReviewedRegimenItem(
      draft,
      'P-01',
      'regimen-1',
      '2026-09-05T12:00:00Z',
    );
    expect(result.errors).toEqual([]);
    expect(result.item?.prn).toEqual({
      doseMg: 0.088,
      indication: 'OFF episode',
      instructions: 'Medicine: Pramipexole\n08:00 — 0.088 mg',
    });
  });

  it('keeps partial PRN suggestions visible without inventing permission details', () => {
    const draft = candidateToReviewDraft(candidate({
      explicitDoses: undefined,
      prnSuggestion: { value: true, evidence: [{ lineId: 'l2', substring: 'bei Bedarf' }] },
      prnDoseSuggestion: undefined,
      indicationSuggestion: undefined,
    }));
    expect(draft.mode).toBe('prn');
    expect(draft.prnDose).toBe('');
    expect(draft.indication).toBe('');
    expect(unresolvedReviewFields(draft)).toEqual([
      'medicine identity',
      'when-needed dose in mg',
      'when-needed indication',
    ]);
  });

  it('accepts only the active extraction response', () => {
    expect(ocrResultBelongsToRequest('request-2', { requestId: 'request-1' })).toBe(false);
    expect(ocrResultBelongsToRequest(null, { requestId: 'request-1' })).toBe(false);
    expect(ocrResultBelongsToRequest('request-1', { requestId: 'request-1' })).toBe(true);
  });
});


describe('qualified source preservation', () => {
  it('routes qualified directions to free text and refuses daily schedule promotion', () => {
    const draft = candidateToReviewDraft(candidate({
      unresolved: ['unsupported or qualified dose direction'],
      instructionsSuggestion: { value: 'Dosis: 100 mg um 08:00 nur montags', evidence: [] },
    }));
    draft.drug = 'levodopa';
    expect(draft.mode).toBe('freeText');
    const result = buildReviewedRegimenItem(draft, 'P-01', 'r1', '2026-09-05T12:00:00Z');
    expect(result.errors).toEqual([]);
    expect(result.item?.times).toEqual([]);
    expect(result.item?.freeText).toContain('nur montags');
    draft.mode = 'scheduled';
    expect(buildReviewedRegimenItem(draft, 'P-01', 'r1', '2026-09-05T12:00:00Z').item).toBeUndefined();
  });
});


it('preserves unrecognized continuation lines instead of making daily slots', () => {
  for (const qualifier of ['jeden zweiten Tag', 'für 5 Tage', 'ab 10.09.2026', 'nur bei Schmerzen']) {
    const parsed = parseMedicineSourceV1([
      { id: 'p', text: 'Medicine: Example 100 mg Tabletten' },
      { id: 'd', text: 'Dosis: 100 mg um 08:00' },
      { id: 'q', text: qualifier },
    ]);
    const draft = candidateToReviewDraft(parsed);
    draft.drug = 'custom';
    expect(draft.mode, qualifier).toBe('freeText');
    const result = buildReviewedRegimenItem(draft, 'P-01', 'r1', '2026-09-05T12:00:00Z');
    expect(result.errors, qualifier).toEqual([]);
    expect(result.item?.times, qualifier).toEqual([]);
    expect(result.item?.freeText, qualifier).toContain(qualifier);
  }
});
