import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import type { Meal, MealKind } from '../db/types';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { compositionChips, formatPlateKcal } from '../lib/plateEstimate';
import { localDayBoundsIso } from '../lib/healthSync';
import { DELETE_CONFIRM_WINDOW_MS, isArmStillValid } from '../lib/deleteArm';
import { logEvent } from '../lib/eventLog';
import { hapticImpact } from '../native/haptics';

interface PlatesTodayProps {
  onNavigate: (screen: Screen) => void;
}

const KIND_LABELS: Record<MealKind, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  skipped: 'Skipped meal',
};

/** Runway's own field-tested lesson, carried over verbatim (see History.tsx
 * here and Runway's own History.tsx/README): "data with no surface reads
 * as lost." A plate saved through PlateCheckIn needs somewhere it's
 * visibly there today, or the check-in might as well not persist it.
 *
 * Deliberately scoped to TODAY's list only — no day total, no weekly view.
 * TIDE_PLAN.md §5.5's ambient daily-shape picture (a total against a
 * day-sized target) is increment 5's job, not this one's; CLAUDE.md's
 * defaults-lean-smaller rule says build the smaller surface first and let
 * a real need ask for more, not pre-build the total before increment 5's
 * actual design for it exists.
 */
export function PlatesToday({ onNavigate }: PlatesTodayProps) {
  // Device-local calendar day, not UTC — see localDayBoundsIso's own doc
  // comment (healthSync.ts) for why a UTC boundary would be wrong here
  // (it would drift a day off for part of every evening in Stuttgart).
  // Ascending by the indexed `at` field, then reversed in JS for
  // newest-first — same idiom History.tsx uses (see its own comment):
  // reversing an already-small in-memory array costs nothing worth
  // avoiding it for.
  //
  // The bounds are computed once per mount (the `[]` deps), so if the app
  // is left open across local midnight this list keeps showing the old
  // day until the next write or remount — the SAME accepted day-rollover
  // tradeoff Home.tsx documents for its own movement/count reads (see its
  // comment there). Re-opening picks up reality; a mounted screen doesn't
  // actively watch the clock. Named here rather than left implicit.
  const meals = useLiveQuery(async () => {
    const { startIso, endIso } = localDayBoundsIso();
    const rows = await db.meals.where('at').between(startIso, endIso, true, false).toArray();
    return rows.reverse();
  }, []);

  // Delete-a-plate increment (6) — same arm/confirm interaction as
  // History.tsx's weigh-in rows, same reasoning (a mis-tapped plate is
  // permanent with no delete path); see that file's own comments for the
  // full explanation of each piece. Lifted to THIS component (not
  // PlateRow below) because only one row across the whole list may be
  // expanded/armed at a time — PlateRow stays a plain presentational
  // component driven by props, same shape it already had.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [armedAtMs, setArmedAtMs] = useState<number | null>(null);
  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armTimeoutRef.current !== null) clearTimeout(armTimeoutRef.current);
    };
  }, []);

  function clearArmTimeout() {
    if (armTimeoutRef.current !== null) {
      clearTimeout(armTimeoutRef.current);
      armTimeoutRef.current = null;
    }
  }

  function disarm() {
    clearArmTimeout();
    setArmedAtMs(null);
  }

  function handleRowTap(id: string) {
    disarm();
    setExpandedId((current) => (current === id ? null : id));
  }

  function handleRemoveTap(id: string) {
    const now = Date.now();
    if (isArmStillValid(armedAtMs, now)) {
      void performDelete(id);
      return;
    }
    setArmedAtMs(now);
    clearArmTimeout();
    armTimeoutRef.current = setTimeout(() => setArmedAtMs(null), DELETE_CONFIRM_WINDOW_MS);
  }

  async function performDelete(id: string) {
    const meal = (meals ?? []).find((m) => m.id === id);
    disarm();
    setExpandedId(null);
    await db.meals.delete(id);
    void hapticImpact('light');
    if (meal) {
      const at = new Date(meal.at);
      // "24 Jul, 13:42" — unlike History's weigh-in removal line, this
      // includes the TIME, not just the date: every row in this list is
      // already today, so the date alone would collapse every deletion on
      // this screen to the same "removed: 24 Jul" line — the time is what
      // actually distinguishes one deletion from the next in the log.
      const dateTimeLabel = `${at.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}, ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
      // Mirrors PlateCheckIn.tsx's own "Plate logged:"/"Skipped meal
      // logged." split (draft.kind is lowercased there; kept lowercase
      // here too, for the same reason — these are log lines, not UI
      // labels, and match the save-time phrasing exactly so a trace
      // through the log reads as one consistent voice).
      const message =
        meal.kind === 'skipped'
          ? `Skipped meal removed: ${dateTimeLabel}.`
          : `Plate removed: ${meal.kind}, ${dateTimeLabel}.`;
      void logEvent('meal', message);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Plates today" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      {meals !== undefined && meals.length === 0 && <p className="text-slate-400">No plates logged today.</p>}

      <div className="flex flex-col gap-2">
        {(meals ?? []).map((meal) => (
          <PlateRow
            key={meal.id}
            meal={meal}
            isExpanded={expandedId === meal.id}
            isArmed={expandedId === meal.id && armedAtMs !== null}
            onRowTap={() => handleRowTap(meal.id)}
            onRemoveTap={() => handleRemoveTap(meal.id)}
            onRemoveBlur={disarm}
          />
        ))}
      </div>
    </div>
  );
}

interface PlateRowProps {
  meal: Meal;
  isExpanded: boolean;
  isArmed: boolean;
  onRowTap: () => void;
  onRemoveTap: () => void;
  onRemoveBlur: () => void;
}

/** A plain bordered <div> wrapping an inner <button> (the tappable row) plus
 * a sibling "Remove" TextAction (its own <button>) — not the <Card>
 * primitive, which renders as a SINGLE <button> around its whole content.
 * See History.tsx's own comment on the identical row-shape change there for
 * why: this row needs two independent tap targets now, and nesting a
 * <button> inside another <button> is invalid HTML. */
function PlateRow({ meal, isExpanded, isArmed, onRowTap, onRemoveTap, onRemoveBlur }: PlateRowProps) {
  const at = new Date(meal.at);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const kcalText = formatPlateKcal(meal.estimatedKcal);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800/60 bg-surface">
      <button
        type="button"
        onClick={onRowTap}
        className="flex min-h-12 w-full flex-col gap-1 p-4 text-left transition-colors hover:bg-raised/70 active:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      >
        <div className="flex items-center justify-between">
          <span className="text-slate-100">{KIND_LABELS[meal.kind]}</span>
          <span className="text-sm text-slate-500 tabular-nums">{time}</span>
        </div>
        {/* For a skipped meal, `compositionChips` returns exactly
            `['Skipped meal']` — the same string the header line above
            already shows, so this row is skipped entirely rather than
            repeating it. Every other kind shows its chips (and, unlike a
            skip, always has a non-empty `kcalText` — see
            `estimatePlateKcal`'s own doc comment for why only a skip
            produces `null`). */}
        {meal.kind !== 'skipped' && (
          <>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {compositionChips(meal).map((chip) => (
                <span key={chip} className="text-sm text-slate-400">
                  {chip}
                </span>
              ))}
            </div>
            {kcalText && <span className="text-sm text-slate-500">{kcalText}</span>}
          </>
        )}
      </button>
      {isExpanded && (
        <div className="flex justify-end border-t border-slate-800/60 px-4 py-2">
          <TextAction onClick={onRemoveTap} onBlur={onRemoveBlur}>
            {isArmed ? 'Tap again to remove' : 'Remove'}
          </TextAction>
        </div>
      )}
    </div>
  );
}
