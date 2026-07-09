import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Departure } from '../db/types';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { computeProjection } from '../lib/projection';
import { medianMinutes } from '../lib/calibration';
import { formatDateDisplay, formatTime } from '../lib/format';

interface HistoryProps {
  onNavigate: (screen: Screen) => void;
}

const HISTORY_LIMIT = 10;

/** leaveBy (appointment minus travel) doesn't depend on the `now` argument
 * - see projection.ts - so any Date works. appointmentAt is used rather
 * than the live clock so a departure's history entry is a fixed fact,
 * not something that would read differently depending on when this
 * screen happens to be opened. */
function plannedLeaveBy(departure: Departure): Date {
  return computeProjection(new Date(departure.appointmentAt), departure).leaveBy;
}

/** leftAt minus planned leaveBy, in whole minutes. Positive = left later
 * than planned (late); negative = left earlier (early). Undefined when
 * leftAt is missing - shouldn't happen for a 'left'/'done' departure in
 * practice, but the Runway 'I'm out the door' write and this history read
 * are two different code paths and nothing enforces that invariant at the
 * type level, so this stays defensive rather than assuming it. */
function slipMinutes(departure: Departure): number | undefined {
  if (!departure.leftAt) return undefined;
  return Math.round((new Date(departure.leftAt).getTime() - plannedLeaveBy(departure).getTime()) / 60_000);
}

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
          {medianSlip < 0
            ? `Median slip: ${Math.abs(medianSlip)} min early.`
            : `Median slip over these departures: ${medianSlip} min.`}
        </p>
      )}

      {entries?.length === 0 && <p className="text-sm text-slate-500">No departures yet.</p>}

      <div className="flex flex-col gap-2">
        {entries?.map((departure) => {
          const slip = slipMinutes(departure);
          return (
            <div key={departure.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-100">{departure.name}</p>
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
                <p>{arrivalResultLabel(departure)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
