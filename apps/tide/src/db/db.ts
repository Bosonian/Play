import Dexie, { type EntityTable } from 'dexie';
import type { Meal, Movement, Setting, TideEvent, WeighIn } from './types';

// Dexie's index string only lists fields actually queried by (`id`/`key`
// are the implicit primary keys). `weighIns` is indexed on `at` because the
// trend engine and History both need "all weigh-ins, in date order" —
// everything else this increment is read as a whole table (`meals` and
// `movement` aren't queried by any screen yet — see types.ts's header
// comment on why they're defined now as rows-in-waiting) or by key
// (`settings`).
class TideDB extends Dexie {
  weighIns!: EntityTable<WeighIn, 'id'>;
  meals!: EntityTable<Meal, 'id'>;
  movement!: EntityTable<Movement, 'date'>;
  settings!: EntityTable<Setting, 'key'>;
  // Activity log (increment 2, v2 below) — a capped, local record of what
  // the app did, for tracing bugs after the fact. See src/lib/eventLog.ts.
  events!: EntityTable<TideEvent, 'id'>;

  constructor() {
    super('tide');
    // v1: every table TIDE_PLAN.md §4 names, defined together up front —
    // unlike Runway (which grew its tables incrementally over many
    // increments, each getting its own version() bump), Tide's whole
    // increment-1 schema is known now, so there's no reason to spread it
    // across multiple versions before a single install has ever run this
    // code. `meals`/`movement` have no screen yet (increment 4/3
    // respectively) but exist here so the schema doesn't need a migration
    // later just to add tables nothing has written to.
    //
    // `movement`'s primary key is `date` (an ISO date string, one row per
    // calendar day), not a generated `id` — a day either has a movement
    // row or it doesn't; there's no scenario where two rows describe the
    // same day, so `date` alone is a natural key and a synthetic id would
    // just be a redundant column pointing at the same information.
    this.version(1).stores({
      weighIns: 'id, at',
      meals: 'id, at',
      movement: 'date',
      settings: 'key',
    });
    // v2 (increment 2 — Capacitor/CI/activity-log/self-update): adds
    // `events`, a genuinely new table — same "new store needs a version
    // bump, existing stores don't" rule Runway's own db.ts documents at
    // each of its version() calls (fieldReports' v4, tasks' v5, events' own
    // v6 there). Purely additive: every v1 table and row is untouched by
    // this upgrade, and increment 1 shipped before any real install existed
    // to migrate, so there's no upgrade risk here beyond the mechanical
    // "new empty table appears" Dexie already handles automatically.
    // Indexed on `at` (the log is always read newest-first, capped, and
    // pruned oldest-first — see eventLog.ts's recentEvents/pruneEventLog),
    // same index choice as Runway's own `events: 'id, at'`.
    this.version(2).stores({
      weighIns: 'id, at',
      meals: 'id, at',
      movement: 'date',
      settings: 'key',
      events: 'id, at',
    });
    // Health Connect bridge increment (0.3.0): no version(3) bump. Every
    // field the sync needs (`weighIns.source: 'healthconnect'`,
    // `movement.source`/`steps`/`activeKcal`/`manualTier`) already exists in
    // v1/v2 — this increment is the first real WRITER of `movement`, not a
    // schema change. See db/types.ts's own header comment on when a bump is
    // actually required (a new indexed field, never a table simply
    // gaining its first real writer).
  }
}

export const db = new TideDB();

// No seed data. Runway seeds a "Standard" template because a generic
// morning routine is genuinely representative of any user's prep steps —
// Tide has no equivalent: a first weigh-in is Deepak's own number, not a
// generic example, so WeighInEntry's empty-state prompt does the work a
// seed would do elsewhere. Same reasoning Runway's own db.ts gives for why
// Prüfung's tables get no seed row either.
