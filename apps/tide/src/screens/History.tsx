import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Card } from '../ui/Card';

interface HistoryProps {
  onNavigate: (screen: Screen) => void;
}

/** Runway's own field-tested lesson, carried over verbatim (see its
 * History.tsx / README): "data with no surface reads as lost." A weigh-in
 * saved through WeighInEntry needs somewhere it's visibly there, or the
 * feature might as well not persist it. */
export function History({ onNavigate }: HistoryProps) {
  // Ascending by the indexed `at` field, then reversed in JS — same idiom
  // Runway's own History.tsx uses (see its comment there): Dexie's
  // reverse() doesn't reliably combine with every query shape, and
  // reversing an already-small in-memory array costs nothing worth
  // avoiding it for.
  const weighIns = useLiveQuery(async () => {
    const rows = await db.weighIns.orderBy('at').toArray();
    return rows.reverse();
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="History" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      {weighIns !== undefined && weighIns.length === 0 && (
        <p className="text-slate-400">No weigh-ins yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {(weighIns ?? []).map((weighIn) => {
          const at = new Date(weighIn.at);
          return (
            <Card key={weighIn.id} className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-slate-100 tabular-nums">{weighIn.weightKg.toFixed(1)} kg</span>
                <span className="text-sm text-slate-500">
                  {at.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  {' · '}
                  {at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              </div>
              {weighIn.bodyFatPct !== null && (
                <span className="text-sm text-slate-400 tabular-nums">{weighIn.bodyFatPct.toFixed(1)}% BF</span>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
