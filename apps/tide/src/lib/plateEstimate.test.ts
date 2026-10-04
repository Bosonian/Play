import { describe, expect, it } from 'vitest';
import { compositionChips, estimatePlateKcal, formatPlateKcal, type PlateComposition } from './plateEstimate';

/** A "normal plate" baseline — every tier at PlateCheckIn's own default
 * ('some'), both toggles off — used as the starting point for the
 * monotonicity checks below, where only ONE field changes per test. */
function basePlate(overrides: Partial<PlateComposition> = {}): PlateComposition {
  return {
    kind: 'lunch',
    carbPortion: 'some',
    protein: 'some',
    veg: 'some',
    fried: false,
    sugary: false,
    ...overrides,
  };
}

describe('estimatePlateKcal — skipped meals', () => {
  it('returns null for a skipped meal, never 0 (TIDE_PLAN.md §2: never a 0-calorie win)', () => {
    const skipped: PlateComposition = {
      kind: 'skipped',
      carbPortion: 'none',
      protein: 'none',
      veg: 'none',
      fried: false,
      sugary: false,
    };
    expect(estimatePlateKcal(skipped)).toBeNull();
  });

  it('returns null for a skipped meal even if its tiers are non-empty (kind wins over tiers)', () => {
    // Not a real reachable state from PlateCheckIn.tsx (it always zeroes
    // the tiers for a skip), but the function itself should still treat
    // `kind: 'skipped'` as authoritative rather than trusting the tiers.
    const skipped: PlateComposition = {
      kind: 'skipped',
      carbPortion: 'lot',
      protein: 'lot',
      veg: 'lot',
      fried: true,
      sugary: true,
    };
    expect(estimatePlateKcal(skipped)).toBeNull();
  });
});

describe('estimatePlateKcal — each tier at none/some/lot', () => {
  it('an entirely empty plate (all none, no toggles) is 0 kcal, not null (a real, honestly-empty plate, not a skip)', () => {
    const empty = basePlate({ carbPortion: 'none', protein: 'none', veg: 'none' });
    expect(estimatePlateKcal(empty)).toBe(0);
  });

  it('carbs alone: none -> 0, some -> 200, lot -> 400', () => {
    const zeroOthers = { protein: 'none' as const, veg: 'none' as const };
    expect(estimatePlateKcal(basePlate({ ...zeroOthers, carbPortion: 'none' }))).toBe(0);
    expect(estimatePlateKcal(basePlate({ ...zeroOthers, carbPortion: 'some' }))).toBe(200);
    expect(estimatePlateKcal(basePlate({ ...zeroOthers, carbPortion: 'lot' }))).toBe(400);
  });

  it('protein alone: none -> 0, some -> 120 (rounds to 100 at nearest-50), lot -> 240 (rounds to 250)', () => {
    const zeroOthers = { carbPortion: 'none' as const, veg: 'none' as const };
    expect(estimatePlateKcal(basePlate({ ...zeroOthers, protein: 'none' }))).toBe(0);
    expect(estimatePlateKcal(basePlate({ ...zeroOthers, protein: 'some' }))).toBe(100);
    expect(estimatePlateKcal(basePlate({ ...zeroOthers, protein: 'lot' }))).toBe(250);
  });

  it('veg alone: none -> 0, some -> 80 (rounds to 100), lot -> 150', () => {
    const zeroOthers = { carbPortion: 'none' as const, protein: 'none' as const };
    expect(estimatePlateKcal(basePlate({ ...zeroOthers, veg: 'none' }))).toBe(0);
    expect(estimatePlateKcal(basePlate({ ...zeroOthers, veg: 'some' }))).toBe(100);
    expect(estimatePlateKcal(basePlate({ ...zeroOthers, veg: 'lot' }))).toBe(150);
  });
});

describe('estimatePlateKcal — fried/sugary adders', () => {
  it('fried adds 150 kcal before rounding', () => {
    const withoutFried = basePlate({ carbPortion: 'none', protein: 'none', veg: 'none', fried: false });
    const withFried = basePlate({ carbPortion: 'none', protein: 'none', veg: 'none', fried: true });
    expect(estimatePlateKcal(withoutFried)).toBe(0);
    expect(estimatePlateKcal(withFried)).toBe(150);
  });

  it('sugary adds 150 kcal before rounding', () => {
    const withoutSugary = basePlate({ carbPortion: 'none', protein: 'none', veg: 'none', sugary: false });
    const withSugary = basePlate({ carbPortion: 'none', protein: 'none', veg: 'none', sugary: true });
    expect(estimatePlateKcal(withoutSugary)).toBe(0);
    expect(estimatePlateKcal(withSugary)).toBe(150);
  });

  it('fried and sugary stack additively', () => {
    const both = basePlate({ carbPortion: 'none', protein: 'none', veg: 'none', fried: true, sugary: true });
    expect(estimatePlateKcal(both)).toBe(300);
  });
});

describe('estimatePlateKcal — rounding to nearest 50', () => {
  it('a full "some" plate rounds a 400 raw sum to 400 (already a multiple of 50)', () => {
    // some carb (200) + some protein (120) + some veg (80) = 400 raw, no
    // adders — already exactly on a 50 kcal boundary.
    const plate = basePlate();
    expect(estimatePlateKcal(plate)).toBe(400);
  });

  it('a full "lot" plate rounds 790 raw down to 800 (nearest-50, not truncation)', () => {
    // lot carb (400) + lot protein (240) + lot veg (150) = 790 raw ->
    // nearest 50 is 800, not 750 — confirms round-to-nearest, not
    // round-down/truncate.
    const plate = basePlate({ carbPortion: 'lot', protein: 'lot', veg: 'lot' });
    expect(estimatePlateKcal(plate)).toBe(800);
  });

  it('every returned non-null estimate is a multiple of 50', () => {
    const tiers = ['none', 'some', 'lot'] as const;
    for (const carbPortion of tiers) {
      for (const protein of tiers) {
        for (const veg of tiers) {
          for (const fried of [false, true]) {
            for (const sugary of [false, true]) {
              const kcal = estimatePlateKcal(basePlate({ carbPortion, protein, veg, fried, sugary }));
              expect(kcal).not.toBeNull();
              expect((kcal as number) % 50).toBe(0);
            }
          }
        }
      }
    }
  });
});

describe('estimatePlateKcal — monotonicity (adding food never lowers the estimate)', () => {
  it('raising any single tier from none -> some -> lot never decreases the total', () => {
    const fields = ['carbPortion', 'protein', 'veg'] as const;
    const tierOrder = ['none', 'some', 'lot'] as const;
    for (const field of fields) {
      let previous = estimatePlateKcal(basePlate({ [field]: 'none' } as Partial<PlateComposition>)) as number;
      for (const tier of tierOrder.slice(1)) {
        const current = estimatePlateKcal(basePlate({ [field]: tier } as Partial<PlateComposition>)) as number;
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    }
  });

  it('turning fried or sugary on never decreases the total, all else equal', () => {
    const base = basePlate();
    const withFried = estimatePlateKcal({ ...base, fried: true }) as number;
    const withSugary = estimatePlateKcal({ ...base, sugary: true }) as number;
    const baseline = estimatePlateKcal(base) as number;
    expect(withFried).toBeGreaterThanOrEqual(baseline);
    expect(withSugary).toBeGreaterThanOrEqual(baseline);
  });
});

describe('formatPlateKcal', () => {
  it('formats a number with the ASCII-tilde approximate prefix', () => {
    expect(formatPlateKcal(350)).toBe('~350 kcal');
  });

  it('formats 0 kcal (an honestly-empty plate) as "~0 kcal", not empty string', () => {
    // 0 is a real, non-null estimate (an empty-but-not-skipped plate) —
    // only `null` (skipped) should render as "". Distinguishing these two
    // is the whole reason estimatePlateKcal returns null for a skip rather
    // than 0.
    expect(formatPlateKcal(0)).toBe('~0 kcal');
  });

  it('formats null (skipped) as an empty string, never a fabricated "0 kcal"', () => {
    expect(formatPlateKcal(null)).toBe('');
  });
});

describe('compositionChips', () => {
  it('returns ["Skipped meal"] for a skipped meal, regardless of its tiers', () => {
    const skipped: PlateComposition = {
      kind: 'skipped',
      carbPortion: 'none',
      protein: 'none',
      veg: 'none',
      fried: false,
      sugary: false,
    };
    expect(compositionChips(skipped)).toEqual(['Skipped meal']);
  });

  it('omits none-tier components and lists the rest in Carbs/Protein/Veg/Fried/Sugary order', () => {
    const plate = basePlate({ carbPortion: 'some', protein: 'lot', veg: 'some', fried: true, sugary: false });
    expect(compositionChips(plate)).toEqual(['Carbs: some', 'Protein: lot', 'Veg: some', 'Fried']);
  });

  it('returns an empty list for an entirely empty, non-skipped plate', () => {
    const empty = basePlate({ carbPortion: 'none', protein: 'none', veg: 'none' });
    expect(compositionChips(empty)).toEqual([]);
  });

  it('includes Sugary without Fried when only sugary is set', () => {
    const plate = basePlate({ carbPortion: 'none', protein: 'none', veg: 'none', fried: false, sugary: true });
    expect(compositionChips(plate)).toEqual(['Sugary']);
  });
});
