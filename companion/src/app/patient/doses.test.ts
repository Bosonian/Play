// Pure-helper tests — plain node, NO fake-indexeddb import. doses.ts imports
// only from src/domain/*, ../lib/uuid (SPEC RISK #5), so nothing here should
// ever need a Dexie/IndexedDB shim.
import { describe, it, expect } from 'vitest';
import {
  expandSchedule,
  markTakenSlots,
  buildDoseEvent,
  extraDoseChoices,
  doseLabel,
  takenVerb,
  groupSlotsByDaypart,
  type SlotStatus,
} from './doses';
import type { RegimenItem } from '../../domain/regimen';
import type { DoseEvent, MotorEvent, PatientEvent } from '../../domain/types';

function item(overrides: Partial<RegimenItem> = {}): RegimenItem {
  return {
    id: 'item-1',
    patient: 'local-1',
    drug: 'levodopa',
    times: [{ time: '08:00', doseMg: 100 }],
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
    const items = [
      item({
        times: [
          { time: '12:00', doseMg: 100 },
          { time: '08:00', doseMg: 100 },
          { time: '20:00', doseMg: 100 },
        ],
      }),
    ];
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
      item({ id: 'a', drug: 'rotigotine', times: [{ time: '08:00', doseMg: 4 }] }),
      item({
        id: 'b',
        drug: 'levodopa',
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '14:00', doseMg: 100 },
        ],
      }),
    ];
    const slots = expandSchedule(items);
    // Both 08:00 — "Levodopa" < "Rotigotine" alphabetically, so levodopa's
    // 08:00 slot comes first.
    expect(slots.map((s) => `${s.time}:${s.drug}`)).toEqual(['08:00:levodopa', '08:00:rotigotine', '14:00:levodopa']);
  });

  it('[] → []', () => {
    expect(expandSchedule([])).toEqual([]);
  });

  it('uneven regimen across two items (same drug, different doseMg) → distinct slots with own doseMg', () => {
    const items = [
      item({ id: 'a', times: [{ time: '08:00', doseMg: 100 }] }),
      item({ id: 'b', times: [{ time: '20:00', doseMg: 50 }] }),
    ];
    const slots = expandSchedule(items);
    expect(slots).toEqual([
      { itemId: 'a', drug: 'levodopa', doseMg: 100, time: '08:00' },
      { itemId: 'b', drug: 'levodopa', doseMg: 50, time: '20:00' },
    ]);
  });

  it('uneven regimen within a SINGLE item (dose-per-time) → three slots, each carrying its own doseMg', () => {
    const items = [
      item({
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '12:00', doseMg: 100 },
          { time: '18:00', doseMg: 50 },
        ],
      }),
    ];
    const slots = expandSchedule(items);
    expect(slots).toEqual([
      { itemId: 'item-1', drug: 'levodopa', doseMg: 100, time: '08:00' },
      { itemId: 'item-1', drug: 'levodopa', doseMg: 100, time: '12:00' },
      { itemId: 'item-1', drug: 'levodopa', doseMg: 50, time: '18:00' },
    ]);
  });

  it('freeText-only item (no times) → yields no slots', () => {
    const items = [item({ times: [], freeText: 'Irregular taper per neurology follow-up.' })];
    expect(expandSchedule(items)).toEqual([]);
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
    const slots = expandSchedule([
      item({
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '14:00', doseMg: 100 },
        ],
      }),
    ]);
    const statuses = markTakenSlots(slots, []);
    expect(statuses.every((s) => s.takenAt === null)).toBe(true);
    expect(statuses.every((s) => s.eventId === null)).toBe(true);
  });

  it('matching event (drug + scheduledTime) ticks its slot with the actual at and the event id', () => {
    const slots = expandSchedule([item({ times: [{ time: '08:00', doseMg: 100 }] })]);
    const ev = doseEvent({ id: 'ev-morning', at: '2026-07-16T08:12:00.000Z', scheduledTime: '08:00' });
    const [status] = markTakenSlots(slots, [ev]);
    expect(status.takenAt).toBe('2026-07-16T08:12:00.000Z');
    // at (actual) is preserved and differs from the scheduled clock time.
    expect(status.takenAt).not.toBe('2026-07-16T08:00:00.000Z');
    expect(status.eventId).toBe('ev-morning');
  });

  it('doseMg mismatch still ticks (strength edited midday — dose NOT in key)', () => {
    const slots = expandSchedule([item({ times: [{ time: '08:00', doseMg: 150 }] })]);
    const ev = doseEvent({ id: 'ev-mismatch', doseMg: 100, scheduledTime: '08:00' });
    const [status] = markTakenSlots(slots, [ev]);
    expect(status.takenAt).toBe(ev.at);
    expect(status.eventId).toBe('ev-mismatch');
  });

  it('extra dose (no scheduledTime) ticks nothing', () => {
    const slots = expandSchedule([item({ times: [{ time: '08:00', doseMg: 100 }] })]);
    const ev = doseEvent({ scheduledTime: undefined });
    const statuses = markTakenSlots(slots, [ev]);
    expect(statuses[0].takenAt).toBeNull();
    expect(statuses[0].eventId).toBeNull();
  });

  it('same drug, two nearby slots — one event ticks only its slot; other stays pending', () => {
    const slots = expandSchedule([
      item({
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '10:00', doseMg: 100 },
        ],
      }),
    ]);
    const ev = doseEvent({ id: 'ev-eight', scheduledTime: '08:00' });
    const statuses = markTakenSlots(slots, [ev]);
    expect(statuses[0].takenAt).toBe(ev.at);
    expect(statuses[0].eventId).toBe('ev-eight');
    expect(statuses[1].takenAt).toBeNull();
    expect(statuses[1].eventId).toBeNull();
  });

  it('two events matching one slot → earliest wins (both at and eventId)', () => {
    const slots = expandSchedule([item({ times: [{ time: '08:00', doseMg: 100 }] })]);
    const later = doseEvent({ id: 'ev-later', at: '2026-07-16T08:30:00.000Z', scheduledTime: '08:00' });
    const earlier = doseEvent({ id: 'ev-earlier', at: '2026-07-16T08:05:00.000Z', scheduledTime: '08:00' });
    const statuses = markTakenSlots(slots, [later, earlier]);
    expect(statuses[0].takenAt).toBe('2026-07-16T08:05:00.000Z');
    expect(statuses[0].eventId).toBe('ev-earlier');
  });

  it('motor/meal events ignored', () => {
    const slots = expandSchedule([item({ times: [{ time: '08:00', doseMg: 100 }] })]);
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
    expect(statuses[0].eventId).toBeNull();
  });

  it('uneven single-item regimen: an event scheduled for 18:00 ticks the 50mg slot specifically', () => {
    const slots = expandSchedule([
      item({
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '12:00', doseMg: 100 },
          { time: '18:00', doseMg: 50 },
        ],
      }),
    ]);
    const ev = doseEvent({ id: 'ev-evening', doseMg: 50, scheduledTime: '18:00' });
    const statuses = markTakenSlots(slots, [ev]);
    const evening = statuses.find((s) => s.slot.time === '18:00')!;
    expect(evening.slot.doseMg).toBe(50);
    expect(evening.takenAt).toBe(ev.at);
    expect(evening.eventId).toBe('ev-evening');
    // The two 100mg slots stay pending — the event only ticks its own time.
    expect(statuses.filter((s) => s.slot.time !== '18:00').every((s) => s.takenAt === null && s.eventId === null)).toBe(
      true,
    );
  });
});

describe('groupSlotsByDaypart', () => {
  // Minimal SlotStatus fixture — most cases only care about slot.time for
  // grouping/ordering; takenAt/eventId pass through untouched so a separate
  // case (below) checks they survive the regrouping rather than repeating
  // that check in every case.
  function status(time: string, overrides: Partial<SlotStatus> = {}): SlotStatus {
    return {
      slot: { itemId: 'item-1', drug: 'levodopa', doseMg: 100, time },
      takenAt: null,
      eventId: null,
      ...overrides,
    };
  }

  it('all four windows present → 4 groups in SLOT_DEFS order with correct labels', () => {
    const groups = groupSlotsByDaypart([status('08:00'), status('12:00'), status('18:00'), status('22:00')]);
    expect(groups.map((g) => g.slotId)).toEqual(['morgens', 'mittags', 'abends', 'nachts']);
    expect(groups.map((g) => g.label)).toEqual(['Morning', 'Midday', 'Evening', 'Night']);
  });

  it('empty day-parts omitted: 08:00 + 18:00 → 2 groups (morning, evening only)', () => {
    const groups = groupSlotsByDaypart([status('08:00'), status('18:00')]);
    expect(groups.map((g) => g.slotId)).toEqual(['morgens', 'abends']);
  });

  it('boundary times: 10:59 morning, 11:00 midday, 20:59 evening, 21:00 night, 03:59 night, 04:00 morning', () => {
    const groups = groupSlotsByDaypart([
      status('10:59'),
      status('11:00'),
      status('20:59'),
      status('21:00'),
      status('03:59'),
      status('04:00'),
    ]);
    const bySlot = Object.fromEntries(groups.map((g) => [g.slotId, g.statuses.map((s) => s.slot.time)]));
    expect(bySlot.morgens).toEqual(expect.arrayContaining(['10:59', '04:00']));
    expect(bySlot.mittags).toEqual(['11:00']);
    expect(bySlot.abends).toEqual(['20:59']);
    // nachts re-orders late-before-early (next case covers that in detail);
    // here just confirm both boundary times land in the night bucket.
    expect(bySlot.nachts).toEqual(expect.arrayContaining(['21:00', '03:59']));
  });

  it('nachts wrap: 00:30 and 22:00 as input → night group lists 22:00 before 00:30', () => {
    const groups = groupSlotsByDaypart([status('00:30'), status('22:00')]);
    const night = groups.find((g) => g.slotId === 'nachts')!;
    expect(night.statuses.map((s) => s.slot.time)).toEqual(['22:00', '00:30']);
  });

  it('within-group input order preserved for a non-night group (07:00 then 09:00)', () => {
    const groups = groupSlotsByDaypart([status('07:00'), status('09:00')]);
    const morning = groups.find((g) => g.slotId === 'morgens')!;
    expect(morning.statuses.map((s) => s.slot.time)).toEqual(['07:00', '09:00']);
  });

  it('[] → []', () => {
    expect(groupSlotsByDaypart([])).toEqual([]);
  });

  it('mixed taken + pending pass through with takenAt/eventId intact', () => {
    const taken = status('08:00', { takenAt: '2026-07-16T08:05:00.000Z', eventId: 'ev-1' });
    const pending = status('09:00');
    const groups = groupSlotsByDaypart([taken, pending]);
    const morning = groups.find((g) => g.slotId === 'morgens')!;
    expect(morning.statuses[0]).toEqual(taken);
    expect(morning.statuses[1]).toEqual(pending);
  });
});

describe('extraDoseChoices', () => {
  it('dedupes identical (drug, doseMg) across items; preserves schedule order; keeps distinct doseMg separate', () => {
    const items = [
      item({
        id: 'a',
        drug: 'levodopa',
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '14:00', doseMg: 100 },
        ],
      }),
      item({ id: 'b', drug: 'levodopa', times: [{ time: '20:00', doseMg: 50 }] }),
      item({ id: 'c', drug: 'rotigotine', times: [{ time: '08:00', doseMg: 4 }] }),
    ];
    const choices = extraDoseChoices(items);
    expect(choices).toEqual([
      { drug: 'levodopa', doseMg: 100 },
      { drug: 'rotigotine', doseMg: 4 },
      { drug: 'levodopa', doseMg: 50 },
    ]);
  });

  it('within a single uneven item, dedupes the repeated 100mg time but keeps the distinct 50mg time', () => {
    const items = [
      item({
        times: [
          { time: '08:00', doseMg: 100 },
          { time: '12:00', doseMg: 100 },
          { time: '18:00', doseMg: 50 },
        ],
      }),
    ];
    expect(extraDoseChoices(items)).toEqual([
      { drug: 'levodopa', doseMg: 100 },
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
