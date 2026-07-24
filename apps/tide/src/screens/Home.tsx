import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { TextAction } from '../ui/TextAction';
import { currentTrend, formatTrendLine, MIN_POINTS } from '../lib/trend';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
}

/** The trend headline is the north star (TIDE_PLAN.md §2/§5) — Home exists
 * almost entirely to show it. Everything else on this screen (the "Add
 * weigh-in" action, the quiet links) is scaffolding around that one
 * number. */
export function Home({ onNavigate }: HomeProps) {
  // Ascending by `at` (the indexed field) so `currentTrend` receives
  // chronological input directly — trendSeries would re-sort it anyway
  // (it makes no ordering assumption about its input), but reading it
  // pre-sorted means there's one less thing to reason about at the call
  // site.
  const weighIns = useLiveQuery(() => db.weighIns.orderBy('at').toArray(), []);

  // `undefined` while useLiveQuery's first read is still pending (Dexie
  // hasn't resolved yet) — distinct from `[]`, an empty table. Rendering
  // nothing in that brief window (rather than flashing the empty state and
  // then the real one) avoids a one-frame flicker on cold start.
  if (weighIns === undefined) {
    return <div className="mx-auto min-h-screen max-w-lg px-4 pt-safe-top" />;
  }

  const trend = currentTrend(weighIns);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
      <header className="pt-12 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.15em] text-slate-500">Tide</p>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        {trend ? (
          <>
            <p className="text-huge font-semibold tracking-tight tabular-nums text-slate-100">
              {trend.smoothedKg.toFixed(1)}
              <span className="text-2xl font-medium text-slate-500"> kg</span>
            </p>
            <p className="text-slate-400">{formatTrendLine(trend)}</p>
          </>
        ) : weighIns.length === 0 ? (
          <p className="max-w-xs text-slate-400">Add your first weigh-in to start the trend.</p>
        ) : (
          // Below the evidence floor (MIN_POINTS) but not empty — an
          // honest "not yet" rather than a fabricated trend line built
          // from too little data. See trend.ts's MIN_POINTS doc comment.
          <p className="max-w-xs text-slate-400">
            {MIN_POINTS - weighIns.length} more weigh-in{MIN_POINTS - weighIns.length === 1 ? '' : 's'} to a trend.
          </p>
        )}
      </section>

      <section className="flex flex-col items-center gap-4">
        <Button onClick={() => onNavigate({ name: 'weighInEntry' })} className="w-full max-w-xs">
          Add weigh-in
        </Button>
        <div className="flex gap-6">
          <TextAction onClick={() => onNavigate({ name: 'history' })}>History</TextAction>
          <TextAction onClick={() => onNavigate({ name: 'settings' })}>Settings</TextAction>
        </div>
      </section>
    </div>
  );
}
