import { Capacitor, registerPlugin } from '@capacitor/core';

// The ONLY file that imports the WifiBridge plugin — same one-choke-point
// pattern as calendar.ts/widgetBridge.ts. Not an npm package: defined
// directly inside this app's own Android project
// (android/app/src/main/java/de/bosonian/runway/WifiBridgePlugin.java),
// registered by MainActivity rather than auto-discovered from node_modules.

interface WifiBridgePlugin {
  /** `ssid` is `''` for "nothing usable right now" — see
   * WifiBridgePlugin.java's own doc comment for the full list of cases that
   * collapse to it (permission missing, no connection, Android's own
   * `<unknown ssid>` placeholder, ...). */
  getCurrentSsid(): Promise<{ ssid: string }>;
}

const WifiBridge = registerPlugin<WifiBridgePlugin>('WifiBridge');

/**
 * Resolves to the phone's currently-connected Wi-Fi SSID, or `null` on web,
 * denied/missing location permission, no active Wi-Fi connection, or any
 * other native error — never throws. Arrival-detection increment (0.23.0):
 * Runway.tsx's journey phase polls this (on mount, and whenever the tab
 * regains visibility) and compares it case-insensitively against a
 * departure's configured `arrivalWifiSsid` to auto-stamp `arrivedAt` — see
 * that screen's own comment for why the manual "I'm at the building" button
 * stays as a fallback regardless (Wi-Fi detection can fail to fire, or
 * simply not be configured for a given departure).
 *
 * Deliberately does NOT request the ACCESS_FINE_LOCATION permission itself
 * — same lazy-permission reasoning as calendar.ts's
 * getUpcomingCalendarEvents: this is called from a passive background poll,
 * not an explicit tap, and auto-prompting from there would surprise a
 * permission dialog into existence with no tap behind it (CLAUDE.md's
 * no-permission-ambush rule). In practice most users will already have
 * granted this exact OS permission via the live-travel feature
 * (src/native/geolocation.ts requests it too), so arrival-Wi-Fi detection
 * mostly "just works" without ever prompting from this feature's own
 * surface. There is, deliberately, no explicit "enable Wi-Fi arrival
 * detection" prompt flow the way calendar.ts's requestCalendarAccess()
 * offers one for calendar reading — a judgment call, not an oversight: the
 * UI this powers (TemplateEdit/DepartureSetup's one optional text field)
 * is small enough that a dedicated permission-request affordance felt like
 * more ceremony than the feature earns in v1. Worth revisiting if real use
 * shows the silent-no-op case (permission never granted, detection quietly
 * never fires) is common enough to be confusing.
 */
export async function getCurrentSsid(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const result = await WifiBridge.getCurrentSsid();
    return result.ssid === '' ? null : result.ssid;
  } catch {
    return null;
  }
}
