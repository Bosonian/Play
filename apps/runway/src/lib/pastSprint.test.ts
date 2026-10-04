import { describe, expect, it } from 'vitest';
import { MAX_PAST_SPRINT_MINUTES, buildPastSprint, validatePastSprint } from './pastSprint';
import type { Sprint } from '../db/types';

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

describe('validatePastSprint', () => {
  const now = new Date('2026-07-09T18:00:00.000Z');
  const examCreatedAt = new Date('2026-01-01T00:00:00.000Z');

  it('accepts an ordinary same-day entry with no existing sprints', () => {
    const result = validatePastSprint(
      { endedAt: new Date('2026-07-09T17:00:00.000Z'), durationMinutes: 180 },
      now,
      examCreatedAt,
      [],
    );
    expect(result).toEqual({ ok: true, startedAt: new Date('2026-07-09T14:00:00.000Z') });
  });

  it('accepts endedAt exactly equal to now (inclusive - "it just finished" is not future)', () => {
    const result = validatePastSprint({ endedAt: new Date(now), durationMinutes: 30 }, now, examCreatedAt, []);
    expect(result.ok).toBe(true);
  });

  it('rejects endedAt after now as in-future', () => {
    const result = validatePastSprint(
      { endedAt: new Date('2026-07-09T18:00:01.000Z'), durationMinutes: 30 },
      now,
      examCreatedAt,
      [],
    );
    expect(result).toEqual({ ok: false, reason: 'in-future' });
  });

  it('rejects a zero-minute duration', () => {
    const result = validatePastSprint({ endedAt: now, durationMinutes: 0 }, now, examCreatedAt, []);
    expect(result).toEqual({ ok: false, reason: 'non-positive-duration' });
  });

  it('rejects a negative duration', () => {
    const result = validatePastSprint({ endedAt: now, durationMinutes: -10 }, now, examCreatedAt, []);
    expect(result).toEqual({ ok: false, reason: 'non-positive-duration' });
  });

  it('accepts a duration exactly at MAX_PAST_SPRINT_MINUTES', () => {
    const result = validatePastSprint(
      { endedAt: now, durationMinutes: MAX_PAST_SPRINT_MINUTES },
      now,
      examCreatedAt,
      [],
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a duration one minute past MAX_PAST_SPRINT_MINUTES', () => {
    const result = validatePastSprint(
      { endedAt: now, durationMinutes: MAX_PAST_SPRINT_MINUTES + 1 },
      now,
      examCreatedAt,
      [],
    );
    expect(result).toEqual({ ok: false, reason: 'duration-too-long' });
  });

  it('rejects a startedAt that lands before the exam was created', () => {
    const result = validatePastSprint(
      { endedAt: new Date('2026-01-01T00:30:00.000Z'), durationMinutes: 60 },
      now,
      examCreatedAt,
      [],
    );
    expect(result).toEqual({ ok: false, reason: 'before-exam-created' });
  });

  it('accepts a startedAt exactly equal to the exam creation instant (inclusive)', () => {
    const result = validatePastSprint(
      { endedAt: new Date('2026-01-01T01:00:00.000Z'), durationMinutes: 60 },
      now,
      examCreatedAt,
      [],
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a window that overlaps an existing finished sprint', () => {
    const existing = [makeSprint({ startedAt: '2026-07-09T16:00:00.000Z', endedAt: '2026-07-09T17:00:00.000Z' })];
    // New entry: 16:30-17:30 - overlaps the tail of the existing sprint.
    const result = validatePastSprint(
      { endedAt: new Date('2026-07-09T17:30:00.000Z'), durationMinutes: 60 },
      now,
      examCreatedAt,
      existing,
    );
    expect(result).toEqual({ ok: false, reason: 'overlaps-existing-sprint' });
  });

  it('accepts a window that ends exactly when an existing sprint starts (back-to-back, not overlapping)', () => {
    const existing = [makeSprint({ startedAt: '2026-07-09T16:00:00.000Z', endedAt: '2026-07-09T17:00:00.000Z' })];
    // New entry: 15:00-16:00, ends exactly at the existing sprint's start.
    const result = validatePastSprint(
      { endedAt: new Date('2026-07-09T16:00:00.000Z'), durationMinutes: 60 },
      now,
      examCreatedAt,
      existing,
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a window that starts exactly when an existing sprint ends (back-to-back, not overlapping)', () => {
    const existing = [makeSprint({ startedAt: '2026-07-09T16:00:00.000Z', endedAt: '2026-07-09T17:00:00.000Z' })];
    // New entry: 17:00-18:00, starts exactly at the existing sprint's end.
    const result = validatePastSprint(
      { endedAt: new Date('2026-07-09T18:00:00.000Z'), durationMinutes: 60 },
      now,
      examCreatedAt,
      existing,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a window that fully contains an existing sprint', () => {
    const existing = [makeSprint({ startedAt: '2026-07-09T16:15:00.000Z', endedAt: '2026-07-09T16:45:00.000Z' })];
    const result = validatePastSprint(
      { endedAt: new Date('2026-07-09T17:00:00.000Z'), durationMinutes: 120 },
      now,
      examCreatedAt,
      existing,
    );
    expect(result).toEqual({ ok: false, reason: 'overlaps-existing-sprint' });
  });

  it('treats a still-live sprint (endedAt null) as ongoing through now for overlap purposes', () => {
    const existing = [makeSprint({ startedAt: '2026-07-09T17:00:00.000Z', endedAt: null })];
    // New entry claims to end at 17:30, i.e. while the live sprint is still open.
    const result = validatePastSprint(
      { endedAt: new Date('2026-07-09T17:30:00.000Z'), durationMinutes: 30 },
      now,
      examCreatedAt,
      existing,
    );
    expect(result).toEqual({ ok: false, reason: 'overlaps-existing-sprint' });
  });

  it('does not overlap a live sprint that started after the new window ends', () => {
    const existing = [makeSprint({ startedAt: '2026-07-09T17:30:00.000Z', endedAt: null })];
    const result = validatePastSprint(
      { endedAt: new Date('2026-07-09T17:00:00.000Z'), durationMinutes: 30 },
      now,
      examCreatedAt,
      existing,
    );
    expect(result.ok).toBe(true);
  });
});

describe('buildPastSprint', () => {
  it('derives startedAt from endedAt minus duration and stamps an empty ritual', () => {
    const endedAt = new Date('2026-07-09T17:00:00.000Z');
    const startedAt = new Date('2026-07-09T14:00:00.000Z');
    const now = new Date('2026-07-09T18:00:00.000Z');
    const sprint = buildPastSprint(
      { examId: 'exam-1', topicId: 'topic-1', endedAt, durationMinutes: 180 },
      startedAt,
      now,
    );
    expect(sprint.examId).toBe('exam-1');
    expect(sprint.topicId).toBe('topic-1');
    expect(sprint.startedAt).toBe('2026-07-09T14:00:00.000Z');
    expect(sprint.endedAt).toBe('2026-07-09T17:00:00.000Z');
    expect(sprint.ritual).toEqual([]);
    expect(sprint.plannedMinutes).toBe(180);
    expect(sprint.createdAt).toBe('2026-07-09T18:00:00.000Z');
    expect(sprint.id).toBeTruthy();
  });

  it('sets createdAt to the write instant, not endedAt - the two are allowed to differ', () => {
    const endedAt = new Date('2026-07-01T10:00:00.000Z');
    const startedAt = new Date('2026-07-01T09:00:00.000Z');
    const now = new Date('2026-07-09T18:00:00.000Z'); // logged 8 days after the fact
    const sprint = buildPastSprint(
      { examId: 'exam-1', topicId: 'topic-1', endedAt, durationMinutes: 60 },
      startedAt,
      now,
    );
    expect(sprint.createdAt).toBe(now.toISOString());
    expect(sprint.createdAt).not.toBe(sprint.endedAt);
  });
});
