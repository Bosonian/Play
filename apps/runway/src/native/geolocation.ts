import { Geolocation } from '@capacitor/geolocation';

// The ONLY file that imports @capacitor/geolocation — same one-choke-point
// pattern as haptics.ts/keepAwake.ts. Unlike those two this wrapper is NOT
// gated to Capacitor.isNativePlatform(): the plugin's web implementation
// calls the browser's own navigator.geolocation, which is a real, useful
// permission prompt in desktop/dev Chrome too (RUNWAY_PLAN.md's "develop
// and test in the browser" bonus applies here as much as anywhere else).

const TIMEOUT_MS = 10_000;

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Resolves the device's current coordinates, or null on any failure —
 * denied permission, timeout, no fix, or any other plugin error. Never
 * throws: fetchDriveMinutes (src/lib/routesApi.ts) needs an origin to call
 * the Routes API at all, and "no location available" is an ordinary,
 * expected outcome here (permission not yet granted, indoors with a weak
 * fix, airplane mode) — not something worth surfacing as an app-breaking
 * error to a caller that can already fall back to the manual estimate.
 *
 * Lazy permission only, by construction: this is only ever called from an
 * explicit user action (DepartureSetup's "Fetch live travel time" button,
 * or useLiveTravel's background refresh once a departure's live travel is
 * already turned on) — never at app open. The plugin prompts for
 * ACCESS_FINE_LOCATION/ACCESS_COARSE_LOCATION on first call; per
 * CLAUDE.md's no-permission-ambush rule, the first moment that prompt can
 * appear is the first moment Deepak does something that needs it.
 */
export async function getCurrentPosition(): Promise<Coordinates | null> {
  try {
    const position = await Geolocation.getCurrentPosition({ timeout: TIMEOUT_MS });
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}
