import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db } from '../db/db';
import type { FieldReport } from '../db/types';
import { readReportConfig } from './reportSettings';

const GITHUB_API_BASE = 'https://api.github.com';
// 20s, not routesApi.ts's 12s — a screenshot upload (base64, up to the 4MB
// cap ReportProblem.tsx enforces before it ever gets here) is a bigger,
// slower payload than a one-line Routes API request.
const TIMEOUT_MS = 20_000;

/** Title cap the spec fixes at 60 characters — the same number GitHub's own
 * issue list truncates to in its UI, so a title this app generates never
 * looks any more cut-off there than a hand-typed one would. */
const TITLE_MAX_CHARS = 60;

/**
 * Title + body for the GitHub issue a field report becomes. Pure (no
 * network, no Dexie) so it's independently testable — reportSync.test.ts
 * covers the truncation boundary, the context block's content, and the
 * image markdown's presence/absence directly, without mocking a fetch.
 *
 * `screenshotUrl` is passed in rather than read off the report because it
 * doesn't exist yet at the time this is called for a report WITH a
 * screenshot — it's the return value of the upload step that runs first
 * (syncOneReport, below).
 */
export function buildIssuePayload(
  report: FieldReport,
  screenshotUrl?: string | null,
): { title: string; body: string } {
  const description = report.description.trim();
  const title =
    description.length > TITLE_MAX_CHARS ? `${description.slice(0, TITLE_MAX_CHARS)}…` : description;

  const bodyLines = [
    report.description,
    '',
    '---',
    `App version: ${report.appVersion}`,
    `Screen: ${report.screenName}`,
    `Reported: ${report.createdAt}`,
    `Filed from Runway's in-app reporter.`,
  ];
  if (screenshotUrl) {
    bodyLines.push('', `![screenshot](${screenshotUrl})`);
  }

  return { title, body: bodyLines.join('\n') };
}

/**
 * Maps an HTTP outcome to what should happen to a report's `status`.
 * 'failed' is a PERMANENT stop — 401/403/404/422 mean bad token, bad repo,
 * or a validation error GitHub rejected outright; retrying the exact same
 * request would only fail the exact same way, so surfacing it and waiting
 * for the user to fix the setting (then hit Retry) is more honest than
 * silently trying again forever. Everything else — no status at all (a
 * thrown network error or timeout, represented as `null`), 5xx, or the
 * literal 0 some transports report for a connection that never completed —
 * is 'pending': ordinary transience that the next app-open retry should
 * just paper over without the user ever being told.
 */
export function classifySyncError(status: number | null): 'failed' | 'pending' {
  if (status !== null && [401, 403, 404, 422].includes(status)) return 'failed';
  return 'pending';
}

interface GithubResponse {
  status: number;
  data: unknown;
}

/**
 * The actual network call, mirroring routesApi.ts's requestRoutes split:
 * CapacitorHttp natively (bypasses the WebView's CORS enforcement the same
 * way), plain fetch on web/dev. Unlike requestRoutes, this deliberately
 * does NOT throw on a non-2xx status — the caller needs the exact status
 * code either way (409 vs 422 during the screenshot retry, 401 vs 500
 * during classification), so turning some of those into thrown errors here
 * would just mean unwrapping them again one frame up. It only throws for
 * genuine transport failures: no response at all (network down, DNS
 * failure, timeout).
 */
async function githubRequest(
  method: 'POST' | 'PUT',
  url: string,
  token: string,
  body: unknown,
): Promise<GithubResponse> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      method,
      url,
      headers,
      data: body,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    return { status: response.status, data: response.data };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // GitHub always returns a JSON body, success or error, so a failed
    // parse here means something is badly wrong with the response — treated
    // as "no usable data" rather than crashing the whole sync pass over it.
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractErrorMessage(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return 'GitHub API request failed.';
}

function extractDownloadUrl(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const content = (data as Record<string, unknown>).content;
  if (typeof content !== 'object' || content === null) return null;
  const downloadUrl = (content as Record<string, unknown>).download_url;
  return typeof downloadUrl === 'string' ? downloadUrl : null;
}

function extractIssueUrl(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const htmlUrl = (data as Record<string, unknown>).html_url;
  return typeof htmlUrl === 'string' ? htmlUrl : null;
}

/** 'image/png' -> 'png', everything else (in practice just 'image/jpeg',
 * the other half of the <input accept="image/*"> + FileReader path
 * ReportProblem.tsx uses) -> 'jpg'. This only decorates a filename in the
 * target repo — it isn't a content-type validator, so an unrecognized mime
 * falling through to 'jpg' is a harmless cosmetic choice, not a bug. */
function mimeToExtension(mime: string): string {
  return mime === 'image/png' ? 'png' : 'jpg';
}

type UploadResult = { ok: true; url: string } | { ok: false; status: number | null; message: string };

/**
 * Step 2a: PUT the report's screenshot into the target repo's
 * field-reports/ folder. `id`'s first 8 characters are enough to make the
 * filename unique in practice (a report's full UUID would work just as
 * well but reads as noise in a repo's file listing) — the 409/422 retry
 * below is the actual collision backstop, not the id length.
 */
async function uploadScreenshot(report: FieldReport, token: string, repo: string): Promise<UploadResult> {
  const ext = mimeToExtension(report.screenshotMime ?? 'image/jpeg');
  const baseName = `${report.createdAt.slice(0, 10)}-${report.id.slice(0, 8)}`;

  async function attempt(name: string): Promise<GithubResponse> {
    const url = `${GITHUB_API_BASE}/repos/${repo}/contents/field-reports/${name}.${ext}`;
    return githubRequest('PUT', url, token, {
      message: 'field report screenshot',
      content: report.screenshotBase64,
    });
  }

  let response: GithubResponse;
  try {
    response = await attempt(baseName);
  } catch (err) {
    return { ok: false, status: null, message: err instanceof Error ? err.message : 'Network error.' };
  }

  if (response.status === 409 || response.status === 422) {
    // Name collision (spec: retry exactly once, with a -2 suffix) — two
    // reports created the same second would otherwise silently overwrite
    // each other's screenshot.
    try {
      response = await attempt(`${baseName}-2`);
    } catch (err) {
      return { ok: false, status: null, message: err instanceof Error ? err.message : 'Network error.' };
    }
  }

  if (response.status >= 200 && response.status < 300) {
    const url = extractDownloadUrl(response.data);
    if (url === null) {
      // Successful upload but a response shape this app doesn't recognize
      // — status null routes this through classifySyncError as 'pending'
      // (transient-shaped, not a token/repo problem), since GitHub's own
      // API contract is what's misbehaving here, not the report's data.
      return { ok: false, status: null, message: 'Unexpected response shape from GitHub.' };
    }
    return { ok: true, url };
  }

  return { ok: false, status: response.status, message: extractErrorMessage(response.data) };
}

/** Writes the outcome of a failed attempt onto the report row — or, for a
 * 'pending' classification, deliberately writes nothing at all, so the row
 * stays exactly as eligible for "next pending sync pass" as it already was. */
async function applyFailure(reportId: string, status: number | null, message: string): Promise<void> {
  if (classifySyncError(status) !== 'failed') return;
  await db.fieldReports.update(reportId, {
    status: 'failed',
    syncError: status !== null ? `GitHub returned ${status}: ${message}` : message,
  });
}

async function syncOneReport(report: FieldReport, token: string, repo: string): Promise<void> {
  let screenshotUrl: string | null = null;

  if (report.screenshotBase64 !== null && report.screenshotMime !== null) {
    const uploaded = await uploadScreenshot(report, token, repo);
    if (!uploaded.ok) {
      await applyFailure(report.id, uploaded.status, uploaded.message);
      return;
    }
    screenshotUrl = uploaded.url;
  }

  const { title, body } = buildIssuePayload(report, screenshotUrl);
  const issuesUrl = `${GITHUB_API_BASE}/repos/${repo}/issues`;

  let response: GithubResponse;
  try {
    response = await githubRequest('POST', issuesUrl, token, { title, body, labels: ['field-report'] });
  } catch (err) {
    await applyFailure(report.id, null, err instanceof Error ? err.message : 'Network error.');
    return;
  }

  if (response.status < 200 || response.status >= 300) {
    await applyFailure(report.id, response.status, extractErrorMessage(response.data));
    return;
  }

  const issueUrl = extractIssueUrl(response.data);
  if (issueUrl === null) {
    // The POST itself succeeded (2xx) but GitHub's response didn't have the
    // field this app reads the issue link from — leave the report pending
    // rather than claim `syncedIssueUrl: null` "synced" success without a
    // link to show for it; the next retry will simply file a second issue,
    // which is an acceptable rare-edge-case cost against the alternative
    // (a report that's actually filed but permanently unreachable from the
    // app).
    return;
  }

  // Screenshot bytes now live in the target repo (or there never were any)
  // — clearing them here means a synced report doesn't keep doubling up
  // local storage for image data nothing in this app reads again.
  await db.fieldReports.update(report.id, {
    status: 'synced',
    syncedIssueUrl: issueUrl,
    syncError: null,
    screenshotBase64: null,
    screenshotMime: null,
  });
}

/**
 * Runs the pending-reports queue against GitHub Issues, sequentially — one
 * report at a time, not Promise.all — because field reports are rare
 * (a handful a month, not a bulk workload), so there's no throughput to
 * gain from parallelism, and sequential keeps a single bad response from
 * racing another report's write to the same Dexie row's error state.
 *
 * Never throws: every network/parse failure this function's own helpers
 * can produce is already caught and turned into a Dexie write (or a
 * deliberate no-write for 'pending'); the outer try/catch here is only a
 * backstop for something unexpected — a Dexie read failure, for
 * instance — so a call site (main.tsx's fire-and-forget, ReportProblem's
 * Retry button) never needs its own try/catch around this.
 */
export async function syncPendingReports(): Promise<void> {
  try {
    const { token, repo } = await readReportConfig();
    // No token configured: reports stay 'pending' forever, which IS the
    // feature (see db/types.ts's FieldReport.status comment) — filing
    // nothing and reporting no error is correct here, not a bug to fix.
    if (!token) return;

    const pending = await db.fieldReports.where('status').equals('pending').sortBy('createdAt');
    for (const report of pending) {
      await syncOneReport(report, token, repo);
    }
  } catch {
    // Genuinely unexpected — swallowed rather than propagated, per this
    // function's "never throws" contract above.
  }
}
