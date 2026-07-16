import { useEffect, useState } from 'react';
import type { CompanionDatabase } from '../db/store';
import { db, upsertPatient } from '../db/store';
import type { Patient } from '../../domain/types';
import { generateLocalCode } from './log';

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
export async function ensureLocalPatient(database: CompanionDatabase): Promise<Patient> {
  return database.transaction('rw', database.patients, async () => {
    const existing = await database.patients.toCollection().first();
    if (existing) return existing;
    const created: Patient = {
      code: generateLocalCode(),
      createdAt: new Date().toISOString(),
    };
    await upsertPatient(database, created);
    return created;
  });
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
