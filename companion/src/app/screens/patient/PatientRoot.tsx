import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
// dexie-react-hooks: added in this increment (deferred in Increment 2
// because nothing rendered from the DB yet). It's Dexie's own official
// observability hook — built on Dexie's internal change tracking, not any
// extra browser API — so it works anywhere Dexie itself works, needs no
// hand-rolled "refetch after every write" bookkeeping, and adds ~1kB.
import { db, addEvent, deleteEvent, getRegimenForPatient } from '../../db/store';
import { usePatient } from '../../patient/usePatient';
import { buildMotorEvent, buildMealEvent, refineDyskinesia, shiftEventTime, eventLabel, formatTimeHM } from '../../patient/log';
import { buildDoseEvent, extraDoseChoices, doseLabel } from '../../patient/doses';
import { logEvent } from '../../activity/activityLog';
import type { PrimaryTap, DyskinesiaRefinement } from '../../../domain/motor';
import type { DrugId } from '../../../domain/drugs';
import type { MotorEvent, PatientEvent } from '../../../domain/types';
import type { RegimenItem } from '../../../domain/regimen';
import { Home, type LastAction } from './Home';
import { State } from './State';
import { Meal } from './Meal';
import { Dose } from './Dose';
import { EventDetail } from './EventDetail';
import { ReportProblem } from '../ReportProblem';

type PatientScreen =
  | { name: 'home' }
  | { name: 'state' }
  | { name: 'meal' }
  | { name: 'dose' }
  | { name: 'detail'; eventId: string }
  | { name: 'report' };

// Patient-mode router. Plain useState switch, no routing library — this app
// has four screens and no deep-linking need, so a library would be pure
// overhead.
export function PatientRoot() {
  const patient = usePatient();
  const [screen, setScreen] = useState<PatientScreen>({ name: 'home' });
  // Undo display rule (RESEARCH §1: no timeouts, no auto-dismiss under 8s).
  // There is no timer anywhere in this file: lastAction simply persists
  // until the NEXT log/delete replaces it, or Undo is tapped and clears it.
  // That trivially satisfies "at least 8 seconds" with zero timer code —
  // it's visible indefinitely, not just for a minimum duration.
  const [lastAction, setLastAction] = useState<LastAction>(null);
  // Holds the motor event most recently logged from the State screen, so
  // that a follow-up refine() call knows which event to mutate. Only ever
  // set right before entering the 'refine' phase; State.tsx owns the
  // pick/refine sub-state itself, this just remembers the target event.
  const lastMotorEventRef = useRef<MotorEvent | null>(null);

  // Debounce for tremor double-strikes (RESEARCH §1: "Debounce logging
  // buttons ~400-500ms so a tremor double-strike is one entry"). A plain
  // ref (not state) because flipping it must not cause a re-render — it's
  // read/written synchronously inside the same tick as the tap handler, and
  // a state update here would just be wasted render work.
  // Read-only regimen query, mirroring DoctorHome's exactly (SPEC RISK #3):
  // no bootstrap write here — usePatient() already owns the one
  // StrictMode-guarded write this screen depends on (creating the local
  // patient record, done once elsewhere); useLiveQuery only reads. Feeds
  // Home's Today's-doses section; nothing here ever writes a RegimenItem.
  const regimenItems = useLiveQuery(
    () => (patient ? getRegimenForPatient(db, patient.code) : Promise.resolve<RegimenItem[]>([])),
    [patient?.code],
  );

  const busyRef = useRef(false);
  function withDebounce(fn: () => void | Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    // The 450ms release timer starts now, not after `fn`'s DB write
    // resolves — it's measuring time-since-tap (the tremor window), not
    // write latency. A slow write must not extend the debounce window
    // beyond what the tremor rationale calls for.
    setTimeout(() => {
      busyRef.current = false;
    }, 450);
    void fn();
  }

  // Activity-log instrumentation lives in these per-intent handlers, not in
  // store.ts's addEvent: addEvent is intent-ambiguous (it's the same call
  // for a first log, an undo-restore, a refine-overwrite, and a time-shift
  // overwrite), so it can't produce a distinct log sentence on its own. The
  // handlers are the choke point where intent is actually known. This also
  // keeps store.ts thin and keeps logEvent free of any React dependency
  // (see activityLog.ts's module header — it must never import React).
  async function logMotor(primary: PrimaryTap) {
    if (!patient) return;
    const ev = buildMotorEvent(patient.code, primary, new Date().toISOString());
    await addEvent(db, ev);
    void logEvent('motor', `Logged motor state: ${eventLabel(ev)}`);
    setLastAction({ kind: 'logged', event: ev, label: 'State logged' });
    if (primary === 'on-dyskinesia') {
      // Stay on State (it shows the refine sub-screen); remember the event
      // so refine()/onDone() below know what to act on.
      lastMotorEventRef.current = ev;
    } else {
      setScreen({ name: 'home' });
    }
  }

  async function refine(refinement: DyskinesiaRefinement) {
    const target = lastMotorEventRef.current;
    if (!target) {
      setScreen({ name: 'home' });
      return;
    }
    const refined = refineDyskinesia(target, refinement);
    await addEvent(db, refined); // put = overwrite, same id as the unspecified event
    void logEvent('motor', `Refined motor state: ${eventLabel(refined)}`);
    // Keep lastAction in sync with the refined event (same id either way) so
    // a subsequent Undo deletes the refined version, not the unspecified one.
    setLastAction({ kind: 'logged', event: refined, label: 'State logged' });
    lastMotorEventRef.current = null;
    setScreen({ name: 'home' });
  }

  async function logMeal(protein: 'low' | 'high') {
    if (!patient) return;
    const ev = buildMealEvent(patient.code, protein, new Date().toISOString());
    await addEvent(db, ev);
    void logEvent('meal', `Logged meal: ${protein} protein`);
    setLastAction({ kind: 'logged', event: ev, label: 'Meal logged' });
    setScreen({ name: 'home' });
  }

  // Logs a dose. Deliberately does NOT setScreen — unlike logMotor/logMeal,
  // both of this handler's call sites need different navigation: tapping a
  // pending slot on Home stays on Home (the banner renders in place), while
  // the "Log another dose" picker navigates back to Home itself, at the call
  // site below. `scheduledTime` is undefined for the extra-dose path — see
  // the "Log another dose" wiring below, which omits the third argument.
  async function logDose(drug: DrugId, doseMg: number, scheduledTime?: string) {
    if (!patient) return;
    const ev = buildDoseEvent(patient.code, drug, doseMg, new Date().toISOString(), scheduledTime);
    await addEvent(db, ev);
    void logEvent(
      'dose',
      `Logged dose: ${doseLabel(drug, doseMg)}, ${scheduledTime === undefined ? 'unscheduled' : `${scheduledTime} slot`}`,
    );
    setLastAction({ kind: 'logged', event: ev, label: 'Dose logged' });
  }

  async function undo() {
    if (!lastAction) return;
    // Both branches are idempotent at the Dexie layer: deleteEvent on a
    // missing id is a no-op (nothing to delete), and addEvent (put) of an
    // id that's already there just overwrites it with the same data. So
    // Undo is safe even if, say, the same event was already removed by a
    // stale duplicate tap.
    if (lastAction.kind === 'logged') {
      await deleteEvent(db, lastAction.event.id);
      void logEvent(lastAction.event.kind, `Undo removed ${lastAction.event.kind} entry`);
    } else {
      await addEvent(db, lastAction.event);
      void logEvent(lastAction.event.kind, `Undo restored ${lastAction.event.kind} entry`);
    }
    setLastAction(null);
  }

  async function changeTime(event: PatientEvent, delta: number) {
    const shifted = shiftEventTime(event, delta, new Date().toISOString());
    await addEvent(db, shifted); // put overwrites in place
    void logEvent(event.kind, `Shifted ${event.kind} entry to ${formatTimeHM(shifted.at)}`);
  }

  async function deleteFromDetail(event: PatientEvent) {
    await deleteEvent(db, event.id);
    void logEvent(event.kind, `Deleted ${event.kind} entry`);
    setLastAction({ kind: 'deleted', event });
    setScreen({ name: 'home' });
  }

  // Renders nothing until the patient record is bootstrapped (single-digit
  // ms — see usePatient.ts). Nothing in this screen needs a spinner.
  if (!patient) return null;

  // No CSS transitions/animations anywhere in these four screens — that IS
  // how prefers-reduced-motion is honoured here. Nothing moves, so there is
  // nothing to gate behind a `@media (prefers-reduced-motion: reduce)`
  // query; adding one would be dead code for a state that never occurs.

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {screen.name === 'home' && (
        <Home
          patientCode={patient.code}
          lastAction={lastAction}
          regimenItems={regimenItems}
          onUndo={() => withDebounce(undo)}
          onLogState={() => setScreen({ name: 'state' })}
          onLogMeal={() => setScreen({ name: 'meal' })}
          onOpenEvent={(id) => setScreen({ name: 'detail', eventId: id })}
          onTakeDose={(slot) => withDebounce(() => logDose(slot.drug, slot.doseMg, slot.time))}
          onLogAnotherDose={() => setScreen({ name: 'dose' })}
          onReportProblem={() => setScreen({ name: 'report' })}
        />
      )}
      {screen.name === 'state' && (
        <State
          onLog={(primary) => withDebounce(() => logMotor(primary))}
          onRefine={(r) => withDebounce(() => refine(r))}
          onDone={() => {
            lastMotorEventRef.current = null;
            setScreen({ name: 'home' });
          }}
          onBack={() => setScreen({ name: 'home' })}
        />
      )}
      {screen.name === 'meal' && (
        <Meal onLog={(protein) => withDebounce(() => logMeal(protein))} onBack={() => setScreen({ name: 'home' })} />
      )}
      {screen.name === 'dose' && (
        <Dose
          choices={extraDoseChoices(regimenItems ?? [])}
          onLog={(c) =>
            withDebounce(() => {
              void logDose(c.drug, c.doseMg);
              setScreen({ name: 'home' });
            })
          }
          onBack={() => setScreen({ name: 'home' })}
        />
      )}
      {screen.name === 'detail' && (
        <EventDetailContainer
          eventId={screen.eventId}
          onChangeTime={changeTime}
          onDelete={(ev) => withDebounce(() => deleteFromDetail(ev))}
          onBack={() => setScreen({ name: 'home' })}
        />
      )}
      {screen.name === 'report' && (
        <ReportProblem screen="patient-home" onBack={() => setScreen({ name: 'home' })} />
      )}
    </div>
  );
}

// Small container that resolves an event id to the live event via
// useLiveQuery, so EventDetail itself can stay presentational (props in,
// callbacks out, no DB imports) per the module spec.
function EventDetailContainer({
  eventId,
  onChangeTime,
  onDelete,
  onBack,
}: {
  eventId: string;
  onChangeTime: (event: PatientEvent, delta: number) => void;
  onDelete: (event: PatientEvent) => void;
  onBack: () => void;
}) {
  // JUDGMENT CALL, flagged for the orchestrator: the spec's literal snippet
  // is `useLiveQuery(() => db.events.get(eventId), [eventId])`. Dexie's
  // `.get()` resolves to `undefined` both when the row doesn't exist AND
  // (per SPEC RISK #2) useLiveQuery's own pre-resolution default is also
  // `undefined` — the two "nothing yet" states are indistinguishable from
  // that return value alone. Taken literally, that means every detail-screen
  // open would read as "gone" on its first render (before the real fetch
  // resolves) and bounce straight back to Home. Wrapping the query to coerce
  // "not found" to `null` instead separates the two: `undefined` = still
  // loading (SPEC RISK #2's rule), `null` = resolved and truly gone.
  const event = useLiveQuery(async () => (await db.events.get(eventId)) ?? null, [eventId]);

  // The "event is gone" navigation is done in an effect, not directly in the
  // render body: calling onBack() (which sets state on the parent
  // PatientRoot) during this component's render would trigger React's
  // "cannot update a component while rendering a different component"
  // warning. An effect defers it to after the render commits, which is safe.
  useEffect(() => {
    if (event === null) onBack();
  }, [event, onBack]);

  // undefined = still loading → render nothing yet.
  if (event === undefined) return null;
  // null = resolved and gone (deleted in another tab, or Undo raced it
  // away) — the effect above already queued the navigation home.
  if (event === null) return null;

  return (
    <EventDetail
      event={event}
      onChangeTime={(delta) => onChangeTime(event, delta)}
      onDelete={() => onDelete(event)}
      onBack={onBack}
    />
  );
}
