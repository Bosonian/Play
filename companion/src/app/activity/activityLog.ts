// THE RULE: the activity log answers "what did the app DO", never "what did
// the user see". A state transition, a scheduled action, a sync result, a
// detection firing — yes. A render, a query, a screen visit — never.
// One exact sentence per row. Enforced at review.
import { db, type CompanionDatabase } from '../db/store';
import { safeUuid } from '../lib/uuid';
import { APP_VERSION } from '../lib/version';
import type { ActivityCategory, ActivityRow } from './types';

// How many rows the log keeps on-device. Old rows beyond this are pruned by
// runAppOpen below, oldest first.
export const ACTIVITY_LOG_KEEP = 2000;

// Fire-and-forget: NEVER throws, NEVER blocks, and callers never await it.
// A logging call must not be able to break the feature it's instrumenting —
// worst case, a line is silently lost (see store.ts's SPEC RISK A comment on
// why logEvent must never be called inside a database.transaction callback,
// which is exactly this failure mode in practice).
export function logEvent(
  category: ActivityCategory,
  message: string,
  database: CompanionDatabase = db,
): void {
  try {
    void database.activityLog
      .put({ id: safeUuid(), at: new Date().toISOString(), category, message })
      .catch(() => {});
  } catch {
    /* swallow — see contract */
  }
}

// Deletes the oldest rows once the table exceeds `keep`. Returns the number
// removed (0 if already under the cap). Called once per app open, from
// runAppOpen below.
export async function pruneActivityLog(
  database: CompanionDatabase,
  keep: number = ACTIVITY_LOG_KEEP,
): Promise<number> {
  const count = await database.activityLog.count();
  if (count <= keep) return 0;
  const removeCount = count - keep;
  const oldestKeys = await database.activityLog.orderBy('at').limit(removeCount).primaryKeys();
  await database.activityLog.bulkDelete(oldestKeys);
  return oldestKeys.length;
}

// "<at> [<category>] <message>" — the one-line-per-row format shared by the
// on-screen Activity log list and the text handed to Share log / clipboard.
export function formatLogLine(row: ActivityRow): string {
  return `${row.at} [${row.category}] ${row.message}`;
}

// Newest `limit` rows, returned in CHRONOLOGICAL order (oldest of the slice
// first) so the exported/shared text reads top-to-bottom like a log, not
// newest-first like the on-screen list.
export async function captureRecentLog(
  database: CompanionDatabase,
  limit: number,
): Promise<string> {
  const rows = await database.activityLog.orderBy('at').reverse().limit(limit).toArray();
  rows.reverse();
  return rows.map(formatLogLine).join('\n');
}

// Module-scoped guard: this module is a long-lived singleton import, not a
// per-render hook, so a plain `let` (not React state) is the right tool —
// it dedupes the "App opened" line across React StrictMode's double-invoke
// in dev without needing any React machinery here (this file must never
// import React — see the module header contract).
let appOpenRan = false;

// Called once, outside React (main.tsx), on process start. Logs the
// lifecycle line and prunes old rows so the table doesn't grow unbounded on
// a device that's never uninstalled.
export function runAppOpen(database: CompanionDatabase = db): void {
  if (appOpenRan) return;
  appOpenRan = true;
  logEvent('lifecycle', `App opened (version ${APP_VERSION})`, database);
  void pruneActivityLog(database)
    .then((n) => {
      if (n > 0) logEvent('lifecycle', `Pruned activity log: removed ${n} entries`, database);
    })
    .catch(() => {});
}
