import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Screen } from '../App';
import { backTarget } from '../lib/backTarget';
import { consumeBackOverride } from '../lib/backOverride';

/**
 * THE FIELD BUG this file exists to fix: "navigating with swipe doesn't
 * work." Navigation in this app is plain React state (App.tsx's own Screen
 * comment), not the browser's History API — there is no WebView back-stack
 * for Android's back gesture to walk. Before this file, NOTHING listened
 * for Capacitor's `backButton` event, so Capacitor's own default kicked in:
 * finish the Activity. A back swipe (or the hardware/3-button back) EXITED
 * THE APP instead of going back one screen.
 *
 * Registers Android's back handler once, for the lifetime of the app.
 * Returns an unsubscribe function so the caller (App.tsx, in a mount
 * effect) can clean up under React 18 StrictMode's double-invoke — same
 * shape as registerNotificationNavigation/registerDeepLinkNavigation.
 *
 * LOAD-BEARING FACT, worth restating because it's easy to miss reading this
 * file in isolation: registering ANY listener on `backButton` — even one
 * that does nothing — disables Capacitor's default close-the-activity
 * behaviour for good. See @capacitor/app's definitions.d.ts on
 * `addListener('backButton', ...)` and `exitApp()`'s own doc comment ("This
 * should only be used in conjunction with the `backButton` handler"). This
 * function's existence, not anything it computes, is what stops the app
 * from exiting.
 *
 * Handling order on every backButton event:
 *   1. `consumeBackOverride()` (src/lib/backOverride.ts) — an open overlay
 *      (StepFocus, BackdateDialog) always wins. The overlay is a LENS over
 *      the current screen, not a place of its own (Runway.tsx's own comment
 *      on `focusStepId`), so a back gesture while one's open should close
 *      IT, never navigate the screen underneath.
 *   2. Otherwise, `backTarget(getScreen())` decides. A non-null target
 *      navigates there. `null` (only ever `home`, the root) means there's
 *      nowhere left to go back TO.
 *
 * At the root, this calls `App.minimizeApp()` — NOT `App.exitApp()`.
 * Android 12+'s own predictive-back gesture already backgrounds the task
 * rather than killing it once the back-stack is empty; matching that here
 * keeps Runway's root-back behaviour consistent with every other app on the
 * device, not a surprising exception. It also matters functionally, not
 * just cosmetically: `exitApp()` tears down the JS runtime entirely, which
 * would kill whatever's keeping a live projection warm (Runway/TaskRun's
 * per-second `useNow` tick, the `keepAwake` lock) — exiting is strictly
 * worse than backgrounding for an app whose whole point is a live countdown
 * someone might glance back at a minute later.
 *
 * UNVERIFIED until tried on the physical device (same class as
 * notifications.ts's cold-start caveats, flagged per CLAUDE.md rather than
 * asserted as working): whether a gesture-nav swipe and the classic
 * 3-button back deliver `backButton` identically, and specifically whether
 * StepFocus's immersive full-screen overlay still lets the OS deliver the
 * event at all rather than intercepting the gesture itself before Capacitor
 * ever sees it.
 */
export async function registerBackGesture(
  getScreen: () => Screen,
  navigate: (screen: Screen) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const listenerHandle = await App.addListener('backButton', () => {
    if (consumeBackOverride()) return;

    const target = backTarget(getScreen());
    if (target === null) {
      void App.minimizeApp();
      return;
    }
    navigate(target);
  });

  return () => {
    void listenerHandle.remove();
  };
}
