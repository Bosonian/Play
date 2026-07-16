import { useEffect, useState } from 'react';
import type { CompanionDatabase } from '../db/store';
import { db, upsertPatient } from '../db/store';
import type { Patient } from '../../domain/types';
import { generateLocalCode } from './log';
import { logEvent } from '../activity/activityLog';

// Finds (or creates, first run only) the single local patient record.
//
// SPEC RISK #1: src/app/main.tsx renders <App /> under <StrictMode>, which
// intentionally double-invokes effects in dev to surface non-idempotent
// side effects. A naive "read, then write if missing" sequence split across
// two separate awaits would race: both StrictMode passes could read "no
// patient yet" before either write lands, and both would then create one —
// two patient rows, one device. Wrapping the read-then-create in a single
// Dexie 'rw' transaction closes that window: Dexie serializes transactions
// against the same table, so the second call's `.first()` read waits for the
// first call's write to commit and correctly sees the already-created row.
//
// SPEC RISK B: the activity-log write for "created a patient" happens AFTER
// the transaction resolves, not inside it. Dexie transactions are scoped to
// the tables named in `database.transaction('rw', database.patients, ...)`;
// activityLog isn't one of them, so a `.put()` to it from inside this
// callback would be rejected by Dexie and, because logEvent swallows its own
// errors by contract (see activityLog.ts), the line would simply vanish with
// no error surfaced anywhere. Logging outside the transaction, once we know
// it committed (`result.created`), avoids that silent loss.
export async function ensureLocalPatient(database: CompanionDatabase): Promise<Patient> {
  const result = await database.transaction('rw', database.patients, async () => {
    const existing = await database.patients.toCollection().first();
    if (existing) return { patient: existing, created: false };
    const created: Patient = {
      code: generateLocalCode(),
      createdAt: new Date().toISOString(),
    };
    await upsertPatient(database, created);
    return { patient: created, created: true };
  });
  if (result.created) {
    void logEvent('lifecycle', `Created local patient record ${result.patient.code}`, database);
  }
  return result.patient;
}

// Bootstraps (or fetches) the local patient once on mount. Returns null
// while bootstrapping — bootstrap is single-digit milliseconds (one local
// IndexedDB transaction), so callers render nothing rather than a spinner.
export function usePatient(): Patient | null {
  const [patient, setPatient] = useState<Patient | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ensureLocalPatient(db).then((p) => {
      if (!cancelled) setPatient(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return patient;
}
