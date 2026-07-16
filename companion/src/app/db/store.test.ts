// SPEC RISK #4 (orchestrator-approved): fake-indexeddb's /auto import
// installs the IndexedDB shim as a side effect and MUST run before anything
// that touches Dexie is imported — Dexie/dexie's global IDB detection reads
// `globalThis.indexedDB` at module-evaluation time, not lazily. Vitest's
// default environment for this project is 'node' (no jsdom), which has no
// native IndexedDB, so without this shim (and without this import order)
// every db.open() would throw. This must stay the first line of the file.
import 'fake-indexeddb/auto';

import { describe, it, expect } from 'vitest';
import Dexie, { type EntityTable } from 'dexie';
import {
  makeDb,
  upsertPatient,
  getPatient,
  addEvent,
  addEvents,
  deleteEvent,
  getEventsInRange,
  getPatientModel,
  putPatientModel,
  getConsent,
  putConsent,
  putRegimenItem,
  deleteRegimenItem,
  getRegimenForPatient,
  type CompanionDatabase,
} from './store';
import type { DoseEvent, Patient, PatientEvent, PatientModel, Consent } from '../../domain/types';
import type { RegimenItem } from '../../domain/regimen';

// Each test gets its own uniquely-named database so tests never share state
// or race each other (fake-indexeddb keeps separate DBs fully isolated, same
// as real IndexedDB does per-origin).
let dbCounter = 0;
function freshDb(): CompanionDatabase {
  return makeDb(`test-companion-${++dbCounter}-${Date.now()}`);
}

const dose = (id: string, at: string, doseMg = 100): DoseEvent => ({
  id,
  patient: 'P-01',
  at,
  kind: 'dose',
  drug: 'levodopa',
  doseMg,
});

describe('store — patients', () => {
  it('upserts and reads back a patient', async () => {
    const db = freshDb();
    const patient: Patient = { code: 'P-01', createdAt: '2026-07-16T00:00:00Z' };
    await upsertPatient(db, patient);
    const fetched = await getPatient(db, 'P-01');
    expect(fetched).toEqual(patient);
    db.close();
  });

  it('returns undefined for an unknown patient code', async () => {
    const db = freshDb();
    expect(await getPatient(db, 'nope')).toBeUndefined();
    db.close();
  });
});

describe('store — events', () => {
  it('adds an event and range-queries it back', async () => {
    const db = freshDb();
    const d = dose('e1', '2026-07-16T08:00:00Z');
    await addEvent(db, d);
    const results = await getEventsInRange(
      db,
      'P-01',
      '2026-07-16T00:00:00Z',
      '2026-07-16T23:59:59Z',
    );
    expect(results.map((e) => e.id)).toEqual(['e1']);
    db.close();
  });

  it('excludes events outside the range', async () => {
    const db = freshDb();
    await addEvent(db, dose('in-range', '2026-07-16T08:00:00Z'));
    await addEvent(db, dose('before', '2026-07-15T23:59:59Z'));
    await addEvent(db, dose('after', '2026-07-17T00:00:01Z'));
    const results = await getEventsInRange(
      db,
      'P-01',
      '2026-07-16T00:00:00Z',
      '2026-07-16T23:59:59Z',
    );
    expect(results.map((e) => e.id)).toEqual(['in-range']);
    db.close();
  });

  it('range query boundaries are inclusive (events exactly at start/end ISO are included)', async () => {
    const db = freshDb();
    const startISO = '2026-07-16T00:00:00Z';
    const endISO = '2026-07-16T23:59:59Z';
    await addEvent(db, dose('at-start', startISO));
    await addEvent(db, dose('at-end', endISO));
    const results = await getEventsInRange(db, 'P-01', startISO, endISO);
    expect(results.map((e) => e.id).sort()).toEqual(['at-end', 'at-start']);
    db.close();
  });

  it('bulkPut via addEvents is idempotent: re-adding the same id does not duplicate', async () => {
    const db = freshDb();
    const d = dose('dup-1', '2026-07-16T08:00:00Z', 100);
    await addEvents(db, [d]);
    // Re-add the same id, with a changed field, simulating a retried sync.
    await addEvents(db, [{ ...d, doseMg: 150 }]);
    const all = await db.events.where('patient').equals('P-01').toArray();
    expect(all).toHaveLength(1);
    expect((all[0] as DoseEvent).doseMg).toBe(150); // last-writer-wins, no dup row
    db.close();
  });

  it('deletes an event', async () => {
    const db = freshDb();
    await addEvent(db, dose('to-delete', '2026-07-16T08:00:00Z'));
    await deleteEvent(db, 'to-delete');
    const all = await db.events.where('patient').equals('P-01').toArray();
    expect(all).toHaveLength(0);
    db.close();
  });
});

describe('store — patient model + consent round trips', () => {
  it('round-trips a patient model', async () => {
    const db = freshDb();
    await putPatientModel(db, {
      patient: 'P-01',
      onThreshold: 0.4,
      dyskThreshold: 0.9,
      updatedAt: '2026-07-16T00:00:00Z',
    });
    const model = await getPatientModel(db, 'P-01');
    expect(model?.onThreshold).toBe(0.4);
    expect(model?.dyskThreshold).toBe(0.9);
    db.close();
  });

  it('round-trips consent', async () => {
    const db = freshDb();
    await putConsent(db, { patient: 'P-01', agreedAt: '2026-07-16T00:00:00Z', version: '1' });
    const consent = await getConsent(db, 'P-01');
    expect(consent?.version).toBe('1');
    db.close();
  });
});

const regimenItem = (
  id: string,
  patient: string,
  overrides: Partial<RegimenItem> = {},
): RegimenItem => ({
  id,
  patient,
  drug: 'levodopa',
  doseMg: 100,
  times: ['08:00', '12:00'],
  updatedAt: '2026-07-16T00:00:00Z',
  ...overrides,
});

describe('store — regimen items', () => {
  it('CRUD round trip: put two items for P-01, one for P-02 -> getRegimenForPatient(P-01) returns exactly the two', async () => {
    const db = freshDb();
    await putRegimenItem(db, regimenItem('r1', 'P-01'));
    await putRegimenItem(db, regimenItem('r2', 'P-01', { drug: 'rotigotine', doseMg: 8, times: ['08:00'] }));
    await putRegimenItem(db, regimenItem('r3', 'P-02'));
    const forP01 = await getRegimenForPatient(db, 'P-01');
    expect(forP01.map((i) => i.id).sort()).toEqual(['r1', 'r2']);
    db.close();
  });

  it('deleteRegimenItem removes the row', async () => {
    const db = freshDb();
    await putRegimenItem(db, regimenItem('to-delete', 'P-01'));
    await deleteRegimenItem(db, 'to-delete');
    const forP01 = await getRegimenForPatient(db, 'P-01');
    expect(forP01).toHaveLength(0);
    db.close();
  });

  it('put with same id overwrites (edit semantics, no duplicate row)', async () => {
    const db = freshDb();
    await putRegimenItem(db, regimenItem('r1', 'P-01', { doseMg: 100 }));
    await putRegimenItem(db, regimenItem('r1', 'P-01', { doseMg: 150 }));
    const forP01 = await getRegimenForPatient(db, 'P-01');
    expect(forP01).toHaveLength(1);
    expect(forP01[0].doseMg).toBe(150);
    db.close();
  });

  it('migration: a v1-only database opened under the v2 schema keeps old rows and gains the regimen table', async () => {
    // Local class declaring ONLY the version-1 stores, simulating a device
    // that has never seen the v2 schema — proves the migration path is
    // additive and non-destructive (SPEC RISK #1).
    class V1Database extends Dexie {
      patients!: EntityTable<Patient, 'code'>;
      events!: EntityTable<PatientEvent, 'id'>;
      patientModels!: EntityTable<PatientModel, 'patient'>;
      consent!: EntityTable<Consent, 'patient'>;

      constructor(name: string) {
        super(name);
        this.version(1).stores({
          patients: '&code, createdAt',
          events: '&id, patient, at, kind, [patient+at]',
          patientModels: '&patient',
          consent: '&patient',
        });
      }
    }

    const dbName = `test-companion-migration-${Date.now()}`;
    const v1db = new V1Database(dbName);
    await v1db.patients.put({ code: 'P-01', createdAt: '2026-07-16T00:00:00Z' });
    await v1db.events.put(dose('legacy-event', '2026-07-16T08:00:00Z'));
    v1db.close();

    const v2db = makeDb(dbName);
    const events = await getEventsInRange(
      v2db,
      'P-01',
      '2026-07-16T00:00:00Z',
      '2026-07-16T23:59:59Z',
    );
    expect(events.map((e) => e.id)).toEqual(['legacy-event']);

    await putRegimenItem(v2db, regimenItem('r1', 'P-01'));
    const regimen = await getRegimenForPatient(v2db, 'P-01');
    expect(regimen.map((i) => i.id)).toEqual(['r1']);
    v2db.close();
  });

  it('migration: a v1+v2-only database opened under the v3 schema keeps old rows and gains activityLog + fieldReports', async () => {
    // Local class declaring ONLY the version-1+version-2 stores, simulating a
    // device that has never seen the v3 schema — proves the v2->v3 migration
    // path is additive and non-destructive (SPEC RISK A).
    class V2Database extends Dexie {
      patients!: EntityTable<Patient, 'code'>;
      events!: EntityTable<PatientEvent, 'id'>;
      patientModels!: EntityTable<PatientModel, 'patient'>;
      consent!: EntityTable<Consent, 'patient'>;
      regimenItems!: EntityTable<RegimenItem, 'id'>;

      constructor(name: string) {
        super(name);
        this.version(1).stores({
          patients: '&code, createdAt',
          events: '&id, patient, at, kind, [patient+at]',
          patientModels: '&patient',
          consent: '&patient',
        });
        this.version(2).stores({
          regimenItems: '&id, patient',
        });
      }
    }

    const dbName = `test-companion-migration-v3-${Date.now()}`;
    const v2db = new V2Database(dbName);
    await v2db.patients.put({ code: 'P-01', createdAt: '2026-07-16T00:00:00Z' });
    await v2db.events.put(dose('legacy-event', '2026-07-16T08:00:00Z'));
    await v2db.regimenItems.put(regimenItem('legacy-r1', 'P-01'));
    v2db.close();

    const v3db = makeDb(dbName);
    const events = await getEventsInRange(
      v3db,
      'P-01',
      '2026-07-16T00:00:00Z',
      '2026-07-16T23:59:59Z',
    );
    expect(events.map((e) => e.id)).toEqual(['legacy-event']);
    const regimen = await getRegimenForPatient(v3db, 'P-01');
    expect(regimen.map((i) => i.id)).toEqual(['legacy-r1']);

    // New v3 tables accept writes.
    await v3db.activityLog.put({
      id: 'a1',
      at: '2026-07-16T00:00:00Z',
      category: 'lifecycle',
      message: 'test',
    });
    expect(await v3db.activityLog.count()).toBe(1);

    await v3db.fieldReports.put({
      id: 'f1',
      createdAt: '2026-07-16T00:00:00Z',
      status: 'pending',
      description: 'test',
      metadata: { appVersion: '0.7.0', screen: 'list', at: '2026-07-16T00:00:00Z' },
    });
    expect(await v3db.fieldReports.count()).toBe(1);

    v3db.close();
  });

  it('fieldReports.status index: where(status).equals(pending) returns exactly the pending rows', async () => {
    const db = freshDb();
    await db.fieldReports.bulkPut([
      {
        id: 'pending-1',
        createdAt: '2026-07-16T00:00:00Z',
        status: 'pending',
        description: 'a',
        metadata: { appVersion: '0.7.0', screen: 'list', at: '2026-07-16T00:00:00Z' },
      },
      {
        id: 'synced-1',
        createdAt: '2026-07-16T00:00:00Z',
        status: 'synced',
        description: 'b',
        metadata: { appVersion: '0.7.0', screen: 'list', at: '2026-07-16T00:00:00Z' },
      },
      {
        id: 'failed-1',
        createdAt: '2026-07-16T00:00:00Z',
        status: 'failed',
        description: 'c',
        metadata: { appVersion: '0.7.0', screen: 'list', at: '2026-07-16T00:00:00Z' },
      },
    ]);
    const pending = await db.fieldReports.where('status').equals('pending').toArray();
    expect(pending.map((r) => r.id)).toEqual(['pending-1']);
    db.close();
  });
});
