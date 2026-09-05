import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObservationStudy } from '../../domain/observation';
import { observationRemindersNative } from './native';
import { syncObservationReminderStudy } from './reconcile';

const study = (enabled = true): ObservationStudy => ({
  id: 'study-new',
  patient: 'P-01',
  protocolVersion: 1,
  durationDays: 14,
  startedAt: '2026-09-05T08:00:00.000Z',
  plannedEndAt: '2026-09-19T08:00:00.000Z',
  status: 'active',
  regimenSnapshot: [],
  reminderPlan: {
    version: 1, revision: 4, enabled, mode: 'interval',
    timeZone: 'Europe/Berlin', firstTime: '08:00', lastTime: '20:00', intervalMinutes: 120,
  },
});

afterEach(() => vi.restoreAllMocks());

describe('observation reminder native reconciliation', () => {
  it('does not replace an already matching native plan', async () => {
    vi.spyOn(observationRemindersNative, 'isAvailable').mockReturnValue(true);
    vi.spyOn(observationRemindersNative, 'getStatus').mockResolvedValue({
      schemaVersion: 1, permission: 'granted', configured: true,
      studyId: 'study-new', revision: 4, nextScheduledAt: null,
    });
    const replace = vi.spyOn(observationRemindersNative, 'replacePlan').mockResolvedValue({} as never);
    await syncObservationReminderStudy(study());
    expect(replace).not.toHaveBeenCalled();
  });

  it('cancels rather than scheduling an ended study', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-20T00:00:00.000Z'));
    vi.spyOn(observationRemindersNative, 'isAvailable').mockReturnValue(true);
    vi.spyOn(observationRemindersNative, 'getStatus').mockResolvedValue({
      schemaVersion: 1, permission: 'granted', configured: true,
      studyId: 'study-new', revision: 4, nextScheduledAt: null,
    });
    const replace = vi.spyOn(observationRemindersNative, 'replacePlan').mockResolvedValue({} as never);
    const cancel = vi.spyOn(observationRemindersNative, 'cancelStudy').mockResolvedValue({} as never);
    await syncObservationReminderStudy(study());
    expect(replace).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith('study-new');
  });

  it('clears the prior native study when a disabled new plan is saved', async () => {
    vi.spyOn(observationRemindersNative, 'isAvailable').mockReturnValue(true);
    vi.spyOn(observationRemindersNative, 'getStatus').mockResolvedValue({
      schemaVersion: 1, permission: 'granted', configured: true,
      studyId: 'study-old', revision: 2, nextScheduledAt: null,
    });
    const cancel = vi.spyOn(observationRemindersNative, 'cancelStudy').mockResolvedValue({} as never);
    await syncObservationReminderStudy(study(false));
    expect(cancel).toHaveBeenCalledWith('study-old');
  });
});
