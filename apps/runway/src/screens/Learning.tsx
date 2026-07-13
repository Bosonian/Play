import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { medianMinutes, slipMinutes } from '../lib/calibration';
import { learningReport } from '../lib/learning';
import { measuredPaceHoursPerWeek } from '../lib/examProjection';

interface LearningProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * The window onto what Runway has learned silently everywhere else — P75
 * step estimates (prefills), P25 rushed-compression floors (replan's
 * squeeze math), the out-the-door slip median (buffer suggestions), and the
 * measured Prüfung pace (the ready-date projection). None of that math
 * changes here; this screen only reads and displays it. Reached from
 * History (a TextAction at its foot) rather than from Home directly —
 * History is the raw record of what happened, and this screen is that
 * record's distillation into "what the app now believes", so it makes sense
 * one level down from the log it's summarizing rather than sitting as a
 * peer entry point of its own.
 */
export function Learning({ onNavigate }: LearningProps) {
  const departures = useLiveQuery(() => db.departures.toArray(), []);
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const exam = useLiveQuery(() => db.exams.toCollection().first(), []);
  // Sprints are scoped to the one exam that exists (mirrors ExamOverview's
  // own query) rather than read unconditionally — `exam` undefined means
  // either "still loading" or "no exam set up yet", and there's nothing to
  // scope a sprint query to in either case.
  const sprints = useLiveQuery(
    async () => (exam ? db.sprints.where('examId').equals(exam.id).toArray() : []),
    [exam],
  );

  if (!departures || !tasks || !sprints) return null;

  const report = learningReport(departures, tasks);

  // Same slip computation History.tsx uses (slipMinutes over left/done
  // departures, medianMinutes, a 3-slip evidence floor) but over ALL
  // eligible departures rather than History's last-10 slice. History's
  // window is deliberately recent — "how am I doing lately" — while this
  // screen is asking a different question, "what has the app learned over
  // all of history", so the all-time median belongs here even though the
  // two numbers can legitimately differ.
  const slips = departures
    .filter((departure) => departure.status === 'left' || departure.status === 'done')
    .map(slipMinutes)
    .filter((value): value is number => value !== undefined);
  const medianSlip = slips.length >= 3 ? medianMinutes(slips) : null;

  // Measured pace only, never the labeled 4 h/week default — that default
  // is a stated ASSUMPTION (examProjection.ts's DEFAULT_PACE_HOURS_PER_WEEK,
  // shown on ExamOverview as "Pace is an assumption... until sprints are
  // logged"), not something the app learned from Deepak's own history. A
  // screen about what's been learned has no business showing a number that
  // was never learned.
  const pace = exam ? measuredPaceHoursPerWeek(new Date(), sprints) : null;

  const isEmpty = report.length === 0 && medianSlip === null && pace === null;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Learning" onBack={() => onNavigate({ name: 'history' })} />
      </div>

      <p className="text-sm text-slate-500">
        Estimates come from your recent natural runs. Rushed runs are kept separate — squeezing a
        morning never shrinks tomorrow's plan.
      </p>

      {isEmpty && (
        <p className="text-sm text-slate-500">
          Nothing learned yet. Finished runs teach Runway how long things really take.
        </p>
      )}

      {report.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Steps and tasks</h2>
          {report.map((entry) => (
            <div key={entry.name} className="rounded-xl border border-slate-800/60 bg-surface p-4">
              <p className="text-slate-100">{entry.name}</p>
              {entry.estimate ? (
                <p className="mt-1 tabular-nums text-sm text-slate-400">
                  {entry.estimate.minutes} min · typically {entry.estimate.low}–{entry.estimate.high} ·{' '}
                  {entry.runCount} runs
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  {entry.runCount === 0
                    ? 'Only rushed runs so far. A learned time needs 3 natural runs.'
                    : `${entry.runCount} run${entry.runCount === 1 ? '' : 's'} recorded. A learned time needs 3.`}
                </p>
              )}
              {entry.rushedFloor !== null && (
                <p className="text-sm text-slate-500">Compresses to {entry.rushedFloor} min when a plan is squeezed.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {medianSlip !== null && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Departures</h2>
          <p className="tabular-nums text-slate-400">
            {medianSlip === 0
              ? `Median slip over ${slips.length} departures: on time.`
              : medianSlip > 0
                ? `Median slip over ${slips.length} departures: ${medianSlip} min late.`
                : `Median slip over ${slips.length} departures: ${Math.abs(medianSlip)} min early.`}
          </p>
        </div>
      )}

      {exam && pace !== null && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Prüfung</h2>
          <p className="tabular-nums text-slate-400">Measured pace: {pace.toFixed(1)} h/week, median of your complete weeks.</p>
        </div>
      )}
    </div>
  );
}
