import { db } from '../db/db';
import { readTransitEvents } from '../native/bluetooth';
import { logEvent } from './eventLog';
import { matchTransitsToDepartures, transitWindows } from './transit';
import type { TransitMeasurementsByName, TransitWindow } from './transit';
import { TRANSIT_MEASUREMENTS_SETTING, TRANSIT_SYNC_CURSOR_SETTING } from './transitSettings';

// Car Bluetooth transit increment (0.36.0): the Dexie-touching orchestrator
// around src/lib/transit.ts's pure math — same split every other learning
// pipeline in this app makes (calibration.ts/learning.ts stay pure; Home.tsx
// or a sync file like this one does the reading and writing). Called
// fire-and-forget from main.tsx's startup sequence, beside the other
// materializers.

/** Per-name measured drives are capped here, same "recent enough to still
 * describe reality, not an unbounded log" reasoning as learning.ts's
 * RECENCY_WINDOW (14) for step actuals — 20 is a slightly looser cap since a
 * drive is a coarser, once-a-day-at-most signal, not a per-step one. */
const MAX_MEASUREMENTS_PER_NAME = 20;

async function readMeasurements(): Promise<TransitMeasurementsByName> {
  try {
    const row = await db.settings.get(TRANSIT_MEASUREMENTS_SETTING);
    if (!row || row.value === '') return {};
    return JSON.parse(row.value) as TransitMeasurementsByName;
  } catch (err) {
    // A corrupt or unparseable row is treated as "nothing measured yet"
    // rather than a thrown error — same "never break the feature that asked"
    // contract eventLog.ts's own Dexie-touching functions follow.
    console.warn('Runway: readMeasurements failed', err);
    return {};
  }
}

async function writeMeasurements(measurements: TransitMeasurementsByName): Promise<void> {
  await db.settings.put({ key: TRANSIT_MEASUREMENTS_SETTING, value: JSON.stringify(measurements) });
}

/**
 * Reads the native connect/disconnect ring, turns it into drive windows,
 * matches each against a departure, and merges anything NEW into the
 * persisted per-name measurement row — "new" meaning a window this function
 * hasn't already processed, tracked with a monotonic cursor
 * (`TRANSIT_SYNC_CURSOR_SETTING`, the highest `windowStartMs` seen so far)
 * rather than a growing per-window dedupe set. This works because
 * `transitWindows` always returns windows in ascending `startMs` order (it
 * sorts its input first) and a car only ever drives forward through time —
 * once a window's start has been processed, no future sync can produce an
 * earlier one again. That single number is what keeps a re-run (this fires
 * on every app open) from re-logging or re-persisting the same drive twice,
 * matched or not.
 *
 * Logs one 'transit' event per NEW window either way — matched
 * ("Drive measured: {N} min, matched to {name}.") or not
 * ("Drive measured: {N} min, unmatched.") — so a Bluetooth event that never
 * found a departure to attach to still leaves a trace worth reading in the
 * activity log, same "what did the app DO" discipline eventLog.ts's own
 * header comment states.
 *
 * Fire-and-forget by contract (never awaited by its caller, same as
 * pruneEventLog/materializeScheduledDepartures in main.tsx) and never
 * throws — a native read failure, a malformed settings row, or a Dexie
 * write failure all degrade to "nothing synced this time," not a crash.
 */
export async function syncTransitEvents(): Promise<void> {
  try {
    const events = await readTransitEvents();
    if (events.length === 0) return;

    const windows = transitWindows(events);
    if (windows.length === 0) return;

    const cursorRow = await db.settings.get(TRANSIT_SYNC_CURSOR_SETTING);
    const cursorMs = cursorRow ? Number(cursorRow.value) : 0;
    const newWindows: TransitWindow[] = Number.isFinite(cursorMs)
      ? windows.filter((window) => window.startMs > cursorMs)
      : windows;
    if (newWindows.length === 0) return;

    const departures = await db.departures.toArray();
    const matches = matchTransitsToDepartures(newWindows, departures);
    const matchedStarts = new Set(matches.map((match) => match.windowStartMs));

    const measurements = await readMeasurements();
    for (const match of matches) {
      const existing = measurements[match.departureName] ?? [];
      existing.push({ minutes: match.minutes, atMs: match.windowStartMs });
      measurements[match.departureName] = existing.slice(-MAX_MEASUREMENTS_PER_NAME);
      void logEvent('transit', `Drive measured: ${match.minutes} min, matched to ${match.departureName}.`);
    }
    for (const window of newWindows) {
      if (matchedStarts.has(window.startMs)) continue;
      const minutes = Math.round((window.endMs - window.startMs) / 60_000);
      void logEvent('transit', `Drive measured: ${minutes} min, unmatched.`);
    }

    await writeMeasurements(measurements);

    const latestWindow = newWindows[newWindows.length - 1];
    await db.settings.put({ key: TRANSIT_SYNC_CURSOR_SETTING, value: String(latestWindow.startMs) });
  } catch (err) {
    console.warn('Runway: syncTransitEvents failed', err);
  }
}
