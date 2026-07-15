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

    // When a future schema bump opens a new DB version in another tab, let the
    // old connection (this one) close so the upgrade isn't blocked forever —
    // otherwise the new tab hangs on open() and shows a blank screen. And if
    // WE are the tab blocked by an older connection, surface it rather than
    // hang silently. (robustness audit P0 — latent until the first version bump.)
    this.on('versionchange', () => {
      this.close();
    });
    this.on('blocked', () => {
      // eslint-disable-next-line no-console
      console.warn('[Head-in] database upgrade blocked — close other open tabs.');
    });
  }
}

export const db = new HeadInDatabase();

// Read the settings row, creating it with defaults on first run. Idempotent.
// Returns a fresh copy of the defaults so callers can't mutate the shared
// DEFAULT_SETTINGS constant.
export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('settings');
  if (existing) return existing;
  const fresh = { ...DEFAULT_SETTINGS };
  await db.settings.put(fresh);
  return fresh;
}

// Patch settings atomically. The read-modify-write runs inside a transaction so
// two rapid toggles can't read the same row and clobber each other's change.
export async function updateSettings(
  patch: Partial<Omit<Settings, 'id'>>,
): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = (await db.settings.get('settings')) ?? { ...DEFAULT_SETTINGS };
    await db.settings.put({ ...current, ...patch, id: 'settings' });
  });
}
