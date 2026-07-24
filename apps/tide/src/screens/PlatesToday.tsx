import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import type { Meal, MealKind } from '../db/types';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Card } from '../ui/Card';
import { compositionChips, formatPlateKcal } from '../lib/plateEstimate';
import { localDayBoundsIso } from '../lib/healthSync';

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

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Plates today" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      {meals !== undefined && meals.length === 0 && <p className="text-slate-400">No plates logged today.</p>}

      <div className="flex flex-col gap-2">
        {(meals ?? []).map((meal) => (
          <PlateRow key={meal.id} meal={meal} />
        ))}
      </div>
    </div>
  );
}

function PlateRow({ meal }: { meal: Meal }) {
  const at = new Date(meal.at);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const kcalText = formatPlateKcal(meal.estimatedKcal);

  return (
    <Card className="flex flex-col gap-1">
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
    </Card>
  );
}
