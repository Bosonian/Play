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

  constructor(name = 'pd-companion') {
    super(name);
    // Index strings: `&` = unique/primary key; plain field = secondary index;
    // `[a+b]` = compound index. `[patient+at]` supports the range query below
    // as a single index scan rather than a full-table filter.
    this.version(1).stores({
      patients: '&code, createdAt',
      events: '&id, patient, at, kind, [patient+at]',
      patientModels: '&patient',
      consent: '&patient',
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
