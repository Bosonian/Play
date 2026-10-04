import { db } from '../db/db';
import type { EventCategory, TideEvent } from '../db/types';

// Ported from apps/runway/src/lib/eventLog.ts verbatim in spirit — a local,
// capped record of what the app DID, not what the user saw. The rule every
// call site of `logEvent` below is held to: this log answers "what did the
// app DO", never "what did the user see" — a render, a query resolving, a
// screen mounting are NOT events; a weigh-in saved, an update noticed, the
// app starting/resuming ARE. Local-first stays binding: nothing here ever
// leaves the device (Tide has no share/export path yet — TIDE_PLAN.md §7
// puts backup, ported from Runway, in a later increment; this table is
// already shaped to feed that the same way Runway's does).

export type { EventCategory };

/** Keep the newest N rows, prune the rest — see `pruneEventLog` below for
 * why this is a fixed count, not a fixed time window. Same value as
 * Runway's own RETAIN_COUNT — no reason for Tide's log to have a different
 * retention floor than the sibling app it's ported from. */
const RETAIN_COUNT = 2000;

/**
 * Writes one event. Fire-and-forget by contract: every call site in this
 * app calls this as `void logEvent(...)`, never `await`s it, because a
 * logging failure must never be the reason a real user action (saving a
 * weigh-in) fails or even pauses. The try/catch below is what makes that
 * contract honest — an IndexedDB write CAN fail (quota, a browser in a
 * locked-down private-browsing mode, a genuinely corrupt database), and
 * none of those should ever surface as an unhandled rejection or, worse,
 * block whatever the caller was actually doing.
 *
 * Timestamps internally (`new Date().toISOString()`), same reasoning as
 * Runway's own logEvent: a log line's whole job is to record when the app
 * actually noticed the event, and there's no scenario here where a log call
 * needs a simulated clock the way trend.ts's pure functions might in a
 * test.
 */
export async function logEvent(category: EventCategory, message: string): Promise<void> {
  try {
    await db.events.add({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      category,
      message,
    });
  } catch (err) {
    console.warn('Tide: logEvent failed', err);
  }
}

/**
 * Keeps the newest `RETAIN_COUNT` rows and deletes the rest. Called once,
 * fire-and-forget, from main.tsx's startup sequence — same "one cheap pass
 * on open, not a count-and-maybe-delete after every single logEvent call"
 * reasoning as Runway's own pruneEventLog. The log can overshoot
 * `RETAIN_COUNT` by however many events land between one app open and the
 * next — an acceptable, self-correcting slop, not unbounded growth.
 */
export async function pruneEventLog(): Promise<void> {
  try {
    const count = await db.events.count();
    if (count <= RETAIN_COUNT) return;
    // Oldest-first primary keys, only as many as need deleting — cheaper
    // than loading every row's full contents just to find the old ones.
    const staleIds = await db.events.orderBy('at').limit(count - RETAIN_COUNT).primaryKeys();
    await db.events.bulkDelete(staleIds);
  } catch (err) {
    console.warn('Tide: pruneEventLog failed', err);
  }
}

/**
 * Newest-first events, capped to `limit`. Returns `[]` (never throws) on a
 * read failure — same "never break the screen that asked" contract as every
 * other Dexie-touching helper with no user-facing error state of its own to
 * report through. No viewer screen reads this yet this increment (Runway's
 * ActivityLog.tsx has no Tide equivalent yet); exported now so Settings can
 * grow one without this file changing shape.
 */
export async function recentEvents(limit: number): Promise<TideEvent[]> {
  try {
    return await db.events.orderBy('at').reverse().limit(limit).toArray();
  } catch (err) {
    console.warn('Tide: recentEvents failed', err);
    return [];
  }
}

/**
 * "2026-07-14 09:41:03 [weighin] Weigh-in logged: 98.4 kg." — the one-line-
 * per-event form. Pure and local-time (not `toISOString()`'s UTC) — a log
 * read the morning after should show the time it actually happened in
 * Stuttgart, not a UTC offset Deepak has to do arithmetic on. Hand-formatted
 * (plain `Date` getters) rather than pulling in a date-fns pattern for one
 * caller, same call Runway's own formatEventLine makes.
 */
export function formatEventLine(event: TideEvent): string {
  const date = new Date(event.at);
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s} [${event.category}] ${event.message}`;
}
