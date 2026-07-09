import { useEffect, useState } from 'react';
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
import { compressPlan, suggestNewTarget } from '../lib/replan';
import type { CompressResult } from '../lib/replan';
import { TextField } from '../ui/TextField';
import { TextAction } from '../ui/TextAction';

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

/**
 * Combines today's date with an `<input type="time">` value ("HH:mm") into
 * the NEXT occurrence of that time from `now` — if today's instance has
 * already gone by, it rolls to tomorrow instead of landing in the past.
 * This is what makes "pick 00:30 while it's 23:50" mean "in 40 minutes",
 * not "in almost 24 hours" — the natural reading of a clock-time picker
 * that doesn't also ask for a date. Returns an Invalid Date (getTime() is
 * NaN) for anything that isn't a well-formed "HH:mm" string, which the
 * caller (Runway.tsx's re-anchor panel) treats the same as "nothing valid
 * chosen yet" rather than crashing on it.
 */
function nextOccurrenceOf(now: Date, hhmm: string): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return new Date(NaN);
  const candidate = new Date(now);
  candidate.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
  return candidate;
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

  // Step-focus increment: which step (if any) the full-screen countdown
  // overlay is showing. Deliberately plain component state, not a routed
  // Screen (see App's Screen union, untouched by this increment) - the
  // overlay is a LENS over this live departure, not a place with its own
  // identity or deep link. Clearing it is just `setFocusStepId(null)`;
  // there is no "navigate back" involved, which is also why StepFocus is
  // rendered as a sibling overlay below rather than something onNavigate
  // ever points at.
  const [focusStepId, setFocusStepId] = useState<string | null>(null);

  // Defensive clear: if the departure stops being 'running' (left/abandoned
  // from elsewhere - e.g. Home - while this screen happens to be open) or
  // the focused step itself vanishes (edited away), the overlay has nothing
  // honest left to show. Runs on every departure/focusStepId change rather
  // than only at specific transitions, since either can happen from outside
  // this component (Dexie's live query, not user action here).
  useEffect(() => {
    if (focusStepId === null) return;
    if (!departure) return;
    if (departure.status !== 'running') {
      setFocusStepId(null);
      return;
    }
    if (!departure.steps.some((s) => s.id === focusStepId)) {
      setFocusStepId(null);
    }
  }, [departure, focusStepId]);

  // Keep the screen on for exactly as long as a run is live. Keyed on
  // status rather than just mount/unmount because this component stays
  // mounted across the 'running' -> 'left' transition (the justLeft
  // confirmation is rendered by this same component) — the cleanup here is
  // what releases the lock the instant status stops being 'running',
  // whether that's because the departure finished or because the screen
  // itself unmounts (React runs cleanups in both cases).
  useEffect(() => {
    if (departure?.status !== 'running') return;
    void keepAwake();
    return () => {
      void allowSleep();
    };
  }, [departure?.status]);

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
    await db.departures.where('id').equals(departure.id).modify((d) => {
      if (d.status === 'planned') {
        d.status = 'running';
        d.startedAt = d.startedAt ?? new Date().toISOString();
      }
      const s = d.steps.find((x) => x.id === step.id);
      if (s) s.checkedAt = s.checkedAt === null ? new Date().toISOString() : null;
    });
    // m4: checking the LAST remaining step flips planLine from "Leave by ...
    // · start by ..." to plain "Leave by ..." (buildDepartureWidgetData in
    // widgetSnapshot.ts keys that off allStepsChecked) — without this the
    // departure widget kept showing a stale "start by" after every step was
    // actually done. Harmless, not wasted, on every other toggle: an
    // unchanged planLine still triggers a real SharedPreferences write and
    // provider redraw (see WidgetBridgePlugin's own comment on why poking
    // both providers unconditionally is simpler than diffing first).
    void refreshWidgets();
  };

  // 'planned' -> 'running' without checking a step - the explicit "Start
  // getting ready" button (M3). Same transactional shape as toggleStep for
  // the same reason: a fast tap here immediately followed by a step tap
  // shouldn't be able to race on `startedAt`.
  const handleStart = async () => {
    void hapticImpact('light');
    await db.departures.where('id').equals(departure.id).modify((d) => {
      if (d.status === 'planned') {
        d.status = 'running';
        d.startedAt = d.startedAt ?? new Date().toISOString();
      }
    });
  };

  const handleLeave = async () => {
    void hapticImpact('heavy');
    await db.departures.update(departure.id, { status: 'left', leftAt: new Date().toISOString() });
    // Terminal status - no more staged alerts make sense once you've left.
    await cancelDepartureAlarms(departure.id);
    // Widgets increment: 'left' is no longer 'planned'/'running', so this
    // departure drops out of the widget's source pool — refresh so it
    // doesn't keep showing "Leave now" after you already have.
    void refreshWidgets();
    setJustLeft(true);
  };

  // M1/M2: abandoning is available from the live Runway screen for either
  // 'planned' or 'running' - this is the only place 'abandoned' is
  // actually reachable from. Same confirm copy and same consequence
  // (status 'abandoned' + cancelled alarms) as Home's "Remove" action on a
  // planned card; the two differ only in where they navigate afterwards.
  const handleAbandon = async () => {
    if (!window.confirm(ABANDON_CONFIRM)) return;
    await db.departures.update(departure.id, { status: 'abandoned' });
    await cancelDepartureAlarms(departure.id);
    // Widgets increment: same reasoning as handleLeave above — 'abandoned'
    // takes this departure out of the widget's source pool.
    void refreshWidgets();
    onNavigate({ name: 'home' });
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
    });
    // wrapUp shifts because the buffer changed (alarmTimes.ts) - reschedule
    // rather than leave the four staged alarms pointing at the old plan.
    // Past alarms are filtered inside computeAlarmTimes itself, so a slot
    // that's already fired (e.g. slot 0, "Start getting ready.") simply
    // doesn't get rescheduled - nothing to reimplement here.
    await scheduleDepartureAlarms({ ...departure, steps: result.steps, bufferMinutes: result.bufferMinutes });
    void refreshWidgets();
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
    void refreshWidgets();
    setReplanOpen(false);
  };

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

  // Step-focus increment: the step the overlay (if open) is showing, and
  // whether that's the CURRENT step - only the current step gets the live
  // countdown + tap-to-advance; see StepFocus's own header comment for why
  // a non-current step can't honestly have one. `currentStepAnchor` is only
  // computed (and only meaningful) for the current step - passing it
  // through unconditionally would invite StepFocus to (mis)use it for a
  // step that isn't running yet.
  const focusedStep = focusStepId ? (departure.steps.find((s) => s.id === focusStepId) ?? null) : null;
  const focusedStepIsCurrent = !!focusedStep && !!currentStep && focusedStep.id === currentStep.id;
  const focusAnchorIso = focusedStepIsCurrent ? currentStepAnchor(departure) : null;

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
    ? compressPlan({ availableMinutes: replanAvailableMinutes, steps: departure.steps, bufferMinutes: departure.bufferMinutes })
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
        leaveBy={projection.leaveBy}
        onBack={() => setFocusStepId(null)}
        onTap={focusedStepIsCurrent ? () => void advanceFocusAfterCheck() : undefined}
      />
    )}
    </>
  );
}
