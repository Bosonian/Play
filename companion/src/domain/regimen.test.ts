import { describe, it, expect } from 'vitest';
import {
  isValidTime,
  sortTimes,
  validateRegimenItem,
  dailyMg,
  regimenDailyDoses,
  sortRegimenItems,
  regimenWarnings,
  type RegimenItem,
} from './regimen';
import { computeLedd } from './ledd';

let seq = 0;
function item(overrides: Partial<RegimenItem> & Pick<RegimenItem, 'drug' | 'doseMg' | 'times'>): RegimenItem {
  return {
    id: `item-${++seq}`,
    patient: 'P-01',
    updatedAt: '2026-07-16T00:00:00Z',
    ...overrides,
  };
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

describe('sortTimes', () => {
  it('sorts chronologically without mutating the input', () => {
    const input = ['20:00', '08:00', '12:00'];
    const sorted = sortTimes(input);
    expect(sorted).toEqual(['08:00', '12:00', '20:00']);
    expect(input).toEqual(['20:00', '08:00', '12:00']);
  });
});

describe('validateRegimenItem', () => {
  it('valid item -> []', () => {
    expect(validateRegimenItem({ doseMg: 100, times: ['08:00', '12:00'] })).toEqual([]);
  });

  it('doseMg 0 -> dose error', () => {
    expect(validateRegimenItem({ doseMg: 0, times: ['08:00'] })).toEqual([
      'Enter a dose greater than 0.',
    ]);
  });

  it('negative doseMg -> dose error', () => {
    expect(validateRegimenItem({ doseMg: -5, times: ['08:00'] })).toEqual([
      'Enter a dose greater than 0.',
    ]);
  });

  it('NaN/Infinity doseMg -> dose error', () => {
    expect(validateRegimenItem({ doseMg: NaN, times: ['08:00'] })).toEqual([
      'Enter a dose greater than 0.',
    ]);
    expect(validateRegimenItem({ doseMg: Infinity, times: ['08:00'] })).toEqual([
      'Enter a dose greater than 0.',
    ]);
  });

  it('no times -> ["Add at least one time."]', () => {
    expect(validateRegimenItem({ doseMg: 100, times: [] })).toEqual(['Add at least one time.']);
  });

  it('malformed time -> ["Enter each time as HH:MM."]', () => {
    expect(validateRegimenItem({ doseMg: 100, times: ['8:00'] })).toEqual([
      'Enter each time as HH:MM.',
    ]);
  });

  it('duplicate times -> ["Times must be unique."]', () => {
    expect(validateRegimenItem({ doseMg: 100, times: ['08:00', '08:00'] })).toEqual([
      'Times must be unique.',
    ]);
  });
});

describe('regimenDailyDoses', () => {
  it('one item, 4 times -> 4 entries of {drug, doseMg}', () => {
    const items = [item({ drug: 'levodopa', doseMg: 100, times: ['08:00', '12:00', '16:00', '20:00'] })];
    expect(regimenDailyDoses(items)).toEqual([
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 100 },
    ]);
  });

  it('multiple items concatenate; empty regimen -> []', () => {
    const items = [
      item({ drug: 'levodopa', doseMg: 100, times: ['08:00', '12:00'] }),
      item({ drug: 'opicapone', doseMg: 50, times: ['22:00'] }),
    ];
    expect(regimenDailyDoses(items)).toEqual([
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'opicapone', doseMg: 50 },
    ]);
    expect(regimenDailyDoses([])).toEqual([]);
  });
});

describe('dailyMg', () => {
  it('doseMg * times.length', () => {
    expect(dailyMg({ doseMg: 100, times: ['08:00', '12:00', '16:00'] })).toBe(300);
  });
});

describe('regimen -> LEDD', () => {
  it('levodopa 100mg x 4 times -> totalMg 400', () => {
    const items = [item({ drug: 'levodopa', doseMg: 100, times: ['08:00', '12:00', '16:00', '20:00'] })];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.totalMg).toBe(400);
  });

  it('+ opicapone 50mg x 1 time -> 600', () => {
    const items = [
      item({ drug: 'levodopa', doseMg: 100, times: ['08:00', '12:00', '16:00', '20:00'] }),
      item({ drug: 'opicapone', doseMg: 50, times: ['22:00'] }),
    ];
    const result = computeLedd(regimenDailyDoses(items));
    // levodopa base 400 + opicapone fraction 0.5 * 400 = 200 -> 600
    expect(result.totalMg).toBe(600);
  });

  it('safinamide 50mg x two times -> fixed 100 once', () => {
    const items = [item({ drug: 'safinamide', doseMg: 50, times: ['08:00', '20:00'] })];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.byDrug.safinamide).toBe(100);
    expect(result.totalMg).toBe(100);
  });

  it('rotigotine 8mg x one time -> 240 (per-mg x30)', () => {
    const items = [item({ drug: 'rotigotine', doseMg: 8, times: ['08:00'] })];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.byDrug.rotigotine).toBe(240);
    expect(result.totalMg).toBe(240);
  });

  it('baclofen 25mg x three times -> contributes 0; byDrug.baclofen === 0', () => {
    const items = [item({ drug: 'baclofen', doseMg: 25, times: ['08:00', '14:00', '20:00'] })];
    const result = computeLedd(regimenDailyDoses(items));
    expect(result.byDrug.baclofen).toBe(0);
    expect(result.totalMg).toBe(0);
  });
});

describe('regimenWarnings', () => {
  it('entacapone + opicapone -> exactly the COMT string; clean regimen -> []', () => {
    const conflicting = [
      item({ drug: 'entacapone', doseMg: 200, times: ['08:00'] }),
      item({ drug: 'opicapone', doseMg: 50, times: ['22:00'] }),
    ];
    expect(regimenWarnings(conflicting)).toEqual([
      'Entacapone and opicapone are both in the regimen. Two COMT inhibitors are not combined in standard practice.',
    ]);

    const clean = [item({ drug: 'levodopa', doseMg: 100, times: ['08:00'] })];
    expect(regimenWarnings(clean)).toEqual([]);
  });

  it('rotigotine with 2 times -> once-daily string with n=2', () => {
    const items = [item({ drug: 'rotigotine', doseMg: 8, times: ['08:00', '20:00'] })];
    expect(regimenWarnings(items)).toEqual([
      'Rotigotine is a once-daily drug; the regimen lists 2 times.',
    ]);
  });
});

describe('sortRegimenItems', () => {
  it('orders by first time, tie-breaks by generic; input not mutated', () => {
    const items = [
      item({ drug: 'opicapone', doseMg: 50, times: ['22:00'] }),
      item({ drug: 'rotigotine', doseMg: 8, times: ['08:00'] }),
      item({ drug: 'levodopa', doseMg: 100, times: ['08:00'] }),
    ];
    const sorted = sortRegimenItems(items);
    expect(sorted.map((i) => i.drug)).toEqual(['levodopa', 'rotigotine', 'opicapone']);
    // input order unchanged
    expect(items.map((i) => i.drug)).toEqual(['opicapone', 'rotigotine', 'levodopa']);
  });
});
