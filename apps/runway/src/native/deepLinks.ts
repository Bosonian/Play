import { App } from '@capacitor/app';
import type { URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Screen } from '../App';

// The ONLY file that imports @capacitor/app. Routes this app defines:
// `runway://exam` (Prüfung overview) and `runway://new-departure` (a blank
// DepartureSetup) from W1 — reached from the Prüfung widget's tap target
// (PruefungWidgetProvider.java) and the static home-screen shortcuts
// (res/xml/shortcuts.xml) — plus two more from W2:
// `runway://departure/{id}` (a specific departure's live Runway screen) from
// the departure widget's tap target (DepartureWidgetProvider.java), and
// `runway://home` from that same widget's "no departure planned" fallback
// tap target. Kept decoupled from `../lib/navigationRef` the same way
// notifications.ts's registerNotificationNavigation is: this file only turns
// a URL into a Screen and hands it to a caller-supplied function, rather
// than importing navigationRef directly — main.tsx is what wires the two
// together, same shape as its registerNotificationNavigation(
// navigateToDeparture) call just above where this is used.

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
    case 'departure': {
      // `runway://departure/{id}` — the id is the first path segment after
      // the host. `.filter(Boolean)` drops the empty string a leading `/`
      // would otherwise produce, so both "runway://departure/abc" and a
      // stray "runway://departure//abc" resolve the same id, and a
      // malformed URL with no id at all (`runway://departure`) falls
      // through to the null below rather than navigating with an empty
      // departureId.
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id ? { name: 'runway', departureId: id } : null;
    }
    case 'home':
      return { name: 'home' };
    default:
      return null;
  }
}

// m7 cold-start dedupe: module-level, not component state, because this
// file's only caller (registerDeepLinkNavigation) is itself only ever
// invoked once for the app's whole lifetime (see that function's own doc
// comment) — a module-level variable and a per-call one would behave
// identically here, and module-level avoids threading it through the
// closure for no benefit. Set once a URL is actually handled (i.e. it
// resolved to a real Screen); an unrecognised URL never overwrites it,
// since nothing was navigated to for the dedupe to guard.
let lastHandledUrl: string | null = null;

/**
 * Registers the tap/deep-link handler once, for the lifetime of the app,
 * and handles the cold-start case in the same call. Returns an unsubscribe
 * function so the caller (main.tsx) could clean up, though in practice this
 * is registered once at startup and lives for the app's whole lifetime, the
 * same as registerNotificationNavigation.
 *
 * Cold start (m7, corrected): this file's earlier comment described
 * `getLaunchUrl()` as THE way to catch a cold start, as if the `appUrlOpen`
 * listener below only ever fired for a deep link tapped while the app was
 * already running. That's not what BridgeActivity actually does — see
 * node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java's
 * `load()`, which calls `onNewIntent(getIntent())` on every cold start,
 * and @capacitor/app's AppPlugin.handleOnNewIntent, which turns that into a
 * *retained* `appUrlOpen` notification (delivered to a listener as soon as
 * one registers, even though the underlying Android intent fired before the
 * listener existed). So a cold start via a runway:// intent fires
 * `appUrlOpen` too, and `getLaunchUrl()` here is a belt-and-suspenders
 * SECOND path, not the sole cold-start mechanism. Without deduping, that
 * means a cold-start deep link is handled twice — once from each path —
 * which double-navigates on the very first screen the app shows.
 * `lastHandledUrl` above is what makes that harmless BY CONSTRUCTION
 * (whichever path runs second is always a no-op for the same URL) rather
 * than relying on every individual route/handler being idempotent to a
 * repeated call.
 */
export async function registerDeepLinkNavigation(handler: (screen: Screen) => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const handleUrl = (url: string) => {
    if (url === lastHandledUrl) return; // already handled via the other cold-start path
    const screen = screenForUrl(url);
    if (!screen) return;
    lastHandledUrl = url;
    handler(screen);
  };

  const listenerHandle = await App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    handleUrl(event.url);
  });

  const launch = await App.getLaunchUrl();
  if (launch?.url) {
    handleUrl(launch.url);
  }

  return () => {
    void listenerHandle.remove();
  };
}
