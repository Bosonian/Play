import { db } from '../db/db';

// Settings-table keys for the live-travel increment (RUNWAY_PLAN.md
// §5.1+§5.6). Both rows live in the existing key-value `settings` table
// (db/db.ts v2) — the same table the first-run card's dismissal flag
// already uses — rather than a new table or a new Dexie version, because
// two more rows don't earn a schema change.
export const ROUTES_API_KEY_SETTING = 'routesApiKey';
export const LIVE_TRAVEL_ENABLED_SETTING = 'liveTravelEnabled';

export interface LiveTravelConfig {
  apiKey: string;
  enabled: boolean;
}

/**
 * Single source of truth for "is live travel actually usable right now".
 * Settings.tsx, DepartureSetup.tsx and Runway.tsx (via useLiveTravel) all
 * read through here rather than the two settings rows directly, so the
 * AND-of-both-conditions rule lives in exactly one place: a saved key with
 * the toggle off is not enabled, and a toggle left on after the key is
 * cleared is not enabled either (Settings.tsx also force-clears the toggle
 * when the key is cleared, but this is the backstop that makes that
 * enforcement redundant rather than load-bearing).
 */
export async function readLiveTravelConfig(): Promise<LiveTravelConfig> {
  const [keyRow, enabledRow] = await Promise.all([
    db.settings.get(ROUTES_API_KEY_SETTING),
    db.settings.get(LIVE_TRAVEL_ENABLED_SETTING),
  ]);
  const apiKey = keyRow?.value ?? '';
  const enabled = apiKey !== '' && enabledRow?.value === 'true';
  return { apiKey, enabled };
}
