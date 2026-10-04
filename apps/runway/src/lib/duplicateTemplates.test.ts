import { describe, expect, it } from 'vitest';
import { findDuplicateTemplates } from './duplicateTemplates';
import type { Departure, Template } from '../db/types';

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'template-1',
    name: 'Punctual to work',
    destination: 'RKH Klinikum Ludwigsburg',
    travelMinutes: 26,
    bufferMinutes: 10,
    steps: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schedule: null,
    autoLearn: false,
    arrivalSteps: [],
    arrivalWifiSsid: null,
    ...overrides,
  };
}

function makeDeparture(overrides: Partial<Departure> = {}): Departure {
  return {
    id: 'departure-1',
    templateId: 'template-1',
    name: 'Punctual to work',
    destination: 'RKH Klinikum Ludwigsburg',
    appointmentAt: '2026-07-20T08:00:00.000Z',
    travelMinutes: 26,
    bufferMinutes: 10,
    steps: [],
    status: 'done',
    startedAt: '2026-07-20T07:00:00.000Z',
    leftAt: '2026-07-20T07:30:00.000Z',
    arrivalResult: 'onTime',
    arrivalLateMinutes: null,
    createdAt: '2026-07-20T06:00:00.000Z',
    originalAppointmentAt: '2026-07-20T08:00:00.000Z',
    scheduledForDate: '2026-07-20',
    wasReplanned: false,
    arrivalSteps: [],
    arrivedAt: null,
    arrivalWifiSsid: null,
    ...overrides,
  };
}

describe('findDuplicateTemplates', () => {
  it('returns no groups when there are no duplicates', () => {
    const templates = [
      makeTemplate({ id: 't1', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
      makeTemplate({ id: 't2', name: 'Piano lesson', destination: 'Musikschule' }),
    ];
    expect(findDuplicateTemplates(templates, [])).toEqual([]);
  });

  it('groups two exact-match templates', () => {
    const templates = [
      makeTemplate({ id: 't1', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
      makeTemplate({ id: 't2', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
    ];
    const groups = findDuplicateTemplates(templates, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].candidates.map((c) => c.template.id).sort()).toEqual(['t1', 't2']);
  });

  it('groups templates that differ only in case and whitespace (dictation artifacts)', () => {
    const templates = [
      makeTemplate({ id: 't1', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
      makeTemplate({ id: 't2', name: '  punctual  to WORK ', destination: 'rkh klinikum ludwigsburg' }),
    ];
    const groups = findDuplicateTemplates(templates, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].candidates).toHaveLength(2);
  });

  it('groups a three-way duplicate into a single group', () => {
    const templates = [
      makeTemplate({ id: 't1', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
      makeTemplate({ id: 't2', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
      makeTemplate({ id: 't3', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
    ];
    const groups = findDuplicateTemplates(templates, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].candidates).toHaveLength(3);
  });

  it('does NOT group the same name with a different destination', () => {
    const templates = [
      makeTemplate({ id: 't1', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
      makeTemplate({ id: 't2', name: 'Punctual to work', destination: 'Robert-Bosch-Krankenhaus' }),
    ];
    expect(findDuplicateTemplates(templates, [])).toEqual([]);
  });

  it('does not let a missing separator falsely merge name+destination across templates', () => {
    // Without a separator between the normalised name and destination,
    // name="a b" + destination="c" and name="a" + destination="b c" would
    // both collapse to "a bc" and falsely group two unrelated templates.
    const templates = [
      makeTemplate({ id: 't1', name: 'a b', destination: 'c' }),
      makeTemplate({ id: 't2', name: 'a', destination: 'b c' }),
    ];
    expect(findDuplicateTemplates(templates, [])).toEqual([]);
  });

  it('ranks candidates by completed (left/done) departure count, richest history first', () => {
    const templates = [
      makeTemplate({ id: 't1', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
      makeTemplate({ id: 't2', name: 'Punctual to work', destination: 'RKH Klinikum Ludwigsburg' }),
    ];
    const departures = [
      makeDeparture({ id: 'd1', templateId: 't1', status: 'done' }),
      makeDeparture({ id: 'd2', templateId: 't2', status: 'done' }),
      makeDeparture({ id: 'd3', templateId: 't2', status: 'left' }),
      makeDeparture({ id: 'd4', templateId: 't2', status: 'planned' }), // not completed, doesn't count
    ];
    const groups = findDuplicateTemplates(templates, departures);
    expect(groups).toHaveLength(1);
    expect(groups[0].candidates[0]).toMatchObject({ template: { id: 't2' }, completedDepartureCount: 2 });
    expect(groups[0].candidates[1]).toMatchObject({ template: { id: 't1' }, completedDepartureCount: 1 });
  });

  it('ignores departures pointing at a template not in the current templates list', () => {
    const templates = [makeTemplate({ id: 't1' })];
    const departures = [makeDeparture({ id: 'd1', templateId: 'ghost-template', status: 'done' })];
    expect(findDuplicateTemplates(templates, departures)).toEqual([]);
  });
});
