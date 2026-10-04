import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';

// The ONLY file that imports @capacitor-community/keep-awake. Gated to
// native even though the plugin's web fallback (the browser's Wake Lock
// API) would technically work in a desktop dev session too — keeping
// screen-on strictly native-only matches RUNWAY_PLAN.md §5.2's framing of
// it as a phone-in-hand feature, and avoids a dev/prod behavioural split
// that would make "why is my laptop screen staying on" a confusing bug to
// track down later.

/** Prevents the screen from dimming/locking. Call on Runway-screen mount
 * while status is 'running'. */
export async function keepAwake(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await KeepAwake.keepAwake();
}

/** Releases the keep-awake lock. Call on Runway-screen unmount, and as soon
 * as the departure reaches a terminal status. */
export async function allowSleep(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await KeepAwake.allowSleep();
}
