import { db } from '../db/db';
import type { Departure } from '../db/types';
import { cancelDepartureAlarms } from '../native/notifications';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from './dayGaugeRefresh';
import { logEvent } from './eventLog';

// The write side of the duplicate-template repair (field report #12's
// residue — see duplicateTemplates.ts's header comment for the full
// background). KEY INSIGHT this whole module leans on: learning is NOT
// stored per template. learning.ts's computeSuggestions/computeBufferSuggestions
// (around lines 430/477) derive a template's history by filtering
// `departures` on `departure.templateId === template.id` — so merging two
// templates needs no sample-merging maths at all. Re-pointing a departure's
// `templateId` from the losing template to the winning one is the entire
// merge; the combined history recombines by itself the next time anything
// reads it.

/**
 * One departure's fate in a merge, decided by `decideMerge` below.
 * 'repoint': its `templateId` moves to the winner — this is every completed
 * run (the learning history this whole feature exists to preserve), every
 * abandoned/running row, and any manually-created departure that happens to
 * link to the loser. 'delete': the departure is removed outright, no
 * re-point — reserved for a future, not-yet-started MATERIALIZED occurrence
 * of the loser's own recurring schedule, where the winner's own
 * materializer pass already owns (or will own) an occurrence for that same
 * date. Re-pointing one of those instead of deleting it would leave two
 * departure rows claiming the same calendar slot once both templates'
 * schedules are merged into one.
 */
export interface MergeDecision {
  toRepoint: Departure[];
  toDelete: Departure[];
}

/**
 * Decides, for every departure currently pointing at `loserTemplateId`,
 * whether it should be re-pointed to the winner or deleted outright. Pure —
 * no Dexie — so this is the function under test; `mergeTemplates` below is a
 * thin Dexie transaction wrapped around its answer.
 *
 * "Future, not-yet-started, materialized" is deliberately the EXACT same
 * four-condition test materialize.ts's `replaceUntouchedFutureAutoRows`
 * already uses to decide "safe to replace" for a template schedule edit —
 * reused rather than reinvented, because that's already this codebase's one
 * definition of "an auto-created occurrence nobody has touched yet":
 *   - `status === 'planned'` — 'running' means startedAt is set (see below),
 *     'left'/'done'/'abandoned' are all already-decided outcomes, not open
 *     future slots.
 *   - `scheduledForDate != null` — this row came from the materializer, not
 *     from someone typing a one-off departure into DepartureSetup by hand.
 *     A manually-created departure has no guaranteed sibling under the
 *     winner for the "same slot" reasoning to apply to.
 *   - `startedAt == null` — untouched. A departure Deepak has already begun
 *     is his now, not a slot to silently delete out from under him.
 *   - `appointmentAt` still ahead of `nowMs` — a past-due 'planned' row
 *     (Home's dimmed "Past departure time" section) is stale, but it is not
 *     what this rule is for; it gets RE-POINTED like everything else that
 *     doesn't meet all four conditions, and FIX 4's 48-hour expiry (Home.tsx)
 *     independently prunes stale past-due rows from view regardless of which
 *     template they point at.
 */
export function decideMerge(loserTemplateId: string, departures: Departure[], nowMs: number): MergeDecision {
  const toRepoint: Departure[] = [];
  const toDelete: Departure[] = [];

  for (const departure of departures) {
    if (departure.templateId !== loserTemplateId) continue;

    const isFutureUntouchedMaterialized =
      departure.status === 'planned' &&
      departure.scheduledForDate != null &&
      departure.startedAt == null &&
      new Date(departure.appointmentAt).getTime() > nowMs;

    if (isFutureUntouchedMaterialized) {
      toDelete.push(departure);
    } else {
      toRepoint.push(departure);
    }
  }

  return { toRepoint, toDelete };
}

export interface MergeResult {
  repointedCount: number;
  deletedCount: number;
}

/**
 * Merges `loserId` into `winnerId`: re-points the loser's past/touched
 * departures onto the winner, deletes the loser's future untouched
 * materialized occurrences, deletes the loser template row, and logs the
 * whole thing through the same `logEvent` machinery every other write path
 * in this app uses. Never touches the winner template itself — its steps,
 * travel, buffer and schedule are exactly what they were before the merge;
 * only departures and the loser template row are written.
 *
 * The Dexie writes (departure updates/deletes, template delete) happen in
 * ONE transaction — a merge is exactly the kind of multi-row write where a
 * partial failure (say, the template delete succeeds but a departure
 * re-point doesn't) would leave the database in a state worse than either
 * "fully merged" or "not merged at all": an orphaned departure pointing at
 * a templateId that no longer exists.
 *
 * `cancelDepartureAlarms` (native, not a Dexie op) deliberately runs AFTER
 * that transaction commits, not inside it — Dexie auto-commits a
 * transaction the instant it awaits a promise that isn't one of its own
 * operations, so an awaited native call inside `db.transaction` risks the
 * transaction closing early with writes still pending. Same ordering
 * `materialize.ts`'s own sweeps use (delete the row, cancel its alarm,
 * plainly sequential, no shared transaction).
 */
export async function mergeTemplates(winnerId: string, loserId: string, now: Date = new Date()): Promise<MergeResult> {
  const [winner, loser, departures] = await Promise.all([
    db.templates.get(winnerId),
    db.templates.get(loserId),
    db.departures.toArray(),
  ]);
  if (!winner || !loser) {
    throw new Error('mergeTemplates: winner or loser template not found');
  }

  const { toRepoint, toDelete } = decideMerge(loserId, departures, now.getTime());

  await db.transaction('rw', db.templates, db.departures, async () => {
    for (const departure of toRepoint) {
      await db.departures.update(departure.id, { templateId: winnerId });
    }
    for (const departure of toDelete) {
      await db.departures.delete(departure.id);
    }
    await db.templates.delete(loserId);
  });

  for (const departure of toDelete) {
    await cancelDepartureAlarms(departure.id, departure.name);
  }

  void logEvent(
    'departure',
    `Templates merged: "${loser.name}" merged into "${winner.name}". ` +
      `${toRepoint.length} departures moved, ${toDelete.length} future occurrences removed.`,
  );

  // A merge can change which departure is "next" for the widget (a deleted
  // future occurrence, a re-pointed row) — same refresh pair every other
  // departure-mutating write path in this app fires (Home.tsx's
  // removeDeparture, materialize.ts's sweeps).
  void refreshWidgets();
  void refreshDayGauge();

  return { repointedCount: toRepoint.length, deletedCount: toDelete.length };
}
