import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';
import {
  addEvent,
  deleteEvent,
  finishObservationStudy,
  getActiveObservationStudy,
  getAssessmentsForStudy,
  makeDb,
  putAssessment,
  putAssessments,
  putObservationStudy,
  saveTappingCheckIn,
} from './store';
import {
  buildObservationStudy,
  OBSERVATION_PROTOCOL_VERSION,
  type AssessmentRecord,
} from '../../domain/observation';
import type { MotorEvent } from '../../domain/types';

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

  it('atomically and idempotently saves the linked state plus both hands', async () => {
    const database = makeDb(`observation-${++counter}`);
    const event: MotorEvent = {
      id: 'state-1', patient: 'P-01', kind: 'motor',
      at: '2026-09-03T10:00:00.000Z', state: 'uncertain',
      studyId: 's1', assessmentSessionId: 'session-3',
    };
    const hand = (side: 'left' | 'right', outcome: 'unable' | 'interrupted'): AssessmentRecord => ({
      id: `session-3-${side}`, studyId: 's1', patient: 'P-01',
      protocolVersion: OBSERVATION_PROTOCOL_VERSION,
      kind: 'finger-tapping', reason: 'scheduled-daily',
      startedAt: event.at, completedAt: event.at, sessionId: 'session-3',
      outcome, measurementProtocolVersion: 3,
      quality: 'invalid', qualityReasons: [outcome],
      linkedMotorEventId: event.id, selfReportedState: event.state,
      selfReportedStateAt: event.at, checkInProtocolVersion: 1,
      metadata: { side },
    });
    const records = [hand('left', 'unable'), hand('right', 'interrupted')];
    await saveTappingCheckIn(database, event, records);
    await saveTappingCheckIn(database, event, records);
    expect(await database.events.get(event.id)).toEqual(event);
    expect(await database.assessments.count()).toBe(2);
    await expect(saveTappingCheckIn(database, { ...event, state: 'off' }, records))
      .rejects.toThrow('inconsistent');
    database.close();
  });

  it('requires both hands to carry the same optional reminder context', async () => {
    const database = makeDb(`observation-${++counter}`);
    const event: MotorEvent = {
      id: 'reminder-state', patient: 'P-01', kind: 'motor',
      at: '2026-09-03T12:00:00.000Z', state: 'on',
      studyId: 's1', assessmentSessionId: 'reminder-session',
    };
    const hand = (side: 'left' | 'right'): AssessmentRecord => ({
      id: `reminder-session-${side}`, studyId: 's1', patient: 'P-01',
      protocolVersion: OBSERVATION_PROTOCOL_VERSION,
      kind: 'finger-tapping', reason: 'scheduled-daily',
      startedAt: event.at, sessionId: 'reminder-session', outcome: 'completed',
      quality: 'valid', qualityReasons: [], metadata: { side },
      linkedMotorEventId: event.id, selfReportedState: event.state,
      selfReportedStateAt: event.at, checkInProtocolVersion: 1,
      reminderOccurrenceId: 'occurrence-12',
      reminderScheduledAt: '2026-09-03T12:00:00.000Z',
    });
    const records = [hand('left'), hand('right')];

    await expect(saveTappingCheckIn(database, event, [
      records[0],
      { ...records[1], reminderScheduledAt: '2026-09-03T12:05:00.000Z' },
    ])).rejects.toThrow('same reminder occurrence and scheduled time');
    expect(await database.events.count()).toBe(0);
    expect(await database.assessments.count()).toBe(0);
    database.close();
  });

  it('deduplicates a reminder occurrence across sessions while preserving exact retries', async () => {
    const database = makeDb(`observation-${++counter}`);
    const event: MotorEvent = {
      id: 'occurrence-state-1', patient: 'P-01', kind: 'motor',
      at: '2026-09-03T13:00:00.000Z', state: 'uncertain',
      studyId: 's1', assessmentSessionId: 'occurrence-session-1',
    };
    const hands = (sessionId: string, linkedMotorEventId: string): AssessmentRecord[] =>
      (['left', 'right'] as const).map((side) => ({
        id: `${sessionId}-${side}`, studyId: 's1', patient: 'P-01',
        protocolVersion: OBSERVATION_PROTOCOL_VERSION,
        kind: 'finger-tapping', reason: 'scheduled-daily',
        startedAt: event.at, sessionId, outcome: 'completed',
        quality: 'valid', qualityReasons: [], metadata: { side },
        linkedMotorEventId, selfReportedState: event.state,
        selfReportedStateAt: event.at, checkInProtocolVersion: 1,
        reminderOccurrenceId: 'one-native-occurrence',
        reminderScheduledAt: '2026-09-03T13:00:00.000Z',
      }));
    const firstRecords = hands('occurrence-session-1', event.id);

    await saveTappingCheckIn(database, event, firstRecords);
    await saveTappingCheckIn(database, event, firstRecords);

    const secondEvent: MotorEvent = {
      ...event, id: 'occurrence-state-2', assessmentSessionId: 'occurrence-session-2',
    };
    await expect(saveTappingCheckIn(
      database,
      secondEvent,
      hands('occurrence-session-2', secondEvent.id),
    )).rejects.toThrow('already has a different tapping session');
    expect(await database.events.toArray()).toEqual([event]);
    expect(await database.assessments.count()).toBe(2);
    database.close();
  });

  it('keeps an assessment-linked state immutable outside the atomic tapping save', async () => {
    const database = makeDb(`observation-${++counter}`);
    const event: MotorEvent = {
      id: 'protected-state', patient: 'P-01', kind: 'motor',
      at: '2026-09-03T14:00:00.000Z', state: 'off',
      studyId: 's1', assessmentSessionId: 'protected-session',
    };
    const records: AssessmentRecord[] = (['left', 'right'] as const).map((side) => ({
      id: `protected-session-${side}`, studyId: 's1', patient: 'P-01',
      protocolVersion: OBSERVATION_PROTOCOL_VERSION,
      kind: 'finger-tapping', reason: 'symptom-triggered',
      startedAt: event.at, sessionId: 'protected-session', outcome: 'unable',
      quality: 'invalid', qualityReasons: ['unable-to-complete'], metadata: { side },
      linkedMotorEventId: event.id, selfReportedState: event.state,
      selfReportedStateAt: event.at, checkInProtocolVersion: 1,
    }));
    await saveTappingCheckIn(database, event, records);

    await addEvent(database, event);
    await expect(addEvent(database, { ...event, at: '2026-09-03T14:05:00.000Z' }))
      .rejects.toThrow('can only be saved with their tapping session');
    await expect(deleteEvent(database, event.id))
      .rejects.toThrow('cannot be deleted separately');
    expect(await database.events.get(event.id)).toEqual(event);
    expect(await database.assessments.count()).toBe(2);

    await expect(addEvent(database, {
      ...event, id: 'orphan-linked-state', assessmentSessionId: 'orphan-session',
    })).rejects.toThrow('can only be saved with their tapping session');
    expect(await database.events.get('orphan-linked-state')).toBeUndefined();
    database.close();
  });

  it('rolls back the state event when the second hand insert fails', async () => {
    const database = makeDb(`observation-${++counter}`);
    const event: MotorEvent = {
      id: 'rollback-state', patient: 'P-01', kind: 'motor',
      at: '2026-09-03T11:00:00.000Z', state: 'on',
      studyId: 's1', assessmentSessionId: 'rollback-session',
    };
    const record = (side: 'left' | 'right'): AssessmentRecord => ({
      id: `rollback-${side}`, studyId: 's1', patient: 'P-01',
      protocolVersion: 1, kind: 'finger-tapping', reason: 'pre-dose',
      startedAt: event.at, sessionId: 'rollback-session', outcome: 'completed',
      quality: 'valid', qualityReasons: [], metadata: { side },
      linkedMotorEventId: event.id, selfReportedState: event.state,
      selfReportedStateAt: event.at, checkInProtocolVersion: 1,
    });
    const fail = (_key: unknown, value: AssessmentRecord) => {
      if (value.id === 'rollback-right') throw new Error('right failed');
    };
    database.assessments.hook('creating').subscribe(fail);
    await expect(saveTappingCheckIn(database, event, [record('left'), record('right')]))
      .rejects.toThrow('right failed');
    expect(await database.events.get(event.id)).toBeUndefined();
    expect(await database.assessments.count()).toBe(0);
    database.assessments.hook('creating').unsubscribe(fail);
    database.close();
  });
});
