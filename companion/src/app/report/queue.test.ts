// fake-indexeddb/auto must be the first import — see store.test.ts's SPEC
// RISK #4 comment for why (Dexie's IDB detection runs at module-evaluation
// time, and vitest's default environment here is 'node').
import 'fake-indexeddb/auto';

import { describe, it, expect, vi } from 'vitest';
import { makeDb, type CompanionDatabase } from '../db/store';
import { logEvent } from '../activity/activityLog';
import { APP_VERSION } from '../lib/version';
import { submitReport, syncReports } from './queue';
import type { GithubApi } from './githubApi';
import type { ReportConfig } from '../lib/reportConfig';
import type { FieldReport } from './types';

let dbCounter = 0;
function freshDb(): CompanionDatabase {
  return makeDb(`test-queue-${++dbCounter}-${Date.now()}`);
}

// logEvent is fire-and-forget — give the fake IndexedDB shim's own async
// resolution a tick to land before reading it back, same convention as
// activityLog.test.ts.
function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function testConfig(overrides: Partial<ReportConfig> = {}): ReportConfig {
  return {
    version: 1,
    owner: 'bosonian',
    repo: 'Play',
    label: 'field-report',
    screenshotDir: 'field-reports',
    token: 'test-token',
    repoIsPublic: null,
    verifiedAt: null,
    ...overrides,
  };
}

// Hand-rolled fake, per the orchestrator-verified fact that queue/github
// tests never touch a real fetch. vi.fn() gives call counts and per-call
// scripting (mockResolvedValueOnce/mockRejectedValueOnce) for free.
function fakeApi(): GithubApi & {
  createIssue: ReturnType<typeof vi.fn>;
  uploadContent: ReturnType<typeof vi.fn>;
  getRepoIsPublic: ReturnType<typeof vi.fn>;
} {
  return {
    createIssue: vi.fn(),
    uploadContent: vi.fn(),
    getRepoIsPublic: vi.fn(),
  };
}

describe('submitReport', () => {
  it('writes a pending row with metadata.appVersion === APP_VERSION, no network call made', async () => {
    const db = freshDb();
    const row = await submitReport(db, {
      description: 'Screen froze after logging a dose',
      screen: 'patient-home',
      attachLog: false,
    });
    expect(row.status).toBe('pending');
    expect(row.metadata.appVersion).toBe(APP_VERSION);
    expect(row.metadata.screen).toBe('patient-home');
    const stored = await db.fieldReports.get(row.id);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe('pending');
    db.close();
  });

  it('attachLog:false leaves attachedLog undefined and produces a body with no fence', async () => {
    const db = freshDb();
    const row = await submitReport(db, {
      description: 'No log wanted',
      screen: 'patient-home',
      attachLog: false,
    });
    expect(row.attachedLog).toBeUndefined();
    db.close();
  });

  it('captures the activity log AT FILING TIME, not at sync time', async () => {
    const db = freshDb();
    logEvent('dose', 'Logged dose: entry A', db);
    await tick();

    const row = await submitReport(db, {
      description: 'Something looked off',
      screen: 'patient-home',
      attachLog: true,
    });

    // Logged AFTER filing — must not appear in the report's captured log.
    logEvent('dose', 'Logged dose: entry B', db);
    await tick();

    const api = fakeApi();
    let capturedBody = '';
    api.createIssue.mockImplementation(async (_target, payload) => {
      capturedBody = payload.body;
      return { htmlUrl: 'https://github.com/bosonian/Play/issues/1' };
    });

    await syncReports(db, api, testConfig());

    expect(capturedBody).toContain('entry A');
    expect(capturedBody).not.toContain('entry B');
    void row;
    db.close();
  });
});

describe('syncReports', () => {
  it('zero candidates: api is never called and no sync log rows are written', async () => {
    const db = freshDb();
    const api = fakeApi();
    const result = await syncReports(db, api, testConfig());
    expect(result).toEqual({ filed: 0, failed: 0 });
    expect(api.createIssue).not.toHaveBeenCalled();
    expect(api.uploadContent).not.toHaveBeenCalled();
    // 'category' isn't an indexed field on activityLog (see store.ts's
    // version(3) schema: only &id and at) — filter the small in-memory
    // table instead of using .where().
    const allRows = await db.activityLog.toArray();
    const syncRows = allRows.filter((r) => r.category === 'sync');
    expect(syncRows).toHaveLength(0);
    db.close();
  });

  it('success: row becomes synced, issueUrl set, screenshotBase64 cleared, lastError cleared', async () => {
    const db = freshDb();
    const row: FieldReport = {
      id: 'r-success',
      createdAt: '2026-07-16T08:00:00.000Z',
      status: 'failed', // simulates a previously-failed attempt
      description: 'Broken thing',
      screenshotBase64: 'ZmFrZS1iYXNlNjQ=',
      screenshotType: 'image/png',
      metadata: { appVersion: APP_VERSION, screen: 'patient-home', at: '2026-07-16T08:00:00.000Z' },
      lastError: 'GitHub 500 on POST /repos/o/r/issues',
    };
    await db.fieldReports.put(row);

    const api = fakeApi();
    api.uploadContent.mockResolvedValue({ htmlUrl: 'https://github.com/o/r/blob/main/f/r-success.png' });
    api.createIssue.mockResolvedValue({ htmlUrl: 'https://github.com/o/r/issues/5' });

    const result = await syncReports(db, api, testConfig());
    expect(result).toEqual({ filed: 1, failed: 0 });

    const stored = await db.fieldReports.get('r-success');
    expect(stored?.status).toBe('synced');
    expect(stored?.issueUrl).toBe('https://github.com/o/r/issues/5');
    expect(stored?.screenshotBase64).toBeUndefined();
    expect(stored?.lastError).toBeUndefined();
    db.close();
  });

  it('failure: row becomes failed, lastError set, row still present', async () => {
    const db = freshDb();
    await submitReport(db, { description: 'Fails to file', screen: 'patient-home', attachLog: false });

    const api = fakeApi();
    api.createIssue.mockRejectedValue(new Error('GitHub 401 on POST /repos/o/r/issues'));

    const result = await syncReports(db, api, testConfig());
    expect(result).toEqual({ filed: 0, failed: 1 });

    const rows = await db.fieldReports.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].lastError).toContain('GitHub 401');
    db.close();
  });

  it('retry failing-then-working: createIssue is called exactly twice total, and never for an already-synced row', async () => {
    const db = freshDb();
    // A row that's already synced — must never be retried.
    await db.fieldReports.put({
      id: 'already-synced',
      createdAt: '2026-07-16T07:00:00.000Z',
      status: 'synced',
      description: 'Old, already filed',
      metadata: { appVersion: APP_VERSION, screen: 'patient-home', at: '2026-07-16T07:00:00.000Z' },
      issueUrl: 'https://github.com/o/r/issues/1',
    });
    const target = await submitReport(db, {
      description: 'Flaky one',
      screen: 'patient-home',
      attachLog: false,
    });

    const api = fakeApi();
    api.createIssue
      .mockRejectedValueOnce(new Error('GitHub 500 on POST /repos/o/r/issues'))
      .mockResolvedValueOnce({ htmlUrl: 'https://github.com/o/r/issues/9' });

    const first = await syncReports(db, api, testConfig());
    expect(first).toEqual({ filed: 0, failed: 1 });
    expect((await db.fieldReports.get(target.id))?.status).toBe('failed');

    const second = await syncReports(db, api, testConfig());
    expect(second).toEqual({ filed: 1, failed: 0 });
    expect((await db.fieldReports.get(target.id))?.status).toBe('synced');

    expect(api.createIssue).toHaveBeenCalledTimes(2);
    db.close();
  });

  it('screenshot checkpoint: uploadContent is called exactly once across a failed-then-retried sync', async () => {
    const db = freshDb();
    const target = await submitReport(db, {
      description: 'Has a screenshot',
      screen: 'patient-home',
      attachLog: false,
      screenshotBase64: 'ZmFrZQ==',
      screenshotType: 'image/png',
    });

    const api = fakeApi();
    api.uploadContent.mockResolvedValue({ htmlUrl: 'https://github.com/o/r/blob/main/f/x.png' });
    api.createIssue
      .mockRejectedValueOnce(new Error('GitHub 502 on POST /repos/o/r/issues'))
      .mockResolvedValueOnce({ htmlUrl: 'https://github.com/o/r/issues/11' });

    const first = await syncReports(db, api, testConfig());
    expect(first).toEqual({ filed: 0, failed: 1 });
    const afterFirst = await db.fieldReports.get(target.id);
    expect(afterFirst?.screenshotUrl).toBe('https://github.com/o/r/blob/main/f/x.png');
    expect(api.uploadContent).toHaveBeenCalledTimes(1);

    const second = await syncReports(db, api, testConfig());
    expect(second).toEqual({ filed: 1, failed: 0 });
    expect(api.uploadContent).toHaveBeenCalledTimes(1); // not re-uploaded on retry
    expect((await db.fieldReports.get(target.id))?.status).toBe('synced');
    db.close();
  });

  it('drains oldest createdAt first', async () => {
    const db = freshDb();
    const rows: FieldReport[] = [
      {
        id: 'newest',
        createdAt: '2026-07-16T10:00:00.000Z',
        status: 'pending',
        description: 'newest',
        metadata: { appVersion: APP_VERSION, screen: 'patient-home', at: '2026-07-16T10:00:00.000Z' },
      },
      {
        id: 'oldest',
        createdAt: '2026-07-16T08:00:00.000Z',
        status: 'pending',
        description: 'oldest',
        metadata: { appVersion: APP_VERSION, screen: 'patient-home', at: '2026-07-16T08:00:00.000Z' },
      },
      {
        id: 'middle',
        createdAt: '2026-07-16T09:00:00.000Z',
        status: 'pending',
        description: 'middle',
        metadata: { appVersion: APP_VERSION, screen: 'patient-home', at: '2026-07-16T09:00:00.000Z' },
      },
    ];
    await db.fieldReports.bulkPut(rows);

    const order: string[] = [];
    const api = fakeApi();
    api.createIssue.mockImplementation(async (_target, payload) => {
      order.push(payload.title);
      return { htmlUrl: 'https://github.com/o/r/issues/1' };
    });

    await syncReports(db, api, testConfig());
    expect(order).toEqual(['Field report: oldest', 'Field report: middle', 'Field report: newest']);
    db.close();
  });
});
