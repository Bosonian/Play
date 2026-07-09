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
import { formatTime } from '../lib/format';
import { allowSleep, keepAwake } from '../native/keepAwake';
import { hapticImpact } from '../native/haptics';
import { cancelDepartureAlarms } from '../native/notifications';

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

  // "I'm out the door" flips status to 'left' immediately, so calibration
  // data (leftAt) is correct even if the tab closes right after the tap -
  // but the richer one-time copy ("Logged 14:32. Safe travels.") is only
  // right in the instant it happens. Reopening an already-'left' departure
  // later should show the plain terminal note instead. Local state (not
  // the persisted status) is what distinguishes those two moments.
  const [justLeft, setJustLeft] = useState(false);

  // Starting a run: flip 'planned' -> 'running' and stamp startedAt, once.
  // Guarded by the status check itself rather than a ref - once this write
  // lands, departure.status is 'running' on the next render and the
  // condition is false, so this can't loop or re-stamp startedAt.
  useEffect(() => {
    if (departure && departure.status === 'planned') {
      void db.departures.update(departure.id, {
        status: 'running',
        startedAt: departure.startedAt ?? new Date().toISOString(),
      });
    }
  }, [departure]);

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

  // Arrow functions assigned to `const`, not `function` declarations: a
  // hoisted function declaration loses TS's narrowing of `departure` (from
  // the `if (!departure) return` guard above) because hoisting means it
  // could, in principle, run before the guard. A `const` closure created
  // after the guard keeps the narrowed (non-undefined) type.
  const toggleStep = async (step: DepartureStep) => {
    void hapticImpact('light');
    const steps = departure.steps.map((s) =>
      s.id === step.id ? { ...s, checkedAt: s.checkedAt === null ? new Date().toISOString() : null } : s,
    );
    await db.departures.update(departure.id, { steps });
  };

  const handleLeave = async () => {
    void hapticImpact('heavy');
    await db.departures.update(departure.id, { status: 'left', leftAt: new Date().toISOString() });
    // Terminal status - no more staged alerts make sense once you've left.
    await cancelDepartureAlarms(departure.id);
    setJustLeft(true);
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

  // Live view - status is 'running', or the instant of 'planned' before the
  // effect above lands its write. RUNWAY_PLAN.md §4's one equation,
  // recomputed every tick from `now`.
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
          Appointment {formatTime(new Date(departure.appointmentAt))}
        </p>
        <p className={`text-base font-medium tabular-nums ${textAccent}`}>
          {projection.slackMinutes >= 0
            ? `${projection.slackMinutes} min of slack`
            : `${Math.abs(projection.slackMinutes)} min past your appointment`}
        </p>
      </div>

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
                      {elapsed.elapsedMinutes}m on this step · planned {currentStep.plannedMinutes}m
                    </span>
                  ) : (
                    <span className="text-sm tabular-nums text-slate-500">
                      planned {currentStep.plannedMinutes}m
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
    </div>
  );
}
