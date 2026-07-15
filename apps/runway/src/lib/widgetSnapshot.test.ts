import { startOfWeek } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { buildWidgetSnapshot, formatTaskCountsLine, selectWidgetTask } from './widgetSnapshot';
import { examProjection } from './examProjection';
import { computeProjection, computeStartBy } from './projection';
import { taskStartBy } from './taskProjection';
import { formatTime } from './format';
import type { Departure, DepartureStep, Exam, Sprint, Topic, WorkTask } from '../db/types';

// Thursday — matches examProjection.test.ts's fixed NOW so the reasoning
// about which week is "current" lines up with that file's own comments.
const NOW = new Date('2026-07-09T08:00:00.000Z');

// m3: mirrors widgetSnapshot.ts's own (unexported) localMidnight exactly —
// duplicated here rather than exported-just-for-tests, same tradeoff the
// rest of this file already makes for computeProjection/computeStartBy
// (imported for real, since those ARE meant to be reused) versus small
// private helpers. Used to compute the expected readyDayEpochMs/
// generatedDayEpochMs independent of the test runner's own timezone.
function localMidnightMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function makeStep(overrides: Partial<DepartureStep> = {}): DepartureStep {
  return { id: crypto.randomUUID(), name: 'Shoes', plannedMinutes: 5, checkedAt: null, ...overrides };
}

function makeDeparture(overrides: Partial<Departure> = {}): Departure {
  return {
    id: 'departure-1',
    templateId: null,
    name: 'Klinik',
    destination: 'Klinikum Stuttgart',
    appointmentAt: '2026-07-09T14:30:00.000Z',
    travelMinutes: 20,
    bufferMinutes: 10,
    steps: [makeStep()],
    status: 'planned',
    startedAt: null,
    leftAt: null,
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: '2026-07-09T07:00:00.000Z',
    originalAppointmentAt: '2026-07-09T14:30:00.000Z',
    scheduledForDate: null,
    wasReplanned: false,
    arrivalSteps: [],
    arrivedAt: null,
    arrivalWifiSsid: null,
    ...overrides,
  };
}

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 'exam-1',
    name: 'Facharztprüfung Neurologie',
    windowStart: '2026-11-01',
    examDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    studySchedule: null,
    ...overrides,
  };
}

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return { id: 'topic-1', examId: 'exam-1', name: 'Vascular syndromes', estimatedHours: 10, order: 0, ...overrides };
}

function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
  return {
    id: crypto.randomUUID(),
    examId: 'exam-1',
    topicId: 'topic-1',
    plannedMinutes: 50,
    startedAt: '2026-07-01T08:00:00.000Z',
    endedAt: '2026-07-01T08:50:00.000Z',
    ritual: [],
    createdAt: '2026-07-01T08:00:00.000Z',
    ...overrides,
  };
}

// Anti-rot increment 3 (0.39.0, W3 — the tasks widget). One unplanned unit
// by default so `taskStartBy`/`taskProjection` have something to sum —
// callers that only care about status/deadlineAt never need to touch it.
function makeTask(overrides: Partial<WorkTask> = {}): WorkTask {
  return {
    id: 'task-1',
    name: 'Befunden EEG',
    units: [{ id: 'unit-1', name: 'Befunden EEG', plannedMinutes: 15, checkedAt: null }],
    deadlineAt: null,
    status: 'planned',
    startedAt: null,
    createdAt: '2026-07-09T07:00:00.000Z',
    ...overrides,
  };
}

describe('buildWidgetSnapshot', () => {
  it('returns pruefung: null when there is no exam yet', () => {
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [], []);
    expect(snapshot.pruefung).toBeNull();
    expect(snapshot.departure).toBeNull();
    expect(snapshot.generatedAtEpochMs).toBe(NOW.getTime());
  });

  it('sets departure to null when no exam exists either, if there is nothing upcoming', () => {
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [], []);
    expect(snapshot.departure).toBeNull();
  });

  it('sets readyDayEpochMs to local midnight of the projected ready date, for a normal projection', () => {
    // No sprints logged yet: DEFAULT_PACE_HOURS_PER_WEEK (4h/week) applies,
    // 10h remaining → 2.5 weeks → 17.5 days out from NOW.
    const topics = [makeTopic({ estimatedHours: 10 })];
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), topics, [], [], []);
    const expectedReadyDate = examProjection(NOW, makeExam(), topics, []).readyDate;
    expect(snapshot.pruefung?.neverReady).toBe(false);
    expect(expectedReadyDate).not.toBeNull();
    expect(snapshot.pruefung?.readyDayEpochMs).toBe(localMidnightMs(expectedReadyDate!));
  });

  it('sets generatedDayEpochMs to local midnight of the generation instant, for any projection', () => {
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic({ estimatedHours: 10 })], [], [], []);
    expect(snapshot.pruefung?.generatedDayEpochMs).toBe(localMidnightMs(NOW));
  });

  it('readyDayEpochMs equals generatedDayEpochMs when every topic is already at its estimate (done)', () => {
    // examProjection's 'done' branch sets readyDate = now exactly, so both
    // midnights fall on the same calendar day — the native slide (m3) then
    // adds 0 days, same as the old offsetDays === 0 case this replaces.
    const topic = makeTopic({ estimatedHours: 1 });
    const sprint = makeSprint({ startedAt: '2026-07-01T08:00:00.000Z', endedAt: '2026-07-01T09:00:00.000Z' });
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [topic], [sprint], [], []);
    expect(snapshot.pruefung?.neverReady).toBe(false);
    expect(snapshot.pruefung?.readyDayEpochMs).toBe(localMidnightMs(NOW));
    expect(snapshot.pruefung?.readyDayEpochMs).toBe(snapshot.pruefung?.generatedDayEpochMs);
  });

  it('sets emptyExam (not neverReady) when the exam has zero topics — the vacuous-done bug', () => {
    // The field screenshot this fixes: an exam with no topics used to
    // produce the same widget data a genuinely finished exam does
    // (remainingHours([], []) is trivially 0), rendering "Ready by
    // {today}" on the home screen. emptyExam is now a distinct flag the
    // native side checks before neverReady, and readyDayEpochMs is left at
    // its 0 placeholder exactly like the neverReady case, never a real
    // date.
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [], [], [], []);
    expect(snapshot.pruefung?.emptyExam).toBe(true);
    expect(snapshot.pruefung?.neverReady).toBe(false);
    expect(snapshot.pruefung?.readyDayEpochMs).toBe(0);
  });

  it('sets emptyExam when topics exist but every one has 0 estimated hours', () => {
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic({ estimatedHours: 0 })], [], [], []);
    expect(snapshot.pruefung?.emptyExam).toBe(true);
    expect(snapshot.pruefung?.neverReady).toBe(false);
  });

  it('sets neverReady when the measured pace is zero, and leaves readyDayEpochMs at the 0 placeholder', () => {
    // A first sprint two complete weeks ago, then total silence — a
    // measured pace of exactly 0h/week (see examProjection.test.ts for the
    // same "silence after a first sprint reads as a measured 0" scenario).
    const topic = makeTopic({ estimatedHours: 10 });
    const sprint = makeSprint({ startedAt: '2026-06-15T08:00:00.000Z', endedAt: '2026-06-15T08:50:00.000Z' });
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [topic], [sprint], [], []);
    expect(snapshot.pruefung?.neverReady).toBe(true);
    expect(snapshot.pruefung?.emptyExam).toBe(false);
    expect(snapshot.pruefung?.readyDayEpochMs).toBe(0);
  });

  it('builds weekLine with a required-pace comparison when the anchor is still in the future', () => {
    const topic = makeTopic({ estimatedHours: 10 });
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [topic], [], [], []);
    expect(snapshot.pruefung?.weekLine).toMatch(/^This week 0\.0 of \d+\.\d h$/);
  });

  it('builds a plain logged-hours weekLine once the anchor is today or past', () => {
    const exam = makeExam({ examDate: '2026-07-09' }); // exact anchor === NOW's calendar day
    const snapshot = buildWidgetSnapshot(NOW, exam, [makeTopic({ estimatedHours: 10 })], [], [], []);
    expect(snapshot.pruefung?.weekLine).toBe('This week 0.0 h logged.');
  });

  it('sets anchorLabel from formatExamAnchorLine, unchanged', () => {
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic()], [], [], []);
    expect(snapshot.pruefung?.anchorLabel).toBe('Exam window opens 1 Nov 2026');
  });

  it('sets weekStartEpochMs to the Monday-start week containing now', () => {
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic()], [], [], []);
    const expected = startOfWeek(NOW, { weekStartsOn: 1 }).getTime();
    expect(snapshot.pruefung?.weekStartEpochMs).toBe(expected);
  });

  it('always includes the same stateThresholdDays examProjection/ExamOverview use for tight/late', () => {
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic()], [], [], []);
    expect(snapshot.pruefung?.stateThresholdDays).toBe(14);
  });
});

describe('buildWidgetSnapshot — departure', () => {
  it('is null when there are no departures at all', () => {
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [], []);
    expect(snapshot.departure).toBeNull();
  });

  it('is null when every candidate is past the threshold or in a terminal status', () => {
    const departures = [
      // Well past PAST_DEPARTURE_THRESHOLD_MS (60 min) before NOW.
      makeDeparture({ id: 'past', status: 'planned', appointmentAt: '2026-07-09T06:00:00.000Z' }),
      // Otherwise-eligible time, but not a live status.
      makeDeparture({ id: 'done', status: 'done', appointmentAt: '2026-07-09T15:00:00.000Z' }),
      makeDeparture({ id: 'abandoned', status: 'abandoned', appointmentAt: '2026-07-09T16:00:00.000Z' }),
      makeDeparture({ id: 'left', status: 'left', appointmentAt: '2026-07-09T16:30:00.000Z' }),
    ];
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], departures, []);
    expect(snapshot.departure).toBeNull();
  });

  it('picks the soonest planned/running departure among several candidates', () => {
    const departures = [
      makeDeparture({ id: 'later', status: 'planned', appointmentAt: '2026-07-09T18:00:00.000Z' }),
      makeDeparture({ id: 'soonest', status: 'running', appointmentAt: '2026-07-09T14:30:00.000Z' }),
      makeDeparture({ id: 'middle', status: 'planned', appointmentAt: '2026-07-09T16:00:00.000Z' }),
    ];
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], departures, []);
    expect(snapshot.departure?.id).toBe('soonest');
  });

  it('includes a departure whose appointment is within the past-threshold window', () => {
    // 30 min before NOW — inside the 60-min PAST_DEPARTURE_THRESHOLD_MS
    // window, same as Home's own Upcoming section would still show it.
    const departure = makeDeparture({ appointmentAt: '2026-07-09T07:30:00.000Z' });
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [departure], []);
    expect(snapshot.departure).not.toBeNull();
  });

  it('sets nameLine, appointmentLine (same day), and appointmentEpochMs from the chosen departure', () => {
    const departure = makeDeparture({ name: 'Klinik', appointmentAt: '2026-07-09T14:30:00.000Z' });
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [departure], []);
    expect(snapshot.departure?.nameLine).toBe('Klinik');
    expect(snapshot.departure?.appointmentLine).toBe('14:30');
    expect(snapshot.departure?.appointmentEpochMs).toBe(new Date('2026-07-09T14:30:00.000Z').getTime());
  });

  it('appointmentLine includes the date once the appointment falls on a different calendar day than now', () => {
    const departure = makeDeparture({ appointmentAt: '2026-07-10T14:30:00.000Z' });
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [departure], []);
    expect(snapshot.departure?.appointmentLine).toBe('Fri 10 Jul 14:30');
  });

  it('planLine shows both leaveBy and startBy while a step is still unchecked', () => {
    const departure = makeDeparture({ steps: [makeStep({ checkedAt: null, plannedMinutes: 15 })] });
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [departure], []);
    const leaveBy = formatTime(computeProjection(NOW, departure).leaveBy);
    const startBy = formatTime(computeStartBy(departure));
    expect(snapshot.departure?.planLine).toBe(`Leave by ${leaveBy} · start by ${startBy}`);
  });

  it('planLine drops "start by" once every step is checked', () => {
    const departure = makeDeparture({ steps: [makeStep({ checkedAt: '2026-07-09T08:05:00.000Z' })] });
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [departure], []);
    const leaveBy = formatTime(computeProjection(NOW, departure).leaveBy);
    expect(snapshot.departure?.planLine).toBe(`Leave by ${leaveBy}`);
  });

  // Arrival-steps increment: no widgetSnapshot.ts code changed for this —
  // buildDepartureWidgetData already calls computeProjection/computeStartBy
  // with the full departure object, so leaveBy (and therefore planLine)
  // picks up the new arrival-steps term automatically. These two tests
  // verify that's actually true, not just assumed.
  it('planLine\'s "leave by" shifts earlier once arrival steps exist, same as the live Runway screen', () => {
    const withArrival = makeDeparture({
      steps: [makeStep({ checkedAt: '2026-07-09T08:05:00.000Z' })],
      arrivalSteps: [{ id: 'a1', name: 'Change into scrubs', plannedMinutes: 8, checkedAt: null }],
    });
    const withoutArrival = makeDeparture({ steps: [makeStep({ checkedAt: '2026-07-09T08:05:00.000Z' })] });

    const snapshotWithArrival = buildWidgetSnapshot(NOW, undefined, [], [], [withArrival], []);
    const snapshotWithoutArrival = buildWidgetSnapshot(NOW, undefined, [], [], [withoutArrival], []);
    const leaveByWithArrival = formatTime(computeProjection(NOW, withArrival).leaveBy);

    expect(snapshotWithArrival.departure?.planLine).toBe(`Leave by ${leaveByWithArrival}`);
    expect(snapshotWithArrival.departure?.planLine).not.toBe(snapshotWithoutArrival.departure?.planLine);
  });

  it('a departure with zero arrival steps produces the exact same planLine as one with the field entirely absent', () => {
    const departure = makeDeparture({ steps: [makeStep({ checkedAt: null })] });
    const legacy: Partial<typeof departure> = { ...departure };
    delete legacy.arrivalSteps;

    const withEmpty = buildWidgetSnapshot(NOW, undefined, [], [], [{ ...departure, arrivalSteps: [] }], []);
    const legacySnapshot = buildWidgetSnapshot(NOW, undefined, [], [], [legacy as typeof departure], []);

    expect(withEmpty.departure?.planLine).toBe(legacySnapshot.departure?.planLine);
  });
});

describe('selectWidgetTask', () => {
  it('picks the soonest deadline among several eligible tasks', () => {
    const tasks = [
      makeTask({ id: 'later', deadlineAt: '2026-07-09T18:00:00.000Z' }),
      makeTask({ id: 'soonest', deadlineAt: '2026-07-09T14:30:00.000Z' }),
      makeTask({ id: 'middle', deadlineAt: '2026-07-09T16:00:00.000Z' }),
    ];
    expect(selectWidgetTask(NOW, tasks)?.id).toBe('soonest');
  });

  it('a past deadline still wins over a later future one — the most overdue task is the most urgent', () => {
    const tasks = [
      makeTask({ id: 'future', deadlineAt: '2026-07-09T18:00:00.000Z' }),
      // Two days before NOW — no threshold drops it, unlike
      // selectUpcomingDeparture's PAST_DEPARTURE_THRESHOLD_MS cutoff.
      makeTask({ id: 'overdue', deadlineAt: '2026-07-07T09:00:00.000Z' }),
    ];
    expect(selectWidgetTask(NOW, tasks)?.id).toBe('overdue');
  });

  it('excludes tasks with no deadline, even if planned/running', () => {
    const tasks = [makeTask({ id: 'no-deadline', deadlineAt: null })];
    expect(selectWidgetTask(NOW, tasks)).toBeNull();
  });

  it('excludes captured tasks even when (unusually) they carry a deadline', () => {
    const tasks = [makeTask({ id: 'captured', status: 'captured', deadlineAt: '2026-07-09T18:00:00.000Z' })];
    expect(selectWidgetTask(NOW, tasks)).toBeNull();
  });

  it('excludes done/abandoned tasks', () => {
    const tasks = [
      makeTask({ id: 'done', status: 'done', deadlineAt: '2026-07-09T18:00:00.000Z' }),
      makeTask({ id: 'abandoned', status: 'abandoned', deadlineAt: '2026-07-09T18:00:00.000Z' }),
    ];
    expect(selectWidgetTask(NOW, tasks)).toBeNull();
  });

  it('returns null for an empty task list', () => {
    expect(selectWidgetTask(NOW, [])).toBeNull();
  });
});

describe('formatTaskCountsLine', () => {
  it('is null when both counts are zero — nothing to report', () => {
    expect(formatTaskCountsLine(0, 0)).toBeNull();
  });

  it('formats "{N} armed · {M} to arm" whenever either count is nonzero', () => {
    expect(formatTaskCountsLine(3, 1)).toBe('3 armed · 1 to arm');
    expect(formatTaskCountsLine(0, 2)).toBe('0 armed · 2 to arm');
    expect(formatTaskCountsLine(4, 0)).toBe('4 armed · 0 to arm');
  });
});

describe('buildWidgetSnapshot — tasks', () => {
  it('task is null and countsLine is null when there are no tasks at all', () => {
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [], []);
    expect(snapshot.tasks.task).toBeNull();
    expect(snapshot.tasks.countsLine).toBeNull();
  });

  it('sets nameLine/dueLine from the headline task, including the start-by clause while it is still future', () => {
    const task = makeTask({
      name: 'Befunden EEG',
      deadlineAt: '2026-07-09T16:00:00.000Z',
      units: [
        { id: 'u1', name: 'Befunden EEG', plannedMinutes: 30, checkedAt: null },
        { id: 'u2', name: 'Befunden EEG', plannedMinutes: 30, checkedAt: null },
      ],
    });
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [], [task]);
    const startBy = taskStartBy(task)!;
    expect(snapshot.tasks.task).toEqual({
      id: task.id,
      nameLine: 'Befunden EEG',
      dueLine: `due ${formatTime(new Date(task.deadlineAt!))} · start by ${formatTime(startBy)}`,
    });
  });

  it('drops the start-by clause once taskStartBy has already passed', () => {
    // Deadline in 5 minutes, but the units alone need well over an hour —
    // startBy is already behind NOW.
    const task = makeTask({
      deadlineAt: '2026-07-09T08:05:00.000Z',
      units: [{ id: 'u1', name: 'Befunden EEG', plannedMinutes: 90, checkedAt: null }],
    });
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [], [task]);
    expect(snapshot.tasks.task?.dueLine).toBe(`due ${formatTime(new Date(task.deadlineAt!))}`);
  });

  it('armedCount (via countsLine) includes the headline task itself, not just the others', () => {
    const tasks = [makeTask({ id: 'only', deadlineAt: '2026-07-09T16:00:00.000Z' })];
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [], tasks);
    expect(snapshot.tasks.task?.id).toBe('only');
    expect(snapshot.tasks.countsLine).toBe('1 armed · 0 to arm');
  });

  it('countsLine still reports armed/to-arm tasks even when no headline task exists', () => {
    const tasks = [makeTask({ id: 'no-deadline', deadlineAt: null }), makeTask({ id: 'shelved', status: 'captured' })];
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], [], tasks);
    expect(snapshot.tasks.task).toBeNull();
    expect(snapshot.tasks.countsLine).toBe('1 armed · 1 to arm');
  });
});
