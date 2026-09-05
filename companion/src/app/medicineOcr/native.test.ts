import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  getPlatform: vi.fn(),
  plugin: {
    getStatus: vi.fn(),
    configureKey: vi.fn(),
    removeKey: vi.fn(),
    testConnection: vi.fn(),
    extractPhoto: vi.fn(),
    cancelExtraction: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
    getPlatform: mocks.getPlatform,
  },
  registerPlugin: vi.fn(() => mocks.plugin),
}));

import { isMedicineOcrNativeAvailable, medicineOcrNative } from './native';

describe('medicine OCR native bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(false);
    mocks.getPlatform.mockReturnValue('web');
  });

  it('fails closed without invoking a credential path outside Android', () => {
    expect(isMedicineOcrNativeAvailable()).toBe(false);
    expect(() => medicineOcrNative.configureKey('companion-vision-123')).toThrow(
      'Medicine OCR is available only in the Android app.',
    );
    expect(mocks.plugin.configureKey).not.toHaveBeenCalled();
  });

  it('passes the request identity and inline image only to the Android plugin', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue('android');
    const request = {
      requestId: 'photo-42',
      imageBase64: 'aW1hZ2U=',
      mimeType: 'image/jpeg' as const,
    };
    const result = {
      schemaVersion: 1 as const,
      requestId: request.requestId,
      imageSha256: 'abc123',
      imageWidth: 1200,
      imageHeight: 800,
      text: 'Pramipexole 0.088 mg',
      lines: [],
    };
    mocks.plugin.extractPhoto.mockResolvedValue(result);

    await expect(medicineOcrNative.extractPhoto(request)).resolves.toEqual(result);
    expect(mocks.plugin.extractPhoto).toHaveBeenCalledWith(request);
    expect(mocks.plugin.extractPhoto).toHaveBeenCalledTimes(1);
  });
});
