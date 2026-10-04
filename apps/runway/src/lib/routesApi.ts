import { Capacitor, CapacitorHttp } from '@capacitor/core';

const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TIMEOUT_MS = 12_000;

/**
 * Extracts `routes[0].duration` (a string like `"1234s"`) from a
 * computeRoutes response, defensively — the Routes API's response shape is
 * outside this app's control, so every step here is a type guard rather
 * than an assumption. Pure and exported on its own (rather than inlined
 * into fetchDriveMinutes below) specifically so it can be unit tested
 * against malformed shapes without any network mocking.
 */
export function parseRouteDurationSeconds(response: unknown): number | null {
  if (typeof response !== 'object' || response === null) return null;

  const routes = (response as Record<string, unknown>).routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;

  const firstRoute = routes[0];
  if (typeof firstRoute !== 'object' || firstRoute === null) return null;

  const duration = (firstRoute as Record<string, unknown>).duration;
  if (typeof duration !== 'string') return null;

  // The API always renders duration as a plain-seconds string with a
  // trailing 's' (protobuf's Duration JSON encoding), e.g. "917s" — never
  // "15m17s" or a bare number. Anything else means the response shape
  // isn't what this app expects, so it's treated the same as "missing".
  const match = /^(\d+)s$/.exec(duration);
  if (!match) return null;

  return Number.parseInt(match[1], 10);
}

export interface FetchDriveMinutesArgs {
  origin: { lat: number; lng: number };
  destinationAddress: string;
  apiKey: string;
}

export type FetchDriveMinutesResult = { ok: true; minutes: number } | { ok: false; reason: string };

/**
 * Calls the Routes API's computeRoutes endpoint for a single live drive-time
 * estimate. Never throws — every failure path (network error, timeout,
 * non-2xx status, malformed response body) resolves to `{ok: false,
 * reason}` instead, so callers (DepartureSetup's explicit fetch button,
 * useLiveTravel's background refresh) can treat "live travel failed" as an
 * ordinary outcome to branch on, not an exception to wrap in a try/catch of
 * their own.
 */
export async function fetchDriveMinutes(args: FetchDriveMinutesArgs): Promise<FetchDriveMinutesResult> {
  const body = {
    origin: { location: { latLng: { latitude: args.origin.lat, longitude: args.origin.lng } } },
    destination: { address: args.destinationAddress },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    // Deliberately no `departureTime` field: omitting it defaults the API
    // to "now", which is exactly what every call site here wants (a live
    // estimate for leaving right away). Setting it explicitly to `now`
    // would risk landing a few hundred milliseconds in the past by the time
    // the request arrives, which the API rejects outright as an invalid
    // (past) departure time — easier and safer to just not send the field.
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': args.apiKey,
    // Mandatory: the Routes API returns almost nothing (and errors on some
    // configurations) without an explicit field mask telling it what to
    // include in the response. `routes.duration` is the only field this
    // app ever reads, so that's the only one requested — a smaller
    // response and a cheaper call under the API's per-field billing.
    'X-Goog-FieldMask': 'routes.duration',
  };

  try {
    const data = await requestRoutes(body, headers);
    const seconds = parseRouteDurationSeconds(data);
    if (seconds === null) {
      return { ok: false, reason: 'Unexpected response shape from the Routes API.' };
    }
    return { ok: true, minutes: Math.ceil(seconds / 60) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Routes API request failed.' };
  }
}

/**
 * The actual network call, split out of fetchDriveMinutes so the two
 * transports (native vs. web) each get one clearly-scoped branch instead of
 * an if/else threaded through the parsing logic above.
 */
async function requestRoutes(body: unknown, headers: Record<string, string>): Promise<unknown> {
  if (Capacitor.isNativePlatform()) {
    // CapacitorHttp issues the request through Android's native HTTP stack
    // instead of the WebView's fetch — that's what lets it bypass the
    // WebView's CORS enforcement. routes.googleapis.com does not send
    // permissive CORS headers, so a plain window.fetch from inside the app
    // would be blocked by the WebView even though the exact same request
    // succeeds natively.
    const response = await CapacitorHttp.post({
      url: ROUTES_API_URL,
      headers,
      data: body,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Routes API returned status ${response.status}.`);
    }
    return response.data;
  }

  // Plain fetch on web/dev. There's no WebView CORS boundary to route
  // around here, but routes.googleapis.com may still refuse a
  // browser-origin request depending on how the key is restricted in the
  // Google Cloud console — an honest failure the caller's try/catch above
  // already turns into `{ok: false, ...}` rather than a dev-mode crash.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(ROUTES_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Routes API returned status ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
