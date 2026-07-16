// Pure-helper tests — plain node, NO fake-indexeddb import. log.ts imports
// only from src/domain/* and the standard library (SPEC RISK #3), so nothing
// here should ever need a Dexie/IndexedDB shim. If a future edit makes that
// necessary, it has broken the pure/impure split this file exists to prove.
import { describe, it, expect } from 'vitest';
import {
  buildMotorEvent,
  refineDyskinesia,
  buildMealEvent,
  shiftEventTime,
  todayRangeISO,
  formatTimeHM,
  generateLocalCode,
  eventLabel,
} from './log';
import type { MotorEvent, PatientEvent } from '../../domain/types';

describe('buildMotorEvent', () => {
  it('maps each PrimaryTap to the correct MotorState', () => {
    expect(buildMotorEvent('local-1', 'on', '2026-07-16T08:00:00.000Z').state).toBe('on');
    expect(buildMotorEvent('local-1', 'off', '2026-07-16T08:00:00.000Z').state).toBe('off');
    expect(buildMotorEvent('local-1', 'on-dyskinesia', '2026-07-16T08:00:00.000Z').state).toBe(
      'on-dyskinesia-unspecified',
    );
  });

  it('sets kind, source, patient and at', () => {
    const ev = buildMotorEvent('local-1', 'on', '2026-07-16T08:00:00.000Z');
    expect(ev.kind).toBe('motor');
    expect(ev.source).toBe('self');
    expect(ev.patient).toBe('local-1');
    expect(ev.at).toBe('2026-07-16T08:00:00.000Z');
  });

  it('generates a non-empty, unique id when omitted', () => {
    const a = buildMotorEvent('local-1', 'on', '2026-07-16T08:00:00.000Z');
    const b = buildMotorEvent('local-1', 'on', '2026-07-16T08:00:00.000Z');
    expect(a.id.length).toBeGreaterThan(0);
    expect(b.id.length).toBeGreaterThan(0);
    expect(a.id).not.toBe(b.id);
  });

  it('uses a supplied id rather than generating one', () => {
    const ev = buildMotorEvent('local-1', 'on', '2026-07-16T08:00:00.000Z', 'fixed-id');
    expect(ev.id).toBe('fixed-id');
  });
});

describe('refineDyskinesia', () => {
  const unspecified: MotorEvent = {
    id: 'ev-1',
    patient: 'local-1',
    at: '2026-07-16T08:00:00.000Z',
    kind: 'motor',
    state: 'on-dyskinesia-unspecified',
    source: 'self',
  };

  it('transitions unspecified → troublesome, preserving id and at', () => {
    const refined = refineDyskinesia(unspecified, 'troublesome');
    expect(refined.state).toBe('on-dyskinesia-troublesome');
    expect(refined.id).toBe(unspecified.id);
    expect(refined.at).toBe(unspecified.at);
  });

  it('transitions unspecified → nontroublesome, preserving id and at', () => {
    const refined = refineDyskinesia(unspecified, 'nontroublesome');
    expect(refined.state).toBe('on-dyskinesia-nontroublesome');
    expect(refined.id).toBe(unspecified.id);
    expect(refined.at).toBe(unspecified.at);
  });

  it('returns a new object and does not mutate the input', () => {
    const refined = refineDyskinesia(unspecified, 'troublesome');
    expect(refined).not.toBe(unspecified);
    expect(unspecified.state).toBe('on-dyskinesia-unspecified');
  });

  it('returns a non-dyskinesia event unchanged', () => {
    const off: MotorEvent = { ...unspecified, state: 'off' };
    const result = refineDyskinesia(off, 'troublesome');
    expect(result).toEqual(off);
  });
});

describe('buildMealEvent', () => {
  it('sets kind, protein, source for low protein', () => {
    const ev = buildMealEvent('local-1', 'low', '2026-07-16T08:00:00.000Z');
    expect(ev.kind).toBe('meal');
    expect(ev.protein).toBe('low');
    expect(ev.source).toBe('self');
  });

  it('sets protein for high protein', () => {
    const ev = buildMealEvent('local-1', 'high', '2026-07-16T08:00:00.000Z');
    expect(ev.protein).toBe('high');
  });
});

describe('shiftEventTime', () => {
  const nowISO = '2026-07-16T12:00:00.000Z';

  it('+5 moves at forward by exactly 300000 ms', () => {
    const ev = { at: '2026-07-16T08:00:00.000Z' };
    const shifted = shiftEventTime(ev, 5, nowISO);
    expect(new Date(shifted.at).getTime() - new Date(ev.at).getTime()).toBe(300_000);
  });

  it('-5 moves at backward by exactly 300000 ms', () => {
    const ev = { at: '2026-07-16T08:00:00.000Z' };
    const shifted = shiftEventTime(ev, -5, nowISO);
    expect(new Date(ev.at).getTime() - new Date(shifted.at).getTime()).toBe(300_000);
  });

  it('-5 across local midnight is allowed (no clamping backward)', () => {
    const localMidnightPlus2 = new Date(2026, 6, 16, 0, 2, 0, 0); // 00:02 local
    const ev = { at: localMidnightPlus2.toISOString() };
    const shifted = shiftEventTime(ev, -5, nowISO);
    expect(new Date(shifted.at).getTime()).toBe(localMidnightPlus2.getTime() - 300_000);
  });

  it('+5 beyond nowISO clamps to exactly nowISO', () => {
    const ev = { at: '2026-07-16T11:58:00.000Z' }; // 2 min before now
    const shifted = shiftEventTime(ev, 5, nowISO);
    expect(shifted.at).toBe(nowISO);
  });
});

describe('todayRangeISO', () => {
  it('contains a local-noon timestamp of the same day', () => {
    const now = new Date(2026, 6, 16, 9, 0, 0, 0); // local 09:00, 16 July
    const { startISO, endISO } = todayRangeISO(now);
    const localNoonSameDay = new Date(2026, 6, 16, 12, 0, 0, 0).toISOString();
    expect(localNoonSameDay >= startISO && localNoonSameDay <= endISO).toBe(true);
  });

  it('excludes local-noon of the previous day', () => {
    const now = new Date(2026, 6, 16, 9, 0, 0, 0);
    const { startISO, endISO } = todayRangeISO(now);
    const localNoonPrevDay = new Date(2026, 6, 15, 12, 0, 0, 0).toISOString();
    expect(localNoonPrevDay >= startISO && localNoonPrevDay <= endISO).toBe(false);
  });
});

describe('formatTimeHM', () => {
  it('zero-pads a single-digit hour and minute', () => {
    expect(formatTimeHM(new Date(2026, 6, 16, 8, 5).toISOString())).toBe('08:05');
  });

  it('formats a double-digit hour and minute', () => {
    expect(formatTimeHM(new Date(2026, 6, 16, 14, 32).toISOString())).toBe('14:32');
  });
});

describe('generateLocalCode', () => {
  it('returns a "local-" prefixed code', () => {
    expect(generateLocalCode()).toMatch(/^local-.{8}$/);
  });

  it('generates unique codes', () => {
    expect(generateLocalCode()).not.toBe(generateLocalCode());
  });
});

describe('eventLabel', () => {
  const base = { id: 'e1', patient: 'local-1', at: '2026-07-16T08:00:00.000Z', source: 'self' as const };

  it('covers every motor state', () => {
    const cases: Array<[MotorEvent['state'], string]> = [
      ['on', 'ON'],
      ['off', 'OFF'],
      ['on-dyskinesia-unspecified', 'ON with dyskinesia'],
      ['on-dyskinesia-troublesome', 'ON with dyskinesia · troublesome'],
      ['on-dyskinesia-nontroublesome', 'ON with dyskinesia · not troublesome'],
      ['asleep', 'Asleep'],
    ];
    for (const [state, label] of cases) {
      const ev: PatientEvent = { ...base, kind: 'motor', state };
      expect(eventLabel(ev)).toBe(label);
    }
  });

  it('covers both meal proteins', () => {
    expect(eventLabel({ ...base, kind: 'meal', protein: 'low' })).toBe('Meal · low protein');
    expect(eventLabel({ ...base, kind: 'meal', protein: 'high' })).toBe('Meal · high protein');
  });

  it('labels a levodopa DoseEvent as "Levodopa 100 mg"', () => {
    expect(eventLabel({ ...base, kind: 'dose', drug: 'levodopa', doseMg: 100 })).toBe('Levodopa 100 mg');
  });

  it('labels a madopar-lt DoseEvent using the catalog generic name', () => {
    expect(eventLabel({ ...base, kind: 'dose', drug: 'madopar-lt', doseMg: 125 })).toBe(
      'Levodopa/benserazide (dispersible) 125 mg',
    );
  });
});
