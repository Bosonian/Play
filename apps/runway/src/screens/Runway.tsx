import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';

interface RunwayProps {
  departureId: string;
  onNavigate: (screen: Screen) => void;
}

// Placeholder for increment 1. The live projection screen — the whole
// point of the app (RUNWAY_PLAN.md §4) — is scoped to increment 2. This
// screen exists now only so Home's "tap an upcoming departure" link has
// somewhere real to go, backed by real data.
export function Runway({ departureId, onNavigate }: RunwayProps) {
  const departure = useLiveQuery(() => db.departures.get(departureId), [departureId]);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Runway" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      {departure && (
        <p className="text-lg text-slate-100">{departure.name}</p>
      )}

      <p className="text-slate-400">Runway screen arrives in increment 2.</p>
    </div>
  );
}
