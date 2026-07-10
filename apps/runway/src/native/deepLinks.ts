import { App } from '@capacitor/app';
import type { URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Screen } from '../App';
import { parseSharedDestination } from '../lib/shareTarget';
import { recordExternalArrival } from '../lib/externalArrival';

// The ONLY file that imports @capacitor/app. Routes this app defines:
// `runway://exam` (Prüfung overview) and `runway://new-departure` (a blank
// DepartureSetup) from W1 — reached from the Prüfung widget's tap target
// (PruefungWidgetProvider.java) and the static home-screen shortcuts
// (res/xml/shortcuts.xml) — plus two more from W2:
// `runway://departure/{id}` (a specific departure's live Runway screen) from
// the departure widget's tap target (DepartureWidgetProvider.java), and
// `runway://home` from that same widget's "no departure planned" fallback
// tap target. Calendar/share-target increment (E1) adds
// `runway://share-target?text=...` — see MainActivity.rewriteShareTargetIntent
// for how a raw Android share becomes this URL with no new native bridge
// code. Arrival-detection increment (0.23.0) adds `runway://arrived` — the
// URL Deepak's own Samsung Modes & Routines automation opens on reaching the
// hospital (README.md's "Automatic arrival" section) — handled specially in
// `handleUrl` below rather than through `screenForUrl`: unlike every other
// route, it carries no departure id and isn't a plain URL-to-Screen mapping
// at all — see `recordExternalArrival` (src/lib/externalArrival.ts) for the
// Dexie lookup that decides which departure (if any) it means. Kept
// decoupled from `../lib/navigationRef` the same way notifications.ts's
// registerNotificationNavigation is: this file only turns a URL into a
// Screen and hands it to a caller-supplied function, rather than importing
// navigationRef directly — main.tsx is what wires the two together, same
// shape as its registerNotificationNavigation(navigateToDeparture) call just
// above where this is used.

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
    case 'share-target': {
      // `text` is the raw, still-URL-encoded EXTRA_TEXT Android's share
      // sheet handed MainActivity — `URL`'s own `searchParams` decodes it
      // for us. parseSharedDestination (src/lib/shareTarget.ts) does the
      // actual "strip the Maps link, keep the place name" work; an empty
      // result (share had nothing usable — an all-URL share, or an empty
      // one) still routes to departureSetup, just with no prefill, rather
      // than being treated as an unrecognised URL.
      const text = parsed.searchParams.get('text') ?? '';
      const destination = parseSharedDestination(text);
      return destination === ''
        ? { name: 'departureSetup' }
        : { name: 'departureSetup', prefillDestination: destination };
    }
    // `arrived` is deliberately NOT a case here — see `handleUrl` below,
    // which intercepts it before this function is ever called. It has no
    // Screen of its own to mean; which Screen (if any) it resolves to
    // depends on an async Dexie lookup this synchronous function can't do.
    default:
      return null;
  }
}

/** Whether `url` is the `runway://arrived` deep link — see `handleUrl`
 * below for why this needs its own check rather than folding into
 * `screenForUrl`. Same URL-parsing shape as that function (try the `URL`
 * constructor, treat anything unparseable or non-`runway:` as "no"). */
function isArrivedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'runway:' && parsed.hostname === 'arrived';
  } catch {
    return false;
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

// Arrival-detection increment: `runway://arrived` deliberately does NOT
// participate in `lastHandledUrl` above — it's a bare signal with no
// departure id, so EVERY delivery of it is the literal same string, unlike
// every other route (which either carries a unique id or is a one-off
// static action). If it reused `lastHandledUrl`, the very first successful
// arrival would permanently poison the dedupe for every later one: the
// Samsung routine behind this link fires once per real hospital arrival,
// meaning DIFFERENT days would keep sending the identical URL, and
// `lastHandledUrl`'s plain string-equality check has no way to tell
// "the same cold-start delivered twice" (which genuinely needs deduping —
// see registerDeepLinkNavigation's own doc comment) apart from "a
// completely new, later arrival" (which must NOT be deduped). This flag is
// a narrower, self-clearing guard instead: it only suppresses a second
// `runway://arrived` delivery that lands WHILE the first one's
// `recordExternalArrival()` call is still in flight — exactly the
// appUrlOpen-listener-vs-getLaunchUrl() race a single cold start can
// produce — and resets the moment that call settles, so the next GENUINE
// arrival (seconds, hours, or days later) is handled fresh.
let arrivedHandlingInFlight = false;

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
    // runway://arrived is handled entirely separately from every other
    // route — see `arrivedHandlingInFlight`'s own comment above for why it
    // can't reuse `lastHandledUrl` below. NOT a navigation on its own: the
    // Screen it resolves to (if any) depends on which departure, if any,
    // `recordExternalArrival` finds — see src/lib/externalArrival.ts.
    if (isArrivedUrl(url)) {
      if (arrivedHandlingInFlight) return; // the other cold-start path already picked this up
      arrivedHandlingInFlight = true;
      void recordExternalArrival()
        .then((screen) => handler(screen))
        .finally(() => {
          arrivedHandlingInFlight = false;
        });
      return;
    }

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
