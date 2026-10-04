import { useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { FieldReport } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { APP_VERSION } from '../lib/appVersion';
import { syncPendingReports } from '../lib/reportSync';
import { formatEventLine, logEvent, recentEvents } from '../lib/eventLog';
import { backTarget as computeBackTarget } from '../lib/backTarget';

// Ported from apps/runway/src/screens/ReportProblem.tsx — the "report a
// problem" composer, ~verbatim. Copy adapted from Runway to Tide; date/time
// formatting uses inline `toLocaleDateString`/`toLocaleTimeString` (Runway's
// `formatDateDisplay`/`formatTime` live in a `lib/format.ts` Tide doesn't
// have — History.tsx and Settings.tsx already format dates this same
// inline way, so this follows that existing convention rather than adding a
// new shared helper for one screen).

interface ReportProblemProps {
  fromScreen: string;
  onNavigate: (screen: Screen) => void;
}

/** "Defaults that lean toward less" (CLAUDE.md) — same cap as Runway's own
 * list, for the same reason: the newest handful is what's actionable, and
 * nothing is lost by not showing the rest. */
const REPORT_LIST_LIMIT = 10;

/** 4 MB — matches the exact copy shown when a file exceeds it. Measured in
 * MiB (1024^2), not the decimal "MB" a camera app's file-size display might
 * use, so a file that reads "3.9 MB" somewhere else could still land just
 * over this line — an accepted, minor imprecision rather than a reason to
 * fetch a byte-exact spec for a screenshot size cap. Same value as Runway's
 * own MAX_SCREENSHOT_BYTES — no reason for Tide's cap to differ. */
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const SCREENSHOT_TOO_LARGE_MESSAGE = 'Screenshot too large — 4 MB limit.';

const DESCRIPTION_PREVIEW_CHARS = 60;

/** How many recent lines get attached when the "Attach recent activity log"
 * checkbox is on — see reportSync.ts's buildIssuePayload for where this
 * number reappears in the section heading it renders under. Same cap as
 * Runway's own REPORT_ACTIVITY_LOG_LIMIT: a report travels to a public repo
 * (see the checkbox's own caption below), so this stays deliberately narrow
 * — CLAUDE.md's "defaults lean toward less". */
const REPORT_ACTIVITY_LOG_LIMIT = 50;

/** What FileReader.readAsDataURL hands back before it's split into the two
 * pieces Dexie actually stores (db/types.ts: screenshotBase64 has the
 * `data:...;base64,` prefix stripped, screenshotMime is separate). Kept as
 * local component state, never written anywhere until Save. */
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

/** "24 Jul, 14:32" — same inline format History.tsx/Settings.tsx already
 * use, 24h time (CLAUDE.md's European-format rule, `hour12: false` rather
 * than trusting the ambient locale). */
function formatReportedAt(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

export function ReportProblem({ fromScreen, onNavigate }: ReportProblemProps) {
  // Back-and-forward destination, computed by the SAME function
  // src/native/backGesture.ts consults for a hardware back gesture
  // (src/lib/backTarget.ts) rather than recomputed inline here the way
  // Runway's own ReportProblem.tsx still does (see that file's comment) —
  // one shared source of truth means the on-screen back chevron and a
  // physical back gesture can never quietly disagree about where "back"
  // means. `fromScreen` here is a plain string (this screen's own prop
  // shape, matching db/types.ts's FieldReport.screenName), while
  // `backTarget` expects a full `Screen` — the `{ name: 'reportProblem',
  // fromScreen }` wrapper below reconstructs exactly the shape backTarget's
  // `reportProblem` case switches on.
  const backTarget: Screen = computeBackTarget({ name: 'reportProblem', fromScreen }) ?? { name: 'home' };

  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<ScreenshotDraft | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  // Activity-log increment: default OFF (CLAUDE.md's "defaults lean toward
  // less" plus the honesty that the target repo can be public — see the
  // checkbox's own caption below). Deliberately not remembered across
  // reports the way the feedback token/repo settings are: whether THIS
  // report needs the log is a decision worth making fresh each time, not a
  // standing preference.
  const [attachLog, setAttachLog] = useState(false);
  // Reset after every selection (see handleFileChange) so choosing the same
  // file again after Remove fires onChange a second time — browsers
  // otherwise treat picking an unchanged value as a no-op event.
  const fileInputRef = useRef<HTMLInputElement>(null);

  // `.limit(...)` on the index BEFORE `.toArray()` (review fix, 0.5.1) —
  // the ported version loaded every report row into memory then sliced, which
  // meant pulling every unsynced row's up-to-4 MB base64 screenshot on each
  // liveQuery fire just to show the newest ten. Impact was small in practice
  // (reports are rare, synced rows have their bytes cleared), but reading only
  // the ten rows the list shows is the correct shape.
  const reports = useLiveQuery(
    () => db.fieldReports.orderBy('createdAt').reverse().limit(REPORT_LIST_LIMIT).toArray(),
    [],
  );

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

    // Snapshotted NOW, not re-read at sync time — see db/types.ts's
    // FieldReport.activityLog doc comment for why a queued-offline report
    // must keep the log it was filed with, not whatever the log says by the
    // time a token/connection finally lets it sync.
    const activityLog = attachLog
      ? (await recentEvents(REPORT_ACTIVITY_LOG_LIMIT)).map(formatEventLine)
      : null;

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
      activityLog,
    });
    void logEvent('report', 'Report submitted.');

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
            className="min-h-32 rounded-lg border border-slate-700 bg-raised px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        {screenshot ? (
          <div className="flex items-center gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
            <img src={screenshot.previewUrl} alt="Screenshot preview" className="h-16 w-16 rounded-lg object-cover" />
            <TextAction onClick={removeScreenshot}>Remove</TextAction>
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
              className="text-sm text-slate-400 file:mr-3 file:min-h-12 file:rounded-lg file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-700"
            />
            {screenshotError && <p className="text-sm text-red-400">{screenshotError}</p>}
          </div>
        )}

        <label className="flex items-start gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
          <input
            type="checkbox"
            checked={attachLog}
            onChange={(e) => setAttachLog(e.target.checked)}
            className="mt-0.5 size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          />
          <span className="flex flex-col gap-1">
            <span className="text-slate-100">Attach recent activity log</span>
            <span className="text-sm text-slate-500">
              The last 50 events are appended — these include your weigh-in and meal entries.
            </span>
          </span>
        </label>

        {/* One screen-level publicity note (review fix, 0.5.1) rather than a
            claim on the log checkbox alone: the description AND the screenshot
            travel to the same repo, so warning only about the log understated
            the reach — a screenshot of Home shows the weight trend. Phrased
            conditionally ("if that repository is public") because it is NOT a
            fact: the repo is configurable in Settings and a private repo is
            offered there precisely to keep all of this between Deepak and the
            reviewer. CLAUDE.md's exact-copy rule — the previous "the report
            repo is public" was simply false once a private repo was set. */}
        <p className="text-sm text-slate-500">
          Reports file to the repository set in Settings. If that repository is public, everything
          here — your description, any screenshot, and the attached log — is publicly visible.
        </p>

        <Button onClick={() => void saveReport()} disabled={description.trim() === ''} className="w-full">
          Save report
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Past reports</h2>

        {reports?.length === 0 && <p className="text-sm text-slate-500">No reports yet.</p>}

        <div className="flex flex-col gap-2">
          {reports?.map((report) => {
            const { text, href } = statusLine(report);
            const preview =
              report.description.length > DESCRIPTION_PREVIEW_CHARS
                ? `${report.description.slice(0, DESCRIPTION_PREVIEW_CHARS)}…`
                : report.description;
            return (
              <div key={report.id} className="rounded-xl border border-slate-800/60 bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-slate-100">{preview}</p>
                  <p className="shrink-0 text-sm tabular-nums text-slate-500">{formatReportedAt(report.createdAt)}</p>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-sky-400 transition-colors hover:text-sky-300"
                    >
                      {text}
                    </a>
                  ) : (
                    <p className="text-sm text-slate-400">{text}</p>
                  )}
                  {(report.status === 'failed' || report.status === 'pending') && (
                    <TextAction onClick={() => void retryReport(report)}>Retry</TextAction>
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
