import { useEffect, useRef, useState } from 'react';
import { Home } from './screens/Home';
import { TemplateEdit } from './screens/TemplateEdit';
import { DepartureSetup } from './screens/DepartureSetup';
import { Runway } from './screens/Runway';
import { History } from './screens/History';
import { Learning } from './screens/Learning';
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
import { ActivityLog } from './screens/ActivityLog';
import { setNavigationRef } from './lib/navigationRef';
import { registerBackGesture } from './native/backGesture';
import { refreshDayGauge } from './lib/dayGaugeRefresh';
import { logEvent } from './lib/eventLog';

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
  // Learning-transparency screen: what Runway has learned from real runs —
  // per-name step/task estimates, rushed-compression floors, the out-the-
  // door slip median, the measured Prüfung pace. Reached only from
  // History's own foot (see History.tsx's comment on that placement), so it
  // has no create/prefill props of its own — it's a pure read-only view.
  | { name: 'learning' }
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
  // `autoSuggest` (Prüfung rework 2): set only by a tapped study-block
  // alarm's notification-tap handler (main.tsx), which has no topicId/
  // plannedMinutes of its own to prefill with the way ExamOverview's
  // next-move card does above — SprintSetup computes the same suggestion
  // itself once its topics/sprints/exam queries resolve (see its own
  // `autoSuggest` prop comment). Mutually exclusive with topicId/
  // plannedMinutes in practice, since the two prefill mechanisms have
  // exactly one caller each.
  | { name: 'sprintSetup'; topicId?: string; plannedMinutes?: number; autoSuggest?: boolean }
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
  //
  // `capturedTaskId` (anti-rot increment 2, 0.38.0): set only by Home's "To
  // arm" shelf card tap — puts TaskSetup into PROMOTE mode, arming an
  // existing name-only 'captured' row (units/deadline UPDATE the same row,
  // never a second `db.tasks.add`) instead of creating a new one. Still not
  // a general edit path — see TaskSetup.tsx's own doc comment for why this
  // is a narrower thing than `departureSetup`'s optional `departureId`.
  | { name: 'taskSetup'; capturedTaskId?: string }
  | { name: 'task'; taskId: string }
  // Activity-log increment: the on-device event viewer, reached from
  // Settings' "View activity log" TextAction — a pure read-only view, no
  // create/prefill props of its own, same shape as `learning` above.
  | { name: 'activityLog' };

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

  // Android back-gesture support (field bug: "navigating with swipe doesn't
  // work" — see src/native/backGesture.ts for the full mechanism). Kept
  // separate from the navigationRef effect above rather than folded into
  // it: that one hands App's setter to code OUTSIDE the component tree that
  // needs to push navigations in (notification taps, deep links);
  // registerBackGesture needs the OPPOSITE direction — live read access to
  // whichever screen is current — so it needs its own effect regardless of
  // whether the two ever run at the same time.
  //
  // `screenRef` exists because the native listener is registered once (an
  // async `App.addListener` call, not re-run on every navigation) but must
  // always see the CURRENT screen when a back gesture actually fires —
  // capturing `screen` directly in the closure below would freeze it at
  // whatever screen was active the instant this effect first ran. Updated
  // on every render (no dependency array of its own, deliberately: a ref
  // write is not a state update, so this line does not cause a re-render
  // itself) rather than only inside the registration effect, so the ref is
  // always fresh regardless of render timing relative to registration.
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void registerBackGesture(() => screenRef.current, setScreen).then((unregister) => {
      // StrictMode double-invoke safe: if this effect instance was already
      // cleaned up (React unmounted it before the async `addListener` call
      // resolved) by the time the promise settles, undo the registration
      // immediately instead of leaking a listener this instance no longer
      // owns — same guard shape registerNotificationNavigation's own caller
      // pattern relies on in main.tsx, just inlined here since this is a
      // mount effect rather than a top-level module call.
      if (cancelled) {
        unregister();
      } else {
        cleanup = unregister;
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Day-gauge increment (0.31.0): the one refreshDayGauge() trigger that
  // has no refreshWidgets() equivalent (see main.tsx's own comment on the
  // pairing rule for why every OTHER trigger is just "wherever refreshWidgets
  // already is"). A home-screen widget self-heals on its own even with the
  // app fully closed — Android redraws it roughly every 6 hours regardless
  // (see widgetSnapshot.ts's own "widget expiry rules are evaluated at
  // redraw" note) — but the day gauge's native chronometer has no such
  // built-in tick: once posted, it counts down (and then up, or negative)
  // with zero further OS-side awareness of whether the target it's counting
  // toward is still the right one. "The app was reopened" has to be an
  // explicit trigger for that reason, even on a resume where nothing was
  // necessarily written to Dexie in between. This is App.tsx's own mount
  // effect (there's no other central "app resumed" hook — Home.tsx's and
  // Runway.tsx's own visibilitychange listeners are both scoped to their
  // own screen-local concerns, calendar reads and live travel, not a
  // whole-app resume signal) rather than folded into the back-gesture
  // effect above, for the same "different direction, different concern"
  // reasoning that effect's own comment gives for staying separate from the
  // navigationRef effect.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refreshDayGauge();
        void logEvent('lifecycle', 'App resumed.');
      } else {
        void logEvent('lifecycle', 'App backgrounded.');
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
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
      case 'learning':
        return <Learning onNavigate={setScreen} />;
      case 'settings':
        return <Settings onNavigate={setScreen} />;
      case 'exam':
        return <ExamOverview onNavigate={setScreen} />;
      case 'examSetup':
        return <ExamSetup examId={screen.examId} onNavigate={setScreen} />;
      case 'topicEdit':
        return <TopicEdit examId={screen.examId} onNavigate={setScreen} />;
      case 'sprintSetup':
        return (
          <SprintSetup
            topicId={screen.topicId}
            plannedMinutes={screen.plannedMinutes}
            autoSuggest={screen.autoSuggest}
            onNavigate={setScreen}
          />
        );
      case 'sprint':
        return <Sprint sprintId={screen.sprintId} onNavigate={setScreen} />;
      case 'milestoneEdit':
        return <MilestoneEdit examId={screen.examId} onNavigate={setScreen} />;
      case 'report':
        return <ReportProblem fromScreen={screen.fromScreen} onNavigate={setScreen} />;
      case 'taskSetup':
        return <TaskSetup capturedTaskId={screen.capturedTaskId} onNavigate={setScreen} />;
      case 'task':
        return <TaskRun taskId={screen.taskId} onNavigate={setScreen} />;
      case 'activityLog':
        return <ActivityLog onNavigate={setScreen} />;
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
