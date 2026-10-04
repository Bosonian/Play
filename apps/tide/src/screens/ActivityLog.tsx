import { useLiveQuery } from 'dexie-react-hooks';
import type { TideEvent } from '../db/types';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { recentEvents } from '../lib/eventLog';

// Ported from apps/runway/src/screens/ActivityLog.tsx — the activity log's
// read-only viewer, adapted to Tide. Runway's version also has a "Share
// log" action (native/shareText.ts, @capacitor/share) — deliberately NOT
// ported: Tide has no @capacitor/share dependency and no equivalent native
// module yet, and this increment's brief forbids adding new npm
// dependencies. The viewer itself (what this screen actually exists for —
// reading the log on-device to trace a bug) is full parity; "send it
// somewhere" is a smaller, separable feature that can follow later if
// Deepak wants it.

/** The viewer's own list cap — "the newest N events are retained" (the
 * log's own retention, eventLog.ts's RETAIN_COUNT) and "the last 200 are
 * shown here" are two different numbers on purpose: keeping 2000 rows
 * on-device costs nothing (a few hundred KB at most), but rendering 2000
 * DOM rows on a phone screen would. 200 is generous for what a viewer is
 * actually for — spotting what happened around a specific recent moment,
 * not scrolling the whole history. Same value as Runway's own VIEW_LIMIT. */
const VIEW_LIMIT = 200;

/** Day-boundary key for grouping the reverse-chronological list, in the
 * device's LOCAL calendar day (review fix, 0.5.1). The naive `at.slice(0,10)`
 * this replaced took the UTC date prefix while every event's TIME is rendered
 * local (see the row markup below) — so an event at 00:30 local in a UTC+2
 * summer (stored `...T22:30:00Z`, UTC date one day earlier) landed under the
 * PREVIOUS day's heading, exactly the local-midnight-to-02:00 window a "what
 * happened last night" trace most needs to read correctly. Hand-formatted
 * from local `Date` getters, matching eventLog.ts's formatEventLine (which is
 * also local) so the same event never carries two different dates between
 * this viewer and a report's attached log. */
function dayKey(event: TideEvent): string {
  const d = new Date(event.at);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** "09:41:03" — local wall-clock time for one event row. Hand-formatted from
 * plain `Date` getters rather than date-fns, matching eventLog.ts's and
 * healthSync.ts's own stated choice to avoid pulling date-fns in for a
 * handful of getters (review fix, 0.5.1 — the ported version imported
 * date-fns here, the only date-fns use in Tide's bundle, contradicting those
 * two files' comments). */
function formatEventTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${mi}:${s}`;
}

/** Same inline day-heading format History.tsx/Settings.tsx already use
 * elsewhere in Tide — no shared `formatDateDisplay` helper exists here the
 * way it does in Runway (see this file's header comment). */
function formatDayHeading(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

interface ActivityLogProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * The activity log's viewer — "what did the app do, and when" (see
 * src/lib/eventLog.ts's own header comment for the log's full "DID, not
 * SAW" rule). Reached only from Settings' "View activity log" entry; a pure
 * read-only view.
 */
export function ActivityLog({ onNavigate }: ActivityLogProps) {
  const events = useLiveQuery(() => recentEvents(VIEW_LIMIT), []);

  // Groups the flat, newest-first list into day buckets without re-sorting
  // — `events` is already newest-first (recentEvents' own contract), so a
  // single forward pass preserves that order both across and within groups.
  const groups: { day: string; events: TideEvent[] }[] = [];
  for (const event of events ?? []) {
    const key = dayKey(event);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.day === key) {
      lastGroup.events.push(event);
    } else {
      groups.push({ day: key, events: [event] });
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Activity log" onBack={() => onNavigate({ name: 'settings' })} />
      </div>

      {events?.length === 0 && <p className="text-sm text-slate-500">Nothing logged yet.</p>}

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.day} className="flex flex-col gap-1">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
              {formatDayHeading(group.day)}
            </h2>
            <div className="flex flex-col gap-0.5">
              {group.events.map((event) => (
                <p key={event.id} className="font-mono text-xs text-slate-400">
                  <span className="text-slate-500">
                    {formatEventTime(event.at)} [{event.category}]
                  </span>{' '}
                  {event.message}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
