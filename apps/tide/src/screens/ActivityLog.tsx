import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
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

/** "14 Jul 2026" day-boundary headers between rows of the reverse-
 * chronological list. */
function dayKey(event: TideEvent): string {
  return event.at.slice(0, 10); // ISO date prefix — cheap, exact, and this
  // file never needs to distinguish two events that share a UTC-adjacent
  // instant but different local calendar days, so the ISO-string prefix
  // (not a Date-object local-calendar comparison) is precise enough here.
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
                    {format(new Date(event.at), 'HH:mm:ss')} [{event.category}]
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
