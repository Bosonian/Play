import { App } from '@capacitor/app';
import type { URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Screen } from '../App';

// The ONLY file that imports @capacitor/app. Two `runway://...` routes this
// increment defines (spec §4): `runway://exam` (Prüfung overview) and
// `runway://new-departure` (a blank DepartureSetup) — reached from the
// Prüfung widget's tap target (PruefungWidgetProvider.java) and from the
// static home-screen shortcuts (res/xml/shortcuts.xml). Kept decoupled from
// `../lib/navigationRef` the same way notifications.ts's
// registerNotificationNavigation is: this file only turns a URL into a
// Screen and hands it to a caller-supplied function, rather than importing
// navigationRef directly — main.tsx is what wires the two together, same
// shape as its registerNotificationNavigation(navigateToDeparture) call
// just above where this is used.

/** Parses a `runway://...` URL into the Screen it means, or null for
 * anything unrecognised (a future scheme addition, a malformed URL, or a
 * host this version doesn't know about — never navigating on an unknown
 * URL is safer than guessing). Uses the URL constructor rather than string
 * prefix-matching: for a non-`http(s)` scheme like `runway:`, the part
 * after `//` up to the next `/`, `?`, or `#` still parses into `.hostname`
 * exactly the way it would for a normal http(s) URL. */
function screenForUrl(url: string): Screen | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'runway:') return null;

  switch (parsed.hostname) {
    case 'exam':
      return { name: 'exam' };
    case 'new-departure':
      return { name: 'departureSetup' };
    default:
      return null;
  }
}

/**
 * Registers the tap/deep-link handler once, for the lifetime of the app,
 * and handles the cold-start case in the same call. Returns an unsubscribe
 * function so the caller (main.tsx) could clean up, though in practice this
 * is registered once at startup and lives for the app's whole lifetime, the
 * same as registerNotificationNavigation.
 *
 * Cold start: unlike @capacitor/local-notifications (see
 * registerNotificationNavigation's own doc comment in notifications.ts for
 * why that one is an unverified inference about buffered bridge events),
 * @capacitor/app's `getLaunchUrl()` directly exposes the URL the app was
 * launched with, when there is one — reading it once here at registration
 * time is a documented, reliable way to catch "the widget/shortcut tap
 * cold-started the app", not a guess about bridge buffering behaviour.
 */
export async function registerDeepLinkNavigation(handler: (screen: Screen) => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const listenerHandle = await App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    const screen = screenForUrl(event.url);
    if (screen) handler(screen);
  });

  const launch = await App.getLaunchUrl();
  if (launch?.url) {
    const screen = screenForUrl(launch.url);
    if (screen) handler(screen);
  }

  return () => {
    void listenerHandle.remove();
  };
}
