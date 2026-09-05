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
import type { Patient, PatientEvent, PatientModel, Consent, ISODateTime, MotorEvent } from '../../domain/types';
import type { RegimenItem } from '../../domain/regimen';
import type { ActivityRow } from '../activity/types';
import type { FieldReport } from '../report/types';
import type { AssessmentRecord, ObservationStudy } from '../../domain/observation';
import type { CustomMedication } from '../../domain/medicationLookup';
import { customMedicationKey } from '../../domain/medicationLookup';
import {
  MEDICINE_IMPORT_PARSER_VERSION,
  MEDICINE_IMPORT_SCHEMA_VERSION,
  type MedicationImportReceipt,
} from '../../domain/medicineImport';
import { validateRegimenItem } from '../../domain/regimen';
import { safeUuid } from '../lib/uuid';

// The pre-version(4) RegimenItem shape (one doseMg for the whole item, times
// as bare strings) — kept ONLY so the version(4) upgrade below can name what
// it's migrating away from. Not exported: nothing outside this migration
// should ever construct or expect this shape again.
type RegimenItemV3 = Omit<RegimenItem, 'times' | 'strengthMg' | 'freeText'> & {
  doseMg: number;
  times: string[];
};

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
  observationStudies!: EntityTable<ObservationStudy, 'id'>;
  assessments!: EntityTable<AssessmentRecord, 'id'>;
  customMedications!: EntityTable<CustomMedication, 'id'>;
  medicationImportReceipts!: EntityTable<MedicationImportReceipt, 'id'>;

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

    // Non-additive: regimenItems rows move from one-doseMg-for-the-item to
    // dose-per-time (SPEC RISK 1). This rewrites existing rows in place, so
    // it needs a real .upgrade() callback, unlike versions 2-3 above.
    //
    // Guard: only touch rows that still have the OLD shape ('doseMg' in
    // row) — a device that's never had a regimenItems row, or one already
    // migrated, hits this as a no-op. And this must never throw: if it did,
    // Dexie aborts the whole upgrade transaction and the database is left
    // stuck unopenable at v3 (real device data, not a test fixture) — so the
    // migration logic itself carries no validation that could reject a row,
    // just a reshape.
    this.version(4).stores({}).upgrade(async (tx) => {
      await tx.table('regimenItems').toCollection().modify((row) => {
        if ('doseMg' in row) {
          const legacy = row as RegimenItemV3;
          (row as unknown as RegimenItem).times = (legacy.times ?? []).map((t) => ({
            time: t,
            doseMg: legacy.doseMg,
          }));
          delete (row as { doseMg?: number }).doseMg;
        }
      });
    });

    this.version(5).stores({
      observationStudies: '&id, patient, status, [patient+status], startedAt',
      assessments: '&id, studyId, patient, kind, quality, startedAt',
    });

    this.version(6).stores({
      customMedications: '&id, &normalizedKey, createdAt',
    });

    this.version(7).stores({
      medicationImportReceipts: '&id, patient, appliedAt, imageSha256',
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
  await database.transaction('rw', database.events, async () => {
    const existing = await database.events.get(event.id);
    const incomingLinked = event.kind === 'motor' && Boolean(event.assessmentSessionId);
    const existingLinked = existing?.kind === 'motor' && Boolean(existing.assessmentSessionId);
    if (incomingLinked || existingLinked) {
      if (existing && stableSerialize(existing) === stableSerialize(event)) return;
      throw new Error('Assessment-linked motor events can only be saved with their tapping session.');
    }
    await database.events.put(event);
  });
}

// Bulk-add events, idempotent by id (bulkPut overwrites on a matching primary
// key rather than erroring, so re-adding an already-stored event — e.g. a
// retried sync — is a harmless no-op, same idempotency guarantee as
// mergeEvents in the domain layer).
export async function addEvents(database: CompanionDatabase, events: PatientEvent[]): Promise<void> {
  await database.events.bulkPut(events);
}

export async function deleteEvent(database: CompanionDatabase, id: string): Promise<void> {
  await database.transaction('rw', database.events, async () => {
    const existing = await database.events.get(id);
    if (existing?.kind === 'motor' && existing.assessmentSessionId) {
      throw new Error('Assessment-linked motor events cannot be deleted separately.');
    }
    await database.events.delete(id);
  });
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

export async function putRegimenWithCustomMedication(
  database: CompanionDatabase,
  item: RegimenItem,
  input: { id?: string; name: string; formulation: string; createdAt?: ISODateTime },
): Promise<CustomMedication> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const formulation = input.formulation.trim().replace(/\s+/g, ' ');
  const normalizedKey = customMedicationKey(name, formulation);
  return database.transaction('rw', database.customMedications, database.regimenItems, async () => {
    const existing = await database.customMedications.where('normalizedKey').equals(normalizedKey).first();
    const profile: CustomMedication = existing ?? {
      id: input.id ?? safeUuid(),
      name,
      formulation,
      normalizedKey,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    if (!existing) await database.customMedications.add(profile);
    await database.regimenItems.put({ ...item, customMedicationId: profile.id });
    return profile;
  });
}

export interface ApplyMedicationImportInput {
  id: string;
  patient: string;
  provider: 'google-cloud-vision';
  feature: 'DOCUMENT_TEXT_DETECTION';
  region: 'eu';
  schemaVersion: number;
  parserVersion: number;
  imageSha256: string;
  actor: 'local-doctor-mode';
  appliedAt: ISODateTime;
  confirmedItems: RegimenItem[];
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function copyImportedItem(item: RegimenItem): RegimenItem {
  const copy: RegimenItem = {
    id: item.id,
    patient: item.patient,
    drug: item.drug,
    times: item.times.map(({ time, doseMg }) => ({ time, doseMg })),
    updatedAt: item.updatedAt,
    ...(item.drug === 'custom'
      ? {
          customName: item.customName,
          customFormulation: item.customFormulation,
          ...(item.customMedicationId ? { customMedicationId: item.customMedicationId } : {}),
        }
      : {}),
    ...(item.strengthMg !== undefined ? { strengthMg: item.strengthMg } : {}),
    ...(item.freeText !== undefined ? { freeText: item.freeText } : {}),
    ...(item.prn ? { prn: { doseMg: item.prn.doseMg, indication: item.prn.indication, ...(item.prn.instructions !== undefined ? { instructions: item.prn.instructions } : {}) } } : {}),
  };
  return copy;
}

function normalizedClinicalText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return normalized || undefined;
}

function importedClinicalKey(item: RegimenItem): string {
  const identity = item.drug === 'custom'
    ? `custom:${customMedicationKey(item.customName!, item.customFormulation!)}`
    : `catalog:${item.drug}`;
  return stableSerialize({
    identity,
    times: item.times
      .map((time) => ({ time: time.time, doseMg: time.doseMg }))
      .sort((a, b) => a.time.localeCompare(b.time) || a.doseMg - b.doseMg),
    freeText: normalizedClinicalText(item.freeText),
    prn: item.prn
      ? {
          doseMg: item.prn.doseMg,
          indication: normalizedClinicalText(item.prn.indication),
          instructions: normalizedClinicalText(item.prn.instructions),
        }
      : undefined,
  });
}

function importFingerprint(input: ApplyMedicationImportInput): string {
  return stableSerialize({
    id: input.id,
    patient: input.patient,
    provider: input.provider,
    feature: input.feature,
    region: input.region,
    schemaVersion: input.schemaVersion,
    parserVersion: input.parserVersion,
    imageSha256: input.imageSha256,
    actor: input.actor,
    appliedAt: input.appliedAt,
    confirmedItems: input.confirmedItems.map((item) => {
      const { customMedicationId: _customId, ...confirmed } = item;
      return confirmed;
    }),
  });
}

function snapshotMedicationImport(input: ApplyMedicationImportInput): ApplyMedicationImportInput {
  return {
    id: input.id,
    patient: input.patient,
    provider: input.provider,
    feature: input.feature,
    region: input.region,
    schemaVersion: input.schemaVersion,
    parserVersion: input.parserVersion,
    imageSha256: input.imageSha256,
    actor: input.actor,
    appliedAt: input.appliedAt,
    confirmedItems: input.confirmedItems.map(copyImportedItem),
  };
}

function validateMedicationImportMetadata(input: ApplyMedicationImportInput): void {
  if (!input.id.trim()) throw new Error('Medication import id is required.');
  if (!input.patient.trim()) throw new Error('Medication import patient is required.');
  if (input.provider !== 'google-cloud-vision'
      || input.feature !== 'DOCUMENT_TEXT_DETECTION'
      || input.region !== 'eu') {
    throw new Error('Unsupported medication import provider configuration.');
  }
  if (input.schemaVersion !== MEDICINE_IMPORT_SCHEMA_VERSION
      || input.parserVersion !== MEDICINE_IMPORT_PARSER_VERSION) {
    throw new Error('Unsupported medication import schema or parser version.');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.imageSha256)) {
    throw new Error('Medication import image hash is invalid.');
  }
  if (input.actor !== 'local-doctor-mode') throw new Error('Medication import actor is invalid.');
  if (!input.appliedAt || Number.isNaN(Date.parse(input.appliedAt))) {
    throw new Error('Medication import timestamp is invalid.');
  }
}

export async function applyMedicationImport(
  database: CompanionDatabase,
  input: ApplyMedicationImportInput,
): Promise<MedicationImportReceipt> {
  // Capture an allowlisted deep snapshot before the first await. Validation,
  // the idempotency fingerprint, and every write must describe exactly the
  // same values even if a UI caller mutates its draft while this runs.
  const snapshot = snapshotMedicationImport(input);
  validateMedicationImportMetadata(snapshot);
  if (snapshot.confirmedItems.length === 0) throw new Error('Import has no confirmed medicines.');
  const ids = new Set<string>();
  const exactItems = new Set<string>();
  for (const item of snapshot.confirmedItems) {
    if (item.patient !== snapshot.patient) throw new Error('Imported regimen item belongs to another patient.');
    const errors = validateRegimenItem(item);
    if (errors.length > 0) throw new Error(`Invalid imported regimen item: ${errors.join(' ')}`);
    if (ids.has(item.id)) throw new Error(`Duplicate imported regimen id: ${item.id}`);
    ids.add(item.id);
    const exactKey = importedClinicalKey(item);
    if (exactItems.has(exactKey)) throw new Error('Import contains an exact duplicate medicine.');
    exactItems.add(exactKey);
  }

  const fingerprint = importFingerprint(snapshot);
  return database.transaction(
    'rw',
    database.medicationImportReceipts,
    database.regimenItems,
    database.customMedications,
    async () => {
      const previous = await database.medicationImportReceipts.get(snapshot.id);
      if (previous) {
        if (previous.payloadFingerprint !== fingerprint) {
          throw new Error(`Medication import ${snapshot.id} already exists with different content.`);
        }
        return previous;
      }
      for (const item of snapshot.confirmedItems) {
        if (await database.regimenItems.get(item.id)) throw new Error(`Regimen id collision: ${item.id}`);
      }
      const existingClinicalKeys = new Set(
        (await database.regimenItems.where('patient').equals(snapshot.patient).toArray())
          .map(importedClinicalKey),
      );
      for (const item of snapshot.confirmedItems) {
        if (existingClinicalKeys.has(importedClinicalKey(item))) {
          throw new Error('Import duplicates an existing medicine.');
        }
      }

      const storedItems: RegimenItem[] = [];
      for (const source of snapshot.confirmedItems) {
        let item = copyImportedItem(source);
        if (item.drug === 'custom') {
          const name = item.customName!.trim().replace(/\s+/g, ' ');
          const formulation = item.customFormulation!.trim().replace(/\s+/g, ' ');
          const normalizedKey = customMedicationKey(name, formulation);
          let profile = await database.customMedications.where('normalizedKey').equals(normalizedKey).first();
          if (!profile) {
            const profileId = item.customMedicationId ?? safeUuid();
            if (await database.customMedications.get(profileId)) {
              throw new Error(`Custom medication id collision: ${profileId}`);
            }
            profile = { id: profileId, name, formulation, normalizedKey, createdAt: snapshot.appliedAt };
            await database.customMedications.add(profile);
          }
          item = { ...item, customMedicationId: profile.id };
        }
        await database.regimenItems.add(item);
        storedItems.push(item);
      }

      const receipt: MedicationImportReceipt = {
        id: snapshot.id,
        patient: snapshot.patient,
        provider: snapshot.provider,
        feature: snapshot.feature,
        region: snapshot.region,
        schemaVersion: snapshot.schemaVersion,
        parserVersion: snapshot.parserVersion,
        imageSha256: snapshot.imageSha256,
        actor: snapshot.actor,
        appliedAt: snapshot.appliedAt,
        payloadFingerprint: fingerprint,
        confirmedItems: storedItems.map(copyImportedItem),
      };
      await database.medicationImportReceipts.add(receipt);
      return receipt;
    },
  );
}

export async function deleteRegimenItem(database: CompanionDatabase, id: string): Promise<void> {
  await database.regimenItems.delete(id);
}

export async function putObservationStudy(database: CompanionDatabase, study: ObservationStudy): Promise<void> {
  await database.transaction('rw', database.observationStudies, async () => {
    if (study.status === 'active') {
      const active = await database.observationStudies
        .where('[patient+status]').equals([study.patient, 'active']).toArray();
      await Promise.all(active.filter((row) => row.id !== study.id).map((row) =>
        database.observationStudies.update(row.id, {
          status: 'cancelled',
          completedAt: study.startedAt,
        }),
      ));
    }
    await database.observationStudies.put(study);
  });
}

export async function getActiveObservationStudy(
  database: CompanionDatabase,
  patient: string,
): Promise<ObservationStudy | undefined> {
  return database.observationStudies.where('[patient+status]').equals([patient, 'active']).first();
}

export async function finishObservationStudy(
  database: CompanionDatabase,
  id: string,
  status: 'completed' | 'cancelled',
  completedAt: string,
): Promise<void> {
  await database.observationStudies.update(id, { status, completedAt });
}

export async function putAssessment(database: CompanionDatabase, assessment: AssessmentRecord): Promise<void> {
  await database.assessments.put(assessment);
}

export async function putAssessments(
  database: CompanionDatabase,
  assessments: AssessmentRecord[],
): Promise<void> {
  await database.transaction('rw', database.assessments, async () => {
    // bulkPut uses each stable assessment id as its idempotency key. Keeping
    // both hands in one transaction prevents a failed retry from exposing a
    // half-saved bilateral session.
    await database.assessments.bulkPut(assessments);
  });
}

export async function saveTappingCheckIn(
  database: CompanionDatabase,
  motorEventInput: MotorEvent,
  assessmentInputs: AssessmentRecord[],
): Promise<void> {
  const motorEvent: MotorEvent = { ...motorEventInput };
  const assessments = assessmentInputs.map((record) => ({
    ...record,
    qualityReasons: [...record.qualityReasons],
    ...(record.metadata ? { metadata: { ...record.metadata } } : {}),
    ...(record.features ? { features: { ...record.features } } : {}),
  }));
  if (assessments.length !== 2) throw new Error('A tapping check-in requires both hand records.');
  if (!motorEvent.studyId || !motorEvent.assessmentSessionId) {
    throw new Error('The motor event must be linked to a study and assessment session.');
  }
  const sides = new Set(assessments.map((record) => record.metadata?.side));
  if (!sides.has('left') || !sides.has('right') || sides.size !== 2) {
    throw new Error('A tapping check-in requires one left and one right hand record.');
  }
  const [first, second] = assessments;
  if (first.reminderOccurrenceId !== second.reminderOccurrenceId
    || first.reminderScheduledAt !== second.reminderScheduledAt) {
    throw new Error('Both tapping hand records must have the same reminder occurrence and scheduled time.');
  }
  for (const record of assessments) {
    if (record.patient !== motorEvent.patient
      || record.studyId !== motorEvent.studyId
      || record.sessionId !== motorEvent.assessmentSessionId
      || record.linkedMotorEventId !== motorEvent.id
      || record.selfReportedState !== motorEvent.state
      || record.selfReportedStateAt !== motorEvent.at) {
      throw new Error('Tapping check-in links are inconsistent.');
    }
  }
  await database.transaction('rw', database.events, database.assessments, async () => {
    const occurrenceId = first.reminderOccurrenceId;
    if (occurrenceId) {
      const recordedOccurrence = await database.assessments
        .filter((record) => record.reminderOccurrenceId === occurrenceId)
        .toArray();
      const incomingIds = new Set(assessments.map((record) => record.id));
      if (recordedOccurrence.some((record) =>
        record.sessionId !== motorEvent.assessmentSessionId || !incomingIds.has(record.id))) {
        throw new Error('This reminder occurrence already has a different tapping session.');
      }
    }
    const existingEvent = await database.events.get(motorEvent.id);
    const existingAssessments = await Promise.all(assessments.map((record) => database.assessments.get(record.id)));
    if (existingEvent || existingAssessments.some(Boolean)) {
      const identical = existingEvent
        && stableSerialize(existingEvent) === stableSerialize(motorEvent)
        && existingAssessments.every((record, index) =>
          record && stableSerialize(record) === stableSerialize(assessments[index]));
      if (identical) return;
      throw new Error('Tapping check-in ids already exist with different content.');
    }
    await database.events.add(motorEvent);
    await database.assessments.bulkAdd(assessments);
  });
}

export async function getAssessmentsForStudy(
  database: CompanionDatabase,
  studyId: string,
): Promise<AssessmentRecord[]> {
  return database.assessments.where('studyId').equals(studyId).sortBy('startedAt');
}

// Unsorted — sorting is the domain layer's job (see regimen.ts's
// sortRegimenItems), keeping this store function a thin, dumb read.
export async function getRegimenForPatient(
  database: CompanionDatabase,
  patient: string,
): Promise<RegimenItem[]> {
  return database.regimenItems.where('patient').equals(patient).toArray();
}
