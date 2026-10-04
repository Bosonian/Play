import { db } from '../db/db';
import type { Departure, WorkTask } from '../db/types';
import { ensurePermissions, scheduleDepartureAlarms, scheduleTaskAlarm } from '../native/notifications';
import { refreshWidgets } from '../native/widgets';
import { SECRET_SETTING_KEYS, type RunwayBackup } from './backup';
import { refreshDayGauge } from './dayGaugeRefresh';
import { materializeScheduledDepartures, materializeStudyBlockAlarms } from './materialize';
import { logEvent } from './eventLog';

/**
 * Replaces every table's contents with `backup`'s, then re-arms the device.
 * This is REPLACE, not merge — deliberately. Merge semantics (what happens
 * when a restored row's id collides with an existing one? what happens to a
 * half-updated learned pool that only exists on this phone?) are
 * unpredictable exactly when Deepak is least able to verify them: this is
 * disaster recovery, run once, under time pressure, not a routine sync. A
 * full replace is the only semantics whose outcome he can fully predict
 * before confirming it — "the phone now looks exactly like the backup" — and
 * Settings.tsx's confirm() dialog says exactly that.
 */
export async function restoreBackup(backup: RunwayBackup): Promise<void> {
  // Every table write happens inside one Dexie transaction: a restore is
  // meant to leave the database in one of exactly two states — untouched, or
  // fully replaced — never a half-imported mix if something throws partway
  // through (a bulkAdd rejecting on a malformed row, for instance).
  await db.transaction(
    'rw',
    [
      db.departures,
      db.templates,
      db.settings,
      db.exams,
      db.topics,
      db.sprints,
      db.milestones,
      db.fieldReports,
      db.tasks,
      db.events,
    ],
    async () => {
      // Read THIS device's current secret settings before settings gets
      // cleared below. buildBackup (backup.ts) deliberately strips
      // SECRET_SETTING_KEYS out of every backup file — see its own doc
      // comment for why (a backup travels; a leaked key is expensive) — so
      // the backup's own `tables.settings` never carries them. Without this
      // read-before-clear, restoring a backup would silently wipe whatever
      // API keys are configured on THIS phone, even though the backup never
      // claimed to know what they should be.
      const currentSecrets = await Promise.all(SECRET_SETTING_KEYS.map((key) => db.settings.get(key)));

      await db.departures.clear();
      await db.departures.bulkAdd(backup.tables.departures ?? []);

      await db.templates.clear();
      await db.templates.bulkAdd(backup.tables.templates ?? []);

      await db.settings.clear();
      await db.settings.bulkAdd(backup.tables.settings ?? []);
      // Re-insert this device's own secrets, now that the clear+bulkAdd
      // above has happened — `?? []` above already means an OLD backup
      // (taken before some settings key existed) never had a chance to
      // overwrite them, but this restores them even when a NEWER backup's
      // settings rows simply never included them in the first place (they
      // never do, by construction).
      for (const secretRow of currentSecrets) {
        if (secretRow) await db.settings.put(secretRow);
      }

      await db.exams.clear();
      await db.exams.bulkAdd(backup.tables.exams ?? []);

      await db.topics.clear();
      await db.topics.bulkAdd(backup.tables.topics ?? []);

      await db.sprints.clear();
      await db.sprints.bulkAdd(backup.tables.sprints ?? []);

      await db.milestones.clear();
      await db.milestones.bulkAdd(backup.tables.milestones ?? []);

      await db.fieldReports.clear();
      await db.fieldReports.bulkAdd(backup.tables.fieldReports ?? []);

      await db.tasks.clear();
      await db.tasks.bulkAdd(backup.tables.tasks ?? []);

      await db.events.clear();
      await db.events.bulkAdd(backup.tables.events ?? []);
    },
  );

  // Everything below runs AFTER the transaction commits, deliberately
  // outside it: these are OS-level side effects (alarms, widgets, the day
  // gauge), not Dexie writes, and none of them should be able to roll back
  // the data restore above if one of them fails. Imported rows carry no
  // alarms on this device — Dexie rows restore DATA, not OS state — a
  // departure that was armed on the phone the backup came from is not armed
  // here until something schedules it fresh. Each step below is independently
  // try/caught so one failure (e.g. alarm permission denied) doesn't stop the
  // rest of the re-arm sequence from running.

  try {
    // Mirrors DepartureSetup's own save path (handleSave): request
    // permission once, lazily, only now that there's actually something to
    // schedule — never at app launch. Requested once for the whole batch
    // (materialize.ts's createMissingOccurrences takes the same "one
    // permission check per batch, not per departure" approach) rather than
    // once per departure.
    const now = Date.now();
    const eligible = (backup.tables.departures ?? []).filter(
      (departure: Departure) =>
        (departure.status === 'planned' || departure.status === 'running') &&
        new Date(departure.appointmentAt).getTime() > now,
    );
    if (eligible.length > 0) {
      const granted = await ensurePermissions();
      if (granted) {
        for (const departure of eligible) {
          try {
            await scheduleDepartureAlarms(departure);
          } catch (err) {
            console.warn('Runway: failed to schedule alarm for restored departure', departure.id, err);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Runway: failed to re-arm departure alarms after restore', err);
  }

  try {
    // Anti-rot increment (0.37.0): same shape as the departure re-arm block
    // just above, own try/catch so a task-alarm failure can't stop the
    // departure re-arm (already run) or anything below it. Eligible mirrors
    // the departure filter's own two conditions, translated to a task's
    // fields: still 'planned' (a 'running'/'done'/'abandoned' task has no
    // start-by alarm to restore — see scheduleTaskAlarm's own no-op guard)
    // and a deadline still in the future (a past deadline means
    // scheduleTaskAlarm would no-op anyway; filtering here avoids a wasted
    // ensurePermissions() call for a backup with zero eligible tasks).
    const now = Date.now();
    const eligibleTasks = (backup.tables.tasks ?? []).filter(
      (task: WorkTask) => task.status === 'planned' && task.deadlineAt !== null && new Date(task.deadlineAt).getTime() > now,
    );
    if (eligibleTasks.length > 0) {
      const granted = await ensurePermissions();
      if (granted) {
        for (const task of eligibleTasks) {
          try {
            await scheduleTaskAlarm(task);
          } catch (err) {
            console.warn('Runway: failed to schedule alarm for restored task', task.id, err);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Runway: failed to re-arm task alarms after restore', err);
  }

  try {
    await materializeScheduledDepartures();
  } catch (err) {
    console.warn('Runway: materializeScheduledDepartures failed after restore', err);
  }

  try {
    await materializeStudyBlockAlarms();
  } catch (err) {
    console.warn('Runway: materializeStudyBlockAlarms failed after restore', err);
  }

  try {
    await refreshWidgets();
  } catch (err) {
    console.warn('Runway: refreshWidgets failed after restore', err);
  }

  try {
    await refreshDayGauge();
  } catch (err) {
    console.warn('Runway: refreshDayGauge failed after restore', err);
  }

  // Written to the just-restored events table (the transaction above
  // already replaced it wholesale with the backup's own log) — so this
  // becomes the first new line after the restored history, not lost inside
  // the clear-then-bulkAdd that preceded it.
  void logEvent('backup', 'Backup restored.');
}
