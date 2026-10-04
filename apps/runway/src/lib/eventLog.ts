import { db } from '../db/db';
import type { EventCategory, RunwayEvent } from '../db/types';

// A local, capped record of what the app DID — not what the user saw. The
// rule every call site of `logEvent` below is held to: this log answers
// "what did the app DO", never "what did the user see" — a render, a query
// resolving, a screen mounting are NOT events; a departure created, an
// alarm armed, an arrival detected, a task finishing ARE. Two field bugs
// this week ("finished task vanished", "left departure stranded when
// Android killed the app mid-drive") had to be diagnosed by reading code
// and reconstructing what must have happened — this exists so that
// reconstruction has a real trail to read instead of guesswork. Local-first
// stays binding: nothing here ever leaves the device except when the user
// explicitly shares the log (ActivityLog.tsx's "Share log") or attaches it
// to a field report (ReportProblem.tsx, opt-in, default OFF).

export type { EventCategory };

/** Keep the newest N rows, prune the rest — see `pruneEventLog` below for
 * why this is a fixed count, not a fixed time window. */
const RETAIN_COUNT = 2000;

/**
 * Writes one event. Fire-and-forget by contract: every call site in this
 * app calls this as `void logEvent(...)`, never `await`s it, because a
 * logging failure must never be the reason a real user action (checking a
 * step, leaving, ending a sprint) fails or even pauses. The try/catch below
 * is what makes that contract honest — an IndexedDB write CAN fail (quota,
 * a browser in a locked-down private-browsing mode, a genuinely corrupt
 * database), and none of those should ever surface as an unhandled
 * rejection or, worse, block whatever the caller was actually doing.
 *
 * Timestamps internally (`new Date().toISOString()`) rather than taking
 * `at` as a parameter — unlike this app's usual "pass `now` in for
 * testability" rule (projection.ts, examProjection.ts, ...), a log line's
 * whole job is to record when the app actually noticed the event, and a
 * caller-supplied `now` would just be `new Date()` at the call site anyway
 * in every real usage; there's no scenario where a log call needs a
 * simulated clock the way a projection's live countdown does.
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
    console.warn('Runway: logEvent failed', err);
  }
}

/**
 * Keeps the newest `RETAIN_COUNT` rows and deletes the rest. Called once,
 * fire-and-forget, from main.tsx's startup sequence, beside the other
 * materializers — deliberately NOT on every write (a count-and-maybe-delete
 * after every single `logEvent` call would mean every checked step, every
 * gauge refresh, pays for a `db.events.count()` it almost never needs). One
 * cheap pass on open is the same trade every other startup-only sweep in
 * this app makes (see materialize.ts's `sweepStaleAutoDepartures`): the log
 * can overshoot `RETAIN_COUNT` by however many events land between one app
 * open and the next, which is bounded by how often Deepak actually uses the
 * app — an acceptable, self-correcting slop, not unbounded growth.
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
    console.warn('Runway: pruneEventLog failed', err);
  }
}

/**
 * Newest-first events, capped to `limit` — the read side for
 * ActivityLog.tsx's viewer and ReportProblem.tsx's opt-in attachment.
 * Returns `[]` (never throws) on a read failure, same "never break the
 * screen that asked" contract as every other Dexie-touching helper in this
 * app that has no user-facing error state of its own to report through.
 */
export async function recentEvents(limit: number): Promise<RunwayEvent[]> {
  try {
    return await db.events.orderBy('at').reverse().limit(limit).toArray();
  } catch (err) {
    console.warn('Runway: recentEvents failed', err);
    return [];
  }
}

/**
 * "2026-07-14 09:41:03 [departure] Out the door: Klinik appointment." — the
 * one-line-per-event form both the viewer and the report attachment render.
 * Pure and local-time (not `toISOString()`'s UTC), matching every other
 * display-time formatter in src/lib/format.ts — a log read the morning
 * after should show the time it actually happened in Stuttgart, not a UTC
 * offset Deepak has to do arithmetic on. Built with plain `Date` getters
 * rather than pulling in format.ts's `format()` (date-fns) for one more
 * import: HH:mm:ss has no existing formatter in this app (format.ts only
 * ever needed HH:mm, seconds-free, until now), and hand-formatting three
 * zero-padded numbers is simpler than adding a new date-fns pattern for a
 * single caller.
 */
export function formatEventLine(event: RunwayEvent): string {
  const date = new Date(event.at);
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s} [${event.category}] ${event.message}`;
}
