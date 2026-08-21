import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// The ONLY file that imports @capacitor/haptics. Exposes a small named-
// intensity API rather than re-exporting ImpactStyle, so call sites read as
// "light tap" / "heavy tap" instead of an unfamiliar enum.

export type HapticIntensity = 'light' | 'medium' | 'heavy';

const STYLE_BY_INTENSITY: Record<HapticIntensity, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
};

/** Fires an impact haptic. No-ops on web/dev. Runway screen uses `light` for
 * step check/uncheck and `heavy` for "I'm out the door". */
export async function hapticImpact(intensity: HapticIntensity): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await Haptics.impact({ style: STYLE_BY_INTENSITY[intensity] });
}
