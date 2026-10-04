import type { Departure, DepartureStep, TaskUnit, WorkTask } from '../db/types';
import { deriveStepActuals } from './calibration';
import { naturalDepartures, naturalTasks } from './learning';
import { deriveTaskUnitActuals } from './taskProjection';

/**
 * Estimation-bias increment (0.30.0): the "guess-then-see calibration" half
 * of the increment — src/screens/TaskRun.tsx's done-summary line and
 * src/screens/Learning.tsx's "Your guesses" section are the other two. This
 * file stays pure (no Dexie access), same discipline as calibration.ts and
 * learning.ts: every function here takes already-loaded rows and returns a
 * plain value, so the whole bias calculation is unit-testable without a
 * database.
 *
 * The question this file answers is narrower than learning.ts's: not "how
 * long does this step actually take" (learnedEstimate) but "when Deepak
 * guesses a time himself, how far off does he tend to run" — which needs
 * exactly one extra fact learning.ts's own actuals never carried:
 * `estimateSource` (db/types.ts's DepartureStep/TaskUnit/StepTemplate doc
 * comments). A learned prefill he never touched isn't a guess at all — a
 * departure whose steps all came from a learned prefill teaches this file
 * nothing about Deepak's own felt sense of time, so `guessPairs` below
 * excludes it, and excludes it the same way for 'undefined' (unknown
 * provenance, a row from before this field existed) as for 'learned' —
 * only 'manual' counts.
 */

/** One occurrence's felt guess paired with what it actually took, for one
 * step/task name. `guessed`/`actual` are both whole minutes, same units as
 * `StepActual.plannedMinutes`/`actualMinutes` (calibration.ts) they're built
 * from. */
export interface GuessActualPair {
  guessed: number;
  actual: number;
}

function estimateSourceById(
  steps: readonly Pick<DepartureStep | TaskUnit, 'id' | 'estimateSource'>[],
): Map<string, 'manual' | 'learned' | undefined> {
  return new Map(steps.map((step) => [step.id, step.estimateSource]));
}

/**
 * Per step/task NAME, every (guessed, actual) pair from a natural (never
 * compressed, never batch-checked-off — see learning.ts's
 * `naturalDepartures`/`naturalTasks`, the exact eligibility this reuses
 * rather than re-deriving) occurrence whose step/unit was Deepak's own felt
 * guess (`estimateSource === 'manual'`).
 *
 * A `plannedMinutes` of 0 is excluded from pairing (not just from the
 * ratio math downstream) — a 0-minute "guess" isn't a real estimate of
 * anything (DepartureSetup/TemplateEdit allow 0 as a valid step length,
 * same as any other non-negative number, but dividing an actual by a
 * guessed 0 has no honest ratio to report), and a step that short teaches
 * this file nothing about calibration either way.
 *
 * Deliberately NOT capped to learning.ts's RECENCY_WINDOW: that cap exists
 * because a learned ESTIMATE (an absolute minutes value) needs to track
 * Deepak's current pace, not a habit from two years ago. A bias RATIO is a
 * different kind of number — accuracy of guessing, not a duration — and
 * more lifetime evidence only sharpens it; there is no "his guessing skill
 * from six months ago is stale" the way there is for "his shower time from
 * six months ago is stale". Every eligible manual guess ever recorded
 * counts.
 */
export function guessPairs(departures: Departure[], tasks: WorkTask[]): Map<string, GuessActualPair[]> {
  const byName = new Map<string, GuessActualPair[]>();

  function addPair(name: string, guessed: number, actual: number) {
    if (guessed <= 0) return;
    const existing = byName.get(name);
    if (existing) existing.push({ guessed, actual });
    else byName.set(name, [{ guessed, actual }]);
  }

  for (const departure of naturalDepartures(departures)) {
    const sourceById = estimateSourceById([...departure.steps, ...(departure.arrivalSteps ?? [])]);
    for (const actual of deriveStepActuals(departure)) {
      if (sourceById.get(actual.stepId) !== 'manual') continue;
      addPair(actual.name, actual.plannedMinutes, actual.actualMinutes);
    }
  }

  for (const task of naturalTasks(tasks)) {
    const sourceById = estimateSourceById(task.units);
    for (const actual of deriveTaskUnitActuals(task)) {
      if (sourceById.get(actual.stepId) !== 'manual') continue;
      addPair(actual.name, actual.plannedMinutes, actual.actualMinutes);
    }
  }

  return byName;
}

export interface Bias {
  /** Median of `actual / guessed` across the contributing pairs. 1.45 means
   * guesses run 45% short (actual routinely bigger than guessed); 0.8 means
   * guesses run 20% long. */
  ratio: number;
  count: number;
}

/** Default evidence floor for a bias ratio — same "a statistic needs real
 * evidence" reasoning as this app's other floors (learnedEstimate's 3,
 * learnedBufferSuggestion's MIN_BUFFER_SLIP_RUNS of 5); 5 chosen to match
 * the buffer-slip floor since a bias ratio, like a slip, is one number per
 * whole occurrence rather than the many-per-run signal a step estimate
 * gets, so it earns real evidence more slowly. Learning.tsx's per-name
 * cards override this down to 3 — see `minPairs`'s own doc comment below
 * for why that asymmetry is deliberate, not an inconsistency. */
const DEFAULT_MIN_PAIRS = 5;

/**
 * Turns a name's guess/actual pairs into one bias ratio — the median of
 * each pair's own `actual / guessed` ratio, not "sum of actuals / sum of
 * guessed" (that second form would let one very long occurrence dominate
 * the answer the same way an unweighted mean would; the median stays
 * robust to exactly the kind of one-off outlier a single bad morning
 * produces).
 *
 * `minPairs` (default `DEFAULT_MIN_PAIRS`, 5): the evidence floor below
 * which this returns `null` rather than a ratio built on noise.
 * Learning.tsx's per-name cards call this with `minPairs: 3` instead — a
 * narrower, per-name question ("how does Deepak guess THIS specific thing")
 * earns a real answer sooner than the headline "how does Deepak guess in
 * general" claim does, the same reasoning learnedEstimate's own 3-sample
 * floor already uses elsewhere in this app. `globalBias` below always uses
 * the conservative default, since it's the one number surfaced as an
 * unqualified claim about Deepak himself.
 */
export function biasFromPairs(pairs: GuessActualPair[], minPairs: number = DEFAULT_MIN_PAIRS): Bias | null {
  if (pairs.length < minPairs) return null;
  const ratios = pairs.map((pair) => pair.actual / pair.guessed).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const ratio = ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];
  return { ratio, count: pairs.length };
}

/**
 * The single across-every-name bias figure Learning.tsx's "Your guesses"
 * section leads with — every manual guess pair, regardless of which
 * step/task name it came from, flattened into one pool. Always uses
 * `biasFromPairs`' conservative default floor (5) — see that function's own
 * doc comment for why the per-name cards are allowed a lower one and this
 * headline number isn't.
 */
export function globalBias(byName: Map<string, GuessActualPair[]>): Bias | null {
  return biasFromPairs([...byName.values()].flat());
}
