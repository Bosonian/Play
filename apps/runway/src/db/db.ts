import Dexie, { type EntityTable } from 'dexie';
import type { Departure, Exam, FieldReport, Milestone, Setting, Sprint, Template, Topic, WorkTask } from './types';

// Dexie's index string only lists the fields we actually query by
// (`id` is the implicit primary key for both tables). `appointmentAt` and
// `status` are indexed on `departures` because Home needs "upcoming
// departures" (status in planned/running, sorted by appointment time) —
// everything else is read as a whole document, not queried by field.
class RunwayDB extends Dexie {
  templates!: EntityTable<Template, 'id'>;
  departures!: EntityTable<Departure, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  // Prüfung mode (Dexie v3 below) — exam prep, additive to the departure
  // tables above.
  exams!: EntityTable<Exam, 'id'>;
  topics!: EntityTable<Topic, 'id'>;
  sprints!: EntityTable<Sprint, 'id'>;
  milestones!: EntityTable<Milestone, 'id'>;
  // Field reports (Dexie v4 below) — in-app bug/improvement reports.
  fieldReports!: EntityTable<FieldReport, 'id'>;
  // Tasks (Dexie v5 below) — timed work without travel.
  tasks!: EntityTable<WorkTask, 'id'>;

  constructor() {
    super('runway');
    this.version(1).stores({
      templates: 'id',
      departures: 'id, appointmentAt, status',
    });
    // v2 (increment 6): adds `settings`, a key-value table for small
    // app-level flags — first user is the first-run setup card's
    // dismissal. Dexie handles this upgrade automatically for existing
    // installs: it only *adds* a store here, doesn't touch `templates` or
    // `departures`, so every existing row in those tables is untouched and
    // the new `settings` table simply starts empty. No explicit .upgrade()
    // callback is needed because there's no data to migrate — a brand-new
    // empty table needs no transformation from what came before.
    this.version(2).stores({
      templates: 'id',
      departures: 'id, appointmentAt, status',
      settings: 'key',
    });
    // v3 (Prüfung increment 1): adds the exam-prep tables — exams, topics,
    // sprints, milestones. Same "purely additive" shape as v1→v2 above:
    // every new store is genuinely new (nothing in `templates`,
    // `departures` or `settings` changes shape), so there's no data to
    // migrate and no explicit .upgrade() callback is needed — existing
    // installs just gain four empty tables. Indexes beyond the primary key
    // are chosen for the queries later increments are already known to
    // need: `topics` on `examId` (TopicEdit reads "all topics for this
    // exam"); `sprints` on `examId, topicId, startedAt` (the pace math and
    // per-topic hours in increment 2 both need to sum/filter by topic and
    // by recency); `milestones` on `examId, at` (a chronological list in
    // increment 4).
    this.version(3).stores({
      templates: 'id',
      departures: 'id, appointmentAt, status',
      settings: 'key',
      exams: 'id',
      topics: 'id, examId',
      sprints: 'id, examId, topicId, startedAt',
      milestones: 'id, examId, at',
    });
    // v4 (field-reports increment): adds `fieldReports`, a genuinely new
    // table — unlike Template.schedule or Departure.scheduledForDate above,
    // which only ever added non-indexed fields to EXISTING tables and so
    // needed no version bump at all, a new table's name has to appear in a
    // `stores()` call for Dexie to create the underlying object store.
    // Indexed on `status` (ReportProblem.tsx's list needs "pending or
    // failed" rows for the retry action, and reportSync.ts's engine needs
    // "all pending, oldest first") and `createdAt` (the list's sort order,
    // newest first, capped to 10). Purely additive otherwise — every
    // existing table and row is untouched by this upgrade.
    this.version(4).stores({
      templates: 'id',
      departures: 'id, appointmentAt, status',
      settings: 'key',
      exams: 'id',
      topics: 'id, examId',
      sprints: 'id, examId, topicId, startedAt',
      milestones: 'id, examId, at',
      fieldReports: 'id, status, createdAt',
    });
    // v5 (tasks increment): adds `tasks`, a genuinely new table — same
    // "new store needs a version bump" reasoning as fieldReports' v4 above,
    // unlike a non-indexed field added to an EXISTING table (Template.
    // schedule, Departure.scheduledForDate), which needs none. Indexed on
    // `status` (Home's "Tasks" section reads planned/running rows) and
    // `createdAt` (tiebreak sort when two tasks share a deadline, or have
    // none) — same shape as `departures`' own index choice. Purely
    // additive otherwise; every existing table and row is untouched.
    this.version(5).stores({
      templates: 'id',
      departures: 'id, appointmentAt, status',
      settings: 'key',
      exams: 'id',
      topics: 'id, examId',
      sprints: 'id, examId, topicId, startedAt',
      milestones: 'id, examId, at',
      fieldReports: 'id, status, createdAt',
      tasks: 'id, status, createdAt',
    });
  }
}

export const db = new RunwayDB();

// Seed data: ships once, on first run, so the app is never empty. The
// "Standard" template mirrors the example routine in RUNWAY_PLAN.md §5.1
// (shower / dress / pack bag / shoes & door) with an empty destination —
// destination is inherently personal, so we leave it for the user to fill
// in rather than guessing one.
//
// Prüfung's tables (exams, topics, sprints, milestones) deliberately get no
// equivalent seed row: an exam is Deepak's specific exam, not a generic
// example, so ExamSetup's empty state does the work a seed would do
// elsewhere — see RUNWAY_PRUFUNG_PLAN.md's "not a fake-urgency machine" §1.
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
    schedule: null,
    autoLearn: false,
    arrivalSteps: [],
    arrivalWifiSsid: null,
  });
});
