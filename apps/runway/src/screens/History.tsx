import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Departure } from '../db/types';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { medianMinutes, slipMinutes } from '../lib/calibration';
import { formatDateDisplay, formatTime } from '../lib/format';

interface HistoryProps {
  onNavigate: (screen: Screen) => void;
}

const HISTORY_LIMIT = 10;

function arrivalResultLabel(departure: Departure): string {
  switch (departure.arrivalResult) {
    case 'early':
      return 'early';
    case 'onTime':
      return 'on time';
    case 'late':
      return `late +${departure.arrivalLateMinutes ?? 0} min`;
    case null:
      return '—';
  }
}

/** Moments (UI-polish increment): "early"/"on time" get the emerald-300
 * acknowledgment tone exclusively; "late" stays red-400; no result yet
 * ('—') stays the row's ordinary secondary tone. Kept separate from
 * `arrivalResultLabel` above so the wording (unchanged) and the colour
 * (new) are two independent decisions, not tangled into one function. */
function arrivalResultClass(departure: Departure): string {
  switch (departure.arrivalResult) {
    case 'early':
    case 'onTime':
      return 'text-emerald-300';
    case 'late':
      return 'text-red-400';
    case null:
      return 'text-slate-400';
  }
}

export function History({ onNavigate }: HistoryProps) {
  // Last 10 departures that actually happened, most recent appointment
  // first. Sorted ascending by the indexed field then reversed, rather
  // than a descending Dexie query, because Dexie's own reverse() combined
  // with a compound `anyOf` filter isn't guaranteed to preserve sort order
  // the same way - sorting in JS on an already-small (<=10 shown, likely
  // low hundreds total) result set costs nothing worth avoiding this way.
  const entries = useLiveQuery(async () => {
    const departures = await db.departures.where('status').anyOf(['left', 'done']).sortBy('appointmentAt');
    return departures.reverse().slice(0, HISTORY_LIMIT);
  }, []);

  const slips = (entries ?? [])
    .map(slipMinutes)
    .filter((value): value is number => value !== undefined);
  const medianSlip = slips.length >= 3 ? medianMinutes(slips) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="History" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      {medianSlip !== null && (
        <p className="tabular-nums text-slate-400">
          {medianSlip === 0
            ? 'Median slip over these departures: on time.'
            : medianSlip > 0
              ? `Median slip over these departures: ${medianSlip} min late.`
              : `Median slip over these departures: ${Math.abs(medianSlip)} min early.`}
        </p>
      )}

      {entries?.length === 0 && <p className="text-sm text-slate-500">No departures yet.</p>}

      <div className="flex flex-col gap-2">
        {entries?.map((departure) => {
          const slip = slipMinutes(departure);
          return (
            <div key={departure.id} className="rounded-xl border border-slate-800/60 bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="text-xl font-medium text-slate-100">{departure.name}</p>
                <p className="text-sm text-slate-500">{formatDateDisplay(new Date(departure.appointmentAt))}</p>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm tabular-nums text-slate-400">
                <p>
                  Appointment {formatTime(new Date(departure.appointmentAt))}
                  {departure.leftAt !== null && slip !== undefined && (
                    <>
                      {' · '}
                      left {formatTime(new Date(departure.leftAt))} ({slip >= 0 ? '+' : ''}
                      {slip} min)
                    </>
                  )}
                </p>
                <p className={`motion-safe:transition-colors motion-safe:duration-300 ${arrivalResultClass(departure)}`}>
                  {arrivalResultLabel(departure)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
