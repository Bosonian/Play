import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  getPlatform: vi.fn(),
  getIdentity: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
    getPlatform: mocks.getPlatform,
  },
  registerPlugin: vi.fn(() => ({ getIdentity: mocks.getIdentity })),
}));

import { getAndroidAppIdentity } from './appUpdateIdentity';

const identity = {
  schemaVersion: 1 as const,
  packageName: 'app.dosing.companion',
  versionCode: 6,
  versionName: '0.16.0',
  signerSha256: 'a'.repeat(64),
};

describe('Android app update identity bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(false);
    mocks.getPlatform.mockReturnValue('web');
  });

  it('stays quiet without invoking native code outside Android', async () => {
    await expect(getAndroidAppIdentity()).resolves.toBeNull();
    expect(mocks.getIdentity).not.toHaveBeenCalled();
  });

  it('returns a validated identity from Android', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue('android');
    mocks.getIdentity.mockResolvedValue(identity);
    await expect(getAndroidAppIdentity()).resolves.toEqual(identity);
  });

  it('fails closed for native errors or malformed signer identity', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue('android');
    mocks.getIdentity.mockRejectedValueOnce(new Error('native unavailable'));
    await expect(getAndroidAppIdentity()).resolves.toBeNull();
    mocks.getIdentity.mockResolvedValueOnce({ ...identity, signerSha256: 'unknown' });
    await expect(getAndroidAppIdentity()).resolves.toBeNull();
    mocks.getIdentity.mockResolvedValueOnce({ ...identity, versionCode: 2_100_000_001 });
    await expect(getAndroidAppIdentity()).resolves.toBeNull();
  });
});
