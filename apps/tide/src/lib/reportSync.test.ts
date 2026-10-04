import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldReport } from '../db/types';

// Ported from apps/runway/src/lib/reportSync.test.ts. Mocks for the
// single-flight mutex tests at the bottom of this file — same "mock db,
// don't spin up a real IndexedDB" precedent as eventLog.test.ts.
// `readReportConfig` and `logEvent` are mocked out too, so a drain that
// actually runs its body (rather than short-circuiting on the "no token"
// branch) never reaches for a Dexie table or settings row this file never
// sets up. `buildIssuePayload`/`classifySyncError` below don't touch `db`
// at all, so mocking it doesn't affect those tests.
const sortByMock = vi.fn();
const equalsMock = vi.fn(() => ({ sortBy: sortByMock }));
const whereMock = vi.fn(() => ({ equals: equalsMock }));
const updateMock = vi.fn();

vi.mock('../db/db', () => ({
  db: { fieldReports: { where: whereMock, update: updateMock } },
}));

const readReportConfigMock = vi.fn();
vi.mock('./reportSettings', () => ({ readReportConfig: readReportConfigMock }));

vi.mock('./eventLog', () => ({ logEvent: vi.fn() }));

const { buildIssuePayload, classifySyncError, syncPendingReports } = await import('./reportSync');

function makeReport(overrides: Partial<FieldReport> = {}): FieldReport {
  return {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    createdAt: '2026-07-09T08:15:00.000Z',
    description: 'The trend line looked frozen after the weigh-in.',
    screenName: 'home',
    appVersion: '0.5.0',
    screenshotBase64: null,
    screenshotMime: null,
    status: 'pending',
    syncedIssueUrl: null,
    syncError: null,
    activityLog: null,
    ...overrides,
  };
}

describe('buildIssuePayload', () => {
  it('uses the full description as the title when it is at or under 60 characters', () => {
    const report = makeReport({ description: 'Short description under sixty chars.' });
    const { title } = buildIssuePayload(report);
    expect(title).toBe('Short description under sixty chars.');
    expect(title.endsWith('…')).toBe(false);
  });

  it('does not truncate a description of exactly 60 characters', () => {
    const description = 'a'.repeat(60);
    const { title } = buildIssuePayload(makeReport({ description }));
    expect(title).toBe(description);
    expect(title).toHaveLength(60);
  });

  it('truncates to 60 characters plus an ellipsis for a longer description', () => {
    const description = 'b'.repeat(75);
    const { title } = buildIssuePayload(makeReport({ description }));
    expect(title).toBe(`${'b'.repeat(60)}…`);
    expect(title).toHaveLength(61);
  });

  it('includes app version, screen, and createdAt in the context block', () => {
    const report = makeReport({ appVersion: '0.5.0', screenName: 'home', createdAt: '2026-07-09T08:15:00.000Z' });
    const { body } = buildIssuePayload(report);
    expect(body).toContain('App version: 0.5.0');
    expect(body).toContain('Screen: home');
    expect(body).toContain('Reported: 2026-07-09T08:15:00.000Z');
    expect(body).toContain("Filed from Tide's in-app reporter.");
  });

  it('starts the context block with the description followed by a --- separator', () => {
    const report = makeReport({ description: 'Weigh-in save button did nothing.' });
    const { body } = buildIssuePayload(report);
    expect(body.startsWith('Weigh-in save button did nothing.\n\n---\n')).toBe(true);
  });

  it('omits the screenshot markdown image when no screenshot URL is given', () => {
    const { body } = buildIssuePayload(makeReport());
    expect(body).not.toContain('![screenshot]');
  });

  it('appends the screenshot markdown image when a screenshot URL is given', () => {
    const url = 'https://raw.githubusercontent.com/Bosonian/Play/main/field-reports/2026-07-09-abcdef12.jpg';
    const { body } = buildIssuePayload(makeReport(), url);
    expect(body).toContain(`![screenshot](${url})`);
  });

  it('omits the screenshot markdown image when the screenshot URL is null', () => {
    const { body } = buildIssuePayload(makeReport(), null);
    expect(body).not.toContain('![screenshot]');
  });

  it('omits the activity log section when activityLog is null', () => {
    const { body } = buildIssuePayload(makeReport({ activityLog: null }));
    expect(body).not.toContain('## Activity log');
  });

  it('omits the activity log section when activityLog is an empty array', () => {
    const { body } = buildIssuePayload(makeReport({ activityLog: [] }));
    expect(body).not.toContain('## Activity log');
  });

  it('appends a fenced activity log section when activityLog is present', () => {
    const lines = [
      '2026-07-09 08:10:00 [weighin] Weigh-in logged: 98.4 kg.',
      '2026-07-09 08:14:00 [lifecycle] App resumed.',
    ];
    const { body } = buildIssuePayload(makeReport({ activityLog: lines }));
    expect(body).toContain('## Activity log (last 50 events)');
    expect(body).toContain('```\n' + lines.join('\n') + '\n```');
  });
});

describe('classifySyncError', () => {
  it.each([401, 403, 404, 422])('classifies status %i as failed (permanent)', (status) => {
    expect(classifySyncError(status)).toBe('failed');
  });

  it.each([0, 409, 500, 502, 503])('classifies status %i as pending (retryable)', (status) => {
    expect(classifySyncError(status)).toBe('pending');
  });

  it('classifies a null status (network error or timeout) as pending', () => {
    expect(classifySyncError(null)).toBe('pending');
  });
});

// Field report #14/#15 (Runway): the same field report arrived as two
// identical GitHub issues, filed seconds apart — two concurrent
// `syncPendingReports` drains each read the same still-'pending' row before
// either write landed 'synced'. These tests pin the module-level
// single-flight guard that fixes it, not the drain's own body (already
// covered by `buildIssuePayload`/`classifySyncError` above and by the real
// GitHub-facing behavior, which isn't mocked here).
describe('syncPendingReports (single-flight mutex)', () => {
  beforeEach(() => {
    readReportConfigMock.mockReset();
    whereMock.mockClear();
    equalsMock.mockClear();
    sortByMock.mockReset();
    // No pending reports for every test in this block — the guard's own
    // coordination is what's under test here, not the drain's queue-walking
    // body (already exercised by the classify/payload tests above).
    sortByMock.mockResolvedValue([]);
  });

  it('a second call while one is still in flight returns the SAME promise instead of starting a parallel drain', async () => {
    let resolveConfig!: (value: { token: string; repo: string }) => void;
    readReportConfigMock.mockImplementation(
      () =>
        new Promise<{ token: string; repo: string }>((resolve) => {
          resolveConfig = resolve;
        }),
    );

    const first = syncPendingReports();
    const second = syncPendingReports();

    // Both calls are in flight at once. Only the FIRST actually started a
    // drain — the second awaited it instead of reading its own config,
    // which is exactly the coordination that stops two drains from both
    // reading the same 'pending' row before either marks it 'synced'.
    expect(readReportConfigMock).toHaveBeenCalledTimes(1);

    resolveConfig({ token: '', repo: 'Bosonian/Play' });
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(readReportConfigMock).toHaveBeenCalledTimes(1);
  });

  it('a call made AFTER the in-flight drain finished starts a genuinely fresh one, not a queued extra run', async () => {
    readReportConfigMock.mockResolvedValue({ token: '', repo: 'Bosonian/Play' });

    await syncPendingReports();
    await syncPendingReports();

    expect(readReportConfigMock).toHaveBeenCalledTimes(2);
  });

  it('the guard clears even when the drain hits an unexpected error, so a later call is not stuck awaiting a dead promise', async () => {
    readReportConfigMock.mockRejectedValueOnce(new Error('unexpected'));
    // Swallowed per this module's "never throws" contract — the outer
    // single-flight promise still resolves, and its `finally` still clears
    // `inFlightSync`.
    await expect(syncPendingReports()).resolves.toBeUndefined();

    readReportConfigMock.mockResolvedValueOnce({ token: '', repo: 'Bosonian/Play' });
    await syncPendingReports();

    expect(readReportConfigMock).toHaveBeenCalledTimes(2);
  });
});
