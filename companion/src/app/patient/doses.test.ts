// Pure-helper tests — plain node, NO fake-indexeddb import. doses.ts imports
// only from src/domain/*, ../lib/uuid (SPEC RISK #5), so nothing here should
// ever need a Dexie/IndexedDB shim.
import { describe, it, expect } from 'vitest';
import { expandSchedule, markTakenSlots, buildDoseEvent, extraDoseChoices, doseLabel, takenVerb } from './doses';
import type { RegimenItem } from '../../domain/regimen';
import type { DoseEvent, MotorEvent, PatientEvent } from '../../domain/types';

function item(overrides: Partial<RegimenItem> = {}): RegimenItem {
  return {
    id: 'item-1',
    patient: 'local-1',
    drug: 'levodopa',
    doseMg: 100,
    times: ['08:00'],
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

function doseEvent(overrides: Partial<DoseEvent> = {}): DoseEvent {
  return {
    id: 'ev-1',
    patient: 'local-1',
    at: '2026-07-16T08:12:00.000Z',
    kind: 'dose',
    drug: 'levodopa',
    doseMg: 100,
    source: 'self',
    ...overrides,
  };
}

describe('expandSchedule', () => {
  it('one item, three times → three slots sorted ascending, each carrying itemId/drug/doseMg', () => {
    const items = [item({ times: ['12:00', '08:00', '20:00'] })];
    const slots = expandSchedule(items);
    expect(slots.map((s) => s.time)).toEqual(['08:00', '12:00', '20:00']);
    for (const s of slots) {
      expect(s.itemId).toBe('item-1');
      expect(s.drug).toBe('levodopa');
      expect(s.doseMg).toBe(100);
    }
  });

  it('two items interleave by time; equal times tie-break by generic name', () => {
    const items = [
      item({ id: 'a', drug: 'rotigotine', doseMg: 4, times: ['08:00'] }),
      item({ id: 'b', drug: 'levodopa', doseMg: 100, times: ['08:00', '14:00'] }),
    ];
    const slots = expandSchedule(items);
    // Both 08:00 — "Levodopa" < "Rotigotine" alphabetically, so levodopa's
    // 08:00 slot comes first.
    expect(slots.map((s) => `${s.time}:${s.drug}`)).toEqual(['08:00:levodopa', '08:00:rotigotine', '14:00:levodopa']);
  });

  it('[] → []', () => {
    expect(expandSchedule([])).toEqual([]);
  });

  it('uneven regimen (same drug, two items, different doseMg) → distinct slots with own doseMg', () => {
    const items = [
      item({ id: 'a', doseMg: 100, times: ['08:00'] }),
      item({ id: 'b', doseMg: 50, times: ['20:00'] }),
    ];
    const slots = expandSchedule(items);
    expect(slots).toEqual([
      { itemId: 'a', drug: 'levodopa', doseMg: 100, time: '08:00' },
      { itemId: 'b', drug: 'levodopa', doseMg: 50, time: '20:00' },
    ]);
  });
});

describe('buildDoseEvent', () => {
  it('sets id/patient/at/kind/drug/doseMg/source/scheduledTime', () => {
    const ev = buildDoseEvent('local-1', 'levodopa', 100, '2026-07-16T08:12:00.000Z', '08:00', 'fixed-id');
    expect(ev.id).toBe('fixed-id');
    expect(ev.patient).toBe('local-1');
    expect(ev.at).toBe('2026-07-16T08:12:00.000Z');
    expect(ev.kind).toBe('dose');
    expect(ev.drug).toBe('levodopa');
    expect(ev.doseMg).toBe(100);
    expect(ev.source).toBe('self');
    expect(ev.scheduledTime).toBe('08:00');
  });

  it('omits scheduledTime when not given; defaults a non-empty id', () => {
    const ev = buildDoseEvent('local-1', 'levodopa', 100, '2026-07-16T08:12:00.000Z');
    expect(ev.scheduledTime).toBeUndefined();
    expect('scheduledTime' in ev).toBe(false);
    expect(ev.id.length).toBeGreaterThan(0);
  });
});

describe('markTakenSlots', () => {
  it('no events → every slot takenAt null', () => {
    const slots = expandSchedule([item({ times: ['08:00', '14:00'] })]);
    const statuses = markTakenSlots(slots, []);
    expect(statuses.every((s) => s.takenAt === null)).toBe(true);
  });

  it('matching event (drug + scheduledTime) ticks its slot with the actual at', () => {
    const slots = expandSchedule([item({ times: ['08:00'] })]);
    const ev = doseEvent({ at: '2026-07-16T08:12:00.000Z', scheduledTime: '08:00' });
    const [status] = markTakenSlots(slots, [ev]);
    expect(status.takenAt).toBe('2026-07-16T08:12:00.000Z');
    // at (actual) is preserved and differs from the scheduled clock time.
    expect(status.takenAt).not.toBe('2026-07-16T08:00:00.000Z');
  });

  it('doseMg mismatch still ticks (strength edited midday — dose NOT in key)', () => {
    const slots = expandSchedule([item({ times: ['08:00'], doseMg: 150 })]);
    const ev = doseEvent({ doseMg: 100, scheduledTime: '08:00' });
    const [status] = markTakenSlots(slots, [ev]);
    expect(status.takenAt).toBe(ev.at);
  });

  it('extra dose (no scheduledTime) ticks nothing', () => {
    const slots = expandSchedule([item({ times: ['08:00'] })]);
    const ev = doseEvent({ scheduledTime: undefined });
    const statuses = markTakenSlots(slots, [ev]);
    expect(statuses[0].takenAt).toBeNull();
  });

  it('same drug, two nearby slots — one event ticks only its slot; other stays pending', () => {
    const slots = expandSchedule([item({ times: ['08:00', '10:00'] })]);
    const ev = doseEvent({ scheduledTime: '08:00' });
    const statuses = markTakenSlots(slots, [ev]);
    expect(statuses[0].takenAt).toBe(ev.at);
    expect(statuses[1].takenAt).toBeNull();
  });

  it('two events matching one slot → earliest at wins', () => {
    const slots = expandSchedule([item({ times: ['08:00'] })]);
    const later = doseEvent({ id: 'ev-later', at: '2026-07-16T08:30:00.000Z', scheduledTime: '08:00' });
    const earlier = doseEvent({ id: 'ev-earlier', at: '2026-07-16T08:05:00.000Z', scheduledTime: '08:00' });
    const statuses = markTakenSlots(slots, [later, earlier]);
    expect(statuses[0].takenAt).toBe('2026-07-16T08:05:00.000Z');
  });

  it('motor/meal events ignored', () => {
    const slots = expandSchedule([item({ times: ['08:00'] })]);
    const motor: MotorEvent = {
      id: 'm1',
      patient: 'local-1',
      at: '2026-07-16T08:00:00.000Z',
      kind: 'motor',
      state: 'on',
      source: 'self',
    };
    const events: PatientEvent[] = [motor];
    const statuses = markTakenSlots(slots, events);
    expect(statuses[0].takenAt).toBeNull();
  });
});

describe('extraDoseChoices', () => {
  it('dedupes identical (drug, doseMg) across items; preserves schedule order; keeps distinct doseMg separate', () => {
    const items = [
      item({ id: 'a', drug: 'levodopa', doseMg: 100, times: ['08:00', '14:00'] }),
      item({ id: 'b', drug: 'levodopa', doseMg: 50, times: ['20:00'] }),
      item({ id: 'c', drug: 'rotigotine', doseMg: 4, times: ['08:00'] }),
    ];
    const choices = extraDoseChoices(items);
    expect(choices).toEqual([
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'rotigotine', doseMg: 4 },
      { drug: 'levodopa', doseMg: 50 },
    ]);
  });
});

describe('doseLabel + takenVerb', () => {
  it('formats "Levodopa 100 mg"', () => {
    expect(doseLabel('levodopa', 100)).toBe('Levodopa 100 mg');
  });

  it('rotigotine → "Rotigotine 4 mg" and takenVerb "Applied"', () => {
    expect(doseLabel('rotigotine', 4)).toBe('Rotigotine 4 mg');
    expect(takenVerb('rotigotine')).toBe('Applied');
  });

  it('levodopa → takenVerb "Taken"', () => {
    expect(takenVerb('levodopa')).toBe('Taken');
  });
});
