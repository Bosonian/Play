import { useEffect, useState } from 'react';
import { Home } from './screens/Home';
import { TemplateEdit } from './screens/TemplateEdit';
import { DepartureSetup } from './screens/DepartureSetup';
import { Runway } from './screens/Runway';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { ExamOverview } from './screens/ExamOverview';
import { ExamSetup } from './screens/ExamSetup';
import { TopicEdit } from './screens/TopicEdit';
import { SprintSetup } from './screens/SprintSetup';
import { Sprint } from './screens/Sprint';
import { MilestoneEdit } from './screens/MilestoneEdit';
import { ReportProblem } from './screens/ReportProblem';
import { TaskSetup } from './screens/TaskSetup';
import { TaskRun } from './screens/TaskRun';
import { setNavigationRef } from './lib/navigationRef';

// Navigation as plain React state, not a router library. There's no
// deep-linkable URL requirement in increment 1 (no shareable departure
// links, no browser back/forward across screens) and only a handful of
// screens — a router would be ceremony without payoff here. If that
// changes later (e.g. "open straight to today's departure" from a
// notification tap), revisit this.
export type Screen =
  | { name: 'home' }
  // `fromDepartureId` (field report #10 §3, "Make repeating"): set only by
  // Home's "Make repeating" TextAction on a planned departure card whose
  // `templateId` is null — see TemplateEdit's own doc comment on the
  // `sourceDeparture` query for how it's used. Mutually exclusive with `id`
  // by construction (Home never passes both).
  | { name: 'templateEdit'; id?: string; fromDepartureId?: string }
  // `prefillName`/`prefillDestination`/`prefillAppointmentIso` (calendar/
  // share-target increment, E1): applied ONCE as DepartureSetup's initial
  // form values on CREATE only, never on an edit (departureId set) — same
  // one-shot shape as the existing templateId prefill, see DepartureSetup's
  // own comment on its lazy useState initializers. Two independent
  // callers pass these: Home's "Plan departure" action on a calendar event
  // (name + appointmentAt, no destination — a calendar event's location
  // field, when present, is shown on the card itself but deliberately not
  // pushed into the destination field sight-unseen, see Home.tsx) and the
  // share-target deep link (destination only, from
  // src/lib/shareTarget.ts's parseSharedDestination).
  // `prefillDate`/`prefillTimeMissing` (quick-capture increment, E2): the
  // capture box's third caller into this same prefill mechanism. Gemini
  // parsed a date but heard no time — the honest reading of "no time in
  // the sentence" is an empty time field to fill in by hand, not a
  // fabricated default (see geminiApi.ts's buildCaptureRequest comment on
  // why inventing one is worse), so this is a DIFFERENT shape from
  // prefillAppointmentIso rather than that ISO string with a fake
  // 00:00/09:00 time baked in: `prefillDate` fills only the date input,
  // `prefillTimeMissing` tells DepartureSetup to show the "No time was
  // heard" note instead of silently leaving the time blank with no
  // explanation. Home's capture-box handler picks ONE of
  // prefillAppointmentIso or prefillDate+prefillTimeMissing depending on
  // whether Gemini returned a time — never both.
  // `prefillRepeatDays` (field report #10 §2): Home's "Plan departure" on a
  // calendar card whose event RRULE parsed (src/lib/rrule.ts) as a plain
  // weekly rule — the ISO weekday numbers it parsed to, pre-enabling
  // DepartureSetup's create-only Repeat section. See DepartureSetup's own
  // prop doc comment for the rest.
  | {
      name: 'departureSetup';
      templateId?: string;
      departureId?: string;
      prefillName?: string;
      prefillDestination?: string;
      prefillAppointmentIso?: string;
      prefillDate?: string;
      prefillTimeMissing?: boolean;
      prefillRepeatDays?: number[];
    }
  | { name: 'runway'; departureId: string }
  | { name: 'history' }
  // Live-travel increment (RUNWAY_PLAN.md §5.1+§5.6): the Routes API key and
  // the "use live travel" toggle, reached from Home's quiet "Settings" link
  // beside History/Prüfung.
  | { name: 'settings' }
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
  | { name: 'milestoneEdit'; examId: string }
  // Field-reports increment: the in-app "Report a problem" form, reached
  // from a quiet link on Home and on Settings. `fromScreen` carries which
  // of the two it was opened from — both the screenshot-less context this
  // screen writes onto the saved FieldReport (db/types.ts's `screenName`)
  // and where "back" (and the post-save navigate) return to.
  | { name: 'report'; fromScreen: string }
  // Tasks increment: timed work without travel — "befunden 5 EEGs before
  // the 16:00 Übergabe." `taskSetup` is create-only (see TaskSetup.tsx's
  // own doc comment on why there's no `taskId` to edit an existing one);
  // `task` is the live screen, TaskRun.tsx, mirroring `runway`'s own
  // `departureId` shape.
  | { name: 'taskSetup' }
  | { name: 'task'; taskId: string };

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

  function renderScreen() {
    switch (screen.name) {
      case 'home':
        return <Home onNavigate={setScreen} />;
      case 'templateEdit':
        return <TemplateEdit id={screen.id} fromDepartureId={screen.fromDepartureId} onNavigate={setScreen} />;
      case 'departureSetup':
        return (
          <DepartureSetup
            templateId={screen.templateId}
            departureId={screen.departureId}
            prefillName={screen.prefillName}
            prefillDestination={screen.prefillDestination}
            prefillAppointmentIso={screen.prefillAppointmentIso}
            prefillDate={screen.prefillDate}
            prefillTimeMissing={screen.prefillTimeMissing}
            prefillRepeatDays={screen.prefillRepeatDays}
            onNavigate={setScreen}
          />
        );
      case 'runway':
        return <Runway departureId={screen.departureId} onNavigate={setScreen} />;
      case 'history':
        return <History onNavigate={setScreen} />;
      case 'settings':
        return <Settings onNavigate={setScreen} />;
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
      case 'report':
        return <ReportProblem fromScreen={screen.fromScreen} onNavigate={setScreen} />;
      case 'taskSetup':
        return <TaskSetup onNavigate={setScreen} />;
      case 'task':
        return <TaskRun taskId={screen.taskId} onNavigate={setScreen} />;
    }
  }

  // UI-polish increment, motion item 1: a 150ms opacity fade on every screen
  // change — `key={screen.name}` forces React to tear down and remount this
  // wrapper (not its children's own internal state, which screens manage
  // themselves) on every navigation, which is what restarts the CSS
  // animation each time rather than it only playing once on first mount.
  // `motion-safe:` (see tailwind.config.ts) means a reduced-motion user gets
  // the new screen at full opacity immediately, with no animation property
  // applied at all.
  return (
    <div key={screen.name} className="motion-safe:animate-fade-in">
      {renderScreen()}
    </div>
  );
}
