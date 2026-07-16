import { describe, it, expect } from 'vitest';
import {
  isValidTime,
  sortDoseTimes,
  validateRegimenItem,
  dailyMg,
  regimenDailyDoses,
  sortRegimenItems,
  regimenWarnings,
  type RegimenItem,
  type DoseTime,
} from './regimen';
import { computeLedd } from './ledd';

let seq = 0;
function item(overrides: Partial<RegimenItem> & Pick<RegimenItem, 'drug' | 'times'>): RegimenItem {
  return {
    id: `item-${++seq}`,
    patient: 'P-01',
    updatedAt: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

// Shorthand for the common case of "the same doseMg at every time" — most
// fixtures below don't care about unevenness, so this keeps them readable.
function times(doseMg: number, ...clockTimes: string[]): DoseTime[] {
  return clockTimes.map((time) => ({ time, doseMg }));
}

describe('isValidTime', () => {
  it('accepts well-formed 24h times', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('08:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
  });

  it('rejects malformed or out-of-range times', () => {
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('8:00')).toBe(false);
    expect(isValidTime('08:60')).toBe(false);
    expect(isValidTime('0800')).toBe(false);
    expect(isValidTime('')).toBe(false);
  });
});

describe('sortDoseTimes', () => {
  it('sorts chronologically by .time without mutating the input', () => {
    const input = times(100, '20:00', '08:00', '12:00');
    const sorted = sortDoseTimes(input);
    expect(sorted.map((t) => t.time)).toEqual(['08:00', '12:00', '20:00']);
    expect(input.map((t) => t.time)).toEqual(['20:00', '08:00', '12:00']);
  });
});

describe('validateRegimenItem', () => {
  it('valid item -> []', () => {
    expect(validateRegimenItem({ times: times(100, '08:00', '12:00') })).toEqual([]);
  });

  it('dose 0 at a time -> dose error', () => {
    expect(validateRegimenItem({ times: [{ time: '08:00', doseMg: 0 }] })).toEqual([
      'Enter a dose greater than 0 for each time.',
    ]);
  });

  it('negative dose at a time -> dose error', () => {
    expect(validateRegimenItem({ times: [{ time: '08:00', doseMg: -5 }] })).toEqual([
      'Enter a dose greater than 0 for each time.',
    ]);
  });

  it('NaN/Infinity dose -> dose error', () => {
    expect(validateRegimenItem({ times: [{ time: '08:00', doseMg: NaN }] })).toEqual([
      'Enter a dose greater than 0 for each time.',
    ]);
    expect(validateRegimenItem({ times: [{ time: '08:00', doseMg: Infinity }] })).toEqual([
      'Enter a dose greater than 0 for each time.',
    ]);
  });

  it('no times, no freeText -> ["Add at least one dose."]', () => {
    expect(validateRegimenItem({ times: [] })).toEqual(['Add at least one dose.']);
  });

  it('malformed time -> ["Enter each time as HH:MM."]', () => {
    expect(validateRegimenItem({ times: [{ time: '8:00', doseMg: 100 }] })).toEqual([
      'Enter each time as HH:MM.',
    ]);
  });

  it('duplicate times -> ["Times must be unique."]', () => {
    expect(validateRegimenItem({ times: times(100, '08:00', '08:00') })).toEqual([
      'Times must be unique.',
    ]);
  });

  it('freeText with times populated -> mutual-exclusion error, no further times checks', () => {
    expect(
      validateRegimenItem({ times: [{ time: '8:00', doseMg: 0 }], freeText: 'Irregular taper.' }),
    ).toEqual(['Use either the schedule grid or free text, not both.']);
  });

  it('freeText with empty times -> valid', () => {
    expect(validateRegimenItem({ times: [], freeText: 'Irregular taper per follow-up.' })).toEqual([]);
  });

  it('blank/whitespace-only freeText is treated as absent (empty times -> dose error, not valid)', () => {
    expect(validateRegimenItem({ times: [], freeText: '   ' })).toEqual(['Add at least one dose.']);
  });

  it('strengthMg 0/negative/non-finite -> strength error, independent of times validity', () => {
    expect(validateRegimenItem({ times: times(100, '08:00'), strengthMg: 0 })).toEqual([
      'Enter a strength greater than 0.',
    ]);
    expect(validateRegimenItem({ times: times(100, '08:00'), strengthMg: -1 })).toEqual([
      'Enter a strength greater than 0.',
    ]);
    expect(validateRegimenItem({ times: times(100, '08:00'), strengthMg: NaN })).toEqual([
      'Enter a strength greater than 0.',
    ]);
  });

  it('valid strengthMg alongside valid times -> []', () => {
    expect(validateRegimenItem({ times: times(100, '08:00'), strengthMg: 100 })).toEqual([]);
  });
});

describe('regimenDailyDoses', () => {
  it('one item, 4 times -> 4 entries of {drug, doseMg}', () => {
    const items = [item({ drug: 'levodopa', times: times(100, '08:00', '12:00', '16:00', '20:00') })];
    expect(regimenDailyDoses(items)).toEqual([
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 100 },
    ]);
  });

  it('multiple items concatenate; empty regimen -> []', () => {
    const items = [
      item({ drug: 'levodopa', times: times(100, '08:00', '12:00') }),
      item({ drug: 'opicapone', times: times(50, '22:00') }),
    ];
    expect(regimenDailyDoses(items)).toEqual([
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'opicapone', doseMg: 50 },
    ]);
    expect(regimenDailyDoses([])).toEqual([]);
  });

  it('uneven single item (100/100/50) -> per-time entries, not per-item', () => {
    const items = [
      item({
        drug: 'levodopa',
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '12:00', doseMg: 100 },
          { time: '18:00', doseMg: 50 },
        ],
      }),
    ];
    expect(regimenDailyDoses(items)).toEqual([
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 50 },
    ]);
  });

  it('freeText-only item -> []', () => {
    const items = [item({ drug: 'levodopa', times: [], freeText: 'Irregular taper.' })];
    expect(regimenDailyDoses(items)).toEqual([]);
  });
});

describe('dailyMg', () => {
  it('sum of times[].doseMg (even regimen)', () => {
    expect(dailyMg({ times: times(100, '08:00', '12:00', '16:00') })).toBe(300);
  });

  it('sum of times[].doseMg (uneven regimen: 100+100+50)', () => {
    expect(
      dailyMg({
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '12:00', doseMg: 100 },
          { time: '18:00', doseMg: 50 },
        ],
      }),
    ).toBe(250);
  });

  it('freeText-only item -> 0', () => {
    expect(dailyMg({ times: [] })).toBe(0);
  });
});

describe('regimen -> LEDD', () => {
  it('levodopa 100mg x 4 times -> totalMg 400', () => {
    const items = [item({ drug: 'levodopa', times: times(100, '08:00', '12:00', '16:00', '20:00') })];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.totalMg).toBe(400);
  });

  it('+ opicapone 50mg x 1 time -> 600', () => {
    const items = [
      item({ drug: 'levodopa', times: times(100, '08:00', '12:00', '16:00', '20:00') }),
      item({ drug: 'opicapone', times: times(50, '22:00') }),
    ];
    const result = computeLedd(regimenDailyDoses(items));
    // levodopa base 400 + opicapone fraction 0.5 * 400 = 200 -> 600
    expect(result.totalMg).toBe(600);
  });

  it('safinamide 50mg x two times -> fixed 100 once', () => {
    const items = [item({ drug: 'safinamide', times: times(50, '08:00', '20:00') })];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.byDrug.safinamide).toBe(100);
    expect(result.totalMg).toBe(100);
  });

  it('rotigotine 8mg x one time -> 240 (per-mg x30)', () => {
    const items = [item({ drug: 'rotigotine', times: times(8, '08:00') })];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.byDrug.rotigotine).toBe(240);
    expect(result.totalMg).toBe(240);
  });

  it('baclofen 25mg x three times -> contributes 0; byDrug.baclofen === 0', () => {
    const items = [item({ drug: 'baclofen', times: times(25, '08:00', '14:00', '20:00') })];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.byDrug.baclofen).toBe(0);
    expect(result.totalMg).toBe(0);
  });

  it('uneven levodopa (100/100/50 = 250mg base) -> totalMg 250', () => {
    const items = [
      item({
        drug: 'levodopa',
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '12:00', doseMg: 100 },
          { time: '18:00', doseMg: 50 },
        ],
      }),
    ];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.totalMg).toBe(250);
  });

  it('freeText-only item -> totalMg 0 (excluded from LEDD)', () => {
    const items = [item({ drug: 'levodopa', times: [], freeText: 'Irregular taper.' })];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.totalMg).toBe(0);
  });
});

describe('regimenWarnings', () => {
  it('entacapone + opicapone -> exactly the COMT string; clean regimen -> []', () => {
    const conflicting = [
      item({ drug: 'entacapone', times: times(200, '08:00') }),
      item({ drug: 'opicapone', times: times(50, '22:00') }),
    ];
    expect(regimenWarnings(conflicting)).toEqual([
      'Entacapone and opicapone are both in the regimen. Two COMT inhibitors are not combined in standard practice.',
    ]);

    const clean = [item({ drug: 'levodopa', times: times(100, '08:00') })];
    expect(regimenWarnings(clean)).toEqual([]);
  });

  it('rotigotine with 2 times -> once-daily string with n=2', () => {
    const items = [item({ drug: 'rotigotine', times: times(8, '08:00', '20:00') })];
    expect(regimenWarnings(items)).toEqual([
      'Rotigotine is a once-daily drug; the regimen lists 2 times.',
    ]);
  });

  it('freeText item -> exact free-text-schedule string', () => {
    const items = [item({ drug: 'levodopa', times: [], freeText: 'Taper per follow-up.' })];
    expect(regimenWarnings(items)).toEqual([
      "Levodopa has a free-text schedule; it is not included in the LEDD total or the patient's dose list.",
    ]);
  });
});

describe('sortRegimenItems', () => {
  it('orders by first time, tie-breaks by generic; input not mutated', () => {
    const items = [
      item({ drug: 'opicapone', times: times(50, '22:00') }),
      item({ drug: 'rotigotine', times: times(8, '08:00') }),
      item({ drug: 'levodopa', times: times(100, '08:00') }),
    ];
    const sorted = sortRegimenItems(items);
    expect(sorted.map((i) => i.drug)).toEqual(['levodopa', 'rotigotine', 'opicapone']);
    // input order unchanged
    expect(items.map((i) => i.drug)).toEqual(['opicapone', 'rotigotine', 'levodopa']);
  });

  it('a freeText-only (timeless) item sorts LAST regardless of drug', () => {
    const items = [
      item({ drug: 'baclofen', times: [], freeText: 'Irregular taper.' }),
      item({ drug: 'opicapone', times: times(50, '22:00') }),
      item({ drug: 'levodopa', times: times(100, '08:00') }),
    ];
    const sorted = sortRegimenItems(items);
    expect(sorted.map((i) => i.drug)).toEqual(['levodopa', 'opicapone', 'baclofen']);
  });
});
