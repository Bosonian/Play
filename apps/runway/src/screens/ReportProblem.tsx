import { useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { FieldReport } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { APP_VERSION } from '../lib/appVersion';
import { syncPendingReports } from '../lib/reportSync';
import { formatDateDisplay, formatTime } from '../lib/format';

interface ReportProblemProps {
  fromScreen: string;
  onNavigate: (screen: Screen) => void;
}

/** "Defaults that lean toward less" (CLAUDE.md) — same cap as History's
 * ten-entry list, for the same reason: the newest handful is what's
 * actionable, and nothing is lost by not showing the rest. */
const REPORT_LIST_LIMIT = 10;

/** 4 MB — matches the exact copy shown when a file exceeds it. Measured in
 * MiB (1024^2), not the decimal "MB" a camera app's file-size display might
 * use, so a file that reads "3.9 MB" somewhere else could still land just
 * over this line — an accepted, minor imprecision rather than a reason to
 * fetch a byte-exact spec for a screenshot size cap. */
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const SCREENSHOT_TOO_LARGE_MESSAGE = 'Screenshot too large — 4 MB limit.';

const DESCRIPTION_PREVIEW_CHARS = 60;

/** What FileReader.readAsDataURL hands back before it's split into the two
 * pieces Dexie actually stores (db/types.ts: screenshotBase64 has the
 * `data:...;base64,` prefix stripped, screenshotMime is separate). Kept as
 * local component state, never written anywhere until Save — same "local
 * draft, not written on every keystroke" treatment Settings.tsx gives the
 * Routes API key. */
interface ScreenshotDraft {
  base64: string;
  mime: string;
  /** The full `data:` URL, kept only so the thumbnail <img> below has
   * something to point at — never itself persisted. */
  previewUrl: string;
}

/** The status line + optional link target for one row in the "Past
 * reports" list below the form. Pure and separate from the JSX so the
 * three-way status branch reads as one flat switch rather than nested
 * ternaries in the markup. */
function statusLine(report: FieldReport): { text: string; href: string | null } {
  switch (report.status) {
    case 'pending':
      return { text: 'Waiting to sync.', href: null };
    case 'synced':
      return { text: 'Filed.', href: report.syncedIssueUrl };
    case 'failed':
      // syncError is shown verbatim (reportSync.ts writes GitHub's own
      // status + message into it) — this is the one place in the app a raw
      // API error reaches the UI, deliberately: a 'failed' report needs a
      // user action (usually fixing the token or repo in Settings) and the
      // exact reason is what tells Deepak which.
      return { text: report.syncError ?? 'Failed to sync.', href: null };
  }
}

export function ReportProblem({ fromScreen, onNavigate }: ReportProblemProps) {
  const backTarget: Screen = fromScreen === 'settings' ? { name: 'settings' } : { name: 'home' };

  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<ScreenshotDraft | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  // Reset after every selection (see handleFileChange) so choosing the same
  // file again after Remove fires onChange a second time — browsers
  // otherwise treat picking an unchanged value as a no-op event.
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reports = useLiveQuery(async () => {
    const all = await db.fieldReports.orderBy('createdAt').reverse().toArray();
    return all.slice(0, REPORT_LIST_LIMIT);
  }, []);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    if (file.size > MAX_SCREENSHOT_BYTES) {
      setScreenshotError(SCREENSHOT_TOO_LARGE_MESSAGE);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return;
      // readAsDataURL's own format: "data:<mime>;base64,<payload>" — split
      // once here so Dexie only ever stores the payload half (db/types.ts's
      // screenshotBase64 doc comment).
      const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(result);
      if (!match) return;
      setScreenshotError(null);
      setScreenshot({ mime: match[1], base64: match[2], previewUrl: result });
    };
    reader.readAsDataURL(file);
  }

  function removeScreenshot() {
    setScreenshot(null);
    setScreenshotError(null);
  }

  async function saveReport() {
    const trimmed = description.trim();
    if (!trimmed) return;

    await db.fieldReports.add({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      description: trimmed,
      screenName: fromScreen,
      appVersion: APP_VERSION,
      screenshotBase64: screenshot?.base64 ?? null,
      screenshotMime: screenshot?.mime ?? null,
      status: 'pending',
      syncedIssueUrl: null,
      syncError: null,
    });

    // Fire-and-forget: the report is already durably saved above regardless
    // of whether this succeeds, times out, or the device is offline — the
    // local write IS the feature (see reportSync.ts's own doc comment for
    // why this call never throws and never needs a try/catch here).
    void syncPendingReports();

    onNavigate(backTarget);
  }

  /** Failed rows need their status flipped back to 'pending' before
   * syncPendingReports() will look at them again — the engine only ever
   * reads status='pending' rows (reportSync.ts's own "never silently retry
   * a permanent failure" rule), so a manual Retry has to be the thing that
   * opts a 'failed' row back in. A 'pending' row is already eligible; this
   * just gives it an on-demand nudge instead of waiting for the next app
   * open. */
  async function retryReport(report: FieldReport) {
    if (report.status === 'failed') {
      await db.fieldReports.update(report.id, { status: 'pending', syncError: null });
    }
    void syncPendingReports();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Report a problem" onBack={() => onNavigate(backTarget)} />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-description" className="text-sm font-medium text-slate-300">
            What happened
          </label>
          <textarea
            id="report-description"
            autoFocus
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what you saw and what you expected instead."
            className="min-h-32 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
          />
        </div>

        {screenshot ? (
          <div className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900 p-3">
            <img src={screenshot.previewUrl} alt="Screenshot preview" className="h-16 w-16 rounded object-cover" />
            <button
              onClick={removeScreenshot}
              className="min-h-11 rounded-md px-3 text-sm font-medium text-slate-500 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-screenshot" className="text-sm font-medium text-slate-300">
              Screenshot (optional)
            </label>
            <input
              id="report-screenshot"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="text-sm text-slate-400 file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-700"
            />
            {screenshotError && <p className="text-sm text-red-400">{screenshotError}</p>}
          </div>
        )}

        <Button onClick={() => void saveReport()} disabled={description.trim() === ''} className="w-full">
          Save report
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Past reports</h2>

        {reports?.length === 0 && <p className="text-sm text-slate-500">No reports yet.</p>}

        <div className="flex flex-col gap-2">
          {reports?.map((report) => {
            const { text, href } = statusLine(report);
            const preview =
              report.description.length > DESCRIPTION_PREVIEW_CHARS
                ? `${report.description.slice(0, DESCRIPTION_PREVIEW_CHARS)}…`
                : report.description;
            return (
              <div key={report.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-slate-100">{preview}</p>
                  <p className="shrink-0 text-sm tabular-nums text-slate-500">
                    {formatDateDisplay(new Date(report.createdAt))} {formatTime(new Date(report.createdAt))}
                  </p>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-sky-400 hover:text-sky-300"
                    >
                      {text}
                    </a>
                  ) : (
                    <p className="text-sm text-slate-400">{text}</p>
                  )}
                  {(report.status === 'failed' || report.status === 'pending') && (
                    <button
                      onClick={() => void retryReport(report)}
                      className="min-h-11 rounded-md px-2 text-sm font-medium text-slate-500 hover:text-slate-300"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
