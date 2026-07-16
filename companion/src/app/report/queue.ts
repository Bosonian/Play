// The field-report queue engine: Dexie reads/writes and the sync loop. No
// React here — ReportProblem.tsx and ReportSettings.tsx call into this, this
// file never imports either.
import { db, type CompanionDatabase } from '../db/store';
import { safeUuid } from '../lib/uuid';
import { APP_VERSION } from '../lib/version';
import { loadReportConfig, type ReportConfig } from '../lib/reportConfig';
import { captureRecentLog, logEvent } from '../activity/activityLog';
import { buildIssuePayload, buildScreenshotPath } from './github';
import { makeGithubApi, type GithubApi, type RepoTarget } from './githubApi';
import type { FieldReport, ReportDraft } from './types';

// Writes a pending row and returns it. NEVER touches the network — the row
// sits in Dexie until a drain (on-open, post-submit, or "Sync now") picks it
// up. This is deliberately the ONLY place that calls captureRecentLog for a
// report: capturing at filing time (not at sync time, which could be
// minutes or days later on a device with no connectivity) is what makes
// "attach recent log" mean "the log as it stood when I filed this", not
// "whatever the log happens to say whenever the network finally comes back".
export async function submitReport(
  database: CompanionDatabase,
  draft: ReportDraft,
): Promise<FieldReport> {
  const attachedLog = draft.attachLog ? await captureRecentLog(database, 50) : undefined;
  const now = new Date().toISOString();
  const id = safeUuid();
  const row: FieldReport = {
    id,
    createdAt: now,
    status: 'pending',
    description: draft.description,
    screenshotBase64: draft.screenshotBase64,
    screenshotType: draft.screenshotType,
    metadata: { appVersion: APP_VERSION, screen: draft.screen, at: now },
    attachedLog,
  };
  await database.fieldReports.put(row);
  void logEvent('report', `Queued field report ${id.slice(0, 8)}`, database);
  return row;
}

function targetFrom(config: ReportConfig): RepoTarget {
  return { owner: config.owner, repo: config.repo, token: config.token };
}

// Attempts every non-synced row, oldest createdAt first, against the given
// GithubApi. Idempotent: only rows with status 'pending' or 'failed' are
// candidates, and a row only flips to 'synced' on confirmed issue creation —
// so re-running this after a partial failure is always safe to retry, never
// double-files an already-synced report.
export async function syncReports(
  database: CompanionDatabase,
  api: GithubApi,
  config: ReportConfig,
): Promise<{ filed: number; failed: number }> {
  const rows = await database.fieldReports.where('status').anyOf(['pending', 'failed']).toArray();
  const candidates = rows.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (candidates.length === 0) {
    // No sync log rows on a no-op run — a "sync started/finished" pair with
    // nothing in between would just be activity-log noise on every app open.
    return { filed: 0, failed: 0 };
  }

  void logEvent('sync', `Report sync started: ${candidates.length} to send`, database);

  let filed = 0;
  let failedCount = 0;
  try {
    for (const row of candidates) {
      const id8 = row.id.slice(0, 8);
      try {
        // Screenshot checkpoint: write screenshotUrl to the row as soon as
        // the upload succeeds, BEFORE attempting createIssue. If createIssue
        // then fails, the next retry sees screenshotUrl already set and
        // skips re-uploading the same image.
        let screenshotUrl = row.screenshotUrl;
        if (row.screenshotBase64 && !screenshotUrl) {
          const path = buildScreenshotPath(row, config.screenshotDir);
          const uploaded = await api.uploadContent(
            targetFrom(config),
            path,
            row.screenshotBase64,
            `Field report ${row.id}: screenshot`,
          );
          screenshotUrl = uploaded.htmlUrl;
          await database.fieldReports.update(row.id, { screenshotUrl });
        }

        const payload = buildIssuePayload(row, config.label, screenshotUrl);
        const issue = await api.createIssue(targetFrom(config), payload);
        await database.fieldReports.update(row.id, {
          status: 'synced',
          issueUrl: issue.htmlUrl,
          lastError: undefined,
          screenshotBase64: undefined,
        });
        void logEvent('report', `Filed field report ${id8} as ${issue.htmlUrl}`, database);
        filed++;
      } catch (e) {
        await database.fieldReports.update(row.id, {
          status: 'failed',
          lastError: String(e).slice(0, 200),
        });
        void logEvent('report', `Field report ${id8} failed: ${String(e).slice(0, 120)}`, database);
        failedCount++;
      }
    }
  } finally {
    void logEvent('sync', `Report sync finished: ${filed} filed, ${failedCount} failed`, database);
  }

  return { filed, failed: failedCount };
}

// Module-scoped reentrancy guard: the on-open drain (main.tsx), the
// post-submit drain (ReportProblem.tsx), and Settings' "Sync now" button can
// all fire close together, and running syncReports concurrently from two of
// them would risk double-filing a row (both calls reading the same pending
// row before either writes 'synced' back). A plain module-level boolean is
// enough — there is exactly one drain in flight at a time, app-wide.
let draining = false;

// Fire-and-forget: never throws, callers never await it. No-op silently if
// reporting isn't configured yet (no config, or a config with a blank
// token) — that's the normal state for a device where doctor Settings
// hasn't been filled in, not an error.
export function drainReports(database: CompanionDatabase = db, api?: GithubApi): void {
  if (draining) return;
  const config = loadReportConfig();
  if (!config || !config.token) return;

  draining = true;
  const resolvedApi = api ?? makeGithubApi();
  void syncReports(database, resolvedApi, config)
    .catch(() => {
      /* swallow — syncReports already logs per-row failures; a drain-level
         rejection would only come from a bug, and fire-and-forget must not
         throw regardless. */
    })
    .finally(() => {
      draining = false;
    });
}
