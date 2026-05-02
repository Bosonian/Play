import Dexie, { type EntityTable } from 'dexie';
import type {
  UserProfile,
  Task,
  DailyScene,
  PropSeed,
  SceneSeed,
  WeeklyReflection,
} from './types';

// Single Dexie database for the whole app. Database name 'playdhd' is the
// IndexedDB database identifier — changing it would orphan all existing local
// data, so don't.
//
// Schema versioning: bump version() and add a new .stores() block (or
// .upgrade() callback) when changing schema. Dexie handles additive changes
// automatically; field renames or data migrations need an explicit upgrade.
export class PlayDHDDatabase extends Dexie {
  // The `!` tells TS these are initialized by Dexie's stores() call.
  userProfile!: EntityTable<UserProfile, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  dailyScenes!: EntityTable<DailyScene, 'id'>;
  propSeeds!: EntityTable<PropSeed, 'id'>;
  sceneSeeds!: EntityTable<SceneSeed, 'id'>;
  weeklyReflections!: EntityTable<WeeklyReflection, 'id'>;

  constructor() {
    super('playdhd');
    // Schema strings: `&` = unique index; plain field = regular index;
    // `[a+b]` = compound index (queryable as a single key).
    //
    // active and lastShownAt on seed tables are intentionally NOT indexed —
    // IndexedDB rejects boolean and null index values, and with ~15-20 rows
    // an in-memory filter is faster than working around that limitation.
    this.version(1).stores({
      userProfile: '&id',
      tasks: '&id, status, createdAt, [status+createdAt]',
      dailyScenes: '&id, &date',
      propSeeds: '&id',
      sceneSeeds: '&id',
      weeklyReflections: '&id, &weekStartDate',
    });
  }
}

export const db = new PlayDHDDatabase();
