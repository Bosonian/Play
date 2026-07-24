import { db } from '../db/db';
import type { Movement } from '../db/types';
import { readActiveEnergy, readBodyFat, readSteps, readWeight } from '../native/healthConnect';
import { logEvent } from './eventLog';
import {
  HEALTH_CONNECT_ENABLED_SETTING,
  HEALTH_LAST_SYNC_AT_SETTING,
  HEALTH_MOVEMENT_CURSOR_SETTING,
  HEALTH_SYNC_CURSOR_SETTING,
} from './healthSettings';

// Health Connect bridge increment (0.3.0): the Dexie-touching orchestrator
// around the pure functions below, same split apps/runway's own
// transitSync.ts makes around transit.ts's pure math — screens/main.tsx call
// `syncHealthData()`, fire-and-forget, never throws. Only the pure functions
// in this file have their own tests (healthSync.test.ts); the Dexie-touching
// orchestrator functions below don't, matching transitSync.ts's own
// precedent (see that file — it has no transitSync.test.ts either) rather
// than eventLog.ts/updateCheck.ts's mocked-db test style. TIDE_PLAN.md §7's
// instruction for this increment is "pure tests" specifically, not full
// orchestrator coverage.

/**
 * Filters to records strictly newer than the cursor — the dedup mechanism
 * that keeps a re-sync (this runs on every app open/resume) from inserting
 * the same underlying Health Connect record twice. Generic over any
 * `{atMs}`-shaped record so both `syncWeighIns`' weight and body-fat reads
 * use the exact same filter, exactly once.
 *
 * STRICT `>`, not `>=`: the native `sinceMs` boundary passed to
 * `readWeight`/`readBodyFat` is a Health Connect implementation detail this
 * code can't verify by reading alone (see native/healthConnect.ts's own
 * comment on that uncertainty) — re-filtering here to a strict boundary is
 * what actually guarantees correctness regardless of whether the native
 * side's `sinceMs` turns out to be inclusive or exclusive, same
 * belt-and-braces idiom Runway's transitSync.ts documents for its own
 * cursor (`window.startMs > cursorMs`).
 */
export function newRecordsSinceCursor<T extends { atMs: number }>(records: readonly T[], cursorMs: number): T[] {
  return records.filter((record) => record.atMs > cursorMs);
}

/**
 * How close a body-fat record's `atMs` has to be to a weight record's for
 * `mergeBodyFat` to treat them as one physical step-on-the-scale event.
 * 2 minutes: comfortably longer than any write-offset a real BIA scale's
 * two Health Connect records could plausibly land at (Samsung Health can
 * write weight and body-fat from the same reading a few seconds apart, or
 * round their timestamps differently — an EXACT-`atMs` match, this file's
 * first cut, was too brittle against either), while being far shorter than
 * the gap between two genuinely separate weigh-ins (Deepak steps on the
 * scale every few days, not every few minutes) — so widening the window
 * this far can't plausibly cross-pair two different real readings.
 */
export const BODY_FAT_MATCH_WINDOW_MS = 120_000;

/**
 * Attaches a body-fat percentage to each weight record by finding the
 * NEAREST unclaimed body-fat record within `BODY_FAT_MATCH_WINDOW_MS` of
 * it — not an exact-`atMs` match (see `BODY_FAT_MATCH_WINDOW_MS`'s own
 * comment for why that first-cut approach was replaced: it made the
 * body-fat trend silently stay empty forever whenever Samsung Health wrote
 * the paired records so much as a few seconds apart).
 *
 * Weight records are processed in ascending `atMs` order, greedily: each
 * one claims the closest body-fat record still available (a record already
 * claimed by an EARLIER weight can't be claimed again), so two real,
 * closely-timed weigh-ins each get their own nearest body-fat reading
 * rather than both claiming the same one. This is a real, load-bearing
 * assumption worth stating plainly (CLAUDE.md's "truth over reassurance"
 * rule): it still assumes Samsung Health pairs a BIA scale's weight and
 * body-fat reading closely in time for one physical step-on-the-scale
 * event — UNVERIFIED against a real Samsung Health -> Health Connect sync,
 * just a much less brittle version of that same assumption than an exact
 * timestamp match was.
 *
 * The returned rows are in ascending `atMs` order (the order weights were
 * processed in), which may differ from `weightRecords`' own input order —
 * `syncWeighIns` only ever iterates the result to write rows, so this
 * reordering has no observable effect there. Each row's own `atMs` is the
 * WEIGHT record's — the weight instant is canonical; body fat just rides
 * along on it, same as before this change.
 *
 * A body-fat record with no weight within the window is dropped, not
 * fabricated into a phantom weigh-in — `WeighIn.weightKg` is mandatory (see
 * db/types.ts), so there is no schema-honest way to store a body-fat-only
 * row. `syncWeighIns` logs how many were dropped (`unmatchedBodyFat`, below)
 * so a persistent stream of drops — the sign this assumption is wrong even
 * at a 2-minute tolerance — leaves a visible trace rather than a silently
 * empty body-fat trend.
 */
export function mergeBodyFat(
  weightRecords: readonly { atMs: number; weightKg: number }[],
  bodyFatRecords: readonly { atMs: number; bodyFatPct: number }[],
): { atMs: number; weightKg: number; bodyFatPct: number | null }[] {
  const sortedWeights = [...weightRecords].sort((a, b) => a.atMs - b.atMs);
  const claimed = new Array<boolean>(bodyFatRecords.length).fill(false);

  return sortedWeights.map((weight) => {
    let nearestIndex = -1;
    let nearestDiffMs = Infinity;
    for (let i = 0; i < bodyFatRecords.length; i++) {
      if (claimed[i]) continue;
      const diffMs = Math.abs(bodyFatRecords[i].atMs - weight.atMs);
      // Inclusive at the boundary (<=, not <): a diff of EXACTLY
      // BODY_FAT_MATCH_WINDOW_MS is still within the tolerance this window
      // is meant to express, not one instant past it — there's no reason
      // for the boundary instant itself to be the one moment this window
      // doesn't cover, and erring toward matching (not losing a real
      // reading) is the same "generous, not brittle" spirit this whole
      // change exists for.
      if (diffMs <= BODY_FAT_MATCH_WINDOW_MS && diffMs < nearestDiffMs) {
        nearestDiffMs = diffMs;
        nearestIndex = i;
      }
    }

    let bodyFatPct: number | null = null;
    if (nearestIndex !== -1) {
      claimed[nearestIndex] = true;
      bodyFatPct = bodyFatRecords[nearestIndex].bodyFatPct;
    }
    return { atMs: weight.atMs, weightKg: weight.weightKg, bodyFatPct };
  });
}

/**
 * Body-fat records with no weight record anywhere within
 * `BODY_FAT_MATCH_WINDOW_MS` of them — used only to produce the "N body-fat
 * readings skipped" log line, so a persistent mismatch (see
 * `mergeBodyFat`'s own comment on that failure mode) is something Deepak
 * can actually notice happening rather than a silent drop.
 *
 * Deliberately independent of `mergeBodyFat`'s own greedy claiming: a
 * body-fat record here counts as "unmatched" purely by proximity to ANY
 * weight record, never by whether it happened to lose a claim to a
 * different body-fat record competing for the same nearby weight. That
 * second case — a real body-fat reading that had a weight nearby but
 * wasn't the nearest one — isn't a sign anything is wrong (see
 * `mergeBodyFat`'s doc comment on why the nearest-and-claim greedy
 * approach is the correct behaviour there); this function's whole purpose
 * is to flag the FIRST case, which is.
 */
export function unmatchedBodyFat(
  weightRecords: readonly { atMs: number }[],
  bodyFatRecords: readonly { atMs: number }[],
): { atMs: number }[] {
  return bodyFatRecords.filter(
    (bodyFat) => !weightRecords.some((weight) => Math.abs(weight.atMs - bodyFat.atMs) <= BODY_FAT_MATCH_WINDOW_MS),
  );
}

/** One day's steps + active-energy, before either is known to be present —
 * the shape `syncMovement` writes into `db.movement` (minus `id`/`source`/
 * `manualTier`, which are Dexie/merge concerns the orchestrator adds). */
export interface MovementDay {
  date: string;
  steps: number | null;
  activeKcal: number | null;
}

/**
 * Combines two independently-fetched per-day lists (steps, active energy —
 * separate Health Connect record types, separate native reads) into one
 * list keyed by date, `null` for whichever side didn't have a row for that
 * day (a watch that reports steps but is between active-energy syncs,
 * or vice versa) rather than dropping the day entirely — a day with SOME
 * data is still worth a `movement` row. Sorted ascending by date for
 * deterministic iteration order in `syncMovement` (and in tests below);
 * `db.movement.put`'s upsert doesn't care about order, this is purely for
 * predictability.
 */
export function mergeMovementDays(
  stepsDays: readonly { date: string; steps: number }[],
  energyDays: readonly { date: string; activeKcal: number }[],
): MovementDay[] {
  const byDate = new Map<string, MovementDay>();
  for (const day of stepsDays) {
    byDate.set(day.date, { date: day.date, steps: day.steps, activeKcal: byDate.get(day.date)?.activeKcal ?? null });
  }
  for (const day of energyDays) {
    byDate.set(day.date, { date: day.date, steps: byDate.get(day.date)?.steps ?? null, activeKcal: day.activeKcal });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** "2026-07-24" — the device-LOCAL calendar day, matching exactly the
 * bucketing HealthConnectPlugin.kt's readSteps/readActiveEnergy do on the
 * native side (`LocalDate.ofInstant(..., ZoneId.systemDefault())`) — Home's
 * "Steps today" line and this file's movement rows must agree on what
 * "today" means, or a step count synced from the watch could momentarily
 * look like it belongs to the wrong day. Deliberately NOT
 * `toISOString().slice(0, 10)` — that reads the UTC calendar date, which
 * drifts a day off the local one for part of every evening in Stuttgart
 * (CET/CEST, UTC+1/+2) — same local-vs-UTC distinction eventLog.ts's
 * formatEventLine draws for the same reason. Hand-formatted rather than
 * pulling in date-fns for three getters, same call eventLog.ts's own
 * formatEventLine makes. */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "Steps today: 6,412 · active 320 kcal." — Home's quiet movement line.
 * `null` in either field (only some Health Connect scopes granted, or the
 * watch hasn't synced yet today) reads as "not yet", never a bare 0 — a
 * missing reading is not the same claim as "zero steps taken today", and
 * treating it as one would be exactly the kind of small dishonesty CLAUDE.md's
 * "truth over reassurance" rule rules out. Returns `null` (render nothing)
 * only when BOTH fields are null — an empty day needs no line at all, rather
 * than a line that's entirely "not yet". `toLocaleString('en-US')` rather
 * than the ambient locale — CLAUDE.md pins English UI for v1; letting a
 * German-locale device format the thousands separator would be a small,
 * needless inconsistency with every other number this app displays. */
export function formatMovementLine(movement: Pick<Movement, 'steps' | 'activeKcal'>): string | null {
  if (movement.steps === null && movement.activeKcal === null) return null;
  const stepsPart = movement.steps === null ? 'not yet' : movement.steps.toLocaleString('en-US');
  const kcalPart = movement.activeKcal === null ? 'not yet' : `${Math.round(movement.activeKcal)} kcal`;
  return `Steps today: ${stepsPart} · active ${kcalPart}.`;
}

/** Missing cursor row -> `0` (epoch) — deliberate, not just a safe default:
 * the FIRST sync after Settings' "Connect health data" flow has no cursor
 * yet, so it reads a device's ENTIRE Health Connect history for
 * weight/body-fat/steps/active-energy, backfilling the trend engine with
 * whatever Samsung Health already has rather than only future readings.
 * That's the intended behaviour (a newly-connected trend line should show
 * real history immediately, not start from a blank slate) but it is
 * UNVERIFIED at any real data volume — a device with years of Samsung
 * Health step history could make that first sync slow, or write far more
 * `movement`/`weighIns` rows than this code has ever been exercised
 * against. Worth watching on first real-device connect. */
async function readCursor(key: string): Promise<number> {
  const row = await db.settings.get(key);
  if (!row) return 0;
  const value = Number(row.value);
  return Number.isFinite(value) ? value : 0;
}

async function isHealthConnectEnabled(): Promise<boolean> {
  const row = await db.settings.get(HEALTH_CONNECT_ENABLED_SETTING);
  return row?.value === 'true';
}

/**
 * Merges new Health Connect weight/body-fat records into `weighIns`. Reads
 * since the stored cursor, filters to strictly-newer records
 * (`newRecordsSinceCursor`), pairs weight with same-instant body fat
 * (`mergeBodyFat`), writes one new `weighIns` row per new weight record with
 * `source: 'healthconnect'`, and advances the cursor to the highest `atMs`
 * seen — same monotonic-cursor shape as Runway's transitSync.ts
 * (`syncTransitEvents`), for the same reason: a car only ever drives
 * forward through time, and a scale only ever gets stepped on forward
 * through time too, so "highest atMs processed so far" is a complete dedup
 * key with no need for a growing per-record set.
 *
 * If `weightRecords` comes back empty this sync contributes nothing, even
 * if `bodyFatRecords` somehow didn't — a lone body-fat reading with no
 * weight cannot become a `weighIns` row (see `mergeBodyFat`'s doc comment)
 * and the cursor stays put until a weight record eventually arrives to
 * carry it forward.
 */
async function syncWeighIns(): Promise<void> {
  const cursorMs = await readCursor(HEALTH_SYNC_CURSOR_SETTING);
  const [weightRecords, bodyFatRecords] = await Promise.all([readWeight(cursorMs), readBodyFat(cursorMs)]);

  const newWeight = newRecordsSinceCursor(weightRecords, cursorMs);
  const newBodyFat = newRecordsSinceCursor(bodyFatRecords, cursorMs);
  if (newWeight.length === 0) return;

  const merged = mergeBodyFat(newWeight, newBodyFat);
  for (const row of merged) {
    await db.weighIns.add({
      id: crypto.randomUUID(),
      at: new Date(row.atMs).toISOString(),
      weightKg: row.weightKg,
      bodyFatPct: row.bodyFatPct,
      source: 'healthconnect',
    });
  }
  void logEvent('health', `Health Connect: ${merged.length} weigh-in${merged.length === 1 ? '' : 's'} synced.`);

  const skipped = unmatchedBodyFat(newWeight, newBodyFat);
  if (skipped.length > 0) {
    void logEvent(
      'health',
      `Health Connect: ${skipped.length} body-fat reading${skipped.length === 1 ? '' : 's'} skipped (no matching weight instant).`,
    );
  }

  const maxAtMs = Math.max(...newWeight.map((r) => r.atMs), ...newBodyFat.map((r) => r.atMs));
  await db.settings.put({ key: HEALTH_SYNC_CURSOR_SETTING, value: String(maxAtMs) });
}

/** How far back from "now" each movement sync re-reads, regardless of how
 * recent the stored cursor already is — covers a watch whose Samsung Health
 * sync lagged a day or two behind, and keeps "today"'s still-accumulating
 * total from ever being treated as finished. A small, bounded re-read (3
 * days of raw records), not a growing one — see `syncMovement`'s own
 * comment for why re-reading recent days is harmless rather than something
 * that needs deduping the way `syncWeighIns` does. */
const MOVEMENT_REREAD_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Merges new Health Connect steps/active-energy into `movement`, one row per
 * calendar day. Unlike `syncWeighIns`, this is NOT cursor-deduped against
 * double-insertion — `movement`'s primary key IS `date` (db/db.ts), so
 * `db.movement.put` naturally upserts: re-syncing part of "today" (or the
 * last few days, per `MOVEMENT_REREAD_WINDOW_MS`) on every app open is not
 * just harmless but necessary, since today's step count keeps growing
 * through the day and a stale row would otherwise never update again until
 * tomorrow. The cursor here exists purely to bound how far back each sync
 * reads — a device with years of Samsung Health history should not have its
 * ENTIRE past re-fetched on every single app open — not to prevent
 * duplicates the way the weigh-in cursor does.
 */
async function syncMovement(): Promise<void> {
  const cursorMs = await readCursor(HEALTH_MOVEMENT_CURSOR_SETTING);
  const [stepsDays, energyDays] = await Promise.all([readSteps(cursorMs), readActiveEnergy(cursorMs)]);
  if (stepsDays.length === 0 && energyDays.length === 0) return;

  const merged = mergeMovementDays(stepsDays, energyDays);
  for (const day of merged) {
    const existing = await db.movement.get(day.date);
    await db.movement.put({
      id: existing?.id ?? crypto.randomUUID(),
      date: day.date,
      source: 'healthconnect',
      steps: day.steps,
      activeKcal: day.activeKcal,
      // Preserved, never set, by this sync — see db/types.ts's Movement
      // doc comment. No screen writes manualTier yet, so `existing` never
      // actually carries one today; kept correct anyway so a future manual-
      // entry increment's writes can never be silently clobbered by a sync
      // that runs on every app open/resume.
      manualTier: existing?.manualTier ?? null,
    });
  }
  void logEvent('health', `Health Connect: movement synced for ${merged.length} day${merged.length === 1 ? '' : 's'}.`);

  await db.settings.put({
    key: HEALTH_MOVEMENT_CURSOR_SETTING,
    value: String(Date.now() - MOVEMENT_REREAD_WINDOW_MS),
  });
}

/**
 * The one entry point every caller uses: main.tsx's startup sequence,
 * App.tsx's visibilitychange resume hook, and Settings' "Sync now" /
 * initial-connect flow. No-ops entirely (before touching the network or
 * Dexie at all) unless `HEALTH_CONNECT_ENABLED_SETTING` is `'true'` — a
 * user who has never tapped "Connect health data" gets zero native calls,
 * same no-ambush discipline every other lazy-permission feature in this
 * monorepo follows. Never throws — any failure (a native read error, a
 * Dexie write failure, a malformed settings row) degrades to "nothing
 * synced this time", logged once, matching every other fire-and-forget
 * sync function in this app (`checkForUpdate`, Runway's `syncTransitEvents`).
 */
export async function syncHealthData(): Promise<void> {
  try {
    if (!(await isHealthConnectEnabled())) return;

    await syncWeighIns();
    await syncMovement();

    await db.settings.put({ key: HEALTH_LAST_SYNC_AT_SETTING, value: new Date().toISOString() });
  } catch (err) {
    console.warn('Tide: syncHealthData failed', err);
  }
}
