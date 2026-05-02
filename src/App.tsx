import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Capture } from './Capture';
import { db } from './db/db';
import { weekStartISO } from './lib/time';
import { PastReflections } from './PastReflections';
import { Settings } from './Settings';
import { SkippedNotice } from './SkippedNotice';
import { SundayReflection } from './SundayReflection';
import { TodaysScene } from './TodaysScene';
import type { UserProfile } from './db/types';
import { WhatsBeenSitting } from './WhatsBeenSitting';

type View = 'today' | 'past' | 'settings';

// Top-level views — Today (default), Sunday Reflection (auto-triggered when
// due), Past Reflections (opt-in), Settings (opt-in). Reflection due always
// wins; the opt-in views are reached via the tiny links at the bottom of
// Today.
//
// No router — none of these views need deep links in a single-device,
// no-sync app.
export function App() {
  const [view, setView] = useState<View>('today');

  const profile = useLiveQuery(() => db.userProfile.toCollection().first());
  const reflectionThisWeekCount = useLiveQuery(() =>
    db.weeklyReflections.where('weekStartDate').equals(weekStartISO()).count(),
  );

  const reflectionDue =
    profile != null &&
    reflectionThisWeekCount === 0 &&
    isReflectionTime(profile);

  if (reflectionDue) return <SundayReflection />;
  if (view === 'past') return <PastReflections onBack={() => setView('today')} />;
  if (view === 'settings') return <Settings onBack={() => setView('today')} />;

  return (
    <main className="min-h-dvh max-w-xl mx-auto px-6 py-12 text-ink-soft">
      <SkippedNotice count={profile?.consecutiveSkippedReflections ?? 0} />
      <div className="flex flex-col gap-12">
        <TodaysScene />
        <Capture />
        <WhatsBeenSitting />
        <div className="flex gap-5 text-xs text-ink-fade">
          <button
            type="button"
            onClick={() => setView('past')}
            className="hover:text-ink-mute"
          >
            see past reflections
          </button>
          <button
            type="button"
            onClick={() => setView('settings')}
            className="hover:text-ink-mute"
          >
            settings
          </button>
        </div>
      </div>
    </main>
  );
}

// True if the wall clock is at or past the configured reflection time on the
// configured reflection day. Uses LOCAL time — the configured time is a
// wall-clock time, not a UTC offset.
function isReflectionTime(profile: UserProfile): boolean {
  const now = new Date();
  if (now.getDay() !== profile.reflectionDayOfWeek) return false;

  const [hh, mm] = profile.reflectionTime.split(':').map(Number);
  const due = new Date(now);
  due.setHours(hh ?? 0, mm ?? 0, 0, 0);
  return now >= due;
}
