import Dexie, { type EntityTable } from 'dexie';
import type { Departure, Template } from './types';

// Dexie's index string only lists the fields we actually query by
// (`id` is the implicit primary key for both tables). `appointmentAt` and
// `status` are indexed on `departures` because Home needs "upcoming
// departures" (status in planned/running, sorted by appointment time) —
// everything else is read as a whole document, not queried by field.
class RunwayDB extends Dexie {
  templates!: EntityTable<Template, 'id'>;
  departures!: EntityTable<Departure, 'id'>;

  constructor() {
    super('runway');
    this.version(1).stores({
      templates: 'id',
      departures: 'id, appointmentAt, status',
    });
  }
}

export const db = new RunwayDB();

// Seed data: ships once, on first run, so the app is never empty. The
// "Standard" template mirrors the example routine in RUNWAY_PLAN.md §5.1
// (shower / dress / pack bag / shoes & door) with an empty destination —
// destination is inherently personal, so we leave it for the user to fill
// in rather than guessing one.
const SEED_TEMPLATE_ID = 'seed-standard-template';

// `on('populate', ...)` fires exactly once — the first time the database is
// created — so this can't accidentally re-seed after the user deletes the
// Standard template later. Dexie runs this inside the same transaction that
// creates the object stores, so the handler must be async and awaited
// directly (not fired-and-forgotten) or the transaction can close before
// the add completes.
db.on('populate', async () => {
  const now = new Date().toISOString();
  await db.templates.add({
    id: SEED_TEMPLATE_ID,
    name: 'Standard',
    destination: '',
    travelMinutes: 20,
    bufferMinutes: 10,
    steps: [
      { id: crypto.randomUUID(), name: 'Shower', minutes: 15 },
      { id: crypto.randomUUID(), name: 'Dress', minutes: 10 },
      { id: crypto.randomUUID(), name: 'Pack bag', minutes: 5 },
      { id: crypto.randomUUID(), name: 'Shoes and door', minutes: 5 },
    ],
    createdAt: now,
    updatedAt: now,
  });
});
