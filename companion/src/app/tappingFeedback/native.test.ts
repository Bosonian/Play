import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  getPlatform: vi.fn(),
  plugin: { beginSession: vi.fn(), performTap: vi.fn(), endSession: vi.fn() },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform, getPlatform: mocks.getPlatform },
  registerPlugin: vi.fn(() => mocks.plugin),
}));

import { tapFeedbackNative } from './native';

describe('tap feedback native bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(false);
    mocks.getPlatform.mockReturnValue('web');
  });

  it('uses visual-only fallback without invoking native methods on web', () => {
    tapFeedbackNative.beginSession('hand-1');
    tapFeedbackNative.performTap('hand-1', 1_000);
    tapFeedbackNative.endSession('hand-1');
    expect(mocks.plugin.performTap).not.toHaveBeenCalled();
  });

  it('passes session and pre-feedback timestamp to Android without awaiting failures', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue('android');
    mocks.plugin.beginSession.mockResolvedValue({ active: true });
    mocks.plugin.performTap.mockRejectedValue(new Error('haptics unavailable'));
    mocks.plugin.endSession.mockResolvedValue({ ended: true });

    expect(tapFeedbackNative.beginSession('hand-2')).toBeUndefined();
    expect(tapFeedbackNative.performTap('hand-2', 12_345)).toBeUndefined();
    expect(tapFeedbackNative.endSession('hand-2')).toBeUndefined();
    await Promise.resolve();

    expect(mocks.plugin.beginSession).toHaveBeenCalledWith({ sessionToken: 'hand-2' });
    expect(mocks.plugin.performTap).toHaveBeenCalledWith({
      sessionToken: 'hand-2', requestedAtEpochMs: 12_345,
    });
    expect(mocks.plugin.endSession).toHaveBeenCalledWith({ sessionToken: 'hand-2' });
  });
});
