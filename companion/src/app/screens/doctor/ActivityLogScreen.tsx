import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/store';
import { captureRecentLog } from '../../activity/activityLog';
import { formatTimeHM } from '../../patient/log';
import type { ActivityRow } from '../../activity/types';

// This screen and the (Phase B) report attachment are the ONLY paths by
// which log rows leave the device — Share log copies/shares plain text,
// nothing here ever transmits automatically.
interface ActivityLogScreenProps {
  onBack: () => void;
}

// ISO local date, "YYYY-MM-DD", computed from LOCAL time (not the UTC date
// embedded in row.at) — a day boundary header should match the doctor's own
// clock, the same local-day convention log.ts's todayRangeISO uses.
function localDateKey(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Groups rows (already newest-first from the query) into local-date buckets,
// preserving the newest-first row order within each bucket and the
// newest-first bucket order overall.
function groupByLocalDay(rows: ActivityRow[]): Array<[string, ActivityRow[]]> {
  const groups: Array<[string, ActivityRow[]]> = [];
  for (const row of rows) {
    const key = localDateKey(row.at);
    const last = groups[groups.length - 1];
    if (last && last[0] === key) {
      last[1].push(row);
    } else {
      groups.push([key, [row]]);
    }
  }
  return groups;
}

export function ActivityLogScreen({ onBack }: ActivityLogScreenProps) {
  const rows = useLiveQuery(() => db.activityLog.orderBy('at').reverse().limit(200).toArray());
  // Inline clipboard confirmation, matching the app's persistent-banner
  // convention (lastAction/lastRemoved): no toast, no timer, no window.alert
  // (which would be jarring against the calm/spare tone). Only the desktop
  // clipboard fallback needs it — a native share sheet is its own feedback.
  const [copied, setCopied] = useState(false);

  // undefined = still loading (SPEC RISK #2's useLiveQuery rule, same
  // convention as Home.tsx / PatientRoot.tsx) — render nothing yet.
  if (rows === undefined) return null;

  const groups = groupByLocalDay(rows);

  async function handleShare() {
    setCopied(false);
    const text = await captureRecentLog(db, 500);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Companion activity log', text });
      } catch {
        /* user cancelled (AbortError) — ignore */
      }
    } else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    }
  }

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <h1 className="text-title font-medium">Activity log</h1>

      {rows.length === 0 ? (
        <p className="mt-4 text-body text-fg-muted">No activity yet.</p>
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map(([day, dayRows]) => (
            <div key={day}>
              <p className="text-label text-fg-muted">{day}</p>
              <div className="mt-2 space-y-1">
                {dayRows.map((row) => (
                  <p key={row.id} className="font-mono text-caption text-fg">
                    {formatTimeHM(row.at)} [{row.category}] {row.message}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleShare()}
        className="mt-6 rounded-md bg-accent px-4 py-2 text-label text-white"
      >
        Share log
      </button>
      {copied && <p className="mt-2 text-label text-fg-muted">Log copied to clipboard.</p>}

      <button
        type="button"
        onClick={onBack}
        className="mt-6 block text-label text-fg-muted underline underline-offset-2"
      >
        Back
      </button>
    </div>
  );
}
