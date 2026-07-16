import { describe, it, expect, vi } from 'vitest';
import { checkForUpdate, APK_FALLBACK_URL } from './updates';

// Hand-rolled fetch fake, same convention as report/queue.test.ts's fakeApi —
// checkForUpdate only needs `ok` and `json()` off the Response it receives.
function fakeFetch(response: { ok: boolean; body?: unknown }): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    json: async () => response.body,
  }) as unknown as typeof fetch;
}

describe('checkForUpdate', () => {
  it('newer build: returns version, buildNumber, and the apkUrl from assets', async () => {
    const fetchFn = fakeFetch({
      ok: true,
      body: {
        body: 'Version 0.11.0 (build 20).',
        assets: [{ name: 'companion.apk', browser_download_url: 'https://x/companion.apk' }],
      },
    });
    const result = await checkForUpdate(10, fetchFn);
    expect(result).toEqual({ version: '0.11.0', buildNumber: 20, apkUrl: 'https://x/companion.apk' });
  });

  it('equal build: returns null (already up to date)', async () => {
    const fetchFn = fakeFetch({
      ok: true,
      body: { body: 'Version 0.10.0 (build 10).', assets: [] },
    });
    const result = await checkForUpdate(10, fetchFn);
    expect(result).toBeNull();
  });

  it('older build: returns null', async () => {
    const fetchFn = fakeFetch({
      ok: true,
      body: { body: 'Version 0.9.0 (build 5).', assets: [] },
    });
    const result = await checkForUpdate(10, fetchFn);
    expect(result).toBeNull();
  });

  it('fetch throws: returns null, never throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(checkForUpdate(10, fetchFn)).resolves.toBeNull();
  });

  it('res.ok false (e.g. 404): returns null', async () => {
    const fetchFn = fakeFetch({ ok: false, body: {} });
    const result = await checkForUpdate(10, fetchFn);
    expect(result).toBeNull();
  });

  it('body missing a "build N" token: returns null', async () => {
    const fetchFn = fakeFetch({
      ok: true,
      body: { body: 'Version 0.11.0, no build token here.', assets: [] },
    });
    const result = await checkForUpdate(10, fetchFn);
    expect(result).toBeNull();
  });

  it('newer build but assets missing companion.apk: falls back to APK_FALLBACK_URL', async () => {
    const fetchFn = fakeFetch({
      ok: true,
      body: {
        body: 'Version 0.11.0 (build 20).',
        assets: [{ name: 'other-asset.txt', browser_download_url: 'https://x/other-asset.txt' }],
      },
    });
    const result = await checkForUpdate(10, fetchFn);
    expect(result).toEqual({ version: '0.11.0', buildNumber: 20, apkUrl: APK_FALLBACK_URL });
  });

  it('version token missing but build present and newer: returns update with version === ""', async () => {
    const fetchFn = fakeFetch({
      ok: true,
      body: { body: 'Build 20 shipped, no version prefix.', assets: [] },
    });
    const result = await checkForUpdate(10, fetchFn);
    expect(result).toEqual({ version: '', buildNumber: 20, apkUrl: APK_FALLBACK_URL });
  });
});
