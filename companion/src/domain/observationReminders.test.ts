import { describe, expect, it } from 'vitest';
import {
  expandObservationReminderOccurrences,
  reminderTimes,
  validateObservationReminderPlan,
  validateObservationReminderOpen,
  type ObservationReminderPlanV1,
} from './observationReminders';

const plan = (overrides: Partial<ObservationReminderPlanV1> = {}): ObservationReminderPlanV1 => ({
  version: 1,
  revision: 1,
  enabled: true,
  mode: 'interval',
  timeZone: 'Europe/Berlin',
  firstTime: '08:00',
  lastTime: '20:00',
  intervalMinutes: 240,
  ...overrides,
});

describe('observation reminders', () => {
  it('expands only the supported same-day interval presets including endpoints', () => {
    expect(validateObservationReminderPlan(plan())).toEqual([]);
    expect(reminderTimes(plan())).toEqual(['08:00', '12:00', '16:00', '20:00']);
    expect(validateObservationReminderPlan(plan({ firstTime: '20:00', lastTime: '08:00' })))
      .toContain('The reminder window must end later on the same day.');
    expect(validateObservationReminderPlan(plan({ intervalMinutes: 90 as 60 })))
      .toContain('Choose a 30 minute, 1 hour, 2 hour, or 4 hour interval.');
  });

  it('sorts custom times and rejects duplicates or values outside the window', () => {
    expect(reminderTimes(plan({
      mode: 'custom',
      intervalMinutes: undefined,
      customTimes: ['17:30', '09:15'],
    }))).toEqual(['09:15', '17:30']);
    expect(validateObservationReminderPlan(plan({
      mode: 'custom',
      intervalMinutes: undefined,
      customTimes: ['09:00', '09:00', '21:00'],
    }))).toEqual(expect.arrayContaining([
      'Custom reminder times must be unique.',
      'Custom times must stay inside the same-day reminder window.',
    ]));
  });

  it('keeps local wall time across the Europe/Berlin spring DST change', () => {
    const occurrences = expandObservationReminderOccurrences(
      'study-1',
      '2026-03-28T00:00:00.000Z',
      '2026-03-30T00:00:00.000Z',
      plan({ firstTime: '08:00', lastTime: '09:00', intervalMinutes: 60 }),
    );
    expect(occurrences.map((item) => [item.localDate, item.localTime, item.scheduledAt])).toEqual([
      ['2026-03-28', '08:00', '2026-03-28T07:00:00.000Z'],
      ['2026-03-28', '09:00', '2026-03-28T08:00:00.000Z'],
      ['2026-03-29', '08:00', '2026-03-29T06:00:00.000Z'],
      ['2026-03-29', '09:00', '2026-03-29T07:00:00.000Z'],
    ]);
  });

  it('chooses the later instant during a repeated fall DST wall time', () => {
    const occurrences = expandObservationReminderOccurrences(
      'study-fold',
      '2026-10-24T22:00:00.000Z',
      '2026-10-25T03:00:00.000Z',
      plan({ mode: 'custom', firstTime: '02:30', lastTime: '03:00', intervalMinutes: undefined, customTimes: ['02:30'] }),
    );
    expect(occurrences[0]?.scheduledAt).toBe('2026-10-25T01:30:00.000Z');
  });

  it('uses the same later-overlap convention in New York', () => {
    const occurrences = expandObservationReminderOccurrences(
      'study-ny',
      '2026-11-01T00:00:00.000Z',
      '2026-11-01T08:00:00.000Z',
      plan({ timeZone: 'America/New_York', mode: 'custom', firstTime: '01:30', lastTime: '02:00', intervalMinutes: undefined, customTimes: ['01:30'] }),
    );
    expect(occurrences[0]?.scheduledAt).toBe('2026-11-01T06:30:00.000Z');
  });

  it('rejects stale revisions and completed notification occurrences', () => {
    const reminderPlan = plan({ firstTime: '08:00', lastTime: '08:30', intervalMinutes: 30 });
    const study = {
      id: 'study-1', status: 'active',
      startedAt: '2026-09-05T00:00:00.000Z',
      plannedEndAt: '2026-09-06T00:00:00.000Z',
      reminderPlan,
    };
    const occurrence = expandObservationReminderOccurrences(
      study.id, study.startedAt, study.plannedEndAt, reminderPlan,
    )[0];
    const pending = {
      occurrenceId: occurrence.id, studyId: study.id,
      revision: reminderPlan.revision, scheduledAt: occurrence.scheduledAt,
    };
    expect(validateObservationReminderOpen(pending, study, new Set(), '2026-09-05T08:30:00.000Z')).toEqual({
      valid: true, occurrence,
    });
    expect(validateObservationReminderOpen(
      pending, study, new Set(), '2026-09-05T05:59:00.000Z',
    )).toMatchObject({ valid: false, reason: expect.stringContaining('not current') });
    expect(validateObservationReminderOpen(
      pending, study, new Set(), '2026-09-04T23:59:00.000Z',
    )).toMatchObject({ valid: false, reason: expect.stringContaining('not current') });
    expect(validateObservationReminderOpen(
      pending, study, new Set(), '2026-09-06T00:00:00.000Z',
    )).toMatchObject({ valid: false, reason: expect.stringContaining('not current') });
    expect(validateObservationReminderOpen(
      { ...pending, revision: 2 }, study, new Set(), '2026-09-05T08:30:00.000Z',
    )).toMatchObject({ valid: false, reason: expect.stringContaining('newer') });
    expect(validateObservationReminderOpen(
      pending, study, new Set([occurrence.id]), '2026-09-05T08:30:00.000Z',
    )).toMatchObject({ valid: false, reason: expect.stringContaining('already') });
  });
});
