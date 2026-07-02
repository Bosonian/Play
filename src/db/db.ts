import Dexie, { type EntityTable } from 'dexie';
import type {
  Settings,
  SrsCard,
  Mastery,
  Attempt,
  AchievementUnlock,
} from './types';
import { DEFAULT_SETTINGS } from './types';

// The single Dexie database for Head-in. All data is local/offline.
//
// Schema versioning: bump version() and add a new .stores() block (plus an
// .upgrade() callback for any non-additive change) when the schema changes.
// Dexie handles additive changes (new tables, new indexes) automatically.
export class HeadInDatabase extends Dexie {
  settings!: EntityTable<Settings, 'id'>;
  srsCards!: EntityTable<SrsCard, 'id'>;
  mastery!: EntityTable<Mastery, 'structureId'>;
  attempts!: EntityTable<Attempt, 'id'>;
  achievements!: EntityTable<AchievementUnlock, 'id'>;

  constructor() {
    super('head-in');
    // Index strings: `&` = unique/primary key; plain field = secondary index;
    // `[a+b]` = compound index. `dueOn` is indexed so the daily due query is a
    // range scan; `at`/`factId` on attempts support the stats/weak-spot views.
    this.version(1).stores({
      settings: '&id',
      srsCards: '&id, factId, dueOn',
      mastery: '&structureId',
      attempts: '&id, factId, at, mode',
      achievements: '&id',
    });
  }
}

export const db = new HeadInDatabase();

// Read the settings row, creating it with defaults on first run. Idempotent.
export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('settings');
  if (existing) return existing;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

// Patch settings. Ensures the row exists first so early calls (before any
// getSettings) still work.
export async function updateSettings(
  patch: Partial<Omit<Settings, 'id'>>,
): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'settings' });
}
