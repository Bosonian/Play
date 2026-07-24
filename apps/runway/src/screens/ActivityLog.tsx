import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import type { RunwayEvent } from '../db/types';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { formatEventLine, recentEvents } from '../lib/eventLog';
import { formatDateDisplay } from '../lib/format';
import { shareWitnessText } from '../native/shareText';

/** The viewer's own list cap — "the newest N events are retained" (the
 * log's own retention) and "the last 200 are shown here" are two different
 * numbers on purpose: keeping 2000 rows on-device costs nothing (a few
 * hundred KB at most), but rendering 2000 DOM rows on a phone screen would.
 * 200 is generous for what a viewer is actually for — spotting what
 * happened around a specific recent moment, not scrolling the whole
 * history. */
const VIEW_LIMIT = 200;

/** What "Share log" hands to the OS share sheet — a wider window than the
 * viewer shows, because a shared log is meant to travel to someone (or into
 * a bug report thread) who wasn't looking at the screen a moment ago and
 * may need more context than the last 200 lines on it. */
const SHARE_LIMIT = 500;

/** "14 Jul 2026" day-boundary headers between rows of the reverse-
 * chronological list — reuses formatDateDisplay's own "Wed d MMM" form
 * rather than inventing a new one, same as every other date-boundary
 * heading in this app. */
function dayKey(event: RunwayEvent): string {
  return event.at.slice(0, 10); // ISO date prefix — cheap, exact, and this
  // file never needs to distinguish two events that share a UTC-adjacent
  // instant but different local calendar days, so the ISO-string prefix
  // (not a Date-object local-calendar comparison) is precise enough here.
}

interface ActivityLogProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * The activity log's viewer — "what did the app do, and when" (see
 * src/lib/eventLog.ts's own header comment for the log's full "DID, not
 * SAW" rule). Reached only from Settings' "Activity log" section; a pure
 * read-only view, same shape as Learning.tsx.
 */
export function ActivityLog({ onNavigate }: ActivityLogProps) {
  const events = useLiveQuery(() => recentEvents(VIEW_LIMIT), []);

  const [shareUnavailable, setShareUnavailable] = useState(false);

  async function handleShare() {
    setShareUnavailable(false);
    // Reuses shareWitnessText (native/shareText.ts) exactly as the witness
    // increment's "Tell someone"/"Tell them" actions do — see that file's
    // own doc comment for why on desktop web this means "copied to the
    // clipboard", not an actual OS share sheet.
    const shareEvents = await recentEvents(SHARE_LIMIT);
    const text = shareEvents.map(formatEventLine).join('\n');
    const result = await shareWitnessText(text);
    if (result === 'unavailable') setShareUnavailable(true);
  }

  // Groups the flat, newest-first list into day buckets without re-sorting
  // — `events` is already newest-first (recentEvents' own contract), so a
  // single forward pass preserves that order both across and within groups.
  const groups: { day: string; events: RunwayEvent[] }[] = [];
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

      <TextAction onClick={() => void handleShare()} className="self-start">
        Share log
      </TextAction>
      {shareUnavailable && <p className="text-sm text-slate-500">Sharing is not available here.</p>}

      {events?.length === 0 && <p className="text-sm text-slate-500">Nothing logged yet.</p>}

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.day} className="flex flex-col gap-1">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
              {formatDateDisplay(new Date(`${group.day}T00:00:00`))}
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
