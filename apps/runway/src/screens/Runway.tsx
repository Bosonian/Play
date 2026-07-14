import { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Departure, DepartureStep } from '../db/types';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Button } from '../ui/Button';
import { computeProjection } from '../lib/projection';
import type { Projection } from '../lib/projection';
import { currentStepAnchor, currentStepElapsed } from '../lib/currentStepElapsed';
import { useNow } from '../hooks/useNow';
import { StepFocus } from './StepFocus';
import { formatAppointmentLine, formatSlackLine, formatTime, formatTimeInput } from '../lib/format';
import { allowSleep, keepAwake } from '../native/keepAwake';
import { hapticImpact } from '../native/haptics';
import { cancelDepartureAlarms, scheduleDepartureAlarms } from '../native/notifications';
import { readLiveTravelConfig } from '../lib/liveTravelSettings';
import { useLiveTravel } from '../hooks/useLiveTravel';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from '../lib/dayGaugeRefresh';
import { compressPlan, suggestNewTarget } from '../lib/replan';
import type { CompressResult } from '../lib/replan';
import { learnedRushedFloor, rushedActualsByStepName } from '../lib/learning';
import { applyAutoLearn } from '../lib/autoLearn';
import { TextField } from '../ui/TextField';
import { TextAction } from '../ui/TextAction';
import { BackdateDialog } from '../ui/BackdateDialog';
import { getCurrentSsid } from '../native/wifi';
import { nextOccurrenceOf } from '../lib/nextOccurrence';
import { pushBackOverride } from '../lib/backOverride';
import { logEvent } from '../lib/eventLog';
import { arrivalPreviewLine } from '../lib/strandedArrival';

/** Same confirm copy as Home's "Remove" action on a planned departure (M1) —
 * abandoning from either screen is the same operation with the same
 * consequence, so it should read as the same sentence in both places. */
const ABANDON_CONFIRM = 'Remove this departure? Its alarms are cancelled.';

/** Google Maps turn-by-turn URL — no API key needed, Android routes this to
 * the Maps app when one's installed. Shared by both handoff points (leave
 * block and the post-departure confirmation). */
function mapsUrl(destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

interface RunwayProps {
  departureId: string;
  onNavigate: (screen: Screen) => void;
}

const TERMINAL_STATUSES: Departure['status'][] = ['left', 'done', 'abandoned'];

// State -> accent classes for the parts of the screen that shift
// calm/tight/late (RUNWAY_PLAN.md §5.2: "obvious at a glance ... not
// theatrical" - so this only ever touches text/border color, never
// backgrounds, icons or motion).
const STATE_TEXT: Record<Projection['state'], string> = {
  calm: 'text-slate-100',
  tight: 'text-amber-400',
  late: 'text-red-400',
};

const STATE_BORDER: Record<Projection['state'], string> = {
  calm: 'border-slate-800',
  tight: 'border-amber-700/60',
  late: 'border-red-700/60',
};

export function Runway({ departureId, onNavigate }: RunwayProps) {
  const departure = useLiveQuery(() => db.departures.get(departureId), [departureId]);
  const now = useNow(1000);
  const liveTravelConfig = useLiveQuery(() => readLiveTravelConfig(), []);

  // Live-travel increment (RUNWAY_PLAN.md §5.1+§5.6): only while a run is
  // actually under way, the feature is on, and there's a destination to
  // route to — matches the increment spec's three gating conditions
  // exactly. Called unconditionally (before the `if (!departure) return`
  // guard below) because React hooks can't be called conditionally; the
  // hook itself no-ops internally whenever `enabled` is false.
  const liveTravelActive =
    departure?.status === 'running' && !!liveTravelConfig?.enabled && departure.destination.trim() !== '';
  const liveTravel = useLiveTravel(
    departure ? { id: departure.id, destination: departure.destination } : undefined,
    { enabled: liveTravelActive, apiKey: liveTravelConfig?.apiKey ?? '' },
  );

  // "I'm out the door" flips status to 'left' immediately, so calibration
  // data (leftAt) is correct even if the tab closes right after the tap -
  // but the richer one-time copy ("Logged 14:32. Safe travels.") is only
  // right in the instant it happens. Reopening an already-'left' departure
  // later should show the plain terminal note instead. Local state (not
  // the persisted status) is what distinguishes those two moments.
  const [justLeft, setJustLeft] = useState(false);

  // F1 ("Replan from now" — recover-instead-of-forfeit spec): whether the
  // inline confirmation block is open. Deliberately plain component state,
  // not persisted anywhere — closing the screen (or the departure finishing)
  // discards it, which is correct: this is a one-shot "does this diff look
  // right, right now" decision, not something that should reopen stale on a
  // later visit.
  const [replanOpen, setReplanOpen] = useState(false);

  // Re-anchor panel's time input (leaveBy-has-passed spec). `null` means
  // "no user edit yet - keep showing the live suggested default", which is
  // what lets the prefilled value stay a genuine live suggestion (it tracks
  // `now` and re-rounds every 5 minutes) right up until the user actually
  // types or picks something themselves - the same "state starts as an
  // override, not a copy of the default" shape a plain useState(defaultVal)
  // would NOT give: with a copy, the field would freeze at whatever the
  // suggestion happened to be on first render instead of staying honest as
  // time passes. Reset on close (below) so reopening the panel later starts
  // from a fresh suggestion rather than an unrelated stale edit.
  const [reanchorValue, setReanchorValue] = useState<string | null>(null);
  const [reanchorTouched, setReanchorTouched] = useState(false);
  useEffect(() => {
    if (!replanOpen) {
      setReanchorValue(null);
      setReanchorTouched(false);
    }
  }, [replanOpen]);

  // Personalized compression floors (learning increment §4): this
  // departure's template's OWN history of compressed (wasReplanned) runs,
  // read lazily - only while the replan panel is actually open, per the
  // spec's "lazy, on panel open" - rather than on every render of a screen
  // that already re-renders every second (useNow above). templateId isn't
  // an indexed field (same tradeoff as materialize.ts/autoLearn.ts), so
  // this loads the whole table and filters in JS; acceptable here because
  // it only runs while the panel is open, not on every tick.
  const replanFloorsSource = useLiveQuery(async () => {
    if (!replanOpen || departure?.templateId == null) return undefined;
    const all = await db.departures.toArray();
    return all.filter((d) => d.templateId === departure.templateId);
  }, [replanOpen, departure?.templateId]);

  const replanFloorsByStepName = useMemo(() => {
    if (!replanFloorsSource) return undefined;
    const rushedByName = rushedActualsByStepName(replanFloorsSource);
    const floors = new Map<string, number>();
    for (const [name, actuals] of rushedByName) {
      const floor = learnedRushedFloor(actuals);
      if (floor !== null) floors.set(name, floor);
    }
    return floors;
  }, [replanFloorsSource]);

  // Step-focus increment: which step (if any) the full-screen countdown
  // overlay is showing. Deliberately plain component state, not a routed
  // Screen (see App's Screen union, untouched by this increment) - the
  // overlay is a LENS over this live departure, not a place with its own
  // identity or deep link. Clearing it is just `setFocusStepId(null)`;
  // there is no "navigate back" involved, which is also why StepFocus is
  // rendered as a sibling overlay below rather than something onNavigate
  // ever points at.
  const [focusStepId, setFocusStepId] = useState<string | null>(null);

  // Backdating increment: whether each of the three "quiet correction"
  // dialogs is open. Three separate flags, not one shared "which dialog"
  // enum, because up to two of these genuinely can be relevant to the same
  // render in principle (StepFocus's handoff closes the focus overlay and
  // opens `stepBackdateOpen` in the same tap) and a single enum would force
  // an arbitrary priority order between them for no benefit. `stepBackdateOpen`
  // is shared between the prep current-step card and the arrival-phase
  // current-step card (below) rather than split in two, because the two
  // branches are mutually exclusive renders of this same component (the
  // arrival branch is an early `return` — see `arrivalPhaseActive` below) —
  // there is never a render where both cards exist to be confused with each
  // other. Deliberately plain component state, not persisted: same
  // "one-shot decision, not something that should reopen stale" reasoning
  // as `replanOpen` above.
  const [stepBackdateOpen, setStepBackdateOpen] = useState(false);
  const [leaveBackdateOpen, setLeaveBackdateOpen] = useState(false);
  const [arrivedBackdateOpen, setArrivedBackdateOpen] = useState(false);

  // Arrival-steps increment: whether this departure has an arrival-phase
  // checklist at all — computed here (not further down, past the
  // `if (!departure) return` guard) because the two effects immediately
  // below both need it, and hooks can't be called conditionally. `?? []`
  // is the same undefined-as-null read every other late-added Departure
  // field gets throughout this app.
  const hasArrivalSteps = !!departure && (departure.arrivalSteps ?? []).length > 0;
  const arrivalPhaseActive = departure?.status === 'left' && hasArrivalSteps;

  // Defensive clear: if the departure stops being in a state that can
  // honestly show a focused step (left/abandoned with nothing to focus,
  // edited away, or - arrival-steps increment - moved on to 'done' from the
  // arrival phase) while this screen happens to be open, the overlay has
  // nothing honest left to show. A step is focusable in exactly two states
  // now: 'running' (prep steps, unchanged from before this increment) or
  // 'left' with arrival steps present (arrival steps, this increment) - and
  // only while the focused id still exists in whichever list matches that
  // state. Runs on every departure/focusStepId change rather than only at
  // specific transitions, since either can happen from outside this
  // component (Dexie's live query, not user action here).
  useEffect(() => {
    if (focusStepId === null) return;
    if (!departure) return;
    if (departure.status === 'running') {
      if (!departure.steps.some((s) => s.id === focusStepId)) setFocusStepId(null);
      return;
    }
    if (arrivalPhaseActive) {
      if (!(departure.arrivalSteps ?? []).some((s) => s.id === focusStepId)) setFocusStepId(null);
      return;
    }
    setFocusStepId(null);
  }, [departure, focusStepId, arrivalPhaseActive]);

  // Back-gesture support: while StepFocus is open (either the prep or the
  // arrival-phase variant — both share this one `focusStepId` flag), a
  // back gesture must close the overlay, not navigate the screen underneath
  // it — same "lens over the live departure, not a place of its own"
  // reasoning as focusStepId's own comment above, now also true for
  // Android's back gesture (src/native/backGesture.ts), not just the
  // overlay's own visible back chevron. Registered/unregistered in an
  // effect keyed on `focusStepId !== null` rather than on mount/unmount of
  // this whole screen: the override must exist ONLY while the overlay is
  // actually on screen, and this component stays mounted well past any
  // single overlay open/close.
  useEffect(() => {
    if (focusStepId === null) return;
    return pushBackOverride(() => setFocusStepId(null));
  }, [focusStepId]);

  // Keep the screen on for exactly as long as a run is live - 'running'
  // (prep), unchanged from before this increment, OR (arrival-steps
  // increment) 'left' with an arrival-phase checklist actually on screen.
  // Keyed on status/arrivalPhaseActive rather than just mount/unmount
  // because this component stays mounted across the 'running' -> 'left'
  // transition (the justLeft confirmation is rendered by this same
  // component) — the cleanup here is what releases the lock the instant
  // neither condition holds any more, whether that's because the departure
  // finished or because the screen itself unmounts (React runs cleanups in
  // both cases).
  useEffect(() => {
    if (departure?.status !== 'running' && !arrivalPhaseActive) return;
    void keepAwake();
    return () => {
      void allowSleep();
    };
  }, [departure?.status, arrivalPhaseActive]);

  // Arrival-detection increment (Wi-Fi path, 0.23.0): whether this
  // departure's journey phase should be polling for its configured arrival
  // Wi-Fi network right now — the same journey-phase gate the manual "I'm
  // at the building" button uses (arrivalPhaseActive, not yet arrived),
  // plus a non-empty `arrivalWifiSsid` actually configured on this
  // departure. `?? ''` covers a departure saved before this field existed,
  // same undefined-as-null treatment as every other late-added Departure
  // field.
  const arrivalWifiTarget = (departure?.arrivalWifiSsid ?? '').trim();
  const wifiDetectionActive = arrivalPhaseActive && departure?.arrivedAt == null && arrivalWifiTarget !== '';

  // Polls getCurrentSsid() (src/native/wifi.ts) on mount and every time the
  // tab regains visibility — the moment a phone screen typically wakes back
  // up after being locked for the drive — rather than on a timer: there is
  // no native "just joined this network" event wired up here, only a
  // one-shot SSID read (see wifi.ts's own comment on why that's the
  // deliberately conservative choice), so polling at the moments the app is
  // actually being looked at is the honest substitute. A match stamps
  // `arrivedAt` with the EXACT SAME write handleArrived below uses, so a
  // Wi-Fi-detected arrival and a manually-tapped one are indistinguishable
  // to every downstream reader (calibration, History, this screen's own
  // arrival-phase UI) — this is an ADDITIONAL path to the same write, never
  // a second source of truth. The manual button stays visible regardless
  // (see its own JSX below): Wi-Fi detection can fail to associate in time,
  // the screen can stay off past both poll moments, or the SSID can simply
  // be mistyped, and the button is the honest fallback for all three. This
  // effect self-disarms the instant arrival is recorded, whichever path
  // recorded it — `wifiDetectionActive` goes false on the next render, and
  // the cleanup below removes the listener.
  useEffect(() => {
    if (!wifiDetectionActive || !departure) return;
    let cancelled = false;
    const target = arrivalWifiTarget.toLowerCase();
    const checkNow = async () => {
      const ssid = await getCurrentSsid();
      if (cancelled || ssid === null) return;
      if (ssid.trim().toLowerCase() !== target) return;
      void hapticImpact('light');
      await db.departures.update(departure.id, { arrivedAt: new Date().toISOString() });
      void logEvent('arrival', `Arrival detected via Wi-Fi: ${departure.name}.`);
    };
    void checkNow();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkNow();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [wifiDetectionActive, departure?.id, arrivalWifiTarget]);

  if (!departure) {
    // Still loading from Dexie (or a stale id) - nothing to show yet.
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
        <div className="pt-8">
          <ScreenHeader title="Runway" onBack={() => onNavigate({ name: 'home' })} />
        </div>
      </div>
    );
  }

  // Live-travel display line (increment spec §5): omitted entirely when the
  // feature isn't active for this departure right now (`null`); otherwise
  // one of two exact copy strings depending on whether the most recent
  // fetch succeeded. `liveMinutes ?? departure.travelMinutes` in the
  // failure branch means a departure that's never had a successful fetch
  // yet still shows a real number (the manual estimate already in use for
  // the projection above) rather than a blank.
  const liveTravelLine = !liveTravelActive
    ? null
    : liveTravel.liveMinutes !== null && !liveTravel.failed
      ? `Travel ${liveTravel.liveMinutes} min · live, updated ${formatTime(liveTravel.updatedAt!)}`
      : liveTravel.failed
        ? `Travel ${liveTravel.liveMinutes ?? departure.travelMinutes} min · live update unavailable`
        : null; // first fetch of this mount hasn't resolved yet - nothing to show

  // Arrow functions assigned to `const`, not `function` declarations: a
  // hoisted function declaration loses TS's narrowing of `departure` (from
  // the `if (!departure) return` guard above) because hoisting means it
  // could, in principle, run before the guard. A `const` closure created
  // after the guard keeps the narrowed (non-undefined) type.
  // Per-step transactional flip via Dexie's `.modify()`, not a whole-array
  // read-modify-write - two fast taps (different steps, or the same step
  // twice) otherwise race: both reads see the same stale `departure.steps`
  // from the closure, and whichever write lands second silently clobbers
  // the first tap's change. `.modify()` runs its callback inside Dexie's
  // own transaction against the current row, so each tap reads fresh state
  // no matter how close together they land (M5).
  //
  // Checking a step also implies starting the run if the departure is
  // still 'planned' - diving straight into the checklist without pressing
  // "Start getting ready" first is a forgivable shortcut, not an error
  // state, and folding the status/startedAt transition into the same
  // `.modify()` call as M3's `handleStart` avoids a second race between
  // "did this tap start the run" and "did this tap check the step".
  const toggleStep = async (step: DepartureStep) => {
    void hapticImpact('light');
    // Read before the write below — checking the first step of a still-
    // 'planned' departure is a forgivable-shortcut start (see this
    // function's own comment above), and that transition is exactly as
    // real a "running" event as the explicit Start button (handleStart).
    const wasPlanned = departure.status === 'planned';
    await db.departures.where('id').equals(departure.id).modify((d) => {
      if (d.status === 'planned') {
        d.status = 'running';
        d.startedAt = d.startedAt ?? new Date().toISOString();
      }
      const s = d.steps.find((x) => x.id === step.id);
      if (s) s.checkedAt = s.checkedAt === null ? new Date().toISOString() : null;
    });
    if (wasPlanned) void logEvent('departure', `Departure started: ${departure.name}.`);
    // m4: checking the LAST remaining step flips planLine from "Leave by ...
    // · start by ..." to plain "Leave by ..." (buildDepartureWidgetData in
    // widgetSnapshot.ts keys that off allStepsChecked) — without this the
    // departure widget kept showing a stale "start by" after every step was
    // actually done. Harmless, not wasted, on every other toggle: an
    // unchanged planLine still triggers a real SharedPreferences write and
    // provider redraw (see WidgetBridgePlugin's own comment on why poking
    // both providers unconditionally is simpler than diffing first).
    void refreshWidgets();
    void refreshDayGauge();
  };

  // Backdating increment ("Done earlier"): the same write toggleStep does
  // when checking the current step, but stamping the chosen PAST instant
  // instead of `new Date()` — for the step that actually finished a while
  // ago and only just got remembered. Deliberately does NOT replicate
  // toggleStep's 'planned' -> 'running' transition: the "Done earlier"
  // TextAction below only renders once `departure.startedAt` already
  // exists (see its own comment), so by the time this can ever be called
  // the departure is already 'running' — there's no 'planned' case left
  // here to handle. Re-reads "whichever step is current" fresh inside the
  // transaction (same race protection as toggleStep's own `.modify()`)
  // rather than trusting a step id captured in the render closure.
  const handleStepBackdateConfirm = async (at: Date) => {
    void hapticImpact('light');
    const atIso = at.toISOString();
    await db.departures.where('id').equals(departure.id).modify((d) => {
      const s = d.steps.find((x) => x.checkedAt === null);
      if (s) s.checkedAt = atIso;
    });
    void refreshWidgets();
    void refreshDayGauge();
    setStepBackdateOpen(false);
  };

  // 'planned' -> 'running' without checking a step - the explicit "Start
  // getting ready" button (M3). Same transactional shape as toggleStep for
  // the same reason: a fast tap here immediately followed by a step tap
  // shouldn't be able to race on `startedAt`.
  const handleStart = async () => {
    void hapticImpact('light');
    const wasPlanned = departure.status === 'planned';
    await db.departures.where('id').equals(departure.id).modify((d) => {
      if (d.status === 'planned') {
        d.status = 'running';
        d.startedAt = d.startedAt ?? new Date().toISOString();
      }
    });
    if (wasPlanned) void logEvent('departure', `Departure started: ${departure.name}.`);
  };

  const handleLeave = async () => {
    void hapticImpact('heavy');
    await db.departures.update(departure.id, { status: 'left', leftAt: new Date().toISOString() });
    void logEvent('departure', `Out the door: ${departure.name}.`);
    // Terminal status - no more staged alerts make sense once you've left.
    await cancelDepartureAlarms(departure.id, departure.name);
    // Widgets increment: 'left' is no longer 'planned'/'running', so this
    // departure drops out of the widget's source pool — refresh so it
    // doesn't keep showing "Leave now" after you already have.
    void refreshWidgets();
    void refreshDayGauge();
    // Learning increment §3: this is one of the two "a departure of an
    // autoLearn template reached left/done" triggers (the other is Home's
    // arrival-capture actions, which move an already-'left' departure on to
    // 'done'). Fire-and-forget, same as every other post-write side effect
    // on this line — applyAutoLearn itself never throws (see its own doc
    // comment) and is a no-op for a template that hasn't opted in.
    if (departure.templateId) void applyAutoLearn(departure.templateId);
    setJustLeft(true);
  };

  // Backdating increment ("Left earlier"): same write and side effects as
  // handleLeave — status 'left', alarms cancelled, auto-learn triggered,
  // the one-time justLeft summary shown — just stamping the chosen PAST
  // instant as `leftAt` instead of `new Date()`. Alarm cancellation is
  // unchanged on purpose: the four staged alerts are all for moments still
  // ahead of a real "I'm out the door," so they're exactly as pointless to
  // leave scheduled after a backdated departure as after an on-time one.
  // The justLeft summary that follows (this component's own `if (justLeft)`
  // branch below) reads `departure.leftAt` back from the live query rather
  // than anything captured here, so a backdated leave shows the true
  // corrected time and slip automatically — nothing extra to wire for that.
  const handleLeaveBackdateConfirm = async (at: Date) => {
    void hapticImpact('heavy');
    await db.departures.update(departure.id, { status: 'left', leftAt: at.toISOString() });
    void logEvent('departure', `Out the door: ${departure.name}.`);
    await cancelDepartureAlarms(departure.id, departure.name);
    void refreshWidgets();
    void refreshDayGauge();
    if (departure.templateId) void applyAutoLearn(departure.templateId);
    setJustLeft(true);
    setLeaveBackdateOpen(false);
  };

  // M1/M2: abandoning is available from the live Runway screen for either
  // 'planned' or 'running' - this is the only place 'abandoned' is
  // actually reachable from. Same confirm copy and same consequence
  // (status 'abandoned' + cancelled alarms) as Home's "Remove" action on a
  // planned card; the two differ only in where they navigate afterwards.
  const handleAbandon = async () => {
    if (!window.confirm(ABANDON_CONFIRM)) return;
    await db.departures.update(departure.id, { status: 'abandoned' });
    void logEvent('departure', `Departure abandoned: ${departure.name}.`);
    await cancelDepartureAlarms(departure.id, departure.name);
    // Widgets increment: same reasoning as handleLeave above — 'abandoned'
    // takes this departure out of the widget's source pool.
    void refreshWidgets();
    void refreshDayGauge();
    onNavigate({ name: 'home' });
  };

  // Arrival-steps increment: the explicit "I'm at the building" tap that
  // begins the arrival phase — stamps `arrivedAt`, the anchor
  // deriveStepActuals (calibration.ts) chains the first arrival step's
  // actual time from. An inferred timestamp (e.g. leftAt + travelMinutes)
  // would silently misattribute however long the journey ACTUALLY took —
  // traffic, parking, walking from the car — onto the first arrival step's
  // timer; a real, explicit tap is the only honest signal this app has for
  // "the journey part is over, the building part begins now."
  const handleArrived = async () => {
    void hapticImpact('light');
    await db.departures.update(departure.id, { arrivedAt: new Date().toISOString() });
    void logEvent('arrival', `Arrival recorded: ${departure.name}.`);
  };

  // Backdating increment ("Arrived earlier"): same write as handleArrived,
  // stamping the chosen PAST instant instead of `new Date()` — for the
  // building that was actually reached a while ago, phone left in a pocket.
  // Lower bound for this dialog is `leftAt` (wired below), which is always
  // set by the time this can render: `arrivedBackdateOpen` only exists in
  // the arrival phase, reachable only once status is already 'left'.
  const handleArrivedBackdateConfirm = async (at: Date) => {
    void hapticImpact('light');
    await db.departures.update(departure.id, { arrivedAt: at.toISOString() });
    void logEvent('arrival', `Arrival recorded: ${departure.name}.`);
    setArrivedBackdateOpen(false);
  };

  // Arrival-steps increment: same transactional-modify shape as toggleStep
  // above, pointed at `arrivalSteps` instead of `steps`. Checking the LAST
  // unchecked arrival step is what resolves the whole departure — status
  // 'done' plus an auto-derived arrivalResult measured against the true
  // target (`appointmentAt`), the most precise arrival capture this app has:
  // every other capture path (Home's Early/On time/Late buttons) is a
  // person's best guess after the fact, this one is the exact checked-off
  // timestamp of the last real thing standing between the door and the
  // appointment. Late-only distinction (no separate "early" outcome) is
  // deliberate, matching the spec this increment shipped against precisely:
  // arrivalResult is 'onTime' for anything at or before the appointment,
  // 'late' (with arrivalLateMinutes) otherwise.
  const toggleArrivalStep = async (step: DepartureStep) => {
    void hapticImpact('light');
    const nowIso = new Date().toISOString();
    let becameDone: 'onTime' | 'late' | null = null;
    await db.departures.where('id').equals(departure.id).modify((d) => {
      const arrivalStepsList = d.arrivalSteps ?? [];
      const s = arrivalStepsList.find((x) => x.id === step.id);
      if (!s) return;
      const checking = s.checkedAt === null;
      s.checkedAt = checking ? nowIso : null;
      if (checking && arrivalStepsList.every((x) => x.checkedAt !== null)) {
        d.status = 'done';
        const lateMinutes = Math.round(
          (new Date(nowIso).getTime() - new Date(d.appointmentAt).getTime()) / 60_000,
        );
        if (lateMinutes > 0) {
          d.arrivalResult = 'late';
          d.arrivalLateMinutes = lateMinutes;
          becameDone = 'late';
        } else {
          d.arrivalResult = 'onTime';
          d.arrivalLateMinutes = null;
          becameDone = 'onTime';
        }
      }
    });
    // Only the CHECKING half is logged, not the uncheck — an uncheck is a
    // correction of the previous check, not a new event worth its own trace
    // line (same "transitions only" rule this module's own header states).
    if (step.checkedAt === null) void logEvent('arrival', `Arrival step checked: ${step.name}.`);
    if (becameDone) void logEvent('departure', `Departure done: ${departure.name}, ${becameDone}.`);
    void refreshWidgets();
    void refreshDayGauge();
    // Same trigger rule as handleLeave above ("a departure of an autoLearn
    // template reached left/done") — checking the last arrival step is the
    // OTHER place a departure reaches 'done' now, alongside Home's manual
    // arrival-capture actions.
    if (departure.templateId) void applyAutoLearn(departure.templateId);
  };

  // Backdating increment ("Done earlier", arrival flavor): the arrival-steps
  // twin of handleStepBackdateConfirm above, mirroring toggleArrivalStep's
  // full write — including the last-step auto-resolve to 'done' with a
  // freshly-derived arrivalResult — rather than just the checkedAt stamp.
  // That auto-resolve isn't optional to replicate here: if backdating the
  // LAST arrival step didn't also resolve the departure, a corrected
  // departure would sit stuck in the arrival phase forever, which is
  // exactly the "corrupted slip record" this whole increment exists to
  // prevent, just moved one step later. `at` (not `new Date()`) drives the
  // lateMinutes math too, so a backdated last step reports the true
  // corrected result, not a result measured against the moment it was
  // finally remembered.
  const handleArrivalStepBackdateConfirm = async (at: Date) => {
    void hapticImpact('light');
    const atIso = at.toISOString();
    let backdatedStepName: string | null = null;
    let becameDone: 'onTime' | 'late' | null = null;
    await db.departures.where('id').equals(departure.id).modify((d) => {
      const arrivalStepsList = d.arrivalSteps ?? [];
      const s = arrivalStepsList.find((x) => x.checkedAt === null);
      if (!s) return;
      backdatedStepName = s.name;
      s.checkedAt = atIso;
      if (arrivalStepsList.every((x) => x.checkedAt !== null)) {
        d.status = 'done';
        const lateMinutes = Math.round((at.getTime() - new Date(d.appointmentAt).getTime()) / 60_000);
        if (lateMinutes > 0) {
          d.arrivalResult = 'late';
          d.arrivalLateMinutes = lateMinutes;
          becameDone = 'late';
        } else {
          d.arrivalResult = 'onTime';
          d.arrivalLateMinutes = null;
          becameDone = 'onTime';
        }
      }
    });
    if (backdatedStepName !== null) void logEvent('arrival', `Arrival step backdated: ${backdatedStepName}.`);
    if (becameDone) void logEvent('departure', `Departure done: ${departure.name}, ${becameDone}.`);
    void refreshWidgets();
    void refreshDayGauge();
    if (departure.templateId) void applyAutoLearn(departure.templateId);
    setStepBackdateOpen(false);
  };

  // F1: writes a compressed plan the confirmation block already showed on
  // screen — the diff the user tapped "Apply" on IS `result`, computed at
  // render time from the same `departure`/`now` this component already has,
  // so there's nothing left to recompute here. Transactional `.modify()`,
  // same reasoning as toggleStep/handleStart above: a fast second tap
  // elsewhere shouldn't be able to race this write.
  //
  // Calibration note (spec-required): compressPlan's compressed
  // plannedMinutes feed straight into this departure's own DepartureStep
  // rows, which deriveStepActuals (calibration.ts) later reads back to
  // reconstruct per-step actuals for history/suggestions. But
  // computeSuggestions joins those actuals to a TEMPLATE's *current* step
  // minutes by NAME (see calibration.ts's own doc comment) — never to
  // whatever plannedMinutes a particular Departure happened to carry. A
  // one-off squeeze here changes what THIS run asked for, not what the
  // template still says it normally takes, so it cannot corrupt future
  // calibration suggestions.
  const applyReplan = async (result: Extract<CompressResult, { fits: true }>) => {
    void hapticImpact('light');
    // Merge the compressed plannedMinutes onto the CURRENT rows by id
    // instead of assigning the whole array from the render-time snapshot —
    // a step checked in the same instant as the Apply tap would otherwise
    // have its fresh checkedAt clobbered back to the stale value shown in
    // the confirm block (same race class as toggleStep's own .modify).
    const compressedMinutesById = new Map(result.steps.map((s) => [s.id, s.plannedMinutes]));
    await db.departures.where('id').equals(departure.id).modify((d) => {
      for (const step of d.steps) {
        const compressed = compressedMinutesById.get(step.id);
        // Only unchecked-at-compression-time steps were compressed; a step
        // checked since then keeps its checkedAt AND gets the new planned
        // minutes, which is harmless — it's history the moment it's checked.
        if (compressed !== undefined) step.plannedMinutes = compressed;
      }
      d.bufferMinutes = result.bufferMinutes;
      // Two-distribution insight (learning increment): compression measures
      // how fast a step CAN go under pressure, not how long it naturally
      // takes - see learning.ts's own header comment. Stamping this is what
      // lets naturalActualsByStepName keep this run's actuals OUT of the
      // "normal" pool while rushedActualsByStepName learns a smarter floor
      // from them instead. applyReanchor below deliberately does NOT set
      // this: re-anchoring moves the appointment TARGET, it never touches a
      // step's plannedMinutes, so there is nothing about it to mark as
      // "measured under compression."
      d.wasReplanned = true;
    });
    // wrapUp shifts because the buffer changed (alarmTimes.ts) - reschedule
    // rather than leave the four staged alarms pointing at the old plan.
    // Past alarms are filtered inside computeAlarmTimes itself, so a slot
    // that's already fired (e.g. slot 0, "Start getting ready.") simply
    // doesn't get rescheduled - nothing to reimplement here.
    await scheduleDepartureAlarms({ ...departure, steps: result.steps, bufferMinutes: result.bufferMinutes });
    void logEvent('departure', `Departure replanned: ${departure.name}.`);
    void refreshWidgets();
    void refreshDayGauge();
    setReplanOpen(false);
  };

  // Re-anchor (leaveBy-has-passed spec): writes a NEW target time, replacing
  // compression's "smaller version of the old plan" with "I'm still going -
  // new target". `chosen` is computed at render time in the JSX (same
  // call-time pattern as applyReplan(replanResult) above), already resolved
  // through nextOccurrenceOf's next-occurrence rolling, so there's nothing
  // left to validate here beyond what the button's own disabled state
  // already gated.
  const applyReanchor = async (chosen: Date) => {
    void hapticImpact('light');
    const chosenIso = chosen.toISOString();
    // Backfill for a legacy (pre-originalAppointmentAt) row: null there
    // means this row has never been re-anchored before, so its CURRENT
    // appointmentAt — captured here, the instant before we overwrite it —
    // IS still the true original commitment. See db/types.ts's own comment
    // on originalAppointmentAt for why this one-time backfill matters: skip
    // it and a legacy row's slip math would silently start measuring
    // against whichever appointmentAt happened to be live at re-anchor
    // time, defeating the field's whole purpose for exactly the rows it
    // exists to help.
    const originalToKeep = departure.originalAppointmentAt ?? departure.appointmentAt;
    await db.departures.where('id').equals(departure.id).modify((d) => {
      d.appointmentAt = chosenIso;
      // == null, not === null: rows written before this field existed don't
      // carry the property at all (undefined, not null) — a strict null
      // check would skip the backfill for exactly the legacy rows it
      // exists to protect.
      if (d.originalAppointmentAt == null) d.originalAppointmentAt = originalToKeep;
    });
    // Same "wrapUp/startBy shift, reschedule" reasoning as applyReplan above
    // — the appointment itself just moved, so all four staged alarm times
    // move with it.
    await scheduleDepartureAlarms({ ...departure, appointmentAt: chosenIso, originalAppointmentAt: originalToKeep });
    void logEvent('departure', `Departure re-anchored: ${departure.name}.`);
    void refreshWidgets();
    void refreshDayGauge();
    setReplanOpen(false);
  };

  // Arrival-steps increment (ward-station insight): status 'left' with a
  // non-empty arrival-steps list gets a live phase of its own instead of
  // the plain justLeft/terminal note below — replaces BOTH of those for
  // exactly this case, checked ahead of `justLeft` so a departure that was
  // just left (this session) with arrival steps goes straight here rather
  // than flashing the old "Logged ... Safe travels." summary first. A
  // departure WITHOUT arrival steps is completely unaffected: this
  // condition is false for it and every branch below behaves exactly as
  // it did before this increment.
  if (arrivalPhaseActive) {
    const arrivalStepsList = departure.arrivalSteps ?? [];
    const arrived = departure.arrivedAt != null;
    // Same equation as the prep view (projection.ts) — projectedArrival
    // now measures against remaining (unchecked) arrival steps instead of
    // prep, since prep is necessarily all checked by the time status is
    // 'left' (allChecked gates the "I'm out the door" button below).
    const projection = computeProjection(now, departure);
    const textAccent = STATE_TEXT[projection.state];
    const border = STATE_BORDER[projection.state];

    const uncheckedArrival = arrivalStepsList.filter((s) => s.checkedAt === null);
    const checkedArrival = arrivalStepsList.filter((s) => s.checkedAt !== null);
    const currentArrivalStep = uncheckedArrival[0] ?? null;
    const laterArrivalSteps = uncheckedArrival.slice(1);
    const overrunTone = projection.state === 'late' ? 'text-red-400' : 'text-amber-400';

    // Step-focus overlay, arrival flavor: currentStepAnchor/currentStepElapsed
    // (currentStepElapsed.ts) are generic over any {steps, startedAt}-shaped
    // object — remapping `startedAt` to `arrivedAt` here reuses that exact
    // "most recent checked timestamp, else the fallback anchor" algorithm
    // unchanged, rather than a second copy of it. See db/types.ts's
    // Departure.arrivedAt comment for why THAT specific anchor (not the prep
    // chain's last event) is the honest one for this phase.
    const arrivalAnchorSource = { steps: arrivalStepsList, startedAt: departure.arrivedAt };
    const arrivalElapsed = currentStepElapsed(now, arrivalAnchorSource);
    // Computed unconditionally (not just while StepFocus is open) —
    // backdating increment: the current-step card's own "Done earlier"
    // dialog (below) needs this exact anchor as its lower bound too, same
    // "don't fork the anchor logic" reuse currentStepElapsed itself is
    // built on.
    const arrivalAnchorIso = currentStepAnchor(arrivalAnchorSource);
    const focusedArrivalStep = focusStepId ? (arrivalStepsList.find((s) => s.id === focusStepId) ?? null) : null;
    const focusedArrivalIsCurrent =
      !!focusedArrivalStep && !!currentArrivalStep && focusedArrivalStep.id === currentArrivalStep.id;
    const focusArrivalAnchorIso = focusedArrivalIsCurrent ? arrivalAnchorIso : null;

    // Tap-anywhere-to-advance, arrival flavor — same shape as the prep
    // view's advanceFocusAfterCheck below: toggleArrivalStep already carries
    // the haptic and the transactional write; this just decides where focus
    // lands next (list order, same reasoning as the prep version).
    const advanceArrivalFocusAfterCheck = async () => {
      if (!currentArrivalStep) return;
      const nextStepId = laterArrivalSteps[0]?.id ?? null;
      await toggleArrivalStep(currentArrivalStep);
      setFocusStepId(nextStepId);
    };

    return (
      <>
      <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
        <div className="pt-8">
          <ScreenHeader
            title={`${departure.name} · ${departure.destination || 'No destination set'}`}
            onBack={() => onNavigate({ name: 'home' })}
          />
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          <p className={`text-huge font-bold tracking-tight tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}>
            {formatTime(projection.projectedArrival)}
          </p>
          <p className="text-lg tabular-nums text-slate-500">
            {formatAppointmentLine(new Date(departure.appointmentAt), now)}
          </p>
          <p className={`text-base font-medium tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}>
            {formatSlackLine(projection.slackMinutes)}
          </p>
        </div>

        {!arrived ? (
          // Gate: the journey isn't over until this explicit tap — see
          // handleArrived's own comment on why a guess would be dishonest.
          // No checklist rendered yet; there's nothing to check off until
          // the phase it belongs to has actually begun.
          <div className={`flex flex-col items-center gap-3 rounded-xl border ${border} bg-surface p-6 text-center motion-safe:transition-colors motion-safe:duration-300`}>
            <p className="text-2xl font-semibold tracking-tight text-slate-100">Not at the building yet.</p>
            <p className="tabular-nums text-slate-400">
              {arrivalStepsList.length} step{arrivalStepsList.length === 1 ? '' : 's'} left once you tap in.
            </p>
            <Button onClick={() => void handleArrived()} className="mt-4 w-full">
              I&apos;m at the building
            </Button>
            {departure.destination && (
              <Button
                variant="secondary"
                onClick={() => window.open(mapsUrl(departure.destination), '_blank')}
                className="w-full"
              >
                Open Maps
              </Button>
            )}
            {/* Arrival-detection increment: quiet reassurance that the tap
                above isn't the only way in, not a claim that it's guaranteed
                — see the polling effect's own comment for the failure modes
                the manual button still covers. */}
            {arrivalWifiTarget !== '' && (
              <p className="text-sm text-slate-500">
                Arrival is detected when the phone joins {arrivalWifiTarget}.
              </p>
            )}
            {/* Backdating increment: the phone was left in a pocket for the
                walk in — a forgotten tap here would otherwise pin the whole
                arrival phase (every arrival step's timer) to whenever it's
                finally remembered, not to when the building was actually
                reached. Lower bound is `leftAt`: the journey can't have
                ended before it began. `?? departure.createdAt` is
                defensive-only — `leftAt` is always set alongside status
                'left' (handleLeave/handleLeaveBackdateConfirm both write
                them together), and this branch is only reachable once
                status is 'left'. */}
            {arrivedBackdateOpen ? (
              <BackdateDialog
                caption="When did you actually arrive?"
                lowerBound={new Date(departure.leftAt ?? departure.createdAt)}
                now={now}
                onConfirm={(at) => void handleArrivedBackdateConfirm(at)}
                onCancel={() => setArrivedBackdateOpen(false)}
              />
            ) : (
              <TextAction onClick={() => setArrivedBackdateOpen(true)}>Arrived earlier</TextAction>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {currentArrivalStep && (
              <div className={`rounded-xl border ${border} bg-surface p-4 motion-safe:transition-colors motion-safe:duration-300`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => toggleArrivalStep(currentArrivalStep)}
                      aria-label={`Check off ${currentArrivalStep.name || 'step'}`}
                      className="size-6 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocusStepId(currentArrivalStep.id)}
                    className="flex min-h-11 flex-1 flex-col gap-1 rounded-lg py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  >
                    <span className="text-xl font-medium text-slate-100">{currentArrivalStep.name || 'Step'}</span>
                    {arrivalElapsed ? (
                      <span
                        className={`text-sm tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${
                          arrivalElapsed.elapsedMinutes > currentArrivalStep.plannedMinutes ? overrunTone : 'text-slate-500'
                        }`}
                      >
                        {arrivalElapsed.elapsedMinutes} min on this step · planned {currentArrivalStep.plannedMinutes} min
                      </span>
                    ) : (
                      <span className="text-sm tabular-nums text-slate-500">
                        planned {currentArrivalStep.plannedMinutes} min
                      </span>
                    )}
                  </button>
                </div>
                {/* Backdating increment: "Done earlier", arrival flavor.
                    Only the CURRENT arrival step ever gets this action —
                    the same "later steps haven't started, so they can't
                    have finished earlier" reasoning as the prep card below.
                    No separate `arrivedAt`-exists guard needed here (unlike
                    the prep card's `startedAt` check): this whole block
                    only renders once `arrived` is already true. */}
                {stepBackdateOpen ? (
                  <div className="mt-3">
                    <BackdateDialog
                      caption="When did this actually finish?"
                      lowerBound={new Date(arrivalAnchorIso ?? departure.arrivedAt ?? departure.createdAt)}
                      now={now}
                      onConfirm={(at) => void handleArrivalStepBackdateConfirm(at)}
                      onCancel={() => setStepBackdateOpen(false)}
                    />
                  </div>
                ) : (
                  <TextAction className="mt-2" onClick={() => setStepBackdateOpen(true)}>
                    Done earlier
                  </TextAction>
                )}
              </div>
            )}

            {laterArrivalSteps.length > 0 && (
              <div className="flex flex-col gap-2">
                {laterArrivalSteps.map((step) => (
                  <div
                    key={step.id}
                    className="flex min-h-12 items-center gap-3 rounded-lg border border-slate-800/60 bg-surface px-4 py-2"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => toggleArrivalStep(step)}
                        aria-label={`Check off ${step.name || 'step'}`}
                        className="size-6 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => setFocusStepId(step.id)}
                      className="flex min-h-11 flex-1 items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    >
                      <span className="flex-1 text-slate-300">{step.name || 'Step'}</span>
                      <span className="text-sm tabular-nums text-slate-500">{step.plannedMinutes} min</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {checkedArrival.length > 0 && (
              <div className="flex flex-col gap-1">
                {checkedArrival.map((step) => (
                  <label
                    key={step.id}
                    className="flex min-h-12 items-center gap-3 rounded-lg px-4 py-1 opacity-50 motion-safe:transition-opacity motion-safe:duration-200"
                  >
                    <input
                      type="checkbox"
                      checked={true}
                      onChange={() => toggleArrivalStep(step)}
                      className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    />
                    <span className="flex-1 text-slate-500 line-through">{step.name || 'Step'}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {Capacitor.isNativePlatform() && (
          <p className="text-center text-sm text-slate-600">Screen stays on while this is open.</p>
        )}
      </div>
      {focusedArrivalStep && (
        <StepFocus
          step={focusedArrivalStep}
          isCurrentStep={focusedArrivalIsCurrent}
          anchorIso={focusArrivalAnchorIso}
          now={now}
          bottomLine={{ label: 'Appointment', time: new Date(departure.appointmentAt) }}
          onBack={() => setFocusStepId(null)}
          onTap={focusedArrivalIsCurrent ? () => void advanceArrivalFocusAfterCheck() : undefined}
          onBackdate={() => {
            // Backdating increment: the handoff. Focus is a full-screen
            // overlay, the dialog lives on the card underneath it — closing
            // one and opening the other is the whole trick, no shared
            // "which is showing" state beyond the two flags this already is.
            setFocusStepId(null);
            setStepBackdateOpen(true);
          }}
        />
      )}
      </>
    );
  }

  if (justLeft) {
    // leaveBy (appointment minus travel) doesn't depend on `now` - see
    // projection.ts - so the argument passed here is arbitrary. appointmentAt
    // is used rather than the live clock so this stays a fixed fact about
    // *this* departure rather than looking like it tracks the wall clock.
    //
    // originalAppointmentAt ?? appointmentAt (not appointmentAt alone): the
    // slip this summary reports must be measured against the ORIGINAL
    // commitment, per db/types.ts's own comment on originalAppointmentAt -
    // otherwise a departure re-anchored to a later target minutes ago would
    // report "on the door on time" against the RESCUED target, silently
    // laundering the lateness it was actually re-anchored to recover from.
    // travelMinutes is still `departure`'s CURRENT value here (it may have
    // been live-updated since the original commitment) - an accepted
    // imprecision, since re-anchoring changes the appointment, not travel
    // time, and there is no separate "travel time as of the original
    // commitment" to fall back on.
    const slipAnchor = departure.originalAppointmentAt ?? departure.appointmentAt;
    const leaveBy = computeProjection(new Date(slipAnchor), { ...departure, appointmentAt: slipAnchor }).leaveBy;
    const leftAtDate = new Date(departure.leftAt ?? new Date().toISOString());
    const slipMinutes = Math.round((leftAtDate.getTime() - leaveBy.getTime()) / 60_000);

    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 px-4 pb-12 pt-safe-top text-center">
        <p className="text-lg text-slate-100">{departure.name}</p>
        <p className="text-sm text-slate-500">
          Appointment {formatTime(new Date(departure.appointmentAt))}
        </p>
        <p className="mt-4 text-2xl font-semibold tracking-tight tabular-nums text-slate-100">
          Logged {formatTime(leftAtDate)}. Safe travels.
        </p>
        <p className="tabular-nums text-slate-400">Planned to leave by {formatTime(leaveBy)}.</p>
        {/* Moments (UI-polish increment): the one acknowledgment-tone line
            in this screen — emerald-300 exclusively for "out the door early
            or on time," never for late, and never anywhere else. Wording
            unchanged; only the colour for the early/on-time branches. */}
        <p
          className={`tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${
            slipMinutes > 0 ? 'text-red-400' : 'text-emerald-300'
          }`}
        >
          {slipMinutes === 0
            ? 'Out the door on time.'
            : slipMinutes > 0
              ? `Out the door ${slipMinutes} min late.`
              : `Out the door ${Math.abs(slipMinutes)} min early.`}
        </p>
        <div className="mt-8 flex w-full flex-col gap-3">
          {departure.destination && (
            <Button variant="secondary" onClick={() => window.open(mapsUrl(departure.destination), '_blank')}>
              Open Maps
            </Button>
          )}
          <Button onClick={() => onNavigate({ name: 'home' })}>Back to home</Button>
        </div>
      </div>
    );
  }

  if (TERMINAL_STATUSES.includes(departure.status)) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 px-4 pb-12 pt-safe-top text-center">
        <p className="text-lg text-slate-100">{departure.name}</p>
        <p className="text-slate-400">This departure is finished.</p>
        <Button onClick={() => onNavigate({ name: 'home' })} className="mt-8 w-full">
          Back to home
        </Button>
      </div>
    );
  }

  // Live view - status is 'planned' (not yet started - the "Start getting
  // ready" button below is shown, but the same live projection and step
  // list are already visible; M3) or 'running' (a run is under way).
  // RUNWAY_PLAN.md §4's one equation, recomputed every tick from `now`.
  const projection = computeProjection(now, departure);
  const elapsed = currentStepElapsed(now, departure);
  const textAccent = STATE_TEXT[projection.state];
  const border = STATE_BORDER[projection.state];

  const uncheckedSteps = departure.steps.filter((s) => s.checkedAt === null);
  const checkedSteps = departure.steps.filter((s) => s.checkedAt !== null);
  const currentStep = uncheckedSteps[0] ?? null;
  const laterSteps = uncheckedSteps.slice(1);
  const allChecked = uncheckedSteps.length === 0;

  // The current step's anchor - computed unconditionally (not just while
  // StepFocus is open) because the backdating increment's "Done earlier"
  // dialog on the current-step card (below) needs it as its lower bound
  // too, same reuse `focusAnchorIso` already relied on before this
  // increment added a second consumer.
  const stepAnchorIso = currentStepAnchor(departure);

  // Step-focus increment: the step the overlay (if open) is showing, and
  // whether that's the CURRENT step - only the current step gets the live
  // countdown + tap-to-advance; see StepFocus's own header comment for why
  // a non-current step can't honestly have one. `currentStepAnchor` is only
  // computed (and only meaningful) for the current step - passing it
  // through unconditionally would invite StepFocus to (mis)use it for a
  // step that isn't running yet.
  const focusedStep = focusStepId ? (departure.steps.find((s) => s.id === focusStepId) ?? null) : null;
  const focusedStepIsCurrent = !!focusedStep && !!currentStep && focusedStep.id === currentStep.id;
  const focusAnchorIso = focusedStepIsCurrent ? stepAnchorIso : null;

  // Backdating increment ("Left earlier"): the honest lower bound for a
  // backdated "I'm out the door" is whichever prep event happened last —
  // the most recently checked step's timestamp, or `startedAt` if
  // (unusually) nothing was ever checked. Can't reuse `currentStepAnchor`
  // unchanged here: it returns `null` once every step is checked (there's
  // no "current" step left), which is exactly the state the leave block
  // below only ever renders in (`allChecked`) — so this walks the same
  // "most recent checkedAt" rule over the FULL list instead.
  // `?? departure.createdAt` is a last-resort defensive fallback (a
  // running departure always has `startedAt`); it only exists so this is
  // never literally `null` for the dialog's required `lowerBound` prop.
  const lastCheckedAtIso = departure.steps.reduce<string | null>(
    (latest, s) => (s.checkedAt !== null && (latest === null || s.checkedAt > latest) ? s.checkedAt : latest),
    null,
  );
  const leaveLowerBoundIso = lastCheckedAtIso ?? departure.startedAt ?? departure.createdAt;

  // Tap-anywhere-to-advance (step-focus increment): reuses toggleStep
  // exactly as the checkbox does (no duplicated `.modify()` logic, and the
  // haptic-light already lives inside toggleStep) - this function's only
  // job on top of that is picking which step focus should land on next.
  // "By order" is list order: after `currentStep` is checked off, the new
  // first unchecked step is `laterSteps[0]` (uncheckedSteps.slice(1)) -
  // exactly the step that becomes the new `currentStep` on the next render.
  // Computed from the PRE-toggle arrays (captured in this render's
  // closure), which is safe here because this only ever fires while
  // focused on the current step, and toggleStep's own transactional
  // `.modify()` is what actually guards the write against a race - this
  // function just decides where the overlay should point afterwards.
  const advanceFocusAfterCheck = async () => {
    if (!currentStep) return;
    const nextStepId = laterSteps[0]?.id ?? null;
    await toggleStep(currentStep);
    setFocusStepId(nextStepId); // null clears focus - the all-checked leave block takes over
  };

  // Overrun on the current step is its own local warning, independent of
  // whether the overall projection is calm right now (plenty of slack
  // elsewhere can mask one slow step). It shares the tight/late palette
  // rather than inventing a third color, but only escalates to red once the
  // whole projection has actually gone late.
  const overrunTone = projection.state === 'late' ? 'text-red-400' : 'text-amber-400';

  // F1: whole minutes between now and the door - leaveBy doesn't move as
  // `now` advances (projection.ts), so this shrinks every tick exactly the
  // way the centerpiece figure does. Deliberately NOT clamped to >= 0 before
  // being handed to compressPlan: a negative value only ever produces a
  // fits:false result down that path (its floor-sum check can't be beaten
  // by a number below zero unless there's truly nothing left to plan for -
  // see replan.ts's own doc comment on the algorithm), so there's no need
  // for a separate "already past leaveBy" branch here.
  const replanAvailableMinutes = Math.floor((projection.leaveBy.getTime() - now.getTime()) / 60_000);
  const replanNeededMinutes =
    uncheckedSteps.reduce((sum, step) => sum + step.plannedMinutes, 0) + departure.bufferMinutes;
  const replanResult: CompressResult | null = replanOpen
    ? compressPlan({
        availableMinutes: replanAvailableMinutes,
        steps: departure.steps,
        bufferMinutes: departure.bufferMinutes,
        floorsByStepName: replanFloorsByStepName,
      })
    : null;

  // Re-anchor spec: once leaveBy itself is behind us, there is no time left
  // to travel at all - compression's floor check would refuse outright
  // (replanResult above would come back fits:false), and rightly so. This
  // case takes over the whole panel instead of showing that refusal, per
  // the spec's priority order.
  const leaveByPassed = projection.leaveBy.getTime() <= now.getTime();
  // suggestNewTarget's "remaining plan" input is exactly replanNeededMinutes
  // above (unchecked steps + buffer) - the same number compressPlan itself
  // measures against, just handed to a different function once compression
  // has nothing left to offer.
  const suggestedTarget = suggestNewTarget(now, replanNeededMinutes, departure.travelMinutes);
  // reanchorValue stays `null` until the user actually edits the field
  // (see its own useState comment above) - the displayed value falls back
  // to the live suggestion until then.
  const reanchorInputValue = reanchorValue ?? formatTimeInput(suggestedTarget);
  const reanchorChosen = nextOccurrenceOf(now, reanchorInputValue);
  // Guards two things at once: an unparseable/empty input (NaN) and, as a
  // defensive backstop, a chosen instant that somehow isn't in the future.
  // In practice the second half of this OR is unreachable for any
  // well-formed "HH:mm" - nextOccurrenceOf's next-occurrence rolling
  // guarantees the result is always strictly after `now` - so this only
  // ever actually fires on empty/invalid input, the same "defensive, not a
  // real path" shape replan.ts's own overshoot-correction loop documents
  // for its own unreachable branch.
  const reanchorInvalid = Number.isNaN(reanchorChosen.getTime()) || reanchorChosen.getTime() <= now.getTime();

  // F1 spec: "Edit link only if the edit path applies" - reachable here
  // means status is 'planned' or 'running' (the TERMINAL_STATUSES guard
  // above already returned for anything else), and F3 makes Edit available
  // on Home for both of those, so the clause always applies wherever this
  // component can render it. Kept as an explicit condition (rather than a
  // hardcoded `true`) so a future status this screen might gain doesn't
  // silently inherit an edit link that isn't actually offered anywhere.
  const editPathApplies = departure.status === 'planned' || departure.status === 'running';

  return (
    <>
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader
          title={`${departure.name} · ${departure.destination || 'No destination set'}`}
          onBack={() => onNavigate({ name: 'home' })}
        />
      </div>

      {/* THE CENTERPIECE - legible from across the room. Centerpiece text,
          the slack line below it, and every state-tinted border on this
          screen share the same motion-safe 300ms colour crossfade (UI-polish
          increment, motion item 2) so a calm -> tight -> late shift reads as
          a transition, not a snap. */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p className={`text-huge font-bold tracking-tight tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}>
          {formatTime(projection.projectedArrival)}
        </p>
        <p className="text-lg tabular-nums text-slate-500">
          {formatAppointmentLine(new Date(departure.appointmentAt), now)}
        </p>
        {liveTravelLine && <p className="text-sm tabular-nums text-slate-500">{liveTravelLine}</p>}
        <p className={`text-base font-medium tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}>
          {formatSlackLine(projection.slackMinutes)}
        </p>
      </div>

      {departure.status === 'planned' && (
        <Button onClick={() => void handleStart()} className="w-full">
          Start getting ready
        </Button>
      )}

      {/* F1 + re-anchor: the hint area. Four mutually exclusive states in
          priority order: the re-anchor panel (leaveByPassed, unopened
          confirm blocks below it never even get evaluated once this is
          true), the confirm block (once tapped open, leaveBy still ahead),
          the late-only prompt (projection.state === 'late', unopened), or
          nothing at all (calm/tight, unopened) - never a modal, never
          applied without an explicit button tap. */}
      {replanOpen && leaveByPassed ? (
        // leaveBy has already passed - there is no time left to travel at
        // all, so compression (which only ever shrinks a plan that still
        // fits SOME window) has nothing honest to offer; see replan.ts's
        // suggestNewTarget doc comment. Re-anchoring to a new target is the
        // recovery path here, not a smaller version of the old one.
        <div className="flex flex-col gap-3 rounded-xl border border-red-800/60 bg-red-950/20 p-4 motion-safe:animate-fade-in">
          <p className="text-sm text-red-200">
            {formatTime(new Date(departure.appointmentAt))} has passed. Set a new target to replan against.
          </p>
          <TextField
            label="New target time"
            type="time"
            value={reanchorInputValue}
            onChange={(e) => {
              setReanchorValue(e.target.value);
              setReanchorTouched(true);
            }}
          />
          <p className="text-sm tabular-nums text-slate-400">
            Earliest honest arrival: {formatTime(suggestedTarget)}.
          </p>
          {reanchorTouched && reanchorInvalid && (
            <p className="text-sm text-red-300">Target must be in the future.</p>
          )}
          <div className="mt-1 flex gap-2">
            <Button
              onClick={() => void applyReanchor(reanchorChosen)}
              disabled={reanchorInvalid}
              className="flex-1"
            >
              Re-anchor to {formatTime(reanchorChosen)}
            </Button>
            <Button variant="secondary" onClick={() => setReplanOpen(false)} className="flex-1">
              Keep the old plan
            </Button>
          </div>
        </div>
      ) : replanOpen && replanResult ? (
        replanResult.fits && replanNeededMinutes <= replanAvailableMinutes ? (
          // compressPlan never expands a plan, so when the remaining plan
          // already fits the time left it returns it unchanged — offering an
          // Apply here would be a button that does nothing ("replan makes no
          // change", reported from real use). Say the true thing instead.
          <div className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4 motion-safe:animate-fade-in">
            <p className="text-sm text-slate-200">
              The plan already fits — {replanAvailableMinutes - replanNeededMinutes} min to spare. Nothing to
              compress.
            </p>
            <Button variant="secondary" onClick={() => setReplanOpen(false)}>
              Close
            </Button>
          </div>
        ) : replanResult.fits ? (
          <div className="flex flex-col gap-3 rounded-xl border border-sky-800/60 bg-sky-950/30 p-4 motion-safe:animate-fade-in">
            <p className="text-sm text-slate-200">
              You have {replanAvailableMinutes} min to the door. The remaining plan needs {replanNeededMinutes}.
            </p>
            <ul className="flex flex-col gap-1 text-sm tabular-nums text-slate-300">
              {uncheckedSteps.map((step) => {
                const compressed = replanResult.steps.find((s) => s.id === step.id);
                return (
                  <li key={step.id}>
                    {step.name || 'Step'} {step.plannedMinutes} → {compressed?.plannedMinutes ?? step.plannedMinutes} min
                  </li>
                );
              })}
              <li>
                buffer {departure.bufferMinutes} → {replanResult.bufferMinutes} min
              </li>
            </ul>
            <div className="mt-1 flex gap-2">
              <Button onClick={() => void applyReplan(replanResult)} className="flex-1">
                Apply
              </Button>
              <Button variant="secondary" onClick={() => setReplanOpen(false)} className="flex-1">
                Keep the old plan
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-red-800/60 bg-red-950/20 p-4 motion-safe:animate-fade-in">
            <p className="text-sm text-red-200">
              No plan reaches {formatTime(new Date(departure.appointmentAt))} on time — the remaining steps need at
              least {replanResult.minimumMinutes} min. Aim for {formatTime(projection.projectedArrival)}
              {editPathApplies ? ', or remove steps in Edit.' : '.'}
            </p>
            <Button variant="secondary" onClick={() => setReplanOpen(false)}>
              Keep the old plan
            </Button>
          </div>
        )
      ) : (
        projection.state === 'late' && (
          <button
            onClick={() => setReplanOpen(true)}
            className="min-h-12 rounded-lg text-left text-sm font-medium text-amber-400 transition-colors hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            {leaveByPassed ? 'The appointment has passed. Set a new target?' : 'The plan no longer fits. Replan from now?'}
          </button>
        )
      )}

      {allChecked ? (
        <div
          className={`flex flex-col items-center gap-3 rounded-xl border ${border} bg-surface p-6 text-center motion-safe:transition-colors motion-safe:duration-300`}
        >
          <p className="text-2xl font-semibold tracking-tight text-slate-100">Leave now.</p>
          <p className="tabular-nums text-slate-400">
            Walk out the door by {formatTime(projection.leaveBy)}
          </p>
          <Button onClick={handleLeave} className="mt-4 w-full">
            I&apos;m out the door
          </Button>
          {departure.destination && (
            <Button
              variant="secondary"
              onClick={() => window.open(mapsUrl(departure.destination), '_blank')}
              className="w-full"
            >
              Open Maps
            </Button>
          )}
          {/* Backdating increment: the forgotten-tap case this whole
              increment is named for — every prep step got checked off, but
              the door itself never got a tap, and the auto-now the app
              WOULD otherwise stamp (if leftAt were ever inferred rather
              than tapped) would corrupt this morning's whole slip record.
              A deliberate correction here counts as data; a silent guess
              never would. */}
          {leaveBackdateOpen ? (
            <BackdateDialog
              caption="When did you actually leave?"
              lowerBound={new Date(leaveLowerBoundIso)}
              now={now}
              onConfirm={(at) => void handleLeaveBackdateConfirm(at)}
              onCancel={() => setLeaveBackdateOpen(false)}
            />
          ) : (
            <TextAction onClick={() => setLeaveBackdateOpen(true)}>Left earlier</TextAction>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {currentStep && (
            <div className={`rounded-xl border ${border} bg-surface p-4 motion-safe:transition-colors motion-safe:duration-300`}>
              {/* Two separate tap targets, not one <label> wrapping both
                  (step-focus increment): a <label> around a checkbox
                  toggles on ANY click inside it, including the step name -
                  which is exactly the target that needs to open Focus
                  instead. Splitting them means the checkbox keeps its own
                  ~44px hit area (unchanged toggle behaviour) and the name/
                  time text becomes its own button that opens the overlay. */}
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggleStep(currentStep)}
                    aria-label={`Check off ${currentStep.name || 'step'}`}
                    className="size-6 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  />
                </span>
                <button
                  type="button"
                  onClick={() => setFocusStepId(currentStep.id)}
                  className="flex min-h-11 flex-1 flex-col gap-1 rounded-lg py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <span className="text-xl font-medium text-slate-100">{currentStep.name || 'Step'}</span>
                  {elapsed ? (
                    <span
                      className={`text-sm tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${
                        elapsed.elapsedMinutes > currentStep.plannedMinutes ? overrunTone : 'text-slate-500'
                      }`}
                    >
                      {elapsed.elapsedMinutes} min on this step · planned {currentStep.plannedMinutes} min
                    </span>
                  ) : (
                    <span className="text-sm tabular-nums text-slate-500">
                      planned {currentStep.plannedMinutes} min
                    </span>
                  )}
                </button>
              </div>
              {/* Backdating increment: "Done earlier" — current step only.
                  A later step (laterSteps, below) hasn't started yet, so it
                  can't honestly have finished "earlier" than a start time it
                  doesn't have; only the current step's row gets this action.
                  Gated on `departure.startedAt` existing: the current-step
                  card also renders before "Start getting ready" is pressed
                  (status still 'planned'), and a departure that hasn't
                  started has no lower bound to correct against yet — see
                  handleStepBackdateConfirm's own comment for why that lets
                  it skip toggleStep's planned -> running transition
                  entirely rather than needing to replicate it. */}
              {departure.startedAt != null && stepAnchorIso && (
                stepBackdateOpen ? (
                  <div className="mt-3">
                    <BackdateDialog
                      caption="When did this actually finish?"
                      lowerBound={new Date(stepAnchorIso)}
                      now={now}
                      onConfirm={(at) => void handleStepBackdateConfirm(at)}
                      onCancel={() => setStepBackdateOpen(false)}
                    />
                  </div>
                ) : (
                  <TextAction className="mt-2" onClick={() => setStepBackdateOpen(true)}>
                    Done earlier
                  </TextAction>
                )
              )}
            </div>
          )}

          {laterSteps.length > 0 && (
            <div className="flex flex-col gap-2">
              {laterSteps.map((step) => (
                // Same checkbox/text split as the current-step card above -
                // tapping the row opens Focus (showing this step's full
                // planned time, static; see StepFocus), tapping the
                // checkbox still just checks it off in place.
                <div
                  key={step.id}
                  className="flex min-h-12 items-center gap-3 rounded-lg border border-slate-800/60 bg-surface px-4 py-2"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => toggleStep(step)}
                      aria-label={`Check off ${step.name || 'step'}`}
                      className="size-6 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocusStepId(step.id)}
                    className="flex min-h-11 flex-1 items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  >
                    <span className="flex-1 text-slate-300">{step.name || 'Step'}</span>
                    <span className="text-sm tabular-nums text-slate-500">{step.plannedMinutes} min</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {checkedSteps.length > 0 && (
            <div className="flex flex-col gap-1">
              {checkedSteps.map((step) => (
                <label
                  key={step.id}
                  className="flex min-h-12 items-center gap-3 rounded-lg px-4 py-1 opacity-50 motion-safe:transition-opacity motion-safe:duration-200"
                >
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => toggleStep(step)}
                    className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  />
                  <span className="flex-1 text-slate-500 line-through">{step.name || 'Step'}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Arrival-steps increment (field report, verbatim: "now the after
          arrival steps are all missing. i had saved them, they seem to be
          hidden"). RUNNING state only — the moment "I'm out the door" is
          tapped these steps stop being a preview and start being the live
          arrival-phase checklist (the `arrivalPhaseActive` branch, top of
          this component). Until this section existed, a departure with
          saved arrival steps showed no trace of them anywhere on this
          screen until that tap: nothing was ever wrong with the data (both
          editors save them, materialize.ts copies them across), they were
          just never rendered here, which reads exactly like "lost" from
          the other side of the screen. This is the fix for that half of
          the report — the reorder half is DepartureSetup's moveStep/
          moveArrivalStep, below.
          Deliberately read-only: no checkboxes, no taps. These steps only
          become interactive in the arrival phase, where checking one has
          real consequences (it can resolve the whole departure to 'done').
          A tappable-looking row here would invite a tap that does nothing
          yet — worse than no affordance at all. */}
      {departure.status === 'running' && (departure.arrivalSteps ?? []).length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">After arrival</h2>
          <p className="text-sm tabular-nums text-slate-500">
            {arrivalPreviewLine(departure.arrivalSteps ?? [])}
          </p>
        </div>
      )}

      {Capacitor.isNativePlatform() && (
        <p className="text-center text-sm text-slate-600">Screen stays on while this is open.</p>
      )}

      {/* Quiet, at the very bottom, on purpose - abandoning is a real but
          uncommon action and shouldn't compete visually with the live
          projection or the step list above it (M1/M2). F1: "Replan from
          now." sits beside it for the same reason - it's a real but
          uncommon action, always available (not gated to the late state;
          slack can be quietly tightened too), and opens the same
          confirmation block the late-only hint above does. Two different
          copy strings, one action: this one reads as an offer ("Replan from
          now."), the hint above reads as a prompt in response to a problem
          ("The plan no longer fits. Replan from now?").
          Toggles (prev => !prev), not a hardcoded `true` — field report: a
          fixed `true` left this button inert once the panel was already
          open (tapping it re-set the already-true state, so nothing
          visibly changed and there was no way to close the panel from
          here). The late-only hint above stays open-only on purpose: it
          only ever renders while the panel is already closed (it's in the
          "else" branch of the same conditional the panel occupies), so
          there is no state where tapping it would need to close anything. */}
      <div className="flex items-center justify-center gap-6">
        <TextAction onClick={() => setReplanOpen((prev) => !prev)}>Replan from now.</TextAction>
        <TextAction onClick={() => void handleAbandon()}>Abandon this departure</TextAction>
      </div>
    </div>
    {/* Step-focus overlay - a sibling of the main screen, not nested inside
        it (see focusStepId's own comment above: this is a lens over the
        live departure, not a navigated-to place). `fixed inset-0` makes its
        position in the DOM irrelevant to what it covers on screen. */}
    {focusedStep && (
      <StepFocus
        step={focusedStep}
        isCurrentStep={focusedStepIsCurrent}
        anchorIso={focusAnchorIso}
        now={now}
        bottomLine={{ label: 'Leave by', time: projection.leaveBy }}
        onBack={() => setFocusStepId(null)}
        onTap={focusedStepIsCurrent ? () => void advanceFocusAfterCheck() : undefined}
        onBackdate={() => {
          // Backdating increment: same handoff as the arrival-phase
          // StepFocus above — close the overlay, open the dialog on the
          // card underneath it.
          setFocusStepId(null);
          setStepBackdateOpen(true);
        }}
      />
    )}
    </>
  );
}
