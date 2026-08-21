import { db } from '../db/db';
import type { FocusSoundKind } from '../audio/focusSound';

// Settings-table keys for the focus-sound increment (0.33.0), same
// one-key-one-constant shape as dayGaugeSettings.ts's
// DAY_GAUGE_ENABLED_SETTING. Three rows in the existing key-value
// `settings` table (db/db.ts v2) — a noise kind, a volume, and an on/off
// flag don't earn a schema change.
export const FOCUS_SOUND_KIND_SETTING = 'focusSoundKind';
export const FOCUS_SOUND_VOLUME_SETTING = 'focusSoundVolume';
export const FOCUS_SOUND_ON_SETTING = 'focusSoundOn';

// 'brown' by default - see focusSound.ts's own doc comment on FocusSoundKind
// for why (least hissy of the three, judged most comfortable to sit under
// for a full 50-minute sprint).
const DEFAULT_KIND: FocusSoundKind = 'brown';
const DEFAULT_VOLUME_PERCENT = '40';

export interface FocusSoundConfig {
  kind: FocusSoundKind;
  /** 0-1, ready to hand straight to `startFocusSound`. */
  volume0to1: number;
  on: boolean;
}

function isFocusSoundKind(value: string | undefined): value is FocusSoundKind {
  return value === 'brown' || value === 'pink' || value === 'white';
}

/**
 * Single source of truth for "what should the focus sound be doing right
 * now" - Sprint.tsx and TaskRun.tsx both read through here on mount rather
 * than the three settings rows directly, same reasoning as
 * liveTravelSettings.ts's readLiveTravelConfig. `on` deliberately defaults
 * to `false` when the row is absent (CLAUDE.md's "defaults lean toward
 * less, not more") - a fresh install, or one where Deepak has never
 * touched this, should never start making noise nobody asked for.
 */
export async function readFocusSoundConfig(): Promise<FocusSoundConfig> {
  const [kindRow, volumeRow, onRow] = await Promise.all([
    db.settings.get(FOCUS_SOUND_KIND_SETTING),
    db.settings.get(FOCUS_SOUND_VOLUME_SETTING),
    db.settings.get(FOCUS_SOUND_ON_SETTING),
  ]);
  const kind = isFocusSoundKind(kindRow?.value) ? kindRow.value : DEFAULT_KIND;
  const rawVolume = Number(volumeRow?.value ?? DEFAULT_VOLUME_PERCENT);
  const volumePercent = Number.isFinite(rawVolume) ? rawVolume : Number(DEFAULT_VOLUME_PERCENT);
  const on = onRow?.value === 'true';
  return { kind, volume0to1: volumePercent / 100, on };
}
