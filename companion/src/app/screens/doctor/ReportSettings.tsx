import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/store';
import {
  loadReportConfig,
  saveReportConfig,
  clearReportToken,
  DEFAULT_LABEL,
  DEFAULT_SCREENSHOT_DIR,
  type ReportConfig,
} from '../../lib/reportConfig';
import { makeGithubApi } from '../../report/githubApi';
import { drainReports } from '../../report/queue';

interface ReportSettingsProps {
  onBack: () => void;
}

const primaryButtonClass = 'rounded-md bg-accent px-4 py-2 text-label text-white disabled:opacity-60';
const secondaryButtonClass = 'text-label text-fg-muted underline underline-offset-2';
const inputClass = 'mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg';

// One of three, or none while unverified-but-blank (no config saved yet).
function visibilityLine(config: ReportConfig | null): string | null {
  if (!config) return null;
  if (config.repoIsPublic === true) {
    return 'This repository is public. Reports and screenshots filed there are publicly visible.';
  }
  if (config.repoIsPublic === false) {
    return 'This repository is private.';
  }
  return 'Repository visibility could not be verified.';
}

// Doctor-mode screen for configuring where field reports get filed, plus a
// small view of the on-device queue. The token itself is write-only from
// this UI's perspective: once saved, this screen never reads it back out of
// `config` for display, only checks whether it's present (see
// reportConfig.ts's SPEC RISK D).
export function ReportSettings({ onBack }: ReportSettingsProps) {
  const [config, setConfig] = useState<ReportConfig | null>(() => loadReportConfig());

  const [owner, setOwner] = useState(config?.owner ?? '');
  const [repo, setRepo] = useState(config?.repo ?? '');
  const [label, setLabel] = useState(config?.label ?? DEFAULT_LABEL);
  const [screenshotDir, setScreenshotDir] = useState(config?.screenshotDir ?? DEFAULT_SCREENSHOT_DIR);

  // Empty means "leave the stored token as-is" at save time — this field is
  // never pre-filled from a stored token (see the SPEC RISK D note above).
  const [tokenInput, setTokenInput] = useState('');
  // Only relevant when a token is already stored: false shows the quiet
  // "Access token · configured" line, true reveals a blank password input
  // so a new token can be typed over it.
  const [replacingToken, setReplacingToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasStoredToken = !!config?.token;
  const showTokenInput = !hasStoredToken || replacingToken;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    const nextToken = tokenInput.trim() !== '' ? tokenInput : (config?.token ?? '');
    const next: ReportConfig = {
      version: 1,
      owner: owner.trim(),
      repo: repo.trim(),
      label: label.trim() || DEFAULT_LABEL,
      screenshotDir: screenshotDir.trim() || DEFAULT_SCREENSHOT_DIR,
      token: nextToken,
      repoIsPublic: config?.repoIsPublic ?? null,
      verifiedAt: config?.verifiedAt ?? null,
    };
    saveReportConfig(next);
    setConfig(next);
    setTokenInput('');
    setReplacingToken(false);
    setSaving(false);

    // Fire-and-forget visibility check: Save completes (and this function
    // returns) without waiting on it. Whichever branch lands re-saves the
    // whole record from a fresh loadReportConfig() read rather than closing
    // over `next`, so a second Save that happens to land while this check is
    // still in flight doesn't get silently overwritten by a stale result.
    if (next.token) {
      makeGithubApi()
        .getRepoIsPublic({ owner: next.owner, repo: next.repo, token: next.token })
        .then((isPublic) => {
          const current = loadReportConfig();
          if (!current) return;
          const updated: ReportConfig = {
            ...current,
            repoIsPublic: isPublic,
            verifiedAt: new Date().toISOString(),
          };
          saveReportConfig(updated);
          setConfig(updated);
        })
        .catch(() => {
          const current = loadReportConfig();
          if (!current) return;
          const updated: ReportConfig = { ...current, repoIsPublic: null };
          saveReportConfig(updated);
          setConfig(updated);
        });
    }
  }

  function handleClear() {
    clearReportToken();
    setConfig((prev) => (prev ? { ...prev, token: '' } : prev));
    setTokenInput('');
    setReplacingToken(false);
  }

  const reports = useLiveQuery(() => db.fieldReports.toArray());
  const pendingCount = reports?.filter((r) => r.status === 'pending').length ?? 0;
  const failedCount = reports?.filter((r) => r.status === 'failed').length ?? 0;
  const syncedCount = reports?.filter((r) => r.status === 'synced').length ?? 0;
  const mostRecentFailed = reports
    ?.filter((r) => r.status === 'failed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const visibility = visibilityLine(config);

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <h1 className="text-title font-medium">Report settings</h1>
      <p className="mt-2 text-body text-fg-muted">
        Field reports are filed as GitHub issues in the repository below.
      </p>

      <form onSubmit={handleSave} className="mt-4 space-y-3">
        <div>
          <label htmlFor="report-owner" className="block text-label text-fg-muted">
            Repository owner
          </label>
          <input
            id="report-owner"
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="report-repo" className="block text-label text-fg-muted">
            Repository name
          </label>
          <input
            id="report-repo"
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="report-label" className="block text-label text-fg-muted">
            Issue label
          </label>
          <input
            id="report-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="report-screenshot-dir" className="block text-label text-fg-muted">
            Screenshot folder
          </label>
          <input
            id="report-screenshot-dir"
            type="text"
            value={screenshotDir}
            onChange={(e) => setScreenshotDir(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          {showTokenInput ? (
            <>
              <label htmlFor="report-token" className="block text-label text-fg-muted">
                Access token
              </label>
              <input
                id="report-token"
                type="password"
                autoComplete="off"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-caption text-fg-muted">
                A fine-grained GitHub token with Issues and Contents write access to this repository.
                Stored only on this device.
              </p>
            </>
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-body text-fg">Access token · configured</span>
              <button
                type="button"
                onClick={() => setReplacingToken(true)}
                className={secondaryButtonClass}
              >
                Replace
              </button>
              <button type="button" onClick={handleClear} className={secondaryButtonClass}>
                Clear
              </button>
            </div>
          )}
        </div>

        {visibility && <p className="text-caption text-fg-muted">{visibility}</p>}

        <div className="flex items-center gap-4 pt-1">
          <button type="submit" disabled={saving} className={primaryButtonClass}>
            Save settings
          </button>
        </div>
      </form>

      {reports !== undefined && (
        <div className="mt-8">
          <h2 className="text-label text-fg-muted">Queued reports</h2>
          <p className="mt-2 text-body text-fg">
            Pending: {pendingCount} · Failed: {failedCount} · Sent: {syncedCount}
          </p>
          {mostRecentFailed?.lastError && (
            <p className="mt-1 text-caption text-fg-muted">Last error: {mostRecentFailed.lastError}</p>
          )}
          <button
            type="button"
            onClick={() => drainReports(db)}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-label text-white"
          >
            Sync now
          </button>
        </div>
      )}

      <button type="button" onClick={onBack} className={`mt-6 block ${secondaryButtonClass}`}>
        Back
      </button>
    </div>
  );
}
