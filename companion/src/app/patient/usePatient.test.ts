// fake-indexeddb/auto must be the first import — see the identical comment
// in src/app/db/store.test.ts for why (Dexie's IDB detection runs at
// module-evaluation time, and vitest's default environment here is 'node').
import 'fake-indexeddb/auto';

import { describe, it, expect } from 'vitest';
import { makeDb } from '../db/store';
import { ensureLocalPatient } from './usePatient';

describe('ensureLocalPatient', () => {
  it('creates a patient on first call', async () => {
    const db = makeDb(`test-patient-${Date.now()}-a`);
    const patient = await ensureLocalPatient(db);
    expect(patient.code).toMatch(/^local-/);
    expect(patient.createdAt).toBeTruthy();
    db.close();
  });

  it('returns the same patient on a second call rather than creating another', async () => {
    const db = makeDb(`test-patient-${Date.now()}-b`);
    const first = await ensureLocalPatient(db);
    const second = await ensureLocalPatient(db);
    expect(second.code).toBe(first.code);
    const all = await db.patients.toArray();
    expect(all).toHaveLength(1);
    db.close();
  });
});
