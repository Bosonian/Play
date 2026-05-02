import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Capture } from './Capture';
import { db } from './db/db';
import { weekStartISO } from './lib/time';
import { PastReflections } from './PastReflections';
import { SkippedNotice } from './SkippedNotice';
import { SundayReflection } from './SundayReflection';
import { TodaysScene } from './TodaysScene';
import type { UserProfile } from './db/types';
import { WhatsBeenSitting } from './WhatsBeenSitting';

// Three top-level views — Today (default), Sunday Reflection (auto-triggered
// when due), Past Reflections (opt-in via the tiny link). Reflection due
// always wins; if the user is in the middle of viewing past reflections and
// the clock crosses 19:00 on Sunday, they'll get the dialog on next reload.
//
// No router — two views and a modal-ish overlay don't justify the dependency,
// and there's no use case for deep links in a single-device, no-sync app.
export function App() {
  const [view, setView] = useState<'today' | 'past'>('today');

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

  return (
    <main className="min-h-dvh max-w-xl mx-auto px-6 py-12 text-ink-soft">
      <SkippedNotice count={profile?.consecutiveSkippedReflections ?? 0} />
      <div className="flex flex-col gap-12">
        <TodaysScene />
        <Capture />
        <WhatsBeenSitting />
        <button
          type="button"
          onClick={() => setView('past')}
          className="self-start text-xs text-ink-fade hover:text-ink-mute"
        >
          see past reflections
        </button>
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
