import { describe, it, expect } from 'vitest';
import {
  slotForTime,
  gridToTimes,
  itemToGrid,
  applyPreset,
  sigLine,
  FREQUENCY_PRESETS,
  type GridState,
} from './grid';
import { sortDoseTimes, type RegimenItem } from './regimen';

describe('slotForTime', () => {
  it('boundaries: 04:00 and 10:59 are morgens', () => {
    expect(slotForTime('04:00')).toBe('morgens');
    expect(slotForTime('10:59')).toBe('morgens');
  });

  it('boundaries: 11:00 is mittags', () => {
    expect(slotForTime('11:00')).toBe('mittags');
  });

  it('boundaries: 20:59 is abends', () => {
    expect(slotForTime('20:59')).toBe('abends');
  });

  it('boundaries: 21:00 and 03:59 are nachts (wraps midnight)', () => {
    expect(slotForTime('21:00')).toBe('nachts');
    expect(slotForTime('03:59')).toBe('nachts');
  });

  it('midnight itself falls in the nachts wrap', () => {
    expect(slotForTime('00:00')).toBe('nachts');
    expect(slotForTime('23:59')).toBe('nachts');
  });
});

describe('gridToTimes', () => {
  it('skips qty===0 slots', () => {
    const grid: GridState = {
      strengthMg: null,
      slots: {
        morgens: { qty: 100, time: '08:00' },
        mittags: { qty: 0, time: '12:00' },
        abends: { qty: 0, time: '18:00' },
        nachts: { qty: 0, time: '22:00' },
      },
    };
    expect(gridToTimes(grid)).toEqual([{ time: '08:00', doseMg: 100 }]);
  });

  it('tablet mode: doseMg = qty × strengthMg, ½ × 125 = 62.5', () => {
    const grid: GridState = {
      strengthMg: 125,
      slots: {
        morgens: { qty: 0.5, time: '08:00' },
        mittags: { qty: 0, time: '12:00' },
        abends: { qty: 0, time: '18:00' },
        nachts: { qty: 0, time: '22:00' },
      },
    };
    expect(gridToTimes(grid)).toEqual([{ time: '08:00', doseMg: 62.5 }]);
  });

  it('mg mode: qty IS the mg value directly', () => {
    const grid: GridState = {
      strengthMg: null,
      slots: {
        morgens: { qty: 137, time: '08:00' },
        mittags: { qty: 0, time: '12:00' },
        abends: { qty: 0, time: '18:00' },
        nachts: { qty: 0, time: '22:00' },
      },
    };
    expect(gridToTimes(grid)).toEqual([{ time: '08:00', doseMg: 137 }]);
  });
});

describe('itemToGrid', () => {
  it('tablet-mode round-trip (1-1-½-0) at edited times', () => {
    const item: Pick<RegimenItem, 'times' | 'strengthMg'> = {
      times: [
        { time: '07:30', doseMg: 100 },
        { time: '13:00', doseMg: 100 },
        { time: '19:00', doseMg: 50 },
      ],
      strengthMg: 100,
    };
    const mapping = itemToGrid(item);
    expect(mapping.kind).toBe('grid');
    if (mapping.kind !== 'grid') throw new Error('expected grid mapping');
    expect(mapping.grid.strengthMg).toBe(100);
    expect(mapping.grid.slots.morgens).toEqual({ qty: 1, time: '07:30' });
    expect(mapping.grid.slots.mittags).toEqual({ qty: 1, time: '13:00' });
    expect(mapping.grid.slots.abends).toEqual({ qty: 0.5, time: '19:00' });
    expect(mapping.grid.slots.nachts).toEqual({ qty: 0, time: '22:00' });
    expect(gridToTimes(mapping.grid)).toEqual(item.times);
  });

  it('mg mode when strengthMg is absent', () => {
    const item: Pick<RegimenItem, 'times' | 'strengthMg'> = {
      times: [{ time: '08:00', doseMg: 137 }],
    };
    const mapping = itemToGrid(item);
    expect(mapping.kind).toBe('grid');
    if (mapping.kind !== 'grid') throw new Error('expected grid mapping');
    expect(mapping.grid.strengthMg).toBeNull();
    expect(mapping.grid.slots.morgens).toEqual({ qty: 137, time: '08:00' });
  });

  it('mg fallback: a strength that does not divide the dose into quarter-tablet multiples is discarded', () => {
    const item: Pick<RegimenItem, 'times' | 'strengthMg'> = {
      times: [{ time: '08:00', doseMg: 137 }],
      strengthMg: 100, // 137/100 = 1.37, not a quarter multiple
    };
    const mapping = itemToGrid(item);
    expect(mapping.kind).toBe('grid');
    if (mapping.kind !== 'grid') throw new Error('expected grid mapping');
    expect(mapping.grid.strengthMg).toBeNull();
    expect(mapping.grid.slots.morgens).toEqual({ qty: 137, time: '08:00' });
  });

  it('kind:"custom" when two doses land in the same BMP slot (e.g. a 6×/day regimen)', () => {
    const item: Pick<RegimenItem, 'times' | 'strengthMg'> = {
      times: [
        { time: '07:00', doseMg: 100 },
        { time: '10:00', doseMg: 100 },
      ],
    };
    expect(itemToGrid(item)).toEqual({ kind: 'custom' });
  });

  it('round-trip invariant holds across several items', () => {
    const cases: Array<Pick<RegimenItem, 'times' | 'strengthMg'>> = [
      { times: [{ time: '08:00', doseMg: 100 }] },
      {
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '18:00', doseMg: 50 },
        ],
        strengthMg: 50,
      },
      { times: [{ time: '12:00', doseMg: 25 }], strengthMg: 100 }, // ¼ tablet
      { times: [{ time: '22:00', doseMg: 8 }] }, // mg mode (patch-style, no strength)
    ];
    for (const item of cases) {
      const mapping = itemToGrid(item);
      expect(mapping.kind).toBe('grid');
      if (mapping.kind === 'grid') {
        expect(gridToTimes(mapping.grid)).toEqual(sortDoseTimes(item.times));
      }
    }
  });
});

describe('applyPreset', () => {
  it('sets qty=1 in the preset slots and 0 elsewhere, preserving each slot\'s time', () => {
    const grid: GridState = {
      strengthMg: 100,
      slots: {
        morgens: { qty: 2, time: '07:15' },
        mittags: { qty: 0, time: '12:00' },
        abends: { qty: 1, time: '18:30' },
        nachts: { qty: 0.5, time: '22:00' },
      },
    };
    const bid = FREQUENCY_PRESETS.find((p) => p.id === 'bid')!;
    const result = applyPreset(grid, bid);
    expect(result.slots.morgens).toEqual({ qty: 1, time: '07:15' });
    expect(result.slots.mittags).toEqual({ qty: 0, time: '12:00' });
    expect(result.slots.abends).toEqual({ qty: 1, time: '18:30' });
    expect(result.slots.nachts).toEqual({ qty: 0, time: '22:00' });
    expect(result.strengthMg).toBe(100);
  });
});

describe('sigLine', () => {
  it('grid-mappable tablet mode: "Levodopa 100 mg — 1-1-½-0 — 07:30 · 13:00 · 19:00"', () => {
    const item: Pick<RegimenItem, 'drug' | 'times' | 'strengthMg' | 'freeText'> = {
      drug: 'levodopa',
      times: [
        { time: '07:30', doseMg: 100 },
        { time: '13:00', doseMg: 100 },
        { time: '19:00', doseMg: 50 },
      ],
      strengthMg: 100,
    };
    expect(sigLine(item)).toBe('Levodopa 100 mg — 1-1-½-0 — 07:30 · 13:00 · 19:00');
  });

  it('mg mode (no strength, single time): "Levodopa — 08:00 137 mg"', () => {
    const item: Pick<RegimenItem, 'drug' | 'times' | 'strengthMg' | 'freeText'> = {
      drug: 'levodopa',
      times: [{ time: '08:00', doseMg: 137 }],
    };
    expect(sigLine(item)).toBe('Levodopa — 08:00 137 mg');
  });

  it('patch (rotigotine, one time): "Rotigotine 6 mg/24h — Patch, daily 08:00"', () => {
    const item: Pick<RegimenItem, 'drug' | 'times' | 'strengthMg' | 'freeText'> = {
      drug: 'rotigotine',
      times: [{ time: '08:00', doseMg: 6 }],
    };
    expect(sigLine(item)).toBe('Rotigotine 6 mg/24h — Patch, daily 08:00');
  });

  it('freeText: "Levodopa — Reduce by 50 mg weekly until off."', () => {
    const item: Pick<RegimenItem, 'drug' | 'times' | 'strengthMg' | 'freeText'> = {
      drug: 'levodopa',
      times: [],
      freeText: 'Reduce by 50 mg weekly until off.',
    };
    expect(sigLine(item)).toBe('Levodopa — Reduce by 50 mg weekly until off.');
  });

  it('uneven mg-mode list: "Levodopa — 08:00 100 mg · 12:00 100 mg · 18:00 50 mg"', () => {
    const item: Pick<RegimenItem, 'drug' | 'times' | 'strengthMg' | 'freeText'> = {
      drug: 'levodopa',
      times: [
        { time: '08:00', doseMg: 100 },
        { time: '12:00', doseMg: 100 },
        { time: '18:00', doseMg: 50 },
      ],
    };
    expect(sigLine(item)).toBe('Levodopa — 08:00 100 mg · 12:00 100 mg · 18:00 50 mg');
  });
});
