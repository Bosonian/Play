import { describe, expect, it } from 'vitest';
import { nextCommitment } from './dayGauge';
import type { Departure, Exam, WorkTask } from '../db/types';

// Fixed "now" for every test — a local-time constructor (not a UTC ISO
// string), same convention recurrence.test.ts uses, because the
// study-block candidate below goes through `occurrenceDates`, which reads
// LOCAL calendar date/weekday off `now` (see recurrence.ts's own doc
// comment on why). 2026-07-09 08:00 is a Thursday (ISO weekday 4). The
// departure/task candidates below use absolute UTC-Z instants instead
// (their arithmetic only ever compares epoch millis, never a local
// calendar field), so this choice doesn't affect them.
const NOW = new Date(2026, 6, 9, 8, 0, 0);

function makeDeparture(overrides: Partial<Departure> = {}): Departure {
  return {
    id: 'd1',
    templateId: null,
    name: 'Klinik',
    destination: 'Klinikum',
    appointmentAt: '2026-07-09T09:00:00.000Z', // leaveBy: 09:00 - 20 = 08:40
    travelMinutes: 20,
    bufferMinutes: 10,
    steps: [],
    status: 'planned',
    startedAt: null,
    leftAt: null,
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: '2026-07-09T07:00:00.000Z',
    originalAppointmentAt: '2026-07-09T09:00:00.000Z',
    scheduledForDate: null,
    wasReplanned: false,
    arrivalSteps: [],
    arrivedAt: null,
    arrivalWifiSsid: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<WorkTask> = {}): WorkTask {
  return {
    id: 't1',
    name: 'Befunden EEG',
    units: [],
    deadlineAt: '2026-07-09T10:00:00.000Z',
    status: 'planned',
    startedAt: null,
    createdAt: '2026-07-09T07:00:00.000Z',
    ...overrides,
  };
}

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 'e1',
    name: 'Facharztprüfung',
    windowStart: '2026-11-01',
    examDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    studySchedule: null,
    ...overrides,
  };
}

describe('nextCommitment', () => {
  it('returns null when there is nothing to show at all', () => {
    expect(nextCommitment(NOW, [], [], undefined)).toBeNull();
  });

  it('picks a departure\'s leaveBy, labeled "Leave for {name}"', () => {
    const departure = makeDeparture();
    const result = nextCommitment(NOW, [departure], [], undefined);
    expect(result).toEqual({ label: 'Leave for Klinik', at: new Date('2026-07-09T08:40:00.000Z') });
  });

  it('picks a task\'s deadline, labeled "{name} due"', () => {
    const task = makeTask();
    const result = nextCommitment(NOW, [], [task], undefined);
    expect(result).toEqual({ label: 'Befunden EEG due', at: new Date('2026-07-09T10:00:00.000Z') });
  });

  it('picks the exam\'s next study-block occurrence, labeled "Study block"', () => {
    // NOW is 2026-07-09, a Thursday (ISO weekday 4).
    const exam = makeExam({ studySchedule: { time: '19:00', days: [4], minutes: 50 } });
    const result = nextCommitment(NOW, [], [], exam);
    expect(result).toEqual({ label: 'Study block', at: new Date(2026, 6, 9, 19, 0, 0) });
  });

  it('soonest wins across all three kinds', () => {
    // leaveBy 08:40, task deadline 10:00, study block later today at 19:00 —
    // the departure's leaveBy is soonest.
    const departure = makeDeparture();
    const task = makeTask();
    const exam = makeExam({ studySchedule: { time: '19:00', days: [4], minutes: 50 } });
    const result = nextCommitment(NOW, [departure], [task], exam);
    expect(result?.label).toBe('Leave for Klinik');
  });

  it('soonest wins the other way too: an earlier task deadline beats a later departure', () => {
    const soonTask = makeTask({ deadlineAt: '2026-07-09T08:20:00.000Z' }); // before the 08:40 leaveBy
    const laterDeparture = makeDeparture();
    const result = nextCommitment(NOW, [laterDeparture], [soonTask], undefined);
    expect(result?.label).toBe('Befunden EEG due');
  });

  it('excludes a departure whose leaveBy has already passed', () => {
    // Appointment 5 min from now, but 20 min of travel means leaveBy is
    // already 15 min in the past.
    const late = makeDeparture({ appointmentAt: '2026-07-09T08:05:00.000Z' });
    expect(nextCommitment(NOW, [late], [], undefined)).toBeNull();
  });

  it('excludes a task whose deadline has already passed', () => {
    const overdue = makeTask({ deadlineAt: '2026-07-09T07:00:00.000Z' });
    expect(nextCommitment(NOW, [], [overdue], undefined)).toBeNull();
  });

  it('excludes a departure whose status is left/done/abandoned', () => {
    const done = makeDeparture({ status: 'done' });
    const left = makeDeparture({ id: 'd2', status: 'left' });
    const abandoned = makeDeparture({ id: 'd3', status: 'abandoned' });
    expect(nextCommitment(NOW, [done, left, abandoned], [], undefined)).toBeNull();
  });

  it('excludes a task with no deadline', () => {
    const noDeadline = makeTask({ deadlineAt: null });
    expect(nextCommitment(NOW, [], [noDeadline], undefined)).toBeNull();
  });

  it('excludes an exam with no study schedule', () => {
    const exam = makeExam({ studySchedule: null });
    expect(nextCommitment(NOW, [], [], exam)).toBeNull();
  });

  it('handles an undefined exam the same as one with no schedule', () => {
    expect(nextCommitment(NOW, [], [], undefined)).toBeNull();
  });
});
