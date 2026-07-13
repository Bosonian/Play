import { db } from '../db/db';
import type { Departure, Template } from '../db/types';
import {
  cancelDepartureAlarms,
  ensurePermissions,
  scheduleDepartureAlarms,
  scheduleStudyBlockAlarms,
} from '../native/notifications';
import { refreshWidgets } from '../native/widgets';
import { HORIZON_DAYS, occurrenceDates, type Occurrence } from './recurrence';

/**
 * How long a machine-created, never-engaged-with departure sits past its
 * appointment before the cleanup sweep below hard-deletes it. See that
 * sweep's own comment for why this is a delete, not a demotion to Home's
 * "Past departure time" section.
 */
const CLEANUP_STALE_MS = 12 * 60 * 60_000;

/**
 * Auto-plans real Departures for every Template with a recurring
 * `schedule`, up to `HORIZON_DAYS` ahead, and sweeps away machine-created
 * departures nobody ever engaged with once they're well past due.
 *
 * Called fire-and-forget from two places: main.tsx on every startup, and
 * TemplateEdit after a schedule/step/travel edit is saved (so a changed
 * plan propagates into the week already materialized — see TemplateEdit's
 * own comment on why it deletes-and-replaces the untouched future rows
 * first). Both callers rely on this NEVER throwing — a materializer glitch
 * must never block app startup or a template save, so every failure is
 * caught and logged here rather than left to propagate.
 *
 * The 7-day horizon means alarms only stay armed if the app is opened at
 * least once a week (each open re-materializes the next 7 days from
 * scratch) — a real limitation for a mode whose whole point is unattended
 * recurrence, stated plainly rather than glossed over. A WorkManager-based
 * native materializer that can run without the app in foreground is the
 * v1.5 upgrade (see README's v1.5 list); this increment ships the
 * in-app-open version because it needs no new native plugin.
 */
export async function materializeScheduledDepartures(): Promise<void> {
  try {
    const now = new Date();
    let changed = false;

    changed = (await createMissingOccurrences(now)) || changed;
    changed = (await sweepStaleAutoDepartures(now)) || changed;

    if (changed) {
      await refreshWidgets();
    }
  } catch (err) {
    // Never throws — see the doc comment above for why both call sites
    // depend on that.
    console.warn('Runway: materializer failed', err);
  }
}

/**
 * Creates whichever of the next `HORIZON_DAYS` scheduled occurrences don't
 * already have a departure for them, across every template with a
 * schedule. Returns whether anything was created.
 */
async function createMissingOccurrences(now: Date): Promise<boolean> {
  const templates = await db.templates.toArray();
  const scheduledTemplates = templates.filter((t) => t.schedule != null);
  if (scheduledTemplates.length === 0) return false;

  // One pass over every departure, rather than one Dexie query per
  // template — `templateId` isn't an indexed field (db.ts only indexes
  // `appointmentAt`/`status`, the fields Home's own queries need), and this
  // app's total departure count is small enough that loading it all once
  // and grouping in JS (the same pattern src/lib/calibration.ts already
  // uses for templateId lookups) is simpler than adding an index just for
  // this.
  const allDepartures = await db.departures.toArray();
  const materializedDatesByTemplate = new Map<string, Set<string>>();
  for (const departure of allDepartures) {
    if (departure.templateId == null || departure.scheduledForDate == null) continue;
    const dates = materializedDatesByTemplate.get(departure.templateId) ?? new Set<string>();
    dates.add(departure.scheduledForDate);
    materializedDatesByTemplate.set(departure.templateId, dates);
  }

  // Plan first, touch nothing yet — a template whose whole horizon is
  // already materialized should never trigger ensurePermissions() below.
  const plan: { template: Template; missing: Occurrence[] }[] = [];
  for (const template of scheduledTemplates) {
    // schedule != null was already filtered above, but TypeScript can't see
    // that through the .filter() call, so this narrows it back to
    // TemplateSchedule for occurrenceDates below.
    if (template.schedule == null) continue;
    const occurrences = occurrenceDates(now, template.schedule, HORIZON_DAYS);
    const alreadyMaterialized = materializedDatesByTemplate.get(template.id) ?? new Set<string>();
    // A date already materialized is never re-created, even if the
    // departure it produced was since removed or abandoned — re-creating a
    // morning Deepak deliberately removed would be nagging, not help. This
    // is why the lookup above is keyed on scheduledForDate alone, with no
    // filter on the existing departure's status.
    const missing = occurrences.filter((occ) => !alreadyMaterialized.has(occ.date));
    if (missing.length > 0) plan.push({ template, missing });
  }
  if (plan.length === 0) return false;

  // Lazy and batch-wide: one permission request for however many
  // departures this pass is about to create, not one per departure — same
  // "ask only when there's something to schedule" rule DepartureSetup's
  // own save path follows.
  let alarmsGranted = false;
  try {
    alarmsGranted = await ensurePermissions();
  } catch (err) {
    console.warn('Runway: materializer failed to request alarm permission', err);
  }

  for (const { template, missing } of plan) {
    for (const occurrence of missing) {
      const departure = buildDeparture(template, occurrence);
      await db.departures.add(departure);
      if (alarmsGranted) {
        // Scoped per-departure, not around the whole batch: one alarm call
        // failing (e.g. a plugin hiccup) shouldn't stop the rest of the
        // week's departures from being created and scheduled.
        try {
          await scheduleDepartureAlarms(departure);
        } catch (err) {
          console.warn('Runway: materializer failed to schedule an alarm', err);
        }
      }
    }
  }
  return true;
}

/** Mirrors DepartureSetup's create path exactly (see its handleSave) — same
 * fields, same "fresh step ids copied from the template" shape — plus the
 * two fields unique to a materialized row: `scheduledForDate` (the join key
 * for "already planned") and an `appointmentAt`/`originalAppointmentAt`
 * pair that starts identical, same reasoning as a brand-new manual
 * departure has nothing to have diverged from yet. */
function buildDeparture(template: Template, occurrence: Occurrence): Departure {
  const nowIso = new Date().toISOString();
  const appointmentIso = occurrence.at.toISOString();
  return {
    id: crypto.randomUUID(),
    templateId: template.id,
    name: template.name,
    destination: template.destination,
    appointmentAt: appointmentIso,
    originalAppointmentAt: appointmentIso,
    travelMinutes: template.travelMinutes,
    bufferMinutes: template.bufferMinutes,
    steps: template.steps.map((step) => ({
      id: crypto.randomUUID(),
      name: step.name,
      plannedMinutes: step.minutes,
      checkedAt: null,
      // Estimation-bias increment: a materialized copy has the same
      // provenance as its source — see db/types.ts's
      // StepTemplate.estimateSource comment.
      estimateSource: step.estimateSource,
    })),
    // Arrival-steps increment: same fresh-ids-copied-from-template shape as
    // `steps` above, `?? []` for a template saved before this field existed.
    arrivalSteps: (template.arrivalSteps ?? []).map((step) => ({
      id: crypto.randomUUID(),
      name: step.name,
      plannedMinutes: step.minutes,
      checkedAt: null,
      estimateSource: step.estimateSource,
    })),
    arrivedAt: null,
    // Arrival-detection increment: same undefined-as-null copy-from-template
    // shape as `arrivalSteps` above.
    arrivalWifiSsid: template.arrivalWifiSsid ?? null,
    status: 'planned',
    startedAt: null,
    leftAt: null,
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: nowIso,
    scheduledForDate: occurrence.date,
    // A freshly materialized occurrence has never been touched by
    // compressPlan - see db/types.ts's own comment on wasReplanned.
    wasReplanned: false,
  };
}

/**
 * Prüfung rework 2's study-block analogue of `materializeScheduledDepartures`
 * above, with a structurally different job: there is no `studyBlocks` table
 * and no per-occurrence row to diff "already planned" against (see
 * db/types.ts's `Exam.studySchedule` doc comment and
 * notifications.ts's `scheduleStudyBlockAlarms` for the "notification-only,
 * no ledger" decision this reads). So instead of computing which occurrences
 * are MISSING, this just reads the one exam (v1 supports exactly one —
 * db/types.ts's `Exam` doc comment) and hands it straight to
 * `scheduleStudyBlockAlarms`, which does its own cancel-then-reschedule of
 * the next `HORIZON_DAYS` from scratch every time. Simpler than the
 * departure path, and correct for the same reason a full reschedule is
 * always correct: there's nothing partially-materialized to preserve when
 * the only output is alarms, not database rows.
 *
 * Called fire-and-forget from the same two places as
 * `materializeScheduledDepartures`: main.tsx on every startup (right after
 * that call — see main.tsx's own comment on why the order doesn't matter)
 * and ExamSetup's save path. Never throws, same reasoning as
 * `materializeScheduledDepartures`'s own doc comment — a materializer glitch
 * must never block app startup or a save.
 */
export async function materializeStudyBlockAlarms(): Promise<void> {
  try {
    const exam = await db.exams.toCollection().first();
    if (!exam) return;
    await scheduleStudyBlockAlarms(exam);
  } catch (err) {
    console.warn('Runway: study-block materializer failed', err);
  }
}

/**
 * Deletes every FUTURE, UNTOUCHED auto-created departure for `templateId`
 * and cancels their alarms — the "replace" half of
 * materializeScheduledDepartures's own dedup rule, meant to be called right
 * before materializeScheduledDepartures so a schedule/step/travel edit (or,
 * from the learning increment, an auto-learn rewrite of step minutes)
 * actually reaches the week that's already planned instead of only
 * affecting occurrences materialized from now on.
 *
 * Deliberately narrow: `startedAt == null` excludes anything Deepak has
 * already begun — a departure he's mid-prep on is HIS now, not the
 * template's to silently rewrite out from under him. `appointmentAt` in the
 * future excludes anything already past, which the materializer's own
 * stale-sweep (not this function) is responsible for.
 *
 * Originally lived only in TemplateEdit.tsx (its own save/delete paths);
 * exported here (learning increment) so src/lib/autoLearn.ts's
 * `applyAutoLearn` can reuse the exact same sweep instead of a second,
 * drifting copy of this logic.
 */
export async function replaceUntouchedFutureAutoRows(templateId: string): Promise<void> {
  const nowMs = Date.now();
  // Same "load planned rows, filter the rest in JS" pattern as this file's
  // own sweep below — templateId isn't an indexed field.
  const plannedDepartures = await db.departures.where('status').equals('planned').toArray();
  for (const departure of plannedDepartures) {
    if (departure.templateId !== templateId) continue;
    if (departure.scheduledForDate == null) continue; // a manual departure, not the materializer's to replace
    if (departure.startedAt != null) continue; // touched — his now, not ours to replace
    if (new Date(departure.appointmentAt).getTime() <= nowMs) continue; // already past

    await db.departures.delete(departure.id);
    await cancelDepartureAlarms(departure.id);
  }
}

/**
 * Hard-deletes machine-created departures nobody ever engaged with, once
 * they're `CLEANUP_STALE_MS` past their appointment. Returns whether
 * anything was removed.
 *
 * The psychology this encodes: a row the materializer created that Deepak
 * never even started (`startedAt` still null) isn't a missed commitment —
 * he never saw it as one. Leaving it to pile up in Home's "Past departure
 * time" section would slowly turn that section into a guilt list of
 * mornings he technically "missed" but that were never real to begin with.
 * A departure he DID engage with (`startedAt` set) is exempted here and
 * keeps the normal lifecycle (Home's Past section, History) — that one IS
 * a real, lived morning, and deleting it would erase something that
 * actually happened.
 */
async function sweepStaleAutoDepartures(now: Date): Promise<boolean> {
  const cutoff = now.getTime() - CLEANUP_STALE_MS;
  // 'status' is indexed (db.ts) — cheap to narrow to 'planned' before the
  // in-JS filter on the two unindexed fields below.
  const plannedDepartures = await db.departures.where('status').equals('planned').toArray();

  let changed = false;
  for (const departure of plannedDepartures) {
    if (departure.scheduledForDate == null) continue; // manual departure, not ours to sweep
    if (departure.startedAt != null) continue; // engaged with — keep it
    if (new Date(departure.appointmentAt).getTime() >= cutoff) continue; // not stale yet

    await db.departures.delete(departure.id);
    await cancelDepartureAlarms(departure.id);
    changed = true;
  }
  return changed;
}
