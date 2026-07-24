import Dexie, { type EntityTable } from 'dexie';
import type { Meal, Movement, Setting, WeighIn } from './types';

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
  }
}

export const db = new TideDB();

// No seed data. Runway seeds a "Standard" template because a generic
// morning routine is genuinely representative of any user's prep steps —
// Tide has no equivalent: a first weigh-in is Deepak's own number, not a
// generic example, so WeighInEntry's empty-state prompt does the work a
// seed would do elsewhere. Same reasoning Runway's own db.ts gives for why
// Prüfung's tables get no seed row either.
