import { db } from '../db/db';
import { SECRET_SETTING_KEYS, type TideBackup } from './backup';
import { logEvent } from './eventLog';

/**
 * Replaces `weighIns`/`meals`/`movement`/`settings`/`events` with `backup`'s
 * contents. This is REPLACE, not merge — deliberately, ported from
 * apps/runway/src/lib/restoreBackup.ts (~verbatim) for the same reason:
 * merge semantics (what happens when a restored row's id collides with an
 * existing one?) are unpredictable exactly when Deepak is least able to
 * verify them — disaster recovery, run once, under time pressure. A full
 * replace is the only semantics whose outcome he can fully predict before
 * confirming it — "the phone now looks exactly like the backup" — and
 * Settings.tsx's confirm() dialog says exactly that.
 *
 * `fieldReports` is deliberately untouched by this function — neither
 * cleared nor written, not even present in the transaction's table list.
 * Mirrors backup.ts's own `BackupTables` doc comment on why that table is
 * excluded from the export in the first place: this device's own pending/
 * synced report queue is a separate, diagnostic concern from the health data
 * a restore exists to recover, and a backup taken on a DIFFERENT phone has
 * no business overwriting whatever reports are still in flight on this one.
 */
export async function restoreBackup(backup: TideBackup): Promise<void> {
  // Every table write happens inside one Dexie transaction: a restore is
  // meant to leave the database in one of exactly two states — untouched, or
  // fully replaced — never a half-imported mix if something throws partway
  // through (a bulkAdd rejecting on a malformed row, for instance).
  await db.transaction('rw', [db.weighIns, db.meals, db.movement, db.settings, db.events], async () => {
    // Read THIS device's current secret settings before settings gets
    // cleared below. buildBackup (backup.ts) deliberately strips
    // SECRET_SETTING_KEYS out of every backup file — see its own doc
    // comment for why (a backup travels; a leaked token is expensive) — so
    // the backup's own `tables.settings` never carries them. Without this
    // read-before-clear, restoring a backup would silently wipe whatever
    // GitHub token is configured on THIS phone, even though the backup never
    // claimed to know what it should be.
    const currentSecrets = await Promise.all(SECRET_SETTING_KEYS.map((key) => db.settings.get(key)));

    await db.weighIns.clear();
    await db.weighIns.bulkAdd(backup.tables.weighIns ?? []);

    await db.meals.clear();
    await db.meals.bulkAdd(backup.tables.meals ?? []);

    await db.movement.clear();
    await db.movement.bulkAdd(backup.tables.movement ?? []);

    await db.settings.clear();
    await db.settings.bulkAdd(backup.tables.settings ?? []);
    // Re-insert this device's own secrets, now that the clear+bulkAdd above
    // has happened — `?? []` above already means an OLD backup (taken
    // before some settings key existed) never had a chance to overwrite
    // them, but this restores them even when a NEWER backup's settings rows
    // simply never included them in the first place (they never do, by
    // construction).
    for (const secretRow of currentSecrets) {
      if (secretRow) await db.settings.put(secretRow);
    }

    await db.events.clear();
    await db.events.bulkAdd(backup.tables.events ?? []);
  });

  // Written to the just-restored events table (the transaction above
  // already replaced it wholesale with the backup's own log) — so this
  // becomes the first new line after the restored history, not lost inside
  // the clear-then-bulkAdd that preceded it.
  //
  // Unlike Runway's own restoreBackup.ts, there is nothing to re-arm after
  // this transaction commits: Tide has no alarms, widgets, or day-gauge tied
  // to weighIns/meals/movement. The one device-side process that reads this
  // data (Health Connect syncing, healthSync.ts) re-runs on its own on the
  // next app open/resume — a restore doesn't need to trigger it directly.
  void logEvent('backup', 'Backup restored.');
}
