// App root: owns the active tab and the due-card count that badges Today, and
// renders the shell around whichever screen is active. Navigation is simple
// local state (not a router) — there are four destinations and the app is a
// single installed PWA, so a router would be overhead. Deep-linking isn't a
// v1 need.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import { AppShell } from './ui/AppShell';
import type { Tab } from './ui/BottomNav';
import { JourneyMap } from './screens/JourneyMap';
import { Today } from './screens/Today';
import { Stats } from './screens/Stats';
import { More } from './screens/More';

export function App() {
  const [tab, setTab] = useState<Tab>('map');

  // Due count badges the Today tab. No SRS cards exist in Increment 1, so this
  // resolves to 0 (the query is here so it's live-correct once the SRS engine
  // starts creating cards in Increment 3).
  const dueCount =
    useLiveQuery(() => db.srsCards.count(), [], 0) ?? 0;

  return (
    <AppShell active={tab} onTabChange={setTab} dueCount={dueCount}>
      {tab === 'map' && (
        <JourneyMap dueCount={dueCount} onGoToday={() => setTab('today')} />
      )}
      {tab === 'today' && <Today onGoMap={() => setTab('map')} />}
      {tab === 'stats' && <Stats />}
      {tab === 'more' && <More />}
    </AppShell>
  );
}
