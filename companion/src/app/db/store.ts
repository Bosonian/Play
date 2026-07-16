// Local persistence for the dosing companion (Dexie/IndexedDB).
//
// HONESTY NOTE: this data is de-identified (see the privacy-by-design comment
// in src/domain/types.ts — patients are only ever short codes, never named)
// and lives on-device only. At-rest encryption of the IndexedDB store is a
// deliberate LATER hardening step, NOT implemented in this increment. If the
// device itself is compromised, this data is readable.
//
// This is the APP layer, not the domain layer: Dexie (and IndexedDB) are
// browser/runtime concerns. src/domain/* stays free of both so the domain
// logic (LEDD, motor-state mapping, the drug catalog) can be unit-tested and
// reasoned about without a browser or a fake-indexeddb shim.

import Dexie, { type EntityTable } from 'dexie';
import type { Patient, PatientEvent, PatientModel, Consent, ISODateTime } from '../../domain/types';
import type { RegimenItem } from '../../domain/regimen';
import type { ActivityRow } from '../activity/types';
import type { FieldReport } from '../report/types';

// The companion's Dexie database. Modeled on the root Head-in app's
// src/db/db.ts pattern (see that file for the versioning-comment rationale).
//
// Schema versioning: bump version() and add a new .stores() block (plus an
// .upgrade() callback for any non-additive change) when the schema changes.
// Dexie handles additive changes (new tables, new indexes) automatically.
export class CompanionDatabase extends Dexie {
  patients!: EntityTable<Patient, 'code'>;
  events!: EntityTable<PatientEvent, 'id'>;
  patientModels!: EntityTable<PatientModel, 'patient'>;
  consent!: EntityTable<Consent, 'patient'>;
  regimenItems!: EntityTable<RegimenItem, 'id'>;
  activityLog!: EntityTable<ActivityRow, 'id'>;
  fieldReports!: EntityTable<FieldReport, 'id'>;

  constructor(name = 'pd-companion') {
    super(name);
    // Index strings: `&` = unique/primary key; plain field = secondary index;
    // `[a+b]` = compound index. `[patient+at]` supports the range query below
    // as a single index scan rather than a full-table filter.
    //
    // SPEC RISK #1: version(1) stays byte-identical, forever — Dexie versions
    // are cumulative, so editing an already-shipped version block (rather
    // than adding a new one) would corrupt the upgrade path for anyone who
    // already has a version-1 database on their device.
    this.version(1).stores({
      patients: '&code, createdAt',
      events: '&id, patient, at, kind, [patient+at]',
      patientModels: '&patient',
      consent: '&patient',
    });

    // Additive only: a new table, no changes to any version-1 table, so no
    // .upgrade() callback is needed — Dexie carries every version-1 table
    // forward automatically. Proven non-destructive by the migration test in
    // store.test.ts (an existing v1 row survives opening under this v2 schema).
    this.version(2).stores({
      regimenItems: '&id, patient',
    });

    // Additive only, same rule as version(2): no changes to any earlier table,
    // no .upgrade() needed. BOTH new tables are declared here in one block even
    // though fieldReports is unused until the report system lands — one shipped
    // version(3), never edited after (see SPEC RISK A / this file's SPEC RISK #1).
    this.version(3).stores({
      activityLog: '&id, at',
      fieldReports: '&id, status, createdAt',
    });

    // When a future schema bump opens a new DB version in another tab, let
    // the old connection (this one) close so the upgrade isn't blocked
    // forever — otherwise the new tab hangs on open() and shows a blank
    // screen. And if WE are the tab blocked by an older connection, surface
    // it rather than hang silently.
    this.on('versionchange', () => {
      this.close();
    });
    this.on('blocked', () => {
      // eslint-disable-next-line no-console
      console.warn('[PD Companion] database upgrade blocked — close other open tabs.');
    });
  }
}

// Factory so tests (and any future multi-profile use) can get an isolated,
// independently-named database instead of sharing the app singleton below.
export function makeDb(name?: string): CompanionDatabase {
  return new CompanionDatabase(name);
}

// The app-wide singleton, used by screens/hooks in normal (non-test) runs.
export const db = makeDb();

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------
export async function upsertPatient(database: CompanionDatabase, patient: Patient): Promise<void> {
  await database.patients.put(patient);
}

export async function getPatient(
  database: CompanionDatabase,
  code: string,
): Promise<Patient | undefined> {
  return database.patients.get(code);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export async function addEvent(database: CompanionDatabase, event: PatientEvent): Promise<void> {
  await database.events.put(event);
}

// Bulk-add events, idempotent by id (bulkPut overwrites on a matching primary
// key rather than erroring, so re-adding an already-stored event — e.g. a
// retried sync — is a harmless no-op, same idempotency guarantee as
// mergeEvents in the domain layer).
export async function addEvents(database: CompanionDatabase, events: PatientEvent[]): Promise<void> {
  await database.events.bulkPut(events);
}

export async function deleteEvent(database: CompanionDatabase, id: string): Promise<void> {
  await database.events.delete(id);
}

// Events for one patient within an inclusive [startISO, endISO] window. Uses
// the compound [patient+at] index so this is a single range scan, not a
// full-table filter. ISO-8601 timestamps sort chronologically as plain
// strings, so the lexicographic index comparison Dexie does under the hood
// is also the chronological comparison we want.
export async function getEventsInRange(
  database: CompanionDatabase,
  patientCode: string,
  startISO: ISODateTime,
  endISO: ISODateTime,
): Promise<PatientEvent[]> {
  return database.events
    .where('[patient+at]')
    .between([patientCode, startISO], [patientCode, endISO], true, true)
    .toArray();
}

// ---------------------------------------------------------------------------
// Per-patient model parameters
// ---------------------------------------------------------------------------
export async function getPatientModel(
  database: CompanionDatabase,
  patient: string,
): Promise<PatientModel | undefined> {
  return database.patientModels.get(patient);
}

export async function putPatientModel(
  database: CompanionDatabase,
  model: PatientModel,
): Promise<void> {
  await database.patientModels.put(model);
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------
export async function getConsent(
  database: CompanionDatabase,
  patient: string,
): Promise<Consent | undefined> {
  return database.consent.get(patient);
}

export async function putConsent(database: CompanionDatabase, consent: Consent): Promise<void> {
  await database.consent.put(consent);
}

// ---------------------------------------------------------------------------
// Regimen items
// ---------------------------------------------------------------------------
export async function putRegimenItem(database: CompanionDatabase, item: RegimenItem): Promise<void> {
  await database.regimenItems.put(item);
}

export async function deleteRegimenItem(database: CompanionDatabase, id: string): Promise<void> {
  await database.regimenItems.delete(id);
}

// Unsorted — sorting is the domain layer's job (see regimen.ts's
// sortRegimenItems), keeping this store function a thin, dumb read.
export async function getRegimenForPatient(
  database: CompanionDatabase,
  patient: string,
): Promise<RegimenItem[]> {
  return database.regimenItems.where('patient').equals(patient).toArray();
}
