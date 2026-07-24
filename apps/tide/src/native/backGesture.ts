import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Screen } from '../App';
import { backTarget } from '../lib/backTarget';

/**
 * THE FIELD BUG this file exists to fix — ported from apps/runway/src/
 * native/backGesture.ts, same underlying bug: Tide has no `backButton`
 * listener at all, and navigation here is plain React state (App.tsx's own
 * Screen comment), not the browser's History API — there is no WebView
 * back-stack for Android's back gesture to walk. Before this file, nothing
 * listened for Capacitor's `backButton` event, so Capacitor's own default
 * kicked in: finish the Activity. A back swipe (or the hardware/3-button
 * back) EXITED THE APP instead of going back one screen.
 *
 * Registers Android's back handler once, for the lifetime of the app.
 * Returns an unsubscribe function so the caller (App.tsx, in a mount
 * effect) can clean up under React 18 StrictMode's double-invoke.
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
 * NO backOverride HERE, unlike Runway's own backGesture.ts — deliberately
 * NOT ported. Runway's src/lib/backOverride.ts exists because StepFocus and
 * BackdateDialog are OVERLAYS a screen renders as a sibling of itself, not
 * screens with an identity of their own, so a back gesture while one is open
 * has to close THAT overlay, never navigate the screen underneath it. Tide
 * has no equivalent as of this increment: every `Screen` variant (App.tsx)
 * is a real, separately-navigable place with its own `ScreenHeader`, and
 * nothing in this app renders as a lens over another screen. If that ever
 * changes, THAT is the moment to port backOverride.ts's stack — not before,
 * since a speculative port with nothing to register against it would just be
 * dead code pretending to be a safety net.
 *
 * Handling on every backButton event: `backTarget(getScreen())` decides. A
 * non-null target navigates there. `null` (only ever `home`, the root)
 * means there's nowhere left to go back to.
 *
 * At the root, this calls `App.minimizeApp()` — NOT `App.exitApp()`.
 * Android 12+'s own predictive-back gesture already backgrounds the task
 * rather than killing it once the back-stack is empty; matching that here
 * keeps Tide's root-back behaviour consistent with every other app on the
 * device, not a surprising exception. `exitApp()` tears down the JS runtime
 * entirely, which would be strictly worse than backgrounding for no benefit
 * — Tide has nothing analogous to Runway's live countdown that needs to
 * keep running in the background, but there is still no reason to prefer
 * destroying the runtime over the OS's own, more familiar behaviour.
 *
 * UNVERIFIED until tried on the physical device (same class of caveat as
 * native/healthConnect.ts's own header comment, and Runway's own
 * backGesture.ts before it): whether a gesture-nav swipe and the classic
 * 3-button back deliver `backButton` identically on this specific device/
 * Android version.
 */
export async function registerBackGesture(
  getScreen: () => Screen,
  navigate: (screen: Screen) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const listenerHandle = await App.addListener('backButton', () => {
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
