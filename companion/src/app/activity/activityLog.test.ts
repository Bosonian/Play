// fake-indexeddb/auto must be the first import — see the identical comment
// in src/app/db/store.test.ts for why (Dexie's IDB detection runs at
// module-evaluation time, and vitest's default environment here is 'node').
import 'fake-indexeddb/auto';

import { describe, it, expect } from 'vitest';
import { makeDb, type CompanionDatabase } from '../db/store';
import {
  logEvent,
  pruneActivityLog,
  formatLogLine,
  captureRecentLog,
  runAppOpen,
} from './activityLog';
import type { ActivityRow } from './types';

// Each test gets its own uniquely-named database so tests never share state
// or race each other, same convention as store.test.ts.
let dbCounter = 0;
function freshDb(): CompanionDatabase {
  return makeDb(`test-activity-${++dbCounter}-${Date.now()}`);
}

// logEvent is deliberately fire-and-forget (never returns a promise callers
// can await), so tests that need to observe its written row give the fake
// IndexedDB shim's own async resolution a tick to land first.
function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('logEvent', () => {
  it('writes a row with the given category, message, and a parseable ISO at', async () => {
    const db = freshDb();
    logEvent('dose', 'Logged dose: Levodopa 100 mg, 08:00 slot', db);
    await tick();
    const rows = await db.activityLog.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('dose');
    expect(rows[0].message).toBe('Logged dose: Levodopa 100 mg, 08:00 slot');
    expect(Number.isNaN(new Date(rows[0].at).getTime())).toBe(false);
    db.close();
  });

  it('does not throw when the stub db activityLog.put returns a rejected promise', async () => {
    const stub = {
      activityLog: {
        put: () => Promise.reject(new Error('put failed')),
      },
    } as unknown as CompanionDatabase;
    expect(() => logEvent('lifecycle', 'test', stub)).not.toThrow();
    // Give the swallowed rejection's .catch a tick to run, so a real bug
    // here (a missing .catch) would surface as vitest's unhandled-rejection
    // failure rather than passing silently.
    await tick();
  });

  it('does not throw when the stub db activityLog.put throws synchronously', () => {
    const stub = {
      activityLog: {
        put: () => {
          throw new Error('sync fail');
        },
      },
    } as unknown as CompanionDatabase;
    expect(() => logEvent('lifecycle', 'test', stub)).not.toThrow();
  });

  it('called inside a db.transaction callback does not break the transaction (pins SPEC RISK B as non-fatal)', async () => {
    const db = freshDb();
    // activityLog is deliberately NOT named in this transaction's table
    // list, so Dexie rejects logEvent's put to it — logEvent swallows that
    // rejection by contract, and the transaction's own write must still
    // commit regardless (see usePatient.ts's SPEC RISK B comment for why
    // ensureLocalPatient logs outside its transaction instead).
    await db.transaction('rw', db.patients, async () => {
      await db.patients.put({ code: 'P-01', createdAt: '2026-07-16T00:00:00Z' });
      logEvent('lifecycle', 'inside txn', db);
    });
    const patient = await db.patients.get('P-01');
    expect(patient).toBeDefined();
    db.close();
  });
});

describe('pruneActivityLog', () => {
  it('removes the oldest rows down to the keep count, newest kept', async () => {
    const db = freshDb();
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const rows: ActivityRow[] = Array.from({ length: 3000 }, (_, i) => ({
      id: `row-${i}`,
      at: new Date(base + i * 60_000).toISOString(),
      category: 'lifecycle',
      message: `entry ${i}`,
    }));
    await db.activityLog.bulkPut(rows);

    const removed = await pruneActivityLog(db);
    expect(removed).toBe(1000);
    expect(await db.activityLog.count()).toBe(2000);

    const oldestSurviving = await db.activityLog.orderBy('at').first();
    // Row #1001 (1-indexed) = index 1000 (0-indexed) — the 1000 oldest
    // rows (indices 0-999) were pruned.
    expect(oldestSurviving?.id).toBe('row-1000');
    db.close();
  });

  it('under the cap: removes nothing and returns 0', async () => {
    const db = freshDb();
    const rows: ActivityRow[] = Array.from({ length: 10 }, (_, i) => ({
      id: `row-${i}`,
      at: new Date(2026, 0, 1, 0, i).toISOString(),
      category: 'lifecycle',
      message: `entry ${i}`,
    }));
    await db.activityLog.bulkPut(rows);

    const removed = await pruneActivityLog(db);
    expect(removed).toBe(0);
    expect(await db.activityLog.count()).toBe(10);
    db.close();
  });
});

describe('formatLogLine', () => {
  it('formats "<at> [<category>] <message>" exactly', () => {
    const row: ActivityRow = {
      id: 'x',
      at: '2026-07-16T08:00:00.000Z',
      category: 'dose',
      message: 'Logged dose: Levodopa 100 mg, 08:00 slot',
    };
    expect(formatLogLine(row)).toBe(
      '2026-07-16T08:00:00.000Z [dose] Logged dose: Levodopa 100 mg, 08:00 slot',
    );
  });
});

describe('captureRecentLog', () => {
  it('returns the newest `limit` rows in chronological order, oldest rows absent', async () => {
    const db = freshDb();
    const rows: ActivityRow[] = Array.from({ length: 60 }, (_, i) => ({
      id: `row-${i}`,
      at: new Date(2026, 0, 1, 0, i).toISOString(),
      category: 'lifecycle',
      message: `entry-${i}`,
    }));
    await db.activityLog.bulkPut(rows);

    const text = await captureRecentLog(db, 50);
    const lines = text.split('\n');
    expect(lines).toHaveLength(50);
    // Exact-match comparison (not substring) — "entry-1" is a substring of
    // "entry-10", so a naive .toContain check here would false-negative on
    // the very rows this test is trying to prove are dropped.
    const expectedLines = rows.slice(10, 60).map(formatLogLine); // rows 10..59, chronological
    expect(lines).toEqual(expectedLines);
    const droppedMessages = rows.slice(0, 10).map((r) => r.message);
    for (const line of lines) {
      const message = line.split('] ')[1];
      expect(droppedMessages).not.toContain(message);
    }
    db.close();
  });
});

describe('runAppOpen', () => {
  it('called twice logs exactly one "App opened" row (module-guard dedupe)', async () => {
    const db = freshDb();
    runAppOpen(db);
    runAppOpen(db);
    await tick();
    const rows = await db.activityLog.toArray();
    const appOpenedRows = rows.filter((r) => r.message.startsWith('App opened'));
    expect(appOpenedRows).toHaveLength(1);
    db.close();
  });
});
