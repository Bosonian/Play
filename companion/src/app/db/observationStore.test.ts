import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';
import {
  finishObservationStudy,
  getActiveObservationStudy,
  getAssessmentsForStudy,
  makeDb,
  putAssessment,
  putAssessments,
  putObservationStudy,
} from './store';
import {
  buildObservationStudy,
  OBSERVATION_PROTOCOL_VERSION,
  type AssessmentRecord,
} from '../../domain/observation';

let counter = 0;

function study(id: string, startedAt: string) {
  return buildObservationStudy({
    id,
    patient: 'P-01',
    durationDays: 14,
    startedAt,
    regimen: [{
      id: 'r1',
      patient: 'P-01',
      drug: 'levodopa',
      times: [{ time: '08:00', doseMg: 100 }],
      updatedAt: startedAt,
    }],
  });
}

describe('observation persistence', () => {
  it('stores one active study and freezes its regimen snapshot', async () => {
    const database = makeDb(`observation-${++counter}`);
    const first = study('s1', '2026-09-01T00:00:00.000Z');
    await putObservationStudy(database, first);
    expect((await getActiveObservationStudy(database, 'P-01'))?.id).toBe('s1');

    const second = study('s2', '2026-09-02T00:00:00.000Z');
    await putObservationStudy(database, second);
    expect((await getActiveObservationStudy(database, 'P-01'))?.id).toBe('s2');
    expect((await database.observationStudies.get('s1'))?.status).toBe('cancelled');
    database.close();
  });

  it('does not cancel the current study when closed history is saved', async () => {
    const database = makeDb(`observation-${++counter}`);
    const active = study('current', '2026-09-02T00:00:00.000Z');
    const historical = {
      ...study('history', '2026-08-01T00:00:00.000Z'),
      status: 'completed' as const,
      completedAt: '2026-08-15T00:00:00.000Z',
    };

    await putObservationStudy(database, active);
    await putObservationStudy(database, historical);

    expect((await getActiveObservationStudy(database, 'P-01'))?.id).toBe('current');
    expect((await database.observationStudies.get('history'))?.status).toBe('completed');
    database.close();
  });

  it('completes a study and persists ordered assessment records', async () => {
    const database = makeDb(`observation-${++counter}`);
    const active = study('s1', '2026-09-01T00:00:00.000Z');
    await putObservationStudy(database, active);
    await putAssessment(database, {
      id: 'a2', studyId: 's1', patient: 'P-01',
      protocolVersion: OBSERVATION_PROTOCOL_VERSION,
      kind: 'finger-tapping', reason: 'expected-onset',
      startedAt: '2026-09-01T09:00:00.000Z',
      completedAt: '2026-09-01T09:00:10.000Z',
      quality: 'valid', qualityReasons: [],
      featureSchemaVersion: 1, features: { tapsPerSecond: 3.8 },
    });
    await putAssessment(database, {
      id: 'a1', studyId: 's1', patient: 'P-01',
      protocolVersion: OBSERVATION_PROTOCOL_VERSION,
      kind: 'check-in', reason: 'pre-dose',
      startedAt: '2026-09-01T08:00:00.000Z',
      quality: 'valid', qualityReasons: [],
    });
    const assessments = await getAssessmentsForStudy(database, 's1');
    expect(assessments.map((row) => row.id)).toEqual(['a1', 'a2']);
    expect(assessments.find((row) => row.id === 'a2')?.featureSchemaVersion).toBe(1);

    await finishObservationStudy(database, 's1', 'completed', '2026-09-15T00:00:00.000Z');
    expect(await getActiveObservationStudy(database, 'P-01')).toBeUndefined();
    expect((await database.observationStudies.get('s1'))?.status).toBe('completed');
    database.close();
  });

  it('atomically and idempotently saves both outcomes in one tapping session', async () => {
    const database = makeDb(`observation-${++counter}`);
    const common = {
      studyId: 's1',
      patient: 'P-01',
      protocolVersion: OBSERVATION_PROTOCOL_VERSION,
      kind: 'finger-tapping' as const,
      reason: 'symptom-triggered' as const,
      sessionId: 'session-1',
      measurementProtocolVersion: 2,
      featureSchemaVersion: 2,
    };
    const bilateral: AssessmentRecord[] = [
      {
        ...common,
        id: 'session-1-left',
        startedAt: '2026-09-03T10:00:00.000Z',
        completedAt: '2026-09-03T10:00:10.000Z',
        outcome: 'completed',
        quality: 'valid',
        qualityReasons: [],
        features: { side: 'left', successfulTapCount: 0 },
      },
      {
        ...common,
        id: 'session-1-right',
        startedAt: '2026-09-03T10:01:00.000Z',
        completedAt: '2026-09-03T10:01:00.000Z',
        outcome: 'unable',
        quality: 'invalid',
        qualityReasons: ['unable-to-complete'],
      },
    ];

    await putAssessments(database, bilateral);
    await putAssessments(database, bilateral);

    const stored = await getAssessmentsForStudy(database, 's1');
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => [row.id, row.sessionId, row.outcome])).toEqual([
      ['session-1-left', 'session-1', 'completed'],
      ['session-1-right', 'session-1', 'unable'],
    ]);
    expect(stored[0].features).toEqual({ side: 'left', successfulTapCount: 0 });
    expect(stored[1].features).toBeUndefined();
    database.close();
  });

  it('rolls back both hand records when an atomic bilateral write fails', async () => {
    const database = makeDb(`observation-${++counter}`);
    const rejectRight = (_key: unknown, record: AssessmentRecord) => {
      if (record.id === 'reject-right') throw new Error('simulated write failure');
    };
    database.assessments.hook('creating').subscribe(rejectRight);
    const record = (id: string): AssessmentRecord => ({
      id,
      studyId: 's1',
      patient: 'P-01',
      protocolVersion: OBSERVATION_PROTOCOL_VERSION,
      kind: 'finger-tapping',
      reason: 'pre-dose',
      startedAt: '2026-09-03T10:00:00.000Z',
      sessionId: 'session-2',
      outcome: 'completed',
      measurementProtocolVersion: 2,
      quality: 'valid',
      qualityReasons: [],
      featureSchemaVersion: 2,
      features: { side: id === 'left-ok' ? 'left' : 'right' },
    });

    await expect(putAssessments(database, [record('left-ok'), record('reject-right')]))
      .rejects.toThrow('simulated write failure');
    expect(await database.assessments.count()).toBe(0);
    database.assessments.hook('creating').unsubscribe(rejectRight);
    database.close();
  });
});
