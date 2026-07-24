import { db } from '../db/db';
import { parseDailyShapeTarget, serializeDailyShapeTarget, type DailyShapeTarget } from './dailyShape';

// Settings-table key for the daily-shape target (increment 7) — same
// flat key-value shape and same "screens read this file's keys directly,
// not the sync/orchestrator internals" split as healthSettings.ts.

/** A single settings row holding the serialised `DailyShapeTarget` (see
 * dailyShape.ts's `serializeDailyShapeTarget` for the exact format). Absent
 * or empty means no target is set — the feature is off, and Home renders no
 * daily-shape block at all — matching `MOVEMENT_STEP_SOURCES_SETTING`'s own
 * "absent row is a meaningful state, not a bug" idiom (healthSettings.ts). */
export const DAILY_SHAPE_TARGET_SETTING = 'dailyShapeTarget';

/** Read-through: `null` for an absent/empty/malformed row — the parse logic
 * itself lives in dailyShape.ts (`parseDailyShapeTarget`) and is reused here
 * verbatim rather than duplicated, so there is exactly one place that
 * decides what counts as a valid target string. */
export async function readDailyShapeTarget(): Promise<DailyShapeTarget | null> {
  const row = await db.settings.get(DAILY_SHAPE_TARGET_SETTING);
  return parseDailyShapeTarget(row?.value);
}

/** Writes a target, serialised via dailyShape.ts's own serialiser — the one
 * write path Settings' "Save" button calls, only once the draft values have
 * passed validation there (this function does no validation of its own; it
 * trusts the caller the same way `writeSelectedStepSources` trusts
 * Settings' step-source picker). */
export async function writeDailyShapeTarget(target: DailyShapeTarget): Promise<void> {
  await db.settings.put({ key: DAILY_SHAPE_TARGET_SETTING, value: serializeDailyShapeTarget(target) });
}

/** Clears the target — writes `''`, not a deleted row, same
 * present-but-empty idiom `writeSelectedStepSources` uses: every reader of
 * this key can then assume the row always exists once ANY target has ever
 * been set, rather than juggling "row absent" and "row present but empty" as
 * two different flavours of "no target". */
export async function clearDailyShapeTarget(): Promise<void> {
  await db.settings.put({ key: DAILY_SHAPE_TARGET_SETTING, value: '' });
}
