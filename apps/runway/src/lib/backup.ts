import type {
  Departure,
  Exam,
  FieldReport,
  Milestone,
  RunwayEvent,
  Setting,
  Sprint,
  Template,
  Topic,
  WorkTask,
} from '../db/types';
import { APP_VERSION } from './appVersion';
import { GEMINI_API_KEY_SETTING } from './captureSettings';
import { formatDateInput } from './format';
import { ROUTES_API_KEY_SETTING } from './liveTravelSettings';
import { FEEDBACK_TOKEN_SETTING } from './reportSettings';

// Backup increment: manual export/import of the whole IndexedDB as one JSON
// file. Everything below is deliberately Dexie-free — `buildBackup` and
// `validateBackup` take plain data in and hand plain data back, so they're
// testable with zero IndexedDB setup and have exactly one job: decide what a
// backup file IS, not how to read or write one. `src/lib/restoreBackup.ts`
// (the Dexie-transaction half) and `src/native/backupFile.ts` (the
// file/share-sheet half) both build on this file rather than duplicating its
// shape.

/**
 * Settings-table keys deliberately EXCLUDED from every backup: the Google
 * Routes API key, the Gemini API key, and the GitHub field-report token — the
 * three secrets this app ever asks Deepak to type in. A backup file's whole
 * purpose is to travel (Drive, email, a second phone), and a secret traveling
 * with it is a liability an ordinary settings row isn't: re-obtaining a key
 * (Google Cloud console, AI Studio, a fresh GitHub token) costs a couple of
 * minutes; a leaked one costs however long it takes to notice and revoke it.
 * Every other settings row (feature toggles, `lastBackupAt` itself, ...)
 * carries no such asymmetry and travels with the backup normally.
 */
export const SECRET_SETTING_KEYS: string[] = [ROUTES_API_KEY_SETTING, GEMINI_API_KEY_SETTING, FEEDBACK_TOKEN_SETTING];

/** Settings-table key for "when did Export backup last succeed" —
 * Settings.tsx's own write site (only written after a successful export: a
 * cancelled share or a failed download must not claim a backup happened). */
export const LAST_BACKUP_AT_SETTING = 'lastBackupAt';

/** Every Dexie table this app has, as of db.ts's v6 schema — see db.ts's own
 * `RunwayDB` class for the authoritative list. Confirmed against it directly
 * rather than assumed: templates, departures, settings, exams, topics,
 * sprints, milestones, fieldReports, tasks, events. Ten tables, ten keys
 * below. `events` (activity-log increment) travels with a backup like any
 * other table — the log is exactly as much "everything Runway has learned"
 * as the rest of this file's contents, and restoring an old phone's data
 * should restore its trace of what happened too, not silently start that
 * phone's log over at zero. */
export interface BackupTables {
  departures: Departure[];
  templates: Template[];
  settings: Setting[];
  exams: Exam[];
  topics: Topic[];
  sprints: Sprint[];
  milestones: Milestone[];
  fieldReports: FieldReport[];
  tasks: WorkTask[];
  events: RunwayEvent[];
}

export interface RunwayBackup {
  app: 'runway';
  /** `db.verno` at export time — Dexie's own schema version number, not this
   * app's `APP_VERSION`. The two can differ (a release can ship with no
   * schema change at all, e.g. 0.30.0's estimate-bias fields — see db.ts's
   * `version()` comments for which fields need a bump and which don't), and
   * it's the schema version, not the app version, that decides whether an
   * old backup's rows are missing fields the current app expects. */
  schemaVersion: number;
  appVersion: string;
  /** ISO 8601 datetime — this app's universal timestamp shape (db/types.ts's
   * own header comment). The caller passes the `Date` in, rather than this
   * function reading `new Date()` internally, for the same testability
   * reason every pure function elsewhere in this app (projection.ts,
   * examProjection.ts, ...) takes `now` as an argument. */
  exportedAt: string;
  tables: BackupTables;
}

/**
 * Assembles a backup object from the current contents of every table.
 * Deliberately synchronous and Dexie-free: the caller (Settings.tsx) is
 * responsible for the actual `db.<table>.toArray()` reads and for passing
 * `db.verno` — this function only knows how to shape data it's handed, not
 * how to fetch it.
 *
 * `settings` is filtered of `SECRET_SETTING_KEYS` here, in the one place a
 * backup object is built, rather than trusting every future caller to
 * remember to filter it themselves before calling in.
 */
export function buildBackup(tables: BackupTables, schemaVersion: number, exportedAt: Date): RunwayBackup {
  return {
    app: 'runway',
    schemaVersion,
    appVersion: APP_VERSION,
    exportedAt: exportedAt.toISOString(),
    tables: {
      ...tables,
      settings: tables.settings.filter((setting) => !SECRET_SETTING_KEYS.includes(setting.key)),
    },
  };
}

export type ValidateBackupResult = { ok: true; backup: RunwayBackup } | { ok: false; reason: string };

/** Shown for every structural problem — not an object, wrong `app`, no
 * `tables`, no `schemaVersion` — rather than a different sentence per check.
 * Deepak doesn't need to know WHICH field was wrong; he needs to know the
 * file he picked isn't a Runway backup, which is exactly what a malformed-
 * JSON parse failure (Settings.tsx's own try/catch, one level up) already
 * tells him for the same underlying situation ("this file is not what I
 * expected"). One consistent sentence for one consistent kind of failure. */
const NOT_A_BACKUP_REASON = 'That file is not a Runway backup.';

/**
 * Checks that `parsed` (whatever `JSON.parse` produced from an imported
 * file) is actually shaped like a Runway backup, and that its schema version
 * isn't newer than what this app currently understands.
 *
 * Rejects, in order: not a plain object (`null`, an array, a primitive) /
 * `app !== 'runway'` / no `tables` object / no numeric `schemaVersion`. All
 * four share `NOT_A_BACKUP_REASON` — see that constant's own comment.
 *
 * A `schemaVersion` GREATER than `currentSchemaVersion` is rejected with a
 * distinct, actionable reason: importing it would mean writing rows shaped
 * for Dexie tables/fields this build doesn't have yet, which isn't a case
 * "read the field that exists, ignore the field that doesn't" can paper
 * over. A schema version OLDER THAN OR EQUAL TO the current one is ACCEPTED:
 * older rows simply lack whatever fields were added since — and this app's
 * universal undefined-as-null discipline (see db/types.ts's many "same
 * undefined-as-null rule" comments, e.g. `Template.schedule`,
 * `Departure.wasReplanned`) already treats an absent field on any row,
 * restored or not, as the safe default. There is nothing schema-specific
 * `restoreBackup` needs to do differently for an older backup.
 */
export function validateBackup(parsed: unknown, currentSchemaVersion: number): ValidateBackupResult {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: NOT_A_BACKUP_REASON };
  }
  const candidate = parsed as Record<string, unknown>;

  if (candidate.app !== 'runway') {
    return { ok: false, reason: NOT_A_BACKUP_REASON };
  }
  if (typeof candidate.tables !== 'object' || candidate.tables === null || Array.isArray(candidate.tables)) {
    return { ok: false, reason: NOT_A_BACKUP_REASON };
  }
  if (typeof candidate.schemaVersion !== 'number') {
    return { ok: false, reason: NOT_A_BACKUP_REASON };
  }
  if (candidate.schemaVersion > currentSchemaVersion) {
    return {
      ok: false,
      reason: `This backup is from a newer Runway (schema v${candidate.schemaVersion}). Update the app first, then import.`,
    };
  }

  return { ok: true, backup: candidate as unknown as RunwayBackup };
}

/**
 * "runway-backup-2026-07-13.json" — ISO date (CLAUDE.md: no US-style
 * MM/DD/YYYY anywhere), so filenames sort chronologically wherever they land
 * (Drive, Downloads, an email attachments list) with no locale ambiguity
 * about which number is the month. Reuses `formatDateInput` (format.ts) —
 * local calendar date, not `date.toISOString()`'s UTC one, so a backup taken
 * late evening in Stuttgart is named for the day it actually happened on,
 * not whatever day UTC had already rolled over to.
 */
export function backupFilename(date: Date): string {
  return `runway-backup-${formatDateInput(date)}.json`;
}
