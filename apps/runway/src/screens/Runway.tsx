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
import { currentStepElapsed } from '../lib/currentStepElapsed';
import { useNow } from '../hooks/useNow';
import { formatAppointmentLine, formatSlackLine, formatTime } from '../lib/format';
import { allowSleep, keepAwake } from '../native/keepAwake';
import { hapticImpact } from '../native/haptics';
import { cancelDepartureAlarms, scheduleDepartureAlarms } from '../native/notifications';
import { readLiveTravelConfig } from '../lib/liveTravelSettings';
import { useLiveTravel } from '../hooks/useLiveTravel';
import { refreshWidgets } from '../native/widgets';
import { compressPlan } from '../lib/replan';
import type { CompressResult } from '../lib/replan';

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

  if (justLeft) {
    // leaveBy (appointment minus travel) doesn't depend on `now` - see
    // projection.ts - so the argument passed here is arbitrary. appointmentAt
    // is used rather than the live clock so this stays a fixed fact about
    // *this* departure rather than looking like it tracks the wall clock.
    const leaveBy = computeProjection(new Date(departure.appointmentAt), departure).leaveBy;
    const leftAtDate = new Date(departure.leftAt ?? new Date().toISOString());
    const slipMinutes = Math.round((leftAtDate.getTime() - leaveBy.getTime()) / 60_000);

    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 px-4 pb-12 pt-safe-top text-center">
        <p className="text-lg text-slate-100">{departure.name}</p>
        <p className="text-sm text-slate-500">
          Appointment {formatTime(new Date(departure.appointmentAt))}
        </p>
        <p className="mt-4 text-2xl font-semibold tabular-nums text-slate-100">
          Logged {formatTime(leftAtDate)}. Safe travels.
        </p>
        <p className="tabular-nums text-slate-400">Planned to leave by {formatTime(leaveBy)}.</p>
        <p className="tabular-nums text-slate-400">
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
  // F1 spec: "Edit link only if the edit path applies" - reachable here
  // means status is 'planned' or 'running' (the TERMINAL_STATUSES guard
  // above already returned for anything else), and F3 makes Edit available
  // on Home for both of those, so the clause always applies wherever this
  // component can render it. Kept as an explicit condition (rather than a
  // hardcoded `true`) so a future status this screen might gain doesn't
  // silently inherit an edit link that isn't actually offered anywhere.
  const editPathApplies = departure.status === 'planned' || departure.status === 'running';

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader
          title={`${departure.name} · ${departure.destination || 'No destination set'}`}
          onBack={() => onNavigate({ name: 'home' })}
        />
      </div>

      {/* THE CENTERPIECE - legible from across the room. */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p className={`text-huge font-bold tabular-nums ${textAccent}`}>
          {formatTime(projection.projectedArrival)}
        </p>
        <p className="text-lg tabular-nums text-slate-500">
          {formatAppointmentLine(new Date(departure.appointmentAt), now)}
        </p>
        {liveTravelLine && <p className="text-sm tabular-nums text-slate-500">{liveTravelLine}</p>}
        <p className={`text-base font-medium tabular-nums ${textAccent}`}>
          {formatSlackLine(projection.slackMinutes)}
        </p>
      </div>

      {departure.status === 'planned' && (
        <Button onClick={() => void handleStart()} className="w-full">
          Start getting ready
        </Button>
      )}

      {/* F1: the hint area. Three mutually exclusive states: the confirm
          block (once tapped open), the late-only prompt (projection.state
          === 'late', unopened), or nothing at all (calm/tight, unopened) -
          never a modal, never applied without the explicit "Apply" tap
          below. */}
      {replanOpen && replanResult ? (
        replanResult.fits && replanNeededMinutes <= replanAvailableMinutes ? (
          // compressPlan never expands a plan, so when the remaining plan
          // already fits the time left it returns it unchanged — offering an
          // Apply here would be a button that does nothing ("replan makes no
          // change", reported from real use). Say the true thing instead.
          <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm text-slate-200">
              The plan already fits — {replanAvailableMinutes - replanNeededMinutes} min to spare. Nothing to
              compress.
            </p>
            <Button variant="secondary" onClick={() => setReplanOpen(false)}>
              Close
            </Button>
          </div>
        ) : replanResult.fits ? (
          <div className="flex flex-col gap-3 rounded-lg border border-sky-800/60 bg-sky-950/30 p-4">
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
          <div className="flex flex-col gap-3 rounded-lg border border-red-800/60 bg-red-950/20 p-4">
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
            className="min-h-11 rounded-md text-left text-sm font-medium text-amber-400 hover:text-amber-300"
          >
            The plan no longer fits. Replan from now?
          </button>
        )
      )}

      {allChecked ? (
        <div className={`flex flex-col items-center gap-2 rounded-lg border ${border} bg-slate-900 p-6 text-center`}>
          <p className="text-2xl font-semibold text-slate-100">Leave now.</p>
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
        <div className="flex flex-col gap-4">
          {currentStep && (
            <div className={`rounded-lg border ${border} bg-slate-900 p-4`}>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => toggleStep(currentStep)}
                  className="mt-1 h-6 w-6 shrink-0 rounded border-slate-700 bg-slate-950 text-sky-500 focus:ring-sky-500"
                />
                <span className="flex flex-1 flex-col gap-1">
                  <span className="text-lg font-medium text-slate-100">{currentStep.name || 'Step'}</span>
                  {elapsed ? (
                    <span
                      className={`text-sm tabular-nums ${
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
                </span>
              </label>
            </div>
          )}

          {laterSteps.length > 0 && (
            <div className="flex flex-col gap-2">
              {laterSteps.map((step) => (
                <label
                  key={step.id}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-slate-800 bg-slate-900/60 px-4 py-2"
                >
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggleStep(step)}
                    className="h-5 w-5 shrink-0 rounded border-slate-700 bg-slate-950 text-sky-500 focus:ring-sky-500"
                  />
                  <span className="flex-1 text-slate-300">{step.name || 'Step'}</span>
                  <span className="text-sm tabular-nums text-slate-500">{step.plannedMinutes} min</span>
                </label>
              ))}
            </div>
          )}

          {checkedSteps.length > 0 && (
            <div className="flex flex-col gap-1">
              {checkedSteps.map((step) => (
                <label key={step.id} className="flex min-h-11 items-center gap-3 rounded-md px-4 py-1 opacity-50">
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => toggleStep(step)}
                    className="h-5 w-5 shrink-0 rounded border-slate-700 bg-slate-950 text-sky-500 focus:ring-sky-500"
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
          ("The plan no longer fits. Replan from now?"). */}
      <div className="flex items-center justify-center gap-6">
        <button
          onClick={() => setReplanOpen(true)}
          className="min-h-11 text-sm font-medium text-slate-600 hover:text-slate-300"
        >
          Replan from now.
        </button>
        <button
          onClick={() => void handleAbandon()}
          className="min-h-11 text-sm font-medium text-slate-600 hover:text-red-400"
        >
          Abandon this departure
        </button>
      </div>
    </div>
  );
}
