import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION_CODE } from './appVersion';

// Mirrors apps/runway/src/lib/updateCheck.test.ts's own approach — same
// "mock db, don't spin up a real IndexedDB" precedent as eventLog.test.ts:
// checkForUpdate only ever calls db.settings.get/put, both trivial to mock.
const getMock = vi.fn();
const putMock = vi.fn();
vi.mock('../db/db', () => ({
  db: { settings: { get: getMock, put: putMock } },
}));

const logEventMock = vi.fn();
vi.mock('./eventLog', () => ({ logEvent: logEventMock }));

// APP_VERSION_CODE is real (not mocked) — fixtures that need a "newer"
// release derive it (NEWER_CODE below) so version bumps can't flip them
// (same 0.42.1 lesson Runway's own test file's comment documents).
const { checkForUpdate, parseAvailableUpdate, parseReleaseName } = await import('./updateCheck');

const NEWER_CODE = APP_VERSION_CODE + 1;

describe('parseReleaseName', () => {
  it('parses a well-formed stamped release name', () => {
    expect(parseReleaseName('Tide v0.2.0 (2)')).toEqual({ version: '0.2.0', versionCode: 2 });
  });

  it('returns null for an unstamped/wrong-app release name', () => {
    // Tide has no real legacy release the way Runway does (every tide-latest
    // publish has been stamped since Tide's first APK) — this exercises the
    // same defensive contract regardless: any name that isn't exactly
    // "Tide v{X} ({N})" must read as "no signal", never as "up to date".
    expect(parseReleaseName('Tide (latest build)')).toBeNull();
    expect(parseReleaseName('Runway v0.44.0 (63)')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseReleaseName('hello world')).toBeNull();
    expect(parseReleaseName('')).toBeNull();
  });

  it('returns null when the parenthesized versionCode is missing entirely', () => {
    expect(parseReleaseName('Tide v0.2.0 2')).toBeNull();
  });

  it('returns null when the versionCode does not parse as a number (NaN)', () => {
    expect(parseReleaseName('Tide v0.2.0 (two)')).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseReleaseName('  Tide v0.2.0 (2)  ')).toEqual({ version: '0.2.0', versionCode: 2 });
  });

  it('returns null for trailing content after the closing paren', () => {
    expect(parseReleaseName('Tide v0.2.0 (2) extra')).toBeNull();
  });
});

describe('parseAvailableUpdate', () => {
  it('returns null for undefined/empty', () => {
    expect(parseAvailableUpdate(undefined)).toBeNull();
    expect(parseAvailableUpdate('')).toBeNull();
  });

  it('parses a well-formed JSON row', () => {
    expect(parseAvailableUpdate(JSON.stringify({ version: '0.3.0', versionCode: 3 }))).toEqual({
      version: '0.3.0',
      versionCode: 3,
    });
  });

  it('returns null for malformed JSON or the wrong shape', () => {
    expect(parseAvailableUpdate('not json')).toBeNull();
    expect(parseAvailableUpdate(JSON.stringify({ version: '0.3.0' }))).toBeNull();
    expect(parseAvailableUpdate(JSON.stringify({ versionCode: 3 }))).toBeNull();
  });
});

describe('checkForUpdate', () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
    logEventMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips the network call when checked recently and not forced, resolving "throttled"', async () => {
    getMock.mockResolvedValue({ key: 'lastUpdateCheckAt', value: new Date().toISOString() });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await checkForUpdate();

    expect(outcome).toBe('throttled');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('checks anyway when never checked before (no settings row)', async () => {
    getMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'Tide v0.2.0 (2)' }), { status: 200 })),
    );

    await checkForUpdate();

    expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'lastUpdateCheckAt' }));
  });

  it('bypasses the throttle when forced, even right after a recent check', async () => {
    getMock.mockResolvedValue({ key: 'lastUpdateCheckAt', value: new Date().toISOString() });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: 'Tide v0.2.0 (2)' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await checkForUpdate(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes availableUpdate, logs "available", and resolves "available" when the release is newer', async () => {
    getMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: `Tide v0.3.0 (${NEWER_CODE})` }), { status: 200 })),
    );

    const outcome = await checkForUpdate();

    expect(outcome).toBe('available');
    expect(putMock).toHaveBeenCalledWith({
      key: 'availableUpdate',
      value: JSON.stringify({ version: '0.3.0', versionCode: NEWER_CODE }),
    });
    expect(logEventMock).toHaveBeenCalledWith('update', `Update check: v0.3.0 available.`);
  });

  it('clears availableUpdate, logs "up to date", and resolves "upToDate" when the release is the same build', async () => {
    getMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'Tide v0.2.0 (2)' }), { status: 200 })),
    );

    const outcome = await checkForUpdate();

    expect(outcome).toBe('upToDate');
    expect(putMock).toHaveBeenCalledWith({ key: 'availableUpdate', value: '' });
    expect(logEventMock).toHaveBeenCalledWith('update', 'Update check: up to date.');
  });

  it('clears availableUpdate when the release is older', async () => {
    getMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'Tide v0.1.0 (1)' }), { status: 200 })),
    );

    await checkForUpdate();

    expect(putMock).toHaveBeenCalledWith({ key: 'availableUpdate', value: '' });
  });

  it('clears availableUpdate (treated as unknown, not as an update) for an unstamped release name', async () => {
    getMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'Tide (latest build)' }), { status: 200 })),
    );

    const outcome = await checkForUpdate();

    expect(outcome).toBe('upToDate');
    expect(putMock).toHaveBeenCalledWith({ key: 'availableUpdate', value: '' });
    expect(logEventMock).toHaveBeenCalledWith('update', 'Update check: up to date.');
  });

  it('never throws, resolves "error", and leaves availableUpdate untouched on a network failure', async () => {
    getMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const outcome = await checkForUpdate();

    expect(outcome).toBe('error');
    expect(putMock).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'availableUpdate' }));
    // lastUpdateCheckAt IS stamped even on failure — see checkForUpdate's own
    // comment on why a failed attempt still counts against the throttle.
    expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'lastUpdateCheckAt' }));
    expect(logEventMock).toHaveBeenCalledWith('update', expect.stringContaining('Update check failed'));
  });

  it('never throws and resolves "error" on a non-2xx status', async () => {
    getMock.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 403 })));

    const outcome = await checkForUpdate();
    expect(outcome).toBe('error');
    expect(putMock).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'availableUpdate' }));
  });

  it('never throws (resolves "error") when the underlying Dexie write itself fails', async () => {
    getMock.mockResolvedValue(undefined);
    putMock.mockRejectedValue(new Error('IndexedDB is broken'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: `Tide v0.3.0 (${NEWER_CODE})` }), { status: 200 })),
    );

    const outcome = await checkForUpdate();
    expect(outcome).toBe('error');
  });
});
