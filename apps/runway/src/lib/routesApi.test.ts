import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDriveMinutes, parseRouteDurationSeconds } from './routesApi';

describe('parseRouteDurationSeconds', () => {
  it('extracts seconds from a well-formed computeRoutes response', () => {
    expect(parseRouteDurationSeconds({ routes: [{ duration: '917s' }] })).toBe(917);
  });

  it('handles "0s" as a real (not missing) value', () => {
    expect(parseRouteDurationSeconds({ routes: [{ duration: '0s' }] })).toBe(0);
  });

  it('returns null for a non-object response', () => {
    expect(parseRouteDurationSeconds('not an object')).toBeNull();
    expect(parseRouteDurationSeconds(42)).toBeNull();
    expect(parseRouteDurationSeconds(null)).toBeNull();
    expect(parseRouteDurationSeconds(undefined)).toBeNull();
  });

  it('returns null when routes is missing', () => {
    expect(parseRouteDurationSeconds({})).toBeNull();
  });

  it('returns null when routes is present but not an array', () => {
    expect(parseRouteDurationSeconds({ routes: 'nope' })).toBeNull();
  });

  it('returns null when routes is an empty array', () => {
    expect(parseRouteDurationSeconds({ routes: [] })).toBeNull();
  });

  it('returns null when routes[0] is not an object', () => {
    expect(parseRouteDurationSeconds({ routes: ['nope'] })).toBeNull();
    expect(parseRouteDurationSeconds({ routes: [null] })).toBeNull();
  });

  it('returns null when duration is missing or the wrong type', () => {
    expect(parseRouteDurationSeconds({ routes: [{}] })).toBeNull();
    expect(parseRouteDurationSeconds({ routes: [{ duration: 917 }] })).toBeNull();
    expect(parseRouteDurationSeconds({ routes: [{ duration: null }] })).toBeNull();
  });

  it('returns null when duration does not match the "<digits>s" shape', () => {
    expect(parseRouteDurationSeconds({ routes: [{ duration: '15m17s' }] })).toBeNull();
    expect(parseRouteDurationSeconds({ routes: [{ duration: 'abc' }] })).toBeNull();
    expect(parseRouteDurationSeconds({ routes: [{ duration: '917' }] })).toBeNull();
    expect(parseRouteDurationSeconds({ routes: [{ duration: '-5s' }] })).toBeNull();
  });
});

describe('fetchDriveMinutes', () => {
  const args = {
    origin: { lat: 48.78, lng: 9.18 },
    destinationAddress: 'Klinikum Stuttgart',
    apiKey: 'test-key',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rounds seconds up to whole minutes on success (917s -> 16 min)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ routes: [{ duration: '917s' }] }), { status: 200 })),
    );

    const result = await fetchDriveMinutes(args);
    expect(result).toEqual({ ok: true, minutes: 16 });
  });

  it('sends the mandatory field mask and no departureTime', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ routes: [{ duration: '60s' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchDriveMinutes(args);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toBe('routes.duration');
    expect(headers['X-Goog-Api-Key']).toBe('test-key');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.departureTime).toBeUndefined();
    expect(sentBody.travelMode).toBe('DRIVE');
  });

  it('fails cleanly on a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));

    const result = await fetchDriveMinutes(args);
    expect(result.ok).toBe(false);
  });

  it('fails cleanly when the response body has an unexpected shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })));

    const result = await fetchDriveMinutes(args);
    expect(result.ok).toBe(false);
  });

  it('fails cleanly on a network error rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await fetchDriveMinutes(args);
    expect(result).toEqual({ ok: false, reason: 'network down' });
  });
});
