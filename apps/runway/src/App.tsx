import { useEffect, useState } from 'react';
import { Home } from './screens/Home';
import { TemplateEdit } from './screens/TemplateEdit';
import { DepartureSetup } from './screens/DepartureSetup';
import { Runway } from './screens/Runway';
import { History } from './screens/History';
import { ExamOverview } from './screens/ExamOverview';
import { ExamSetup } from './screens/ExamSetup';
import { TopicEdit } from './screens/TopicEdit';
import { SprintSetup } from './screens/SprintSetup';
import { Sprint } from './screens/Sprint';
import { MilestoneEdit } from './screens/MilestoneEdit';
import { setNavigationRef } from './lib/navigationRef';

// Navigation as plain React state, not a router library. There's no
// deep-linkable URL requirement in increment 1 (no shareable departure
// links, no browser back/forward across screens) and only a handful of
// screens — a router would be ceremony without payoff here. If that
// changes later (e.g. "open straight to today's departure" from a
// notification tap), revisit this.
export type Screen =
  | { name: 'home' }
  | { name: 'templateEdit'; id?: string }
  | { name: 'departureSetup'; templateId?: string; departureId?: string }
  | { name: 'runway'; departureId: string }
  | { name: 'history' }
  // Prüfung mode (RUNWAY_PRUFUNG_PLAN.md §4). `examSetup`'s `examId` is
  // optional: omitted means "create" from Home's Prüfung link when no exam
  // exists yet, but ExamSetup itself re-checks for an already-existing
  // exam and edits that instead — see its own comment — because v1 allows
  // exactly one exam and Home's link shouldn't be the only thing enforcing
  // that.
  | { name: 'exam' }
  | { name: 'examSetup'; examId?: string }
  | { name: 'topicEdit'; examId: string }
  // Increment 3: ExamOverview's "Start a sprint" action navigates here —
  // topic → length → start ritual (src/screens/SprintSetup.tsx) — which in
  // turn navigates to the live sprint screen below once a Sprint row
  // exists to point at. `topicId`/`plannedMinutes` (guided-layer increment)
  // are an optional prefill: ExamOverview's next-move card passes both when
  // its "Start" button is tapped, so this screen preselects the suggested
  // topic and length but still requires the start ritual to be completed —
  // the prefill only removes the topic/length decisions, never the ritual
  // gate. Omitted (as from the plain "Start a sprint" button, or the card's
  // own "Choose differently" link) means the ordinary blank form.
  | { name: 'sprintSetup'; topicId?: string; plannedMinutes?: number }
  | { name: 'sprint'; sprintId: string }
  // Increment 4: ExamOverview's "Add milestone" link and each milestone
  // row's "Edit" action both land here — a single list+form screen (see
  // MilestoneEdit's own doc comment for why it isn't split into a separate
  // per-milestone route the way examSetup/topicEdit are).
  | { name: 'milestoneEdit'; examId: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  // Makes `setScreen` reachable from outside the component tree. The actual
  // notification-tap listener is registered in main.tsx, before this
  // component ever mounts (see src/lib/navigationRef.ts for why: it needs
  // to attach as early as possible to have a chance at catching a
  // cold-start tap) — this effect is the other half of that handoff, and
  // also replays any navigation that arrived before this ran.
  useEffect(() => {
    setNavigationRef(setScreen);
    return () => setNavigationRef(null);
  }, []);

  switch (screen.name) {
    case 'home':
      return <Home onNavigate={setScreen} />;
    case 'templateEdit':
      return <TemplateEdit id={screen.id} onNavigate={setScreen} />;
    case 'departureSetup':
      return (
        <DepartureSetup
          templateId={screen.templateId}
          departureId={screen.departureId}
          onNavigate={setScreen}
        />
      );
    case 'runway':
      return <Runway departureId={screen.departureId} onNavigate={setScreen} />;
    case 'history':
      return <History onNavigate={setScreen} />;
    case 'exam':
      return <ExamOverview onNavigate={setScreen} />;
    case 'examSetup':
      return <ExamSetup examId={screen.examId} onNavigate={setScreen} />;
    case 'topicEdit':
      return <TopicEdit examId={screen.examId} onNavigate={setScreen} />;
    case 'sprintSetup':
      return <SprintSetup topicId={screen.topicId} plannedMinutes={screen.plannedMinutes} onNavigate={setScreen} />;
    case 'sprint':
      return <Sprint sprintId={screen.sprintId} onNavigate={setScreen} />;
    case 'milestoneEdit':
      return <MilestoneEdit examId={screen.examId} onNavigate={setScreen} />;
  }
}
