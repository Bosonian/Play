import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Departure, WorkTask } from '../db/types';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { medianMinutes, slipMinutes } from '../lib/calibration';
import { formatDateDisplay, formatTime } from '../lib/format';
import { deriveTaskUnitActuals, taskDeadlineResult, taskFinishedAt } from '../lib/taskProjection';
import { TextAction } from '../ui/TextAction';
import { Card } from '../ui/Card';

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

/** Task-mode twin of `arrivalResultLabel` above — same "one function decides
 * the words, a second decides the colour" split, mirrored rather than
 * shared because a task's four outcomes ('done'+met / 'done'+overshot /
 * 'done'+no-deadline / 'abandoned') don't line up one-to-one with a
 * departure's three arrivalResult values. */
function taskResultLabel(task: WorkTask): string {
  if (task.status === 'abandoned') return 'abandoned';
  const result = taskDeadlineResult(task);
  if (result === null) return '—';
  return result.kind === 'met' ? 'on time' : `past deadline +${result.minutes} min`;
}

function taskResultClass(task: WorkTask): string {
  if (task.status === 'abandoned') return 'text-slate-400';
  const result = taskDeadlineResult(task);
  if (result === null) return 'text-slate-400';
  return result.kind === 'met' ? 'text-emerald-300' : 'text-red-400';
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

  // The field bug this section fixes: Home only ever lists planned/running
  // tasks, so a task that finished (or was abandoned) used to vanish from
  // every screen the moment it left that status — the row was intact in
  // Dexie the whole time, there was simply no surface left that queried for
  // it. Sorted most-recently-finished first via `taskFinishedAt`, falling
  // back to `createdAt` ONLY for ordering ties/abandoned-with-no-checked-
  // units — `taskFinishedAt` itself never makes that substitution (see its
  // own comment), so this fallback lives here, one layer up, where it's an
  // honest tiebreak rather than a fabricated finish time.
  const finishedTasks = useLiveQuery(async () => {
    const tasks = await db.tasks.where('status').anyOf(['done', 'abandoned']).toArray();
    return tasks
      .sort((a, b) => {
        const aTime = taskFinishedAt(a) ?? a.createdAt;
        const bTime = taskFinishedAt(b) ?? b.createdAt;
        return bTime.localeCompare(aTime);
      })
      .slice(0, HISTORY_LIMIT);
  }, []);

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

      {/* Rendered only when there's at least one finished/abandoned task —
          CLAUDE.md's "defaults lean toward less, not more": an empty Tasks
          section with a "Nothing here yet" line would be one more thing on
          screen saying nothing, for the (currently the more common) case of
          a Runway install that hasn't run a task yet. */}
      {finishedTasks !== undefined && finishedTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Tasks</h2>
          {/* Field bug fix (0.34.1): these rows used to be plain, non-tappable
              divs — the real user report this fixes ("i cant go into history
              and continue that task") landed here specifically, because a
              task stuck 'done' by an accidental last-unit check-off had
              nowhere to go FROM History even once you found it. `Card` (a
              real <button>, same component Home's own task/template/
              departure rows already use) makes the row tappable, landing on
              TaskRun's done summary — where "Reopen" now lives.
              Deliberately asymmetric: the departure rows just above this
              section are still plain, non-tappable divs. They're left that
              way this increment rather than made tappable for consistency —
              a finished/abandoned departure has no equivalent "reopen"
              destination to land on, so tapping one here would just be a
              dead end dressed up as an affordance. */}
          {finishedTasks.map((task) => {
            const finishedAt = taskFinishedAt(task);
            const totalMinutes = deriveTaskUnitActuals(task).reduce((sum, actual) => sum + actual.actualMinutes, 0);
            return (
              <Card key={task.id} onClick={() => onNavigate({ name: 'task', taskId: task.id })}>
                <div className="flex items-center justify-between">
                  <p className="text-xl font-medium text-slate-100">{task.name}</p>
                  <p className="text-sm text-slate-500">{finishedAt ? formatDateDisplay(new Date(finishedAt)) : '—'}</p>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm tabular-nums text-slate-400">
                  <p>
                    {task.units.length} unit{task.units.length === 1 ? '' : 's'} · {totalMinutes} min.
                  </p>
                  <p className={`motion-safe:transition-colors motion-safe:duration-300 ${taskResultClass(task)}`}>
                    {taskResultLabel(task)}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Learning-transparency screen's entry point. Placed at the bottom of
          History rather than as a peer link from Home: History is the raw
          record of what happened; Learning is that record's distillation
          into "what the app now believes" — one level down from the log
          it's summarizing, not a separate destination competing for
          attention on Home. */}
      <TextAction onClick={() => onNavigate({ name: 'learning' })} className="self-start">
        What Runway has learned
      </TextAction>
    </div>
  );
}
