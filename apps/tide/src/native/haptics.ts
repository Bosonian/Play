import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// Copied from apps/runway/src/native/haptics.ts verbatim in spirit — the
// ONLY file in this app that imports @capacitor/haptics. Exposes a small
// named-intensity API rather than re-exporting ImpactStyle, so call sites
// read as "light tap" instead of an unfamiliar enum.
//
// Delete increment (6): Tide only ever fires `hapticImpact('light')`, on a
// weigh-in save, a plate save, a skipped-meal save, and a row removed — see
// this increment's own report for the full list. Kept as a three-intensity
// API anyway, matching Runway's shape exactly, rather than narrowing it to
// a single no-argument function: a future increment reaching for `'heavy'`
// (say, a more consequential confirm) shouldn't need to redesign this
// module's surface to get it.

export type HapticIntensity = 'light' | 'medium' | 'heavy';

const STYLE_BY_INTENSITY: Record<HapticIntensity, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
};

/** Fires an impact haptic. No-ops on web/dev. Never throws — a haptic is an
 * acknowledgment, not a step in the save itself; a failure here (an
 * unsupported device, a permission quirk) must never surface as an error on
 * an action that already succeeded. */
export async function hapticImpact(intensity: HapticIntensity): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Haptics.impact({ style: STYLE_BY_INTENSITY[intensity] });
  } catch (err) {
    console.warn('Tide: hapticImpact failed', err);
  }
}
