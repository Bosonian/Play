import { db } from '../db/db';
import { updateWidgetSnapshot } from '../native/widgetBridge';
import { dailyShapeProgress, formatCheckInsLine, formatStepsLine, parseDailyShapeTarget } from './dailyShape';
import type { DailyShapeActuals, DailyShapeTarget } from './dailyShape';
import { DAILY_SHAPE_TARGET_SETTING } from './dailyShapeSettings';
import { localDateKey, localDayBoundsIso } from './healthSync';
import { currentTrend, formatTrendLine, MIN_POINTS } from './trend';
import type { WeighInPoint } from './trend';

// Widget increment (0.9.0) — TIDE_PLAN.md §5, "Daily shape" (signal 5)
// strictly below "Weight trend" (signal 1). One widget, one JSON snapshot,
// unlike Runway's src/native/widgets.ts + src/lib/widgetSnapshot.ts split
// (three widgets, three data shapes, worth separating). Tide's whole
// snapshot is five strings and a flag, so both halves — the PURE
// snapshot-building function and the Dexie-touching orchestrator around
// it — live in this one file, per this increment's own instruction.
//
// ARCHITECTURE RULE, same as Runway's widgetSnapshot.ts: every string the
// widget shows verbatim is built HERE, by reusing Home.tsx's own
// formatting functions (`formatTrendLine`, `formatCheckInsLine`,
// `formatStepsLine`) — never reimplemented. The native side
// (TideWidgetProvider.java) does zero formatting; it only places
// already-decided strings into views.

/** The JSON shape written to Android SharedPreferences and read by
 * TideWidgetProvider.java. Every field is a string (including `shapeMet`,
 * `"true"`/`"false"`) — a Capacitor plugin call's arguments cross the JS↔
 * native bridge as one JSON-serialisable object, and keeping every field a
 * plain string (rather than a nested boolean) means the native side's
 * org.json parsing has exactly one type to handle per field, matching how
 * WidgetBridgePlugin.java's own doc comment describes the batch. */
export interface TideWidgetSnapshot {
  /** "98.4 kg", or "" when there is no smoothed trend yet (below the
   * evidence floor, or no weigh-ins at all) — the native side hides the
   * whole large-number row rather than showing an empty slot. */
  trendValue: string;
  /** `formatTrendLine`'s own sentence once there's a real trend; the
   * evidence-floor line ("N more weigh-ins to a trend.") below
   * `MIN_POINTS`; or the empty-state prompt with zero weigh-ins at all —
   * mirrors Home.tsx's own three-way branch on the trend headline exactly,
   * word for word (see `buildTideWidgetSnapshot`'s own comment). Never
   * empty in practice — there is always something honest to say here. */
  trendLine: string;
  /** `formatCheckInsLine`'s output, or `""` when no daily-shape target is
   * set, or the check-ins component is opted out (target 0). */
  shapeLine1: string;
  /** `formatStepsLine`'s output, or `""` under the same two conditions as
   * `shapeLine1`. */
  shapeLine2: string;
  /** `"true"`/`"false"` — whether the WHOLE day's shape is met (both
   * in-play components), for the native side's emerald-vs-slate tint. Only
   * meaningful when at least one of shapeLine1/shapeLine2 is non-empty. */
  shapeMet: string;
  /** ISO 8601 datetime this snapshot was built — debugging only (visible
   * via `adb shell cat` of the SharedPreferences file); no widget view
   * reads it. */
  updatedAt: string;
}

/**
 * Builds the trend half of the snapshot — a direct mirror of Home.tsx's own
 * three-way branch on `trend`/`weighIns.length` (see that component's JSX:
 * `trend ? ... : weighIns.length === 0 ? ... : ...`), reusing
 * `formatTrendLine` for the one case that has its own formatter and
 * matching the other two branches' literal copy exactly — the widget must
 * say exactly what Home says, never a paraphrase that could quietly drift
 * from it.
 */
function buildTrendFields(weighIns: readonly WeighInPoint[]): Pick<TideWidgetSnapshot, 'trendValue' | 'trendLine'> {
  const trend = currentTrend(weighIns);
  if (trend) {
    return { trendValue: `${trend.smoothedKg.toFixed(1)} kg`, trendLine: formatTrendLine(trend) };
  }
  if (weighIns.length === 0) {
    return { trendValue: '', trendLine: 'Add your first weigh-in to start the trend.' };
  }
  // Below the evidence floor but not empty — same remaining-count/plural
  // rule as Home.tsx's own JSX (`MIN_POINTS - weighIns.length`, pluralised
  // on the REMAINING count, not on `weighIns.length`).
  const remaining = MIN_POINTS - weighIns.length;
  return { trendValue: '', trendLine: `${remaining} more weigh-in${remaining === 1 ? '' : 's'} to a trend.` };
}

/**
 * Builds the daily-shape half of the snapshot — `""` for both lines and
 * `shapeMet: false` when no target is set, matching Home.tsx's own "block
 * absent entirely" treatment (dailyShape is `null` there in the same case).
 * `dailyShapeProgress`/`formatCheckInsLine`/`formatStepsLine` are the exact
 * functions Home.tsx calls — reused, not reimplemented, so a component
 * opted out at 0 (formatCheckInsLine/formatStepsLine returning `null`)
 * collapses to `""` here via the same `?? ''` on both lines, never a
 * fabricated "0 of 0" sentence.
 */
function buildShapeFields(
  target: DailyShapeTarget | null,
  actuals: DailyShapeActuals,
): Pick<TideWidgetSnapshot, 'shapeLine1' | 'shapeLine2' | 'shapeMet'> {
  if (!target) return { shapeLine1: '', shapeLine2: '', shapeMet: 'false' };

  const progress = dailyShapeProgress(target, actuals);
  return {
    shapeLine1: formatCheckInsLine(progress.checkIns) ?? '',
    shapeLine2: formatStepsLine(progress.steps) ?? '',
    shapeMet: progress.met ? 'true' : 'false',
  };
}

/**
 * The pure snapshot builder — no Dexie import, same "pass in whatever was
 * already read" discipline as trend.ts/dailyShape.ts, which is what makes
 * this exhaustively unit-testable with plain fixtures (widgets.test.ts).
 * `refreshWidgets` below is the one caller that reads real data and passes
 * it in.
 */
export function buildTideWidgetSnapshot(
  now: Date,
  weighIns: readonly WeighInPoint[],
  dailyShapeTarget: DailyShapeTarget | null,
  dailyShapeActuals: DailyShapeActuals,
): TideWidgetSnapshot {
  return {
    ...buildTrendFields(weighIns),
    ...buildShapeFields(dailyShapeTarget, dailyShapeActuals),
    updatedAt: now.toISOString(),
  };
}

/**
 * Rebuilds the widget snapshot from the latest Dexie data and pushes it to
 * the native widget. Called explicitly from a short, fixed list of write
 * sites — same "traceable over automatic" reasoning as Runway's own
 * refreshWidgets doc comment: a generic Dexie-write hook would also fire on
 * writes that don't touch anything the widget shows (a field-report saved,
 * an activity-log prune), and would be one more layer to trace through to
 * answer "why did the widget just refresh".
 *
 * Current call sites: main.tsx (app start, and again once syncHealthData's
 * startup call resolves), App.tsx's visibilitychange resume hook (after its
 * own syncHealthData call resolves), Settings.tsx's handleConnect/
 * handleSyncNow/selectStepSource (each awaits syncHealthData directly),
 * WeighInEntry.tsx's save, History.tsx's performDelete, PlateCheckIn.tsx's
 * handleSubmit and handleSkip, PlatesToday.tsx's performDelete, and
 * Settings.tsx's handleSaveDailyShape/handleRemoveDailyShape.
 *
 * Not logged to the activity log (increment 2's `events` table) —
 * deliberately. This runs on every Health Connect sync (main.tsx, the
 * resume hook, and three Settings actions), which itself already logs its
 * own 'health' event; a second 'widget refreshed' line next to every one of
 * those would roughly double the log's volume for a fact nobody reading the
 * log for "what did the app DO" cares about — the log answers questions
 * about weigh-ins/plates/syncs/backups, not about a display cache being
 * kept warm. See db/types.ts's `EventCategory` doc comment for the same
 * "what did the app DO, never what did it render" boundary this respects.
 *
 * Never throws: this always runs as a fire-and-forget side effect after a
 * Dexie write (or a Health Connect sync) that has already succeeded on its
 * own. A widget refresh failing — no weigh-ins yet, no target set, a native
 * call error — must never surface as a failure of the screen action that
 * triggered it.
 */
export async function refreshWidgets(): Promise<void> {
  try {
    const weighIns = await db.weighIns.orderBy('at').toArray();

    const dailyShapeSetting = await db.settings.get(DAILY_SHAPE_TARGET_SETTING);
    const dailyShapeTarget = parseDailyShapeTarget(dailyShapeSetting?.value);

    const todayMovement = await db.movement.get(localDateKey());
    const { startIso, endIso } = localDayBoundsIso();
    const checkIns = await db.meals.where('at').between(startIso, endIso, true, false).count();

    const snapshot = buildTideWidgetSnapshot(new Date(), weighIns, dailyShapeTarget, {
      checkIns,
      steps: todayMovement?.steps ?? null,
    });
    await updateWidgetSnapshot(JSON.stringify(snapshot));
  } catch (err) {
    console.warn('Tide: failed to refresh widgets', err);
  }
}
