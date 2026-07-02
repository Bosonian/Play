// App root: owns the active tab, the due-card count, and the current mode
// session (Drill/Atlas run full-screen over the shell so they have no bottom
// nav — focus, per §8.3). Navigation is local state, not a router: four
// destinations in a single installed PWA don't need one.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import { STRUCTURES, TRACTS } from './content';
import type { Act, Chapter } from './content/types';
import { generateQuestions, type Question } from './engine/questionGen';
import { isDue } from './lib/date';
import { AppShell } from './ui/AppShell';
import type { Tab } from './ui/BottomNav';
import type { ModeKey } from './ui/NodeSheet';
import { JourneyMap } from './screens/JourneyMap';
import { Today } from './screens/Today';
import { Stats } from './screens/Stats';
import { More } from './screens/More';
import { Drill } from './screens/Drill';
import { Atlas } from './screens/Atlas';
import { tr } from './lib/text';

type Session =
  | { kind: 'drill'; questions: Question[]; title: string }
  | { kind: 'atlas'; crossSectionId: string; title: string };

export function App() {
  const [tab, setTab] = useState<Tab>('map');
  const [session, setSession] = useState<Session | null>(null);

  // Due count = SRS cards whose dueOn is today or earlier. Badges Today; drives
  // the map's CTA. 0 until the first review creates cards.
  const cards = useLiveQuery(() => db.srsCards.toArray(), [], []);
  const dueCount = (cards ?? []).filter((c) => isDue(c.dueOn)).length;

  // Launch a mode from a region (NodeSheet). Only Drill and Atlas are built;
  // the NodeSheet won't enable the others.
  function launch(mode: ModeKey, _act: Act, chapter: Chapter) {
    const title = tr(chapter.title);
    if (mode === 'drill') {
      const questions = generateQuestions({
        structureIds: chapter.structureIds,
        tractIds: chapter.tractIds,
        syndromeIds: chapter.syndromeIds,
      });
      if (questions.length) setSession({ kind: 'drill', questions, title });
    } else if (mode === 'atlas') {
      const id = chapter.crossSectionIds?.[0];
      if (id) setSession({ kind: 'atlas', crossSectionId: id, title });
    }
  }

  // Start the daily review: all currently-due facts, in one Drill. Built from
  // every authored fact, filtered to those with a due SRS card.
  async function startReview() {
    const due = new Set(
      (await db.srsCards.toArray())
        .filter((c) => isDue(c.dueOn))
        .map((c) => c.factId),
    );
    if (due.size === 0) return;
    const questions = generateQuestions({
      structureIds: STRUCTURES.map((s) => s.id),
      tractIds: TRACTS.map((t) => t.id),
    }).filter((q) => due.has(q.factId));
    if (questions.length) {
      setSession({ kind: 'drill', questions, title: 'Review' });
    }
  }

  // A mode session takes the whole screen.
  if (session) {
    const exit = () => setSession(null);
    return (
      <div className="mx-auto h-full max-w-md bg-bg text-fg">
        {session.kind === 'drill' ? (
          <Drill questions={session.questions} title={session.title} onExit={exit} />
        ) : (
          <Atlas
            crossSectionId={session.crossSectionId}
            title={session.title}
            onExit={exit}
          />
        )}
      </div>
    );
  }

  return (
    <AppShell active={tab} onTabChange={setTab} dueCount={dueCount}>
      {tab === 'map' && (
        <JourneyMap
          dueCount={dueCount}
          onGoToday={() => setTab('today')}
          onLaunch={launch}
        />
      )}
      {tab === 'today' && (
        <Today
          dueCount={dueCount}
          onStartReview={startReview}
          onGoMap={() => setTab('map')}
        />
      )}
      {tab === 'stats' && <Stats />}
      {tab === 'more' && <More />}
    </AppShell>
  );
}
