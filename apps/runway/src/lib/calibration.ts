import type { Departure, Template } from '../db/types';

export interface StepActual {
  stepId: string;
  name: string;
  plannedMinutes: number;
  actualMinutes: number;
}

/**
 * Reconstructs how long each checked-off step actually took, from
 * check-off timestamps alone (RUNWAY_PLAN.md §5.4: "per-step actuals are
 * captured free from check-off timestamps").
 *
 * Attribution assumption (the one thing worth flagging in a reader's
 * comment, not just here): the gap between two check-offs is attributed
 * *entirely* to the later-checked step. If Deepak checks "Shower" at 08:15
 * and "Dress" at 08:28, "Dress" is recorded as 13 minutes — even though
 * some of that 13 minutes might really have been him standing around
 * between the two, not dressing. There's no signal in the data to split
 * that time any other way (no step-start timestamp, only step-*done*
 * timestamps), so this approximation is the only one the data supports.
 * It's honest enough for calibration, which only needs "roughly how long
 * does this step take", not forensic precision.
 *
 * Steps are ordered by `checkedAt` (not list position) because prep is
 * nonlinear in practice — any step can be checked in any order — and the
 * first event boundary is always `startedAt`, the moment the departure
 * began. A departure that was never started (no `startedAt`) has no time
 * axis to reconstruct anything against, so it contributes nothing.
 */
export function deriveStepActuals(
  departure: Pick<Departure, 'steps' | 'startedAt'>,
): StepActual[] {
  if (!departure.startedAt) return [];

  // ISO 8601 timestamps sort correctly as plain strings. Array#sort is
  // stable (guaranteed since ES2019), so steps checked at the exact same
  // instant keep their original relative order — irrelevant to the
  // result either way, since a 0-minute gap is 0-minute regardless of
  // which of the tied steps is treated as "later".
  const checked = departure.steps
    .filter((step): step is typeof step & { checkedAt: string } => step.checkedAt !== null)
    .slice()
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));

  const actuals: StepActual[] = [];
  let previousIso = departure.startedAt;
  for (const step of checked) {
    const actualMinutes = Math.round(
      (new Date(step.checkedAt).getTime() - new Date(previousIso).getTime()) / 60_000,
    );
    actuals.push({
      stepId: step.id,
      name: step.name,
      plannedMinutes: step.plannedMinutes,
      actualMinutes,
    });
    previousIso = step.checkedAt;
  }
  return actuals;
}

/** Standard median: middle value for an odd-length list, average of the two
 * middle values for an even-length list. `null` for an empty list — there's
 * no meaningful median of nothing, and callers should treat that as "not
 * enough data" rather than coercing it to 0. */
export function medianMinutes(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface Suggestion {
  templateId: string;
  templateName: string;
  stepName: string;
  plannedMinutes: number;
  medianActualMinutes: number;
  runCount: number;
}

// RUNWAY_PLAN.md §5.4: "After 3+ runs of a template: ... suggestion, never
// silent adjustment." Both thresholds are inclusive (>=), not strict (>) —
// exactly 3 runs and exactly a 3-minute delta both qualify.
const MIN_RUNS = 3;
const MIN_DELTA_MINUTES = 3;

/**
 * For each current template step, looks at real-world history and proposes
 * an update when the lived median has drifted meaningfully from the plan.
 *
 * Steps are joined across a Template and its historical Departures **by
 * name**, not by id. That's forced by the data model: DepartureStep is
 * copied from StepTemplate at departure-creation time (db/types.ts), so a
 * step checked off six months ago carries the id it was given back then,
 * which has no relationship to the current template's step ids. Name is
 * the only field both sides still share. The limitation this creates is
 * real and worth stating plainly: renaming a template step orphans that
 * step's entire history — old departures still say "Shower", the
 * renamed-to "Wash up" step in the template starts from zero data. That's
 * an acceptable v1 tradeoff (renames are rare; silently mis-joining on a
 * coincidental id would be worse), not an oversight.
 *
 * Only departures that actually happened (`status` 'left' or 'done') and
 * were actually started (`startedAt` set) count as runs — a departure that
 * was merely planned and never begun has no per-step actuals to learn
 * from. `plannedMinutes` on the returned Suggestion is always the
 * template's *current* value for that step name, so a suggestion reflects
 * "here's what's true now", not a stale snapshot from whenever the
 * matching departures were created.
 */
export function computeSuggestions(templates: Template[], departures: Departure[]): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const template of templates) {
    const templateRuns = departures.filter(
      (departure) =>
        departure.templateId === template.id &&
        (departure.status === 'left' || departure.status === 'done') &&
        departure.startedAt !== null,
    );

    const actualsByStepName = new Map<string, number[]>();
    for (const run of templateRuns) {
      for (const actual of deriveStepActuals(run)) {
        const existing = actualsByStepName.get(actual.name);
        if (existing) {
          existing.push(actual.actualMinutes);
        } else {
          actualsByStepName.set(actual.name, [actual.actualMinutes]);
        }
      }
    }

    for (const step of template.steps) {
      const actuals = actualsByStepName.get(step.name);
      if (!actuals || actuals.length < MIN_RUNS) continue;

      const rawMedian = medianMinutes(actuals);
      if (rawMedian === null) continue;

      // Rounded once, here, and reused for both the delta check and the
      // suggestion's displayed/applied value — template step minutes are
      // whole numbers (db/types.ts), so the value offered by "Update to N
      // min" has to be a whole number too, and it should be the same N
      // that was compared against the threshold.
      const median = Math.round(rawMedian);
      const delta = Math.abs(median - step.minutes);
      if (delta < MIN_DELTA_MINUTES) continue;

      suggestions.push({
        templateId: template.id,
        templateName: template.name,
        stepName: step.name,
        plannedMinutes: step.minutes,
        medianActualMinutes: median,
        runCount: actuals.length,
      });
    }
  }

  return suggestions;
}
