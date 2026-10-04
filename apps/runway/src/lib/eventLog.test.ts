import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RunwayEvent } from '../db/types';

// No existing test in this app touches a live Dexie/IndexedDB table (a
// quick survey of src/**/*.test.ts turned up none, and this app has no
// fake-indexeddb dependency) — every Dexie-backed test elsewhere either
// tests pure functions that take plain data, or doesn't exist. Rather than
// introduce a new pattern (a real fake-indexeddb-backed database) for this
// one file, `db` is mocked here instead: eventLog.ts's three Dexie-touching
// functions (logEvent, pruneEventLog, recentEvents) are thin wrappers whose
// only real logic is "call the right Dexie method, never let it throw" —
// exactly what a mock can verify without a real database. `formatEventLine`
// (pure, no Dexie) is tested directly with plain objects, no mock needed.
const addMock = vi.fn();
const countMock = vi.fn();
const bulkDeleteMock = vi.fn();
const primaryKeysMock = vi.fn();
const toArrayMock = vi.fn();
const limitMock = vi.fn(() => ({ primaryKeys: primaryKeysMock }));
const reverseMock = vi.fn(() => ({ limit: vi.fn(() => ({ toArray: toArrayMock })) }));
const orderByMock = vi.fn(() => ({ limit: limitMock, reverse: reverseMock }));

vi.mock('../db/db', () => ({
  db: {
    events: {
      add: addMock,
      count: countMock,
      bulkDelete: bulkDeleteMock,
      orderBy: orderByMock,
    },
  },
}));

// Imported AFTER the mock is registered (vi.mock is hoisted by vitest, so
// this ordering in source doesn't actually matter, but it reads correctly
// top-to-bottom).
const { logEvent, pruneEventLog, recentEvents, formatEventLine } = await import('./eventLog');

describe('formatEventLine', () => {
  it('formats YYYY-MM-DD HH:mm:ss [category] message', () => {
    const event: RunwayEvent = {
      id: 'evt-1',
      at: new Date(2026, 6, 14, 9, 41, 3).toISOString(), // 14 Jul 2026, local
      category: 'departure',
      message: 'Out the door: Klinik appointment.',
    };
    expect(formatEventLine(event)).toBe('2026-07-14 09:41:03 [departure] Out the door: Klinik appointment.');
  });

  it('zero-pads single-digit month/day/hour/minute/second', () => {
    const event: RunwayEvent = {
      id: 'evt-2',
      at: new Date(2026, 0, 5, 3, 7, 9).toISOString(), // 5 Jan 2026, 03:07:09
      category: 'lifecycle',
      message: 'App started.',
    };
    expect(formatEventLine(event)).toBe('2026-01-05 03:07:09 [lifecycle] App started.');
  });
});

describe('logEvent', () => {
  beforeEach(() => {
    addMock.mockReset();
  });

  it('writes a row with the given category and message, and an ISO `at`', async () => {
    addMock.mockResolvedValue('evt-1');
    await logEvent('task', 'Task created: Befunden EEG.');
    expect(addMock).toHaveBeenCalledTimes(1);
    const row = addMock.mock.calls[0][0];
    expect(row.category).toBe('task');
    expect(row.message).toBe('Task created: Befunden EEG.');
    expect(typeof row.id).toBe('string');
    expect(new Date(row.at).toISOString()).toBe(row.at);
  });

  it('never throws even when the underlying db write fails', async () => {
    addMock.mockRejectedValue(new Error('IndexedDB is broken'));
    await expect(logEvent('sprint', 'Sprint started: Neuro, 50 min.')).resolves.toBeUndefined();
  });
});

describe('pruneEventLog', () => {
  beforeEach(() => {
    countMock.mockReset();
    bulkDeleteMock.mockReset();
    primaryKeysMock.mockReset();
    orderByMock.mockClear();
    limitMock.mockClear();
  });

  it('does nothing when at or under the retain count', async () => {
    countMock.mockResolvedValue(2000);
    await pruneEventLog();
    expect(bulkDeleteMock).not.toHaveBeenCalled();
  });

  it('deletes exactly (count - 2000) oldest rows, keeping the newest 2000', async () => {
    countMock.mockResolvedValue(2137);
    primaryKeysMock.mockResolvedValue(['old-1', 'old-2']);
    await pruneEventLog();
    expect(orderByMock).toHaveBeenCalledWith('at');
    expect(limitMock).toHaveBeenCalledWith(137); // 2137 - 2000
    expect(bulkDeleteMock).toHaveBeenCalledWith(['old-1', 'old-2']);
  });

  it('never throws even when the underlying db read fails', async () => {
    countMock.mockRejectedValue(new Error('IndexedDB is broken'));
    await expect(pruneEventLog()).resolves.toBeUndefined();
    expect(bulkDeleteMock).not.toHaveBeenCalled();
  });
});

describe('recentEvents', () => {
  beforeEach(() => {
    toArrayMock.mockReset();
  });

  it('reads newest-first, capped to the given limit', async () => {
    const rows: RunwayEvent[] = [{ id: 'evt-3', at: '2026-07-14T09:00:00.000Z', category: 'lifecycle', message: 'App started.' }];
    toArrayMock.mockResolvedValue(rows);
    const result = await recentEvents(200);
    expect(orderByMock).toHaveBeenCalledWith('at');
    expect(result).toEqual(rows);
  });

  it('returns an empty array (never throws) when the underlying db read fails', async () => {
    toArrayMock.mockRejectedValue(new Error('IndexedDB is broken'));
    await expect(recentEvents(200)).resolves.toEqual([]);
  });
});
