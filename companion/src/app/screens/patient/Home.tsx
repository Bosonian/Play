import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/store';
import { getEventsInRange } from '../../db/store';
import { eventLabel, formatTimeHM, todayRangeISO } from '../../patient/log';
import { expandSchedule, markTakenSlots, doseLabel, takenVerb, type DoseSlot } from '../../patient/doses';
import type { PatientEvent } from '../../../domain/types';
import type { RegimenItem } from '../../../domain/regimen';

export type LastAction =
  | { kind: 'logged'; event: PatientEvent; label: string }
  | { kind: 'deleted'; event: PatientEvent }
  | null;

interface HomeProps {
  patientCode: string;
  lastAction: LastAction;
  regimenItems: RegimenItem[] | undefined;
  onUndo: () => void;
  onLogState: () => void;
  onLogMeal: () => void;
  onOpenEvent: (id: string) => void;
  onTakeDose: (slot: DoseSlot) => void;
  onLogAnotherDose: () => void;
}

// Presentational only: props in, callbacks out. The one exception is the
// live "Today" query below, which the spec deliberately keeps here (rather
// than threaded through as a prop) since it's the one piece of read-only,
// always-fresh state this screen owns end to end. As of the dose-logging
// increment it has TWO consumers: the Today timeline below, and the
// Today's-doses section's taken/pending marking (markTakenSlots) — one query,
// read twice, so the timeline and the dose checklist can never disagree about
// what's actually been logged today.
export function Home({
  patientCode,
  lastAction,
  regimenItems,
  onUndo,
  onLogState,
  onLogMeal,
  onOpenEvent,
  onTakeDose,
  onLogAnotherDose,
}: HomeProps) {
  const dateHeading = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const events = useLiveQuery(() => {
    const { startISO, endISO } = todayRangeISO(new Date());
    return getEventsInRange(db, patientCode, startISO, endISO);
  }, [patientCode]);

  // useLiveQuery returns undefined while its first result is pending (SPEC
  // RISK #2) — treat that as "loading", not "empty", so we never flash a
  // false "Nothing logged yet today" before the real data arrives.
  const todayEvents = events ? [...events].reverse() : undefined; // newest first

  // Same undefined-gating rule applies to the dose checklist below: render
  // nothing until BOTH the regimen and today's events have resolved, so we
  // never flash "No medications set up yet." for a regimen that's actually
  // still loading.
  const slotStatuses =
    regimenItems && events ? markTakenSlots(expandSchedule(regimenItems), events) : undefined;

  return (
    <div className="flex flex-col">
      <h1 className="text-title text-fg">{dateHeading}</h1>

      {lastAction && (
        <div className="mt-4 flex min-h-[76px] items-center justify-between gap-4 rounded-md bg-surface-soft p-4">
          <p className="text-body-lg text-fg">
            {lastAction.kind === 'deleted'
              ? 'Entry deleted'
              : `${lastAction.label} · ${formatTimeHM(lastAction.event.at)}`}
          </p>
          <button
            type="button"
            onClick={onUndo}
            className="min-h-[76px] min-w-[76px] shrink-0 rounded-md border border-line text-body-lg text-fg"
          >
            Undo
          </button>
        </div>
      )}

      {slotStatuses !== undefined && (
        <div className="mt-12">
          <h2 className="text-label text-fg-muted">{"Today's doses"}</h2>
          {slotStatuses.length === 0 ? (
            <p className="mt-4 text-body text-fg-muted">No medications set up yet.</p>
          ) : (
            <div className="mt-4 space-y-8">
              {slotStatuses.map(({ slot, takenAt }) =>
                takenAt === null ? (
                  <button
                    key={`${slot.itemId}-${slot.time}`}
                    type="button"
                    onClick={() => onTakeDose(slot)}
                    className="flex min-h-[88px] w-full items-center justify-between rounded-md border border-line bg-surface px-4 text-left"
                  >
                    <span className="text-title font-medium text-fg">{doseLabel(slot.drug, slot.doseMg)}</span>
                    <span className="text-body-lg tabular-nums text-fg-muted">{slot.time}</span>
                  </button>
                ) : (
                  <div
                    key={`${slot.itemId}-${slot.time}`}
                    className="flex min-h-[76px] w-full items-center justify-between rounded-md bg-surface-soft px-4"
                  >
                    <span className="flex flex-col">
                      <span className="text-body-lg text-fg-muted">{doseLabel(slot.drug, slot.doseMg)}</span>
                      <span className="text-body text-fg-muted">
                        {takenVerb(slot.drug)} · {formatTimeHM(takenAt)}
                      </span>
                    </span>
                    <span className="text-body-lg tabular-nums text-fg-muted">{slot.time}</span>
                  </div>
                ),
              )}
              <button
                type="button"
                onClick={onLogAnotherDose}
                className="flex min-h-[76px] w-full items-center justify-between rounded-md border border-line bg-surface px-4 text-left"
              >
                <span className="text-body-lg text-fg">Log another dose</span>
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-12 space-y-12">
        <button
          type="button"
          onClick={onLogState}
          className="min-h-[120px] w-full rounded-md bg-accent text-title font-medium text-white"
        >
          How I feel now
        </button>
        <button
          type="button"
          onClick={onLogMeal}
          className="min-h-[120px] w-full rounded-md border border-line bg-surface text-title font-medium text-fg"
        >
          Log a meal
        </button>
      </div>

      <h2 className="mt-12 text-label text-fg-muted">Today</h2>
      {todayEvents === undefined ? null : todayEvents.length === 0 ? (
        <p className="mt-4 text-body text-fg-muted">Nothing logged yet today.</p>
      ) : (
        <div className="mt-4 space-y-8">
          {todayEvents.map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={() => onOpenEvent(ev.id)}
              className="flex min-h-[76px] w-full items-center justify-between rounded-md border border-line bg-surface px-4"
            >
              <span className="text-body-lg text-fg">{eventLabel(ev)}</span>
              <span className="text-body-lg tabular-nums text-fg-muted">{formatTimeHM(ev.at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
