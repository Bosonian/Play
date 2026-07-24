import type { Meal, Movement, Setting, TideEvent, WeighIn } from '../db/types';
import { APP_VERSION } from './appVersion';
import { FEEDBACK_TOKEN_SETTING } from './reportSettings';

// Backup increment (6): manual export/import of the whole IndexedDB as one
// JSON file. Ported from apps/runway/src/lib/backup.ts, ~verbatim — see that
// file's own header comment for the split this preserves: `buildBackup` and
// `validateBackup` are pure (no Dexie, no native file/share calls), so
// they're testable with zero IndexedDB setup and have exactly one job:
// decide what a backup file IS, not how to read or write one.
// src/lib/restoreBackup.ts (the Dexie-transaction half) and
// src/native/backupFile.ts (the file-write half) both build on this file
// rather than duplicating its shape.

/**
 * Settings-table keys deliberately EXCLUDED from every backup — for Tide,
 * just the GitHub field-report token (src/lib/reportSettings.ts's
 * FEEDBACK_TOKEN_SETTING). Tide has only this one secret-shaped setting,
 * unlike Runway's three (Routes API key, Gemini API key, feedback token) —
 * Health Connect's own settings rows (healthSettings.ts) are flags and
 * cursors, not credentials; Health Connect's actual permission grant lives
 * in Android, not in this app's Dexie at all. Same reasoning as Runway's own
 * SECRET_SETTING_KEYS, carried across verbatim: a backup file's whole
 * purpose is to travel (Drive, email, a second phone), and a plaintext token
 * traveling with it is a liability an ordinary settings row isn't —
 * re-obtaining a GitHub token costs a couple of minutes; a leaked one costs
 * however long it takes to notice and revoke it.
 */
export const SECRET_SETTING_KEYS: string[] = [FEEDBACK_TOKEN_SETTING];

/** Settings-table key for "when did Export backup last succeed" —
 * Settings.tsx's own write site (only written after a successful export: a
 * cancelled/failed export must not claim a backup happened). Same key name
 * Runway uses for the identical concept — no reason for the two apps'
 * settings rows to disagree on this. */
export const LAST_BACKUP_AT_SETTING = 'lastBackupAt';

/**
 * Every table this backup carries — DELIBERATELY not all six of Tide's
 * Dexie tables (see db/db.ts's `TideDB` class for the full list).
 * `fieldReports` is excluded ENTIRELY, not merely filtered the way
 * `settings` is below — two independent reasons, both worth naming plainly
 * (CLAUDE.md's truth-over-reassurance rule):
 *
 *   1. Size. A `FieldReport` can carry a base64-encoded screenshot up to
 *      4MB (ReportProblem.tsx's own MAX_SCREENSHOT_BYTES) each. A handful
 *      of pending reports would make a "personal-scale, one phone's worth
 *      of health data" backup balloon into something an order of magnitude
 *      larger than weighIns + meals + movement + settings + events could
 *      ever be on their own.
 *   2. Nature. A field report is a bug-tracking artifact tied to the app
 *      VERSION and SCREEN it was filed from, already best-effort synced to
 *      GitHub Issues once a token is configured (reportSync.ts) — it isn't
 *      health data the way every other table here is, and restoring a
 *      donor phone's stale report queue onto this device (possibly
 *      clobbering reports still pending sync here) has no upside a health
 *      backup needs. `restoreBackup.ts` mirrors this exclusion: it never
 *      touches `fieldReports`, kept or replaced, for the identical reason.
 *
 * `events` (the activity log) DOES travel, deliberately, unlike
 * `fieldReports` — it's diagnostic history, not user-facing content, small
 * (capped at 2000 rows, eventLog.ts's RETAIN_COUNT), and restoring an old
 * phone's data should restore its trace of what happened too, not silently
 * start that phone's log over at zero. Same call Runway's own backup.ts
 * makes for its own `events` table.
 */
export interface BackupTables {
  weighIns: WeighIn[];
  meals: Meal[];
  movement: Movement[];
  settings: Setting[];
  events: TideEvent[];
}

export interface TideBackup {
  app: 'tide';
  /** `db.verno` at export time — Dexie's own schema version number, not
   * this app's `APP_VERSION`. The two can differ (a release can ship with
   * no schema change at all), and it's the schema version, not the app
   * version, that decides whether an old backup's rows are missing fields
   * the current app expects. */
  schemaVersion: number;
  appVersion: string;
  /** ISO 8601 datetime — this app's universal timestamp shape (db/types.ts's
   * own header comment). The caller passes the `Date` in, rather than this
   * function reading `new Date()` internally, for the same testability
   * reason every pure function elsewhere in this app (trend.ts,
   * healthSync.ts's mergeBodyFat, ...) takes its "now" as an argument. */
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
export function buildBackup(tables: BackupTables, schemaVersion: number, exportedAt: Date): TideBackup {
  return {
    app: 'tide',
    schemaVersion,
    appVersion: APP_VERSION,
    exportedAt: exportedAt.toISOString(),
    tables: {
      ...tables,
      settings: tables.settings.filter((setting) => !SECRET_SETTING_KEYS.includes(setting.key)),
    },
  };
}

export type ValidateBackupResult = { ok: true; backup: TideBackup } | { ok: false; reason: string };

/** Shown for every structural problem — not an object, wrong `app`, no
 * `tables`, no `schemaVersion` — rather than a different sentence per check.
 * Deepak doesn't need to know WHICH field was wrong; he needs to know the
 * file he picked isn't a Tide backup, which is exactly what a malformed-JSON
 * parse failure (Settings.tsx's own try/catch, one level up) already tells
 * him for the same underlying situation ("this file is not what I
 * expected"). One consistent sentence for one consistent kind of failure. */
const NOT_A_BACKUP_REASON = 'That file is not a Tide backup.';

/**
 * Checks that `parsed` (whatever `JSON.parse` produced from an imported
 * file) is actually shaped like a Tide backup, and that its schema version
 * isn't newer than what this app currently understands.
 *
 * Rejects, in order: not a plain object (`null`, an array, a primitive) /
 * `app !== 'tide'` / no `tables` object / no numeric `schemaVersion`. All
 * four share `NOT_A_BACKUP_REASON` (see that constant's own comment).
 *
 * A `schemaVersion` GREATER than `currentSchemaVersion` is rejected with a
 * distinct, actionable reason: importing it would mean writing rows shaped
 * for Dexie tables/fields this build doesn't have yet. A schema version
 * OLDER THAN OR EQUAL TO the current one is ACCEPTED: older rows simply lack
 * whatever fields were added since — and this app's universal
 * undefined-as-null discipline (db/types.ts's header comment) already
 * treats an absent field on any row, restored or not, as the safe default.
 */
export function validateBackup(parsed: unknown, currentSchemaVersion: number): ValidateBackupResult {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: NOT_A_BACKUP_REASON };
  }
  const candidate = parsed as Record<string, unknown>;

  if (candidate.app !== 'tide') {
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
      reason: `This backup is from a newer Tide (schema v${candidate.schemaVersion}). Update the app first, then import.`,
    };
  }

  return { ok: true, backup: candidate as unknown as TideBackup };
}

/** "2026-07-24" — local calendar date (CLAUDE.md's ISO-8601-for-storage
 * rule, applied here to a FILENAME rather than a stored field), so a backup
 * taken late evening in Stuttgart is named for the day it actually happened
 * on, not whatever day UTC had already rolled over to. Hand-formatted
 * locally rather than importing healthSync.ts's own `localDateKey`
 * (semantically a movement-day key owned by that file, not a
 * general-purpose date formatter) or pulling in date-fns for three getters —
 * same "own local formatting, no shared helper for one caller" convention
 * every other single-call-site date format in this app already follows
 * (eventLog.ts's formatEventLine, healthSync.ts's own localDateKey,
 * ActivityLog.tsx's formatDayHeading). */
function localDateForFilename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "tide-backup-2026-07-24.json" — ISO date (CLAUDE.md: no US-style
 * MM/DD/YYYY anywhere), so filenames sort chronologically wherever they land
 * (Drive, Downloads, an email attachments list) with no locale ambiguity
 * about which number is the month. */
export function backupFilename(date: Date): string {
  return `tide-backup-${localDateForFilename(date)}.json`;
}
