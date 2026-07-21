import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { medianMinutes, slipMinutes, slipTrend } from '../lib/calibration';
import { learningReport } from '../lib/learning';
import type { LearningReportEntry } from '../lib/learning';
import { biasFromPairs, globalBias, guessPairs } from '../lib/estimateBias';
import type { Bias, GuessActualPair } from '../lib/estimateBias';
import { measuredPaceHoursPerWeek } from '../lib/examProjection';
import { transitMeasurementSummaries } from '../lib/transit';
import type { TransitMeasurementsByName, TransitMeasurementSummary } from '../lib/transit';
import { TRANSIT_MEASUREMENTS_SETTING } from '../lib/transitSettings';
import { safely } from '../lib/safely';
import { logEvent } from '../lib/eventLog';

/** "on time" / "N min late" / "N min early" — the same three-way phrasing
 * this screen's own median-slip line below already uses (History.tsx and
 * Runway.tsx each carry their own copy of the identical ternary) — factored
 * out locally rather than lifted into format.ts because the slip-trend
 * lines below need it twice more and this is the only screen presenting the
 * "early window vs. late window" pair. De-duplicating all four copies into
 * one shared helper is a reasonable v1.5 cleanup, out of scope here. */
function formatSlipPhrase(minutes: number): string {
  if (minutes === 0) return 'on time';
  return minutes > 0 ? `${minutes} min late` : `${Math.abs(minutes)} min early`;
}

/** Per-name evidence floor for the "Guessed X -> typically Y" line —
 * deliberately looser than globalBias's default 5 (estimateBias.ts's own
 * `biasFromPairs` doc comment explains the asymmetry): a per-name card is
 * already a narrow, specific claim about one thing Deepak's guessed
 * repeatedly, not the headline "how do you guess in general" statement
 * globalBias is. */
const PER_NAME_MIN_PAIRS = 3;

/** Median of the pairs' own guessed/actual values (NOT the bias ratio —
 * that's estimateBias.ts's `biasFromPairs`) — what the per-name card's
 * "Guessed X min -> typically Y min" line reads from. Rounded, unlike this
 * screen's own median-slip line below (which leaves a .5 median
 * unrounded) — a "guessed"/"typically" minutes figure sits next to whole-
 * minute numbers everywhere else in this app (learnedEstimate's own
 * P75/P25/P90 are all `Math.round`ed), so this matches that convention
 * instead of the slip line's. */
function medianOfPairField(pairs: GuessActualPair[], field: 'guessed' | 'actual'): number {
  // Non-null: every caller here only reaches this once biasFromPairs has
  // already confirmed pairs.length >= PER_NAME_MIN_PAIRS (> 0).
  return Math.round(medianMinutes(pairs.map((pair) => pair[field]))!);
}

/** "Your guesses" section's headline sentence — see `Bias.ratio`'s own doc
 * comment (estimateBias.ts) for what the number means. Within +/-10% reads
 * as "accurate" rather than a single-digit percentage, which would claim
 * more precision than this evidence actually supports. */
function formatBiasLine(bias: Bias): string {
  if (bias.ratio >= 0.9 && bias.ratio <= 1.1) {
    return `Across ${bias.count} guessed runs, your guesses are accurate.`;
  }
  const pctOff = Math.round(Math.abs(bias.ratio - 1) * 100);
  const direction = bias.ratio > 1 ? 'short' : 'long';
  return `Across ${bias.count} guessed runs, your guesses run ${pctOff}% ${direction}.`;
}

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
 *
 * INVARIANT (field report #16, "What runway has learned button leads to a
 * blank page" — still reproducing on v0.43.1's error boundary, because a
 * boundary only catches THROWS, and the old code's `if (...) return null`
 * guard didn't throw): this screen renders the header unconditionally and
 * degrades every data section independently; it can show empty, it can
 * show partial, it can never show blank. Concretely: (1) `useLiveQuery`
 * returns `undefined` both while a query is still loading AND permanently,
 * if the query throws internally — dexie-react-hooks only rethrows (for an
 * error boundary to catch) when the underlying `liveQuery` observable calls
 * `observer.error`, which Dexie's own `liveQuery` implementation
 * deliberately does NOT do for a `DatabaseClosedError`/`AbortError` (see
 * node_modules/dexie/dist/dexie.mjs's `liveQuery`) — so a closed-connection
 * hiccup can leave a query silently stuck at `undefined` forever, with
 * nothing for a boundary to ever catch. The old `return null` guard turned
 * that stuck `undefined` into a permanently blank screen with no way back;
 * below, the same stuck state instead renders the header (so there's always
 * a way back) plus a "Loading…" line, distinguished from a query that has
 * actually resolved to empty. (2) Every pure computation this render
 * depends on is wrapped in `safely` (src/lib/safely.ts) — a throw from any
 * one of them degrades that section alone (logged via eventLog.ts, surfaced
 * once as "Some learning data could not be shown.") rather than crashing
 * the whole render.
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
  const transitMeasurementsSetting = useLiveQuery(() => db.settings.get(TRANSIT_MEASUREMENTS_SETTING), []);

  // The header — including its back button — renders in EVERY branch below,
  // loading or loaded, so Deepak is never stranded on a screen with no way
  // out. Kept as one JSX value rather than a small component so there's
  // exactly one place this gets built, not two copies that could drift.
  const header = (
    <div className="pt-8">
      <ScreenHeader title="Learning" onBack={() => onNavigate({ name: 'history' })} />
    </div>
  );

  // "Still loading" (undefined) is a different state from "loaded and
  // genuinely empty" ([]) — the old `!departures || !tasks || !sprints`
  // guard couldn't tell them apart because it returned null either way,
  // which is exactly what made a permanently-stuck-undefined query
  // indistinguishable from a slow one. `transitMeasurementsSetting` and
  // `exam` are deliberately NOT part of this gate: both were already
  // optional in the original code (a missing settings row or a
  // not-yet-created exam are normal, valid states, not loading states).
  if (departures === undefined || tasks === undefined || sprints === undefined) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
        {header}
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  // Collects every section label that failed this render, purely so the
  // JSX below can show one "Some learning data could not be shown." line
  // if `failedSections.length > 0` — never more than one line, regardless
  // of how many sections failed. `logEvent` is fire-and-forget (its own
  // contract, eventLog.ts) so a logging failure here can never be the
  // reason this screen itself fails to render.
  const failedSections: string[] = [];
  function handleSectionFailure(label: string, err: unknown) {
    failedSections.push(label);
    console.warn(`Runway: Learning section failed: ${label}.`, err);
    void logEvent('lifecycle', `Learning section failed: ${label}.`);
  }

  const report = safely<LearningReportEntry[]>(
    () => learningReport(departures, tasks),
    [],
    'Steps and tasks',
    handleSectionFailure,
  );

  // Estimation-bias increment (0.30.0): every manual guess/actual pair,
  // name-keyed — see estimateBias.ts's own header comment for why this is a
  // narrower question than learningReport's "how long does this really
  // take" (only Deepak's OWN felt guesses count, never a learned prefill he
  // never touched). One label ("Your guesses") covers both calls — if
  // guessPairs throws, pairsByName falls back to an empty Map, and
  // globalBias(emptyMap) then just returns null on its own (no second
  // throw, no double-count in failedSections) rather than needing its own
  // separate wrapper.
  const pairsByName = safely<Map<string, GuessActualPair[]>>(
    () => guessPairs(departures, tasks),
    new Map(),
    'Your guesses',
    handleSectionFailure,
  );
  const overallBias = safely<Bias | null>(() => globalBias(pairsByName), null, 'Your guesses', handleSectionFailure);

  // Same slip computation History.tsx uses (slipMinutes over left/done
  // departures, medianMinutes, a 3-slip evidence floor) but over ALL
  // eligible departures rather than History's last-10 slice. History's
  // window is deliberately recent — "how am I doing lately" — while this
  // screen is asking a different question, "what has the app learned over
  // all of history", so the all-time median belongs here even though the
  // two numbers can legitimately differ.
  const slips = safely<number[]>(
    () =>
      departures
        .filter((departure) => departure.status === 'left' || departure.status === 'done')
        .map(slipMinutes)
        .filter((value): value is number => value !== undefined),
    [],
    'Departures',
    handleSectionFailure,
  );
  const medianSlip = safely<number | null>(
    () => (slips.length >= 3 ? medianMinutes(slips) : null),
    null,
    'Departures',
    handleSectionFailure,
  );

  // Slip-trend increment: calibration.ts's `slipTrend` needs its input in
  // chronological (OLDEST first) order — the opposite of History.tsx's own
  // most-recent-first `.reverse()` — see slipTrend's own doc comment for
  // why getting this backwards would silently swap "earliest" and "latest".
  const chronologicalSlips = safely<number[]>(
    () =>
      departures
        .filter((departure) => departure.status === 'left' || departure.status === 'done')
        .slice()
        .sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt))
        .map(slipMinutes)
        .filter((value): value is number => value !== undefined),
    [],
    'Departures',
    handleSectionFailure,
  );
  const trend = safely(() => slipTrend(chronologicalSlips), null, 'Departures', handleSectionFailure);

  // Measured pace only, never the labeled 4 h/week default — that default
  // is a stated ASSUMPTION (examProjection.ts's DEFAULT_PACE_HOURS_PER_WEEK,
  // shown on ExamOverview as "Pace is an assumption... until sprints are
  // logged"), not something the app learned from Deepak's own history. A
  // screen about what's been learned has no business showing a number that
  // was never learned.
  const pace = safely<number | null>(
    () => (exam ? measuredPaceHoursPerWeek(new Date(), sprints) : null),
    null,
    'Prüfung',
    handleSectionFailure,
  );

  // Car Bluetooth transit increment (0.36.0): the measured-drive store is a
  // single JSON settings row (src/lib/transitSettings.ts), not a table this
  // component has anywhere else to read from — see that file's own comment
  // for why a keyed row is enough for one car's drive history. The
  // JSON.parse (a plausible corruption point for anything hand-edited or
  // written by an older app version) and transitMeasurementSummaries are
  // both inside the same `safely` call — a missing or corrupt row degrades
  // to "nothing measured yet", same as before, now via the same wrapper
  // (and the same failure-tracking/logging) every other section uses rather
  // than a bespoke try/catch.
  const transitSummaries = transitMeasurementsSetting
    ? safely<TransitMeasurementSummary[]>(
        () =>
          transitMeasurementSummaries(JSON.parse(transitMeasurementsSetting.value) as TransitMeasurementsByName),
        [],
        'Transit',
        handleSectionFailure,
      )
    : [];

  const anyFailed = failedSections.length > 0;
  // Only claims "nothing learned yet" when every section genuinely
  // resolved empty — if a section instead THREW, its fallback is also
  // empty, and showing "nothing learned yet" on top of a silent failure
  // would misdescribe what actually happened. `anyFailed` takes priority:
  // the "Some learning data could not be shown." line below covers that
  // case instead.
  const isEmpty = !anyFailed && report.length === 0 && medianSlip === null && pace === null && transitSummaries.length === 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      {header}

      <p className="text-sm text-slate-500">
        Estimates come from your recent natural runs. Rushed runs are kept separate — squeezing a
        morning never shrinks tomorrow's plan.
      </p>

      {/* One line, at most, regardless of how many sections in
          `failedSections` actually failed — a per-section error message
          would read as more alarming than a single Learning card refusing
          to draw part of itself deserves, and "which section" is already in
          the (opt-in, never-leaves-the-device) event log for anyone who
          needs to trace it further. */}
      {anyFailed && <p className="text-sm text-slate-500">Some learning data could not be shown.</p>}

      {isEmpty && (
        <p className="text-sm text-slate-500">
          Nothing learned yet. Finished runs teach Runway how long things really take.
        </p>
      )}

      {/* Estimation-bias increment (0.30.0): the calibration half of
          "guess-then-see" — placed ABOVE "Steps and tasks" because it's the
          headline answer ("how accurate are YOUR guesses"), with the
          per-name detail underneath it. Rendered only when there's real
          evidence (globalBias's own 5-pair floor) — no partial/loading
          version of this claim. Measurement, not verdict, same as
          TaskRun.tsx's own guessed-vs-actual line: no color coding, plain
          slate. */}
      {overallBias && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Your guesses</h2>
          <p className="tabular-nums text-slate-400">{formatBiasLine(overallBias)}</p>
        </div>
      )}

      {report.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Steps and tasks</h2>
          {report.map((entry) => {
            // Estimation-bias increment: per-name evidence floor (3, not
            // globalBias's 5) — see PER_NAME_MIN_PAIRS's own comment above
            // for why the asymmetry is deliberate. Wrapped per-entry (not
            // just once for the whole list) so one malformed name's pairs
            // can't take out every OTHER entry's card too — this runs
            // inside `report.map`, so an unwrapped throw here would fail
            // the entire "Steps and tasks" section, not just this row.
            const namedPairs = pairsByName.get(entry.name) ?? [];
            const namedBias = safely<Bias | null>(
              () => biasFromPairs(namedPairs, PER_NAME_MIN_PAIRS),
              null,
              'Steps and tasks',
              handleSectionFailure,
            );
            return (
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
                  <p className="text-sm text-slate-500">
                    Compresses to {entry.rushedFloor} min when a plan is squeezed.
                  </p>
                )}
                {/* Estimation-bias increment: only once this name's OWN
                    manual-guess evidence clears the (lower, per-name)
                    floor — a name with plenty of `entry.estimate` evidence
                    above can still have zero bias evidence, e.g. every run
                    of it came from a learned prefill nobody hand-edited. */}
                {namedBias && (
                  <p className="text-sm text-slate-500">
                    Guessed {medianOfPairField(namedPairs, 'guessed')} min → typically{' '}
                    {medianOfPairField(namedPairs, 'actual')}.
                  </p>
                )}
              </div>
            );
          })}
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
          {/* Slip-trend increment: evidence of CHANGE, not just a snapshot —
              only rendered once slipTrend clears its own 3-per-window
              floor (needs 6+ total left/done departures). */}
          {trend && (
            <p className="tabular-nums text-slate-400">
              Earliest {trend.window}: median {formatSlipPhrase(trend.early)}. Latest {trend.window}: median{' '}
              {formatSlipPhrase(trend.late)}.
            </p>
          )}
        </div>
      )}

      {/* Car Bluetooth transit increment (0.36.0): rendered only when
          there's at least one measured drive — a transparency report of
          everything transitSync.ts has matched so far, same "narrower floor
          for a report than for an actionable suggestion" shape the rest of
          this screen already uses (a step with 1-2 runs still gets a row
          above, just no learned estimate yet). */}
      {transitSummaries.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Transit</h2>
          {transitSummaries.map((summary) => (
            <p key={summary.name} className="tabular-nums text-slate-400">
              {summary.name}: median {summary.medianMinutes} min over {summary.runCount} drives.
            </p>
          ))}
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
