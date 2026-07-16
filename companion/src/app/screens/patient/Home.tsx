import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/store';
import { getEventsInRange } from '../../db/store';
import { eventLabel, formatTimeHM, todayRangeISO } from '../../patient/log';
import { expandSchedule, markTakenSlots, groupSlotsByDaypart, doseLabel, takenVerb, type DoseSlot } from '../../patient/doses';
import type { PatientEvent } from '../../../domain/types';
import type { RegimenItem } from '../../../domain/regimen';
import type { SlotId } from '../../../domain/grid';

// Tailwind can't see dynamically-built class names like `bg-tint-${slotId}`
// (SPEC RISK #6) — its content scan only matches literal strings it finds in
// source, so a template-built class would be purged from the production CSS
// even though it works in dev. This static Record is the workaround: every
// class name appears here as a full literal, so the Tailwind scan finds it.
const DAYPART_CLASSES: Record<
  SlotId,
  { bg: string; headerText: string; ringBorder: string; ringFill: string; checkText: string }
> = {
  morgens: {
    bg: 'bg-tint-morning',
    headerText: 'text-tint-morning-accent',
    ringBorder: 'border-tint-morning-accent',
    ringFill: 'bg-tint-morning-accent',
    checkText: 'text-tint-morning',
  },
  mittags: {
    bg: 'bg-tint-midday',
    headerText: 'text-tint-midday-accent',
    ringBorder: 'border-tint-midday-accent',
    ringFill: 'bg-tint-midday-accent',
    checkText: 'text-tint-midday',
  },
  abends: {
    bg: 'bg-tint-evening',
    headerText: 'text-tint-evening-accent',
    ringBorder: 'border-tint-evening-accent',
    ringFill: 'bg-tint-evening-accent',
    checkText: 'text-tint-evening',
  },
  nachts: {
    bg: 'bg-tint-night',
    headerText: 'text-tint-night-accent',
    ringBorder: 'border-tint-night-accent',
    ringFill: 'bg-tint-night-accent',
    checkText: 'text-tint-night',
  },
};

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
  onReportProblem: () => void;
}

// Presentational only: props in, callbacks out. The one exception is the
// live "Today" query below, which the spec deliberately keeps here (rather
// than threaded through as a prop) since it's the one piece of read-only,
// always-fresh state this screen owns end to end. It now has THREE
// consumers, all reading the same resolved `events`: the Today's-doses
// section's taken/pending marking (markTakenSlots), the Recent-activity
// timeline below, and that timeline's consumed-id filter (which excludes
// exactly the events markTakenSlots already ticked) — one query, read three
// times, so the checklist and the timeline can never disagree about what's
// actually been logged today.
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
  onReportProblem,
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
            groupSlotsByDaypart(slotStatuses).map((group, i) => {
              const cls = DAYPART_CLASSES[group.slotId];
              return (
                <div key={group.slotId} className={i === 0 ? 'mt-4' : 'mt-10'}>
                  <h3 className={`text-label font-medium ${cls.headerText}`}>{group.label}</h3>
                  <div className="mt-3 space-y-8">
                    {group.statuses.map((status) => {
                      const key = `${status.slot.itemId}-${status.slot.time}`;
                      if (status.takenAt === null) {
                        return <PendingDoseCard key={key} slot={status.slot} cls={cls} onTakeDose={onTakeDose} />;
                      }
                      // Narrow eventId explicitly rather than !-asserting it
                      // from takenAt (SPEC RISK): markTakenSlots always sets
                      // both together, but an assertion here would silently
                      // paper over a future violation of that invariant
                      // instead of surfacing it. If eventId is ever null
                      // despite takenAt being set, fall back to the pending
                      // render rather than wiring a tap target to a
                      // non-existent event id.
                      if (status.eventId === null) {
                        return <PendingDoseCard key={key} slot={status.slot} cls={cls} onTakeDose={onTakeDose} />;
                      }
                      return (
                        <TakenDoseCard
                          key={key}
                          slot={status.slot}
                          cls={cls}
                          takenAt={status.takenAt}
                          eventId={status.eventId}
                          onOpenEvent={onOpenEvent}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {slotStatuses !== undefined && slotStatuses.length > 0 && (
        <button
          type="button"
          onClick={onLogAnotherDose}
          className="mt-8 self-start text-label text-fg-muted underline underline-offset-2"
        >
          Log another dose
        </button>
      )}

      {/* Heroes stay below ~4×88px of dose cards on a 4-slot regimen — the
          honest tradeoff: RESEARCH's ≥8mm tap-target gaps forbid compressing
          the checklist any further, so a heavy regimen pushes "How I feel
          now" further down the page than ideal. Accepted, not fixed here. */}
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

      {todayEvents !== undefined && slotStatuses !== undefined && (
        <>
          <h2 className="mt-12 text-label text-fg-muted">Recent activity</h2>
          {(() => {
            // Consumed ids are exactly the ticked doses (markTakenSlots'
            // eventId) — excluding only those from the timeline keeps
            // rescue/orphaned/duplicate doses and all motor/meal events
            // visible. This is de-dup, not deletion: nothing here is hidden
            // except the events already shown as a tick above.
            const consumedIds = new Set(
              slotStatuses.filter((s) => s.eventId !== null).map((s) => s.eventId!),
            );
            const visibleEvents = todayEvents.filter((ev) => !consumedIds.has(ev.id));
            return visibleEvents.length === 0 ? (
              <p className="mt-4 text-body text-fg-muted">No other activity today.</p>
            ) : (
              <div className="mt-4 space-y-8">
                {visibleEvents.map((ev) => (
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
            );
          })()}
        </>
      )}

      <button
        type="button"
        onClick={onReportProblem}
        className="mt-12 self-start text-label text-fg-muted underline underline-offset-2"
      >
        Report a problem
      </button>
    </div>
  );
}

type DaypartCardClasses = (typeof DAYPART_CLASSES)[SlotId];

// A pending dose slot: tap logs it now (RESEARCH §1 — one tap, timestamp
// auto-captured). Hollow ring is the shape-cue (SPEC RISK #2 — colour is
// never the only signal that a dose is outstanding).
function PendingDoseCard({
  slot,
  cls,
  onTakeDose,
}: {
  slot: DoseSlot;
  cls: DaypartCardClasses;
  onTakeDose: (slot: DoseSlot) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onTakeDose(slot)}
      className={`flex min-h-[88px] w-full items-center justify-between rounded-md px-4 text-left ${cls.bg}`}
    >
      <span className="flex items-center gap-4">
        <span className={`h-7 w-7 shrink-0 rounded-full border-2 ${cls.ringBorder}`} aria-hidden="true" />
        <span className="text-title font-medium text-fg">{doseLabel(slot.drug, slot.doseMg)}</span>
      </span>
      <span className="text-body-lg tabular-nums text-fg-muted">{slot.time}</span>
    </button>
  );
}

// A taken dose slot: tap opens the matched event's detail (navigation, not
// logging — no debounce needed here, see PatientRoot.tsx). Filled ring +
// check is the shape-cue; the "Taken · HH:MM" text beneath restates the same
// fact in words, so colour is never the only signal (SPEC RISK #2).
function TakenDoseCard({
  slot,
  cls,
  takenAt,
  eventId,
  onOpenEvent,
}: {
  slot: DoseSlot;
  cls: DaypartCardClasses;
  takenAt: string;
  eventId: string;
  onOpenEvent: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenEvent(eventId)}
      className={`flex min-h-[76px] w-full items-center justify-between rounded-md px-4 text-left ${cls.bg}`}
    >
      <span className="flex items-center gap-4">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${cls.ringFill}`}
          aria-hidden="true"
        >
          <svg
            className={cls.checkText}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8.5l3.2 3.2L13 4.8" />
          </svg>
        </span>
        <span className="flex flex-col">
          <span className="text-body-lg text-fg-muted">{doseLabel(slot.drug, slot.doseMg)}</span>
          <span className="text-body text-fg-muted">
            {takenVerb(slot.drug)} · {formatTimeHM(takenAt)}
          </span>
        </span>
      </span>
      <span className="text-body-lg tabular-nums text-fg-muted">{slot.time}</span>
    </button>
  );
}
