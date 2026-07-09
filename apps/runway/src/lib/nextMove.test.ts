import { describe, expect, it } from 'vitest';
import { nextMove, suggestedPlannedMinutes } from './nextMove';
import type { Sprint, Topic } from '../db/types';

const NOW = new Date('2026-07-09T08:00:00.000Z');

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

describe('nextMove', () => {
  it('returns null when there are no topics', () => {
    expect(nextMove(NOW, [], [])).toBeNull();
  });

  it('returns null when every topic is already at or past its estimate', () => {
    const topics = [
      makeTopic({ id: 't1', estimatedHours: 10 }),
      makeTopic({ id: 't2', estimatedHours: 5 }),
    ];
    const sprints = [
      makeSprint({ topicId: 't1', startedAt: '2026-07-01T08:00:00.000Z', endedAt: '2026-07-01T18:00:00.000Z' }), // 10h
      makeSprint({ topicId: 't2', startedAt: '2026-07-02T08:00:00.000Z', endedAt: '2026-07-02T13:00:00.000Z' }), // 5h
    ];
    expect(nextMove(NOW, topics, sprints)).toBeNull();
  });

  it('START: suggests the first topic by order when no sprints exist at all', () => {
    const topics = [
      makeTopic({ id: 't2', name: 'Epilepsy', order: 1, estimatedHours: 30 }),
      makeTopic({ id: 't1', name: 'Vascular', order: 0, estimatedHours: 10 }),
    ];
    const result = nextMove(NOW, topics, []);
    expect(result).toEqual({ topicId: 't1', topicName: 'Vascular', plannedMinutes: 25, reason: 'start' });
  });

  it('MOMENTUM: a topic completed within 48h with remaining hours wins over a more-behind topic', () => {
    const topics = [
      makeTopic({ id: 't1', name: 'Vascular', order: 0, estimatedHours: 40 }), // untouched, most "behind"
      makeTopic({ id: 't2', name: 'Epilepsy', order: 1, estimatedHours: 10 }),
    ];
    const sprints = [
      makeSprint({
        topicId: 't2',
        startedAt: new Date(NOW.getTime() - 2 * 60 * 60_000).toISOString(),
        endedAt: new Date(NOW.getTime() - 1.5 * 60 * 60_000).toISOString(),
      }),
    ];
    const result = nextMove(NOW, topics, sprints);
    expect(result?.topicId).toBe('t2');
    expect(result?.reason).toBe('momentum');
  });

  it('MOMENTUM: a completed sprint older than 48h does not count as momentum (falls to BEHIND)', () => {
    const topics = [
      makeTopic({ id: 't1', name: 'Vascular', order: 0, estimatedHours: 40 }),
      makeTopic({ id: 't2', name: 'Epilepsy', order: 1, estimatedHours: 10 }),
    ];
    const sprints = [
      makeSprint({
        topicId: 't2',
        startedAt: new Date(NOW.getTime() - 49 * 60 * 60_000).toISOString(),
        endedAt: new Date(NOW.getTime() - 48.5 * 60 * 60_000).toISOString(),
      }),
    ];
    const result = nextMove(NOW, topics, sprints);
    // t1 has the larger remaining hours (40 vs 10), so BEHIND picks it.
    expect(result?.topicId).toBe('t1');
    expect(result?.reason).toBe('behind');
  });

  it('MOMENTUM is skipped when the recently-sprinted topic is already complete', () => {
    const topics = [
      makeTopic({ id: 't1', name: 'Vascular', order: 0, estimatedHours: 10 }),
      makeTopic({ id: 't2', name: 'Epilepsy', order: 1, estimatedHours: 5 }),
    ];
    const sprints = [
      // t2 finished exactly at its estimate within the last 48h - no remaining hours left.
      makeSprint({
        topicId: 't2',
        startedAt: new Date(NOW.getTime() - 5 * 60 * 60_000).toISOString(),
        endedAt: new Date(NOW.getTime() - 5 * 60 * 60_000 + 5 * 60 * 60_000).toISOString(),
      }),
    ];
    const result = nextMove(NOW, topics, sprints);
    expect(result?.topicId).toBe('t1');
    expect(result?.reason).toBe('behind');
  });

  it('BEHIND: ties on remaining hours resolve to the lowest order', () => {
    const topics = [
      makeTopic({ id: 't2', name: 'Epilepsy', order: 1, estimatedHours: 20 }),
      makeTopic({ id: 't1', name: 'Vascular', order: 0, estimatedHours: 20 }),
    ];
    // One sprint on a topic outside this pair, purely so this isn't the
    // "no sprints at all" START case - it must not touch t1/t2's own
    // remaining hours, or it would break the exact tie this test relies on.
    const sprints = [
      makeSprint({
        topicId: 'unrelated-topic',
        startedAt: new Date(NOW.getTime() - 100 * 60 * 60_000).toISOString(),
        endedAt: new Date(NOW.getTime() - 100 * 60 * 60_000 + 60_000).toISOString(),
      }),
    ];
    const result = nextMove(NOW, topics, sprints);
    expect(result?.topicId).toBe('t1');
    expect(result?.reason).toBe('behind');
  });

  it('BEHIND: picks the topic with the largest absolute remaining hours, not the largest fraction', () => {
    const topics = [
      makeTopic({ id: 'small', name: 'Small', order: 0, estimatedHours: 5 }), // 5h remaining, 0% done
      makeTopic({ id: 'big', name: 'Big', order: 1, estimatedHours: 40 }), // 35h remaining, 12.5% done
    ];
    const sprints = [
      makeSprint({
        topicId: 'big',
        startedAt: new Date(NOW.getTime() - 100 * 60 * 60_000).toISOString(),
        endedAt: new Date(NOW.getTime() - 100 * 60 * 60_000 + 5 * 60 * 60_000).toISOString(),
      }),
    ];
    const result = nextMove(NOW, topics, sprints);
    expect(result?.topicId).toBe('big');
    expect(result?.reason).toBe('behind');
  });
});

describe('suggestedPlannedMinutes', () => {
  it('defaults to 25 with no completed-sprint history', () => {
    expect(suggestedPlannedMinutes([])).toBe(25);
  });

  it('ignores a still-live sprint (no endedAt) and falls back to the no-history default', () => {
    expect(suggestedPlannedMinutes([makeSprint({ endedAt: null })])).toBe(25);
  });

  it('snaps down at the 50-minute boundary (median exactly 50 stays 50)', () => {
    const sprints = [50, 50, 50, 50, 50].map((plannedMinutes, i) =>
      makeSprint({ plannedMinutes, startedAt: new Date(NOW.getTime() - i * 60_000).toISOString() }),
    );
    expect(suggestedPlannedMinutes(sprints)).toBe(50);
  });

  it('snaps down at the 90-minute boundary (median exactly 90 stays 90)', () => {
    const sprints = [90, 90, 90, 90, 90].map((plannedMinutes, i) =>
      makeSprint({ plannedMinutes, startedAt: new Date(NOW.getTime() - i * 60_000).toISOString() }),
    );
    expect(suggestedPlannedMinutes(sprints)).toBe(90);
  });

  it('snaps a between-boundary median (37.5, between 25 and 50) DOWN to 25', () => {
    const sprints = [25, 50].map((plannedMinutes, i) =>
      makeSprint({ plannedMinutes, startedAt: new Date(NOW.getTime() - i * 60_000).toISOString() }),
    );
    expect(suggestedPlannedMinutes(sprints)).toBe(25);
  });

  it('snaps a between-boundary median (70, between 50 and 90) DOWN to 50', () => {
    const sprints = [50, 90].map((plannedMinutes, i) =>
      makeSprint({ plannedMinutes, startedAt: new Date(NOW.getTime() - i * 60_000).toISOString() }),
    );
    expect(suggestedPlannedMinutes(sprints)).toBe(50);
  });

  it('considers only the last 5 completed sprints, most recent first', () => {
    // 5 recent 90s, then a bunch of old 25s far in the past - median of the
    // most-recent-5 window should be 90, not dragged down by older history.
    const recent = [90, 90, 90, 90, 90].map((plannedMinutes, i) =>
      makeSprint({ plannedMinutes, startedAt: new Date(NOW.getTime() - i * 60_000).toISOString() }),
    );
    const old = [25, 25, 25].map((plannedMinutes, i) =>
      makeSprint({ plannedMinutes, startedAt: new Date(NOW.getTime() - (1000 + i) * 60_000).toISOString() }),
    );
    expect(suggestedPlannedMinutes([...old, ...recent])).toBe(90);
  });
});
