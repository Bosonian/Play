import { describe, expect, it } from 'vitest';
import { parseMedicineOcrLines, parseMedicineSourceV1 } from './medicineImport';

describe('conservative medicine OCR parser', () => {
  it('creates a draft from ordinary selected lines and keeps dose evidence separate from strength', () => {
    const result = parseMedicineSourceV1([
      { id: 'l1', text: '  Pramipexol Retardtabletten 0,26 mg' },
      { id: 'l2', text: 'Dosis: 0,088 mg um 08:00' },
      { id: 'l3', text: '20:00 — 0,18 mg' },
      { id: 'l4', text: 'Schema 1-0-1' },
    ]);

    expect(result.nameSuggestion).toEqual({
      value: 'Pramipexol',
      evidence: [{ lineId: 'l1', substring: 'Pramipexol' }],
    });
    expect(result.formulationSuggestion?.value).toBe('Retardtabletten');
    expect(result.strengthSuggestion?.value).toBe('0,26 mg');
    expect(result.explicitDoses).toEqual({
      value: [
        { time: '08:00', doseMg: 0.088 },
        { time: '20:00', doseMg: 0.18 },
      ],
      evidence: [
        { lineId: 'l2', substring: 'Dosis: 0,088 mg um 08:00' },
        { lineId: 'l3', substring: '20:00 — 0,18 mg' },
      ],
    });
    expect(result.sourceText).toBe(
      '  Pramipexol Retardtabletten 0,26 mg\nDosis: 0,088 mg um 08:00\n20:00 — 0,18 mg\nSchema 1-0-1',
    );
    expect(result.instructionsSuggestion.evidence).toHaveLength(4);
  });

  it('preserves uncertain selected text while leaving identity unresolved', () => {
    const result = parseMedicineSourceV1([
      { id: 'u1', text: '08:00 — 0,088 mg' },
      { id: 'u2', text: 'unleserliche Nachbarspalte' },
    ]);
    expect(result.nameSuggestion).toBeUndefined();
    expect(result.unresolved).toContain('medicine identity');
    expect(result.explicitDoses?.value).toEqual([{ time: '08:00', doseMg: 0.088 }]);
    expect(result.sourceText).toContain('unleserliche Nachbarspalte');
  });

  it('keeps PRN marker, dose, and indication as independent suggestions', () => {
    const markerOnly = parseMedicineSourceV1([
      { id: 'p1', text: 'Madipar LT 100/25 mg' },
      { id: 'p2', text: 'bei Bedarf' },
    ]);
    expect(markerOnly.prnSuggestion?.value).toBe(true);
    expect(markerOnly.prnDoseSuggestion).toBeUndefined();
    expect(markerOnly.unresolved).toEqual(expect.arrayContaining(['PRN dose', 'PRN indication']));

    const withDose = parseMedicineSourceV1([
      { id: 'p3', text: 'Medicine: Apomorphine' },
      { id: 'p4', text: 'Dosis: 2.5 mg PRN' },
    ]);
    expect(withDose.prnSuggestion?.value).toBe(true);
    expect(withDose.prnDoseSuggestion?.value).toBe(2.5);
    expect(withDose.indicationSuggestion).toBeUndefined();

    const inline = parseMedicineSourceV1([
      { id: 'p5', text: 'Paracetamol 500 mg bei Bedarf bei Schmerzen' },
    ]);
    expect(inline.nameSuggestion?.value).toBe('Paracetamol');
    expect(inline.strengthSuggestion?.value).toBe('500 mg');
    expect(inline.prnSuggestion?.value).toBe(true);
    expect(inline.indicationSuggestion?.value).toBe('bei Schmerzen');
    expect(inline.prnDoseSuggestion).toBeUndefined();
  });

  it('rejects ambiguous, denominator, malformed-time, and OCR-substitution doses', () => {
    for (const text of [
      'Dosis: 1.000 mg um 08:00',
      '08:00 — 5 mg/kg',
      '108:00 — 5 mg',
      'Dosis: O,5 mg um 08:00',
    ]) {
      const parsed = parseMedicineSourceV1([{ id: text, text }]);
      expect(parsed.explicitDoses, text).toBeUndefined();
    }
  });

  it('rejects a whole schedule line when any qualifier or unsupported residue remains', () => {
    for (const text of [
      'Nicht einnehmen: Dosis: 100 mg um 08:00',
      'Dosis: 100 mg um 08:00–10:00',
      'Dosis: 100 mg um 08:00 nur montags',
      'nicht 08:00 — 0,088 mg',
      'Montag 08:00 — 0,088 mg',
      '08:00 — 0,088 mg bei guter Verträglichkeit',
      '08:00 — 0,088 mg bis 0,18 mg',
      'Dosis: 1.000 mg um 08:00',
      '08:00 — 5 mg/kg',
      '108:00 — 5 mg',
    ]) {
      const parsed = parseMedicineSourceV1([{ id: text, text }]);
      expect(parsed.explicitDoses, text).toBeUndefined();
      expect(parsed.strengthSuggestion, text).toBeUndefined();
      expect(parsed.unresolved, text).toContain('unsupported or qualified dose direction');
    }
  });

  it('extracts multiple explicit administrations and rejects conflicting doses at one time', () => {
    const multiple = parseMedicineSourceV1([
      { id: 'm1', text: 'Pramipexol' },
      { id: 'm2', text: '08:00 — 0,088 mg; 20:00 — 0,18 mg' },
    ]);
    expect(multiple.explicitDoses?.value).toEqual([
      { time: '08:00', doseMg: 0.088 },
      { time: '20:00', doseMg: 0.18 },
    ]);

    const conflict = parseMedicineSourceV1([
      { id: 'c1', text: 'Pramipexol' },
      { id: 'c2', text: '08:00 — 0,088 mg' },
      { id: 'c3', text: '08:00 — 0,18 mg' },
    ]);
    expect(conflict.explicitDoses).toBeUndefined();
    expect(conflict.unresolved).toContain('conflicting doses at the same time');
  });

  it('does not promote combination strength or tablet grids into a prescribed dose', () => {
    const parsed = parseMedicineSourceV1([
      { id: 'c1', text: 'Madopar LT 100/25 mg' },
      { id: 'c2', text: '1-0-1' },
    ]);
    expect(parsed.nameSuggestion?.value).toBe('Madopar LT');
    expect(parsed.strengthSuggestion?.value).toBe('100/25 mg');
    expect(parsed.explicitDoses).toBeUndefined();
    expect(parsed.unresolved).toEqual(expect.arrayContaining(['prescribed dose', 'schedule']));
  });

  it('flags mixed schedule and PRN directions plus conflicting PRN values', () => {
    const mixed = parseMedicineSourceV1([
      { id: 'x1', text: 'Medicine: Levodopa' },
      { id: 'x2', text: '08:00 — 100 mg' },
      { id: 'x3', text: 'Dosis: 50 mg bei Bedarf' },
      { id: 'x4', text: 'Dosis: 75 mg PRN' },
      { id: 'x5', text: 'Indikation: OFF' },
      { id: 'x6', text: 'When: Bradykinesia' },
    ]);
    expect(mixed.unresolved).toEqual(expect.arrayContaining([
      'mixed scheduled and PRN directions',
      'conflicting PRN doses',
      'conflicting PRN indications',
    ]));
    expect(mixed.prnDoseSuggestion).toBeUndefined();
    expect(mixed.indicationSuggestion).toBeUndefined();
  });

  it('splits explicitly labeled streams but treats an unlabeled selection as one block', () => {
    expect(parseMedicineOcrLines([
      { id: 'a', text: 'Medicine: A' },
      { id: 'b', text: 'Dosis: 1 mg um 08:00' },
      { id: 'c', text: 'Medikament: B' },
      { id: 'd', text: 'Dosis: 2 mg um 09:00' },
    ]).candidates).toHaveLength(2);
    expect(parseMedicineOcrLines([
      { id: 'a', text: 'Pramipexol 0,088 mg 1-0-0' },
      { id: 'b', text: 'unparsed context' },
    ]).candidates).toHaveLength(1);
  });
});


describe('qualified PRN directions', () => {
  it('does not reduce a conditional alternative to one numeric PRN dose', () => {
    const result = parseMedicineSourceV1([
      { id: 'a', text: 'Levodopa' },
      { id: 'b', text: 'Dosis: 100 mg bei Bedarf bei Bradykinese oder 50 mg bei Schmerzen' },
    ]);
    expect(result.prnDoseSuggestion).toBeUndefined();
    expect(result.unresolved).toContain('unsupported or qualified PRN direction');
    expect(result.instructionsSuggestion.value).toContain('oder 50 mg');
  });
});
