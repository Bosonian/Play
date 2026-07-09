import { startOfWeek } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { buildWidgetSnapshot } from './widgetSnapshot';
import type { Exam, Sprint, Topic } from '../db/types';

// Thursday — matches examProjection.test.ts's fixed NOW so the reasoning
// about which week is "current" lines up with that file's own comments.
const NOW = new Date('2026-07-09T08:00:00.000Z');

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 'exam-1',
    name: 'Facharztprüfung Neurologie',
    windowStart: '2026-11-01',
    examDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

describe('buildWidgetSnapshot', () => {
  it('returns pruefung: null when there is no exam yet', () => {
    const snapshot = buildWidgetSnapshot(NOW, undefined, [], [], null);
    expect(snapshot.pruefung).toBeNull();
    expect(snapshot.departure).toBeNull();
    expect(snapshot.generatedAtEpochMs).toBe(NOW.getTime());
  });

  it('always sets departure to null (W2 fills this in)', () => {
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic()], [], null);
    expect(snapshot.departure).toBeNull();
  });

  it('computes offsetDays as ceil(readyDate − now) for a normal projection', () => {
    // No sprints logged yet: DEFAULT_PACE_HOURS_PER_WEEK (4h/week) applies,
    // 10h remaining → 2.5 weeks → 17.5 days, ceil'd to 18.
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic({ estimatedHours: 10 })], [], null);
    expect(snapshot.pruefung?.neverReady).toBe(false);
    expect(snapshot.pruefung?.offsetDays).toBe(18);
  });

  it('offsetDays is 0 when every topic is already at its estimate (done)', () => {
    const topic = makeTopic({ estimatedHours: 1 });
    const sprint = makeSprint({ startedAt: '2026-07-01T08:00:00.000Z', endedAt: '2026-07-01T09:00:00.000Z' });
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [topic], [sprint], null);
    expect(snapshot.pruefung?.offsetDays).toBe(0);
    expect(snapshot.pruefung?.neverReady).toBe(false);
  });

  it('sets neverReady when the measured pace is zero', () => {
    // A first sprint two complete weeks ago, then total silence — a
    // measured pace of exactly 0h/week (see examProjection.test.ts for the
    // same "silence after a first sprint reads as a measured 0" scenario).
    const topic = makeTopic({ estimatedHours: 10 });
    const sprint = makeSprint({ startedAt: '2026-06-15T08:00:00.000Z', endedAt: '2026-06-15T08:50:00.000Z' });
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [topic], [sprint], null);
    expect(snapshot.pruefung?.neverReady).toBe(true);
    expect(snapshot.pruefung?.offsetDays).toBe(0);
  });

  it('builds weekLine with a required-pace comparison when the anchor is still in the future', () => {
    const topic = makeTopic({ estimatedHours: 10 });
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [topic], [], null);
    expect(snapshot.pruefung?.weekLine).toMatch(/^This week 0\.0 of \d+\.\d h$/);
  });

  it('builds a plain logged-hours weekLine once the anchor is today or past', () => {
    const exam = makeExam({ examDate: '2026-07-09' }); // exact anchor === NOW's calendar day
    const snapshot = buildWidgetSnapshot(NOW, exam, [makeTopic({ estimatedHours: 10 })], [], null);
    expect(snapshot.pruefung?.weekLine).toBe('This week 0.0 h logged.');
  });

  it('sets anchorLabel from formatExamAnchorLine, unchanged', () => {
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic()], [], null);
    expect(snapshot.pruefung?.anchorLabel).toBe('Exam window opens 1 Nov 2026');
  });

  it('sets weekStartEpochMs to the Monday-start week containing now', () => {
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic()], [], null);
    const expected = startOfWeek(NOW, { weekStartsOn: 1 }).getTime();
    expect(snapshot.pruefung?.weekStartEpochMs).toBe(expected);
  });

  it('always includes the same stateThresholdDays examProjection/ExamOverview use for tight/late', () => {
    const snapshot = buildWidgetSnapshot(NOW, makeExam(), [makeTopic()], [], null);
    expect(snapshot.pruefung?.stateThresholdDays).toBe(14);
  });
});
