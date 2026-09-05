import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  getPlatform: vi.fn(),
  plugin: {
    getStatus: vi.fn(),
    requestPermission: vi.fn(),
    replacePlan: vi.fn(),
    cancelStudy: vi.fn(),
    getPendingOpen: vi.fn(),
    acknowledgeOpen: vi.fn(),
    addListener: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
    getPlatform: mocks.getPlatform,
  },
  registerPlugin: vi.fn(() => mocks.plugin),
}));

import { observationRemindersNative } from './native';

describe('observation reminders native bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(false);
    mocks.getPlatform.mockReturnValue('web');
  });

  it('does not request notification permission outside Android', () => {
    expect(() => observationRemindersNative.requestPermission()).toThrow(
      'Observation reminders are available only in the Android app.',
    );
    expect(mocks.plugin.requestPermission).not.toHaveBeenCalled();
  });

  it('passes the versioned fixed-timezone plan without reshaping it', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue('android');
    const options = {
      studyId: 'study-1',
      revision: 4,
      startedAt: '2026-09-05T08:00:00.000Z',
      plannedEndAt: '2026-09-19T08:00:00.000Z',
      plan: {
        version: 1 as const,
        revision: 4,
        enabled: true,
        mode: 'custom' as const,
        timeZone: 'Europe/Berlin',
        firstTime: '08:00',
        lastTime: '20:00',
        customTimes: ['08:30', '17:15'],
      },
    };
    mocks.plugin.replacePlan.mockResolvedValue({ schemaVersion: 1, configured: true });

    await observationRemindersNative.replacePlan(options);
    expect(mocks.plugin.replacePlan).toHaveBeenCalledWith(options);
  });

  it('subscribes to warm notification opens without exposing occurrence data in the event', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue('android');
    const listener = vi.fn();
    const handle = { remove: vi.fn() };
    mocks.plugin.addListener.mockResolvedValue(handle);

    await expect(observationRemindersNative.onReminderOpen(listener)).resolves.toBe(handle);
    expect(mocks.plugin.addListener).toHaveBeenCalledWith('reminderOpen', listener);
  });

  it('keeps planned delivery and actual open timestamps distinct', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue('android');
    const pending = {
      schemaVersion: 1 as const,
      pending: {
        occurrenceId: 'study-1:r4:2026-09-06T08:30',
        studyId: 'study-1',
        revision: 4,
        scheduledAt: '2026-09-06T06:30:00.000Z',
        deliveredAt: '2026-09-06T06:32:00.000Z',
        openedAt: '2026-09-06T06:37:00.000Z',
      },
    };
    mocks.plugin.getPendingOpen.mockResolvedValue(pending);

    await expect(observationRemindersNative.getPendingOpen()).resolves.toEqual(pending);
    await observationRemindersNative.acknowledgeOpen(pending.pending.occurrenceId);
    expect(mocks.plugin.acknowledgeOpen).toHaveBeenCalledWith({ occurrenceId: pending.pending.occurrenceId });
  });
});
