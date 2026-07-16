import { useRef, useState } from 'react';
import { db } from '../db/store';
import { loadReportConfig, type ReportConfig } from '../lib/reportConfig';
import { submitReport, drainReports } from '../report/queue';

interface ReportProblemProps {
  screen: string; // which screen this report was filed from (metadata.screen)
  onBack: () => void;
}

const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;

const primaryButtonClass = 'rounded-md bg-accent px-4 py-2 text-label text-white disabled:opacity-60';
const secondaryButtonClass = 'text-label text-fg-muted underline underline-offset-2';

// Priority-ordered contextual notice about where this report will end up.
// Exactly one of these renders, or none (a verified-private repo needs no
// warning). Read from `config` alone — never from any live network check,
// which is why "verified" here means "as of the last time doctor Settings
// confirmed it", not "right now".
function reportingNotice(config: ReportConfig | null): string | null {
  if (!config || !config.token) {
    return 'Reporting is not set up on this device yet. Your report will be saved here and sent after setup is completed in doctor Settings.';
  }
  if (config.repoIsPublic === true) {
    return 'Reports are filed to a public repository. Anyone can read them, including screenshots and attached logs.';
  }
  if (config.repoIsPublic === null) {
    return "The repository's visibility could not be verified. Treat reports as publicly visible.";
  }
  return null; // repoIsPublic === false — a verified-private repo, nothing to warn about
}

// Shared by both patient and doctor mode (screen prop distinguishes them in
// the filed report's metadata). Two states only: editing -> saved. There is
// no "sending" state here on purpose — submit only ever writes to the local
// queue (submitReport never touches the network), so there's nothing to wait
// on beyond the Dexie write itself.
export function ReportProblem({ screen, onBack }: ReportProblemProps) {
  const [state, setState] = useState<'editing' | 'saved'>('editing');
  // Loaded once on mount, for the warning notice only — NEVER rendered back
  // as a config value, and never the token itself (see reportConfig.ts's
  // SPEC RISK D comment on why the token must never round-trip into the UI).
  const [config] = useState<ReportConfig | null>(() => loadReportConfig());

  const [description, setDescription] = useState('');
  const [screenshotBase64, setScreenshotBase64] = useState<string | undefined>(undefined);
  const [screenshotType, setScreenshotType] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attachLog, setAttachLog] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function clearFile() {
    setScreenshotBase64(undefined);
    setScreenshotType(undefined);
    setFileName(undefined);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_SCREENSHOT_BYTES) {
      setFileError('That image is larger than 3 MB. Choose a smaller image.');
      setScreenshotBase64(undefined);
      setScreenshotType(undefined);
      setFileName(undefined);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setFileError(null);
    const reader = new FileReader();
    reader.onload = () => {
      // readAsDataURL yields "data:<mime>;base64,<payload>" — strip
      // everything up to and including the comma, since GitHub's contents
      // API (githubApi.ts's uploadContent) wants the bare base64 payload.
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.slice(result.indexOf(',') + 1);
      setScreenshotBase64(base64);
      setScreenshotType(file.type);
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !description.trim()) return;
    setSaving(true);
    await submitReport(db, {
      description,
      screen,
      screenshotBase64,
      screenshotType,
      attachLog,
    });
    // Fire-and-forget: a report that can't reach the network right now is
    // still successfully saved (see the saved-state copy below) — this call
    // is an opportunistic "try now", not something the user waits on.
    drainReports(db);
    setSaving(false);
    setState('saved');
  }

  if (state === 'saved') {
    return (
      <div className="rounded-md border border-line bg-surface p-4">
        <p className="text-body text-fg">
          Report saved on this device. It sends automatically once a connection is available.
        </p>
        <button type="button" onClick={onBack} className={`mt-6 ${secondaryButtonClass}`}>
          Done
        </button>
      </div>
    );
  }

  const notice = reportingNotice(config);

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-line bg-surface p-4">
      <h1 className="text-title font-medium">Report a problem</h1>
      <p className="mt-2 text-body text-fg-muted">
        Describe what went wrong. The report is saved on this device first and sent later.
      </p>

      <div className="mt-4">
        <label htmlFor="report-description" className="block text-label text-fg-muted">
          What happened
        </label>
        <textarea
          id="report-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          className="mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="report-screenshot" className="block text-label text-fg-muted">
          Screenshot (optional)
        </label>
        <input
          ref={fileInputRef}
          id="report-screenshot"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="mt-1 block w-full text-body text-fg"
        />
        {fileError && <p className="mt-1 text-label text-warn">{fileError}</p>}
        {fileName && !fileError && (
          <p className="mt-1 text-caption text-fg-muted">
            {fileName}{' '}
            <button type="button" onClick={clearFile} className={secondaryButtonClass}>
              Remove image
            </button>
          </p>
        )}
      </div>

      <div className="mt-4">
        <label className="flex items-start gap-2 text-body text-fg">
          <input
            type="checkbox"
            checked={attachLog}
            onChange={(e) => setAttachLog(e.target.checked)}
            className="mt-1"
          />
          <span>Attach recent activity log</span>
        </label>
        <p className="mt-1 text-caption text-fg-muted">
          Attaches the last 50 lines of the app&apos;s activity log. Log lines name medications and
          symptom entries — review the log before attaching. Reports filed to a public repository are
          publicly visible, including attached logs.
        </p>
      </div>

      {notice && <p className="mt-4 text-caption text-fg-muted">{notice}</p>}

      <div className="mt-6 flex items-center gap-4">
        <button type="submit" disabled={saving || !description.trim()} className={primaryButtonClass}>
          Save report
        </button>
        <button type="button" onClick={onBack} className={secondaryButtonClass}>
          Back
        </button>
      </div>
    </form>
  );
}
