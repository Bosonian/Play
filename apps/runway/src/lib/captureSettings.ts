import { db } from '../db/db';

// Settings-table key for the quick-capture increment (E2) — same "one more
// row in the existing key-value `settings` table" treatment as the Routes
// API key (liveTravelSettings.ts) and the feedback token (reportSettings.ts):
// a single API key doesn't earn a dedicated table.
export const GEMINI_API_KEY_SETTING = 'geminiApiKey';

export interface CaptureConfig {
  apiKey: string;
}

/**
 * Single source of truth for "is quick capture usable right now" — an empty
 * key IS the disabled state (unlike live travel, there's no separate
 * enabled/disabled toggle to AND against: Home's own "only render the
 * capture box when a key exists" check reads through here, mirroring
 * readLiveTravelConfig/readReportConfig's read-through-only shape).
 */
export async function readCaptureConfig(): Promise<CaptureConfig> {
  const keyRow = await db.settings.get(GEMINI_API_KEY_SETTING);
  return { apiKey: keyRow?.value ?? '' };
}
