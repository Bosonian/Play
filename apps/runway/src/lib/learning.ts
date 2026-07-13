import type { Departure, Template, WorkTask } from '../db/types';
import { deriveStepActuals, medianMinutes, slipMinutes } from './calibration';
import { deriveTaskUnitActuals } from './taskProjection';
import type { StepActual } from './calibration';

/**
 * Runway's calibration layer (calibration.ts) reconstructs how long a step
 * ACTUALLY took from check-off timestamps. This file answers a harder
 * question underneath that: which of those actuals teach the app anything
 * true about a step's NATURAL pace?
 *
 * The answer came from a real field morning: a departure replanned midway
 * through (F1's "Replan from now") compresses the remaining unchecked steps
 * down to whatever time is actually left. A step that got compressed from
 * 15 minutes to 6 and was then checked off in roughly 6 minutes did NOT
 * suddenly become a 6-minute step — it got squeezed, once, under pressure,
 * because the appointment demanded it. Folding that 6-minute actual into
 * the same pool as every normal, uncompressed 14-minute shower would teach
 * the learner a false "normal" pace: the average of one real morning and
 * one compressed one, which describes neither.
 *
 * So this file keeps two distributions, never mixed:
 *   - "natural" actuals (naturalActualsByStepName) — what a step normally
 *     takes, used to learn realistic ESTIMATES (learnedEstimate) and to
 *     drive auto-learn (autoLearn.ts) and Home's suggestion cards.
 *   - "rushed" actuals (rushedActualsByStepName) — what a step has proven
 *     it CAN be squeezed to under real pressure, used only to set smarter
 *     personalized FLOORS the next compression is allowed to compress down
 *     to (replan.ts's `floorsByStepName`), never to change what the step is
 *     normally planned to take.
 *
 * `wasReplanned` (db/types.ts, stamped by Runway.tsx's `applyReplan`) is
 * the flag that keeps the two apart.
 */

/**
 * Linear-interpolation quantile over an already-sorted (ascending) array —
 * the standard "R-7" method most spreadsheet/stats tools default to, which
 * is why e.g. quantile(sorted, 0.5) exactly matches medianMinutes for an
 * even-length list. Precondition: `sorted` is non-empty and ascending;
 * every caller in this file only reaches this after checking a minimum
 * sample size, so there's no empty-array branch to define a meaningless
 * answer for.
 */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

/** A checked-off step's timestamp only teaches the learner something if it
 * was recorded roughly when the step actually happened. A run where three
 * or more steps were all checked off within the same minute is someone
 * catching up the app after the fact — retroactively ticking boxes for
 * steps that already happened, not timing them live — and every gap that
 * production would compute between those check-offs is noise, not a
 * measurement. Two checked close together is normal (a fast step really
 * can take under a minute); three or more within a single one-minute
 * window is the retroactive-door-checking pattern this exists to catch.
 *
 * Backdating increment: a deliberate single correction - "Done earlier" /
 * "Left earlier" / "Arrived earlier" (src/lib/backdate.ts, wired in
 * Runway.tsx/StepFocus.tsx/TaskRun.tsx) - writes exactly one checkedAt/
 * leftAt/arrivedAt stamped with a chosen PAST time. It does NOT trip this
 * guard, and shouldn't: a bounded, explicit correction is the user's
 * considered best truth about when something actually happened - the
 * opposite of the unattended catch-up-tapping this function exists to
 * filter out. The two guards are complementary, not contradictory:
 * isBatchedRun still catches three-or-more check-offs landing within the
 * same real-time minute regardless of how far in the past they're dated;
 * a single corrected timestamp just isn't shaped like that pattern on its
 * own. */
export function isBatchedRun(departure: Pick<Departure, 'steps'>): boolean {
  const checkedAtTimes = departure.steps
    .filter((step): step is typeof step & { checkedAt: string } => step.checkedAt !== null)
    .map((step) => new Date(step.checkedAt).getTime());
  if (checkedAtTimes.length < 3) return false;

  const span = Math.max(...checkedAtTimes) - Math.min(...checkedAtTimes);
  return span < 60_000;
}

/** How many of the most recent occurrences of a step name feed its learned
 * estimate. Capped, not unlimited, because habits drift — a shower that
 * took 20 minutes two years ago says nothing useful about this month's
 * pace, and an uncapped history would let old behaviour permanently drag
 * down (or up) a learned value that should track recent reality. 14 is
 * roughly a two-week window for a daily step, or a much longer real window
 * for a less frequent one — either way "recent enough to still describe
 * how this step goes today," not a number claiming any deeper statistical
 * significance. */
const RECENCY_WINDOW = 14;

/** Chronological sort key for a departure — the moment it actually
 * happened, for ordering "most recent N" correctly. `leftAt` is the
 * truest "when did this run finish" fact; `startedAt` is the fallback for
 * the (should-be-unreachable, given callers already filter on `leftAt`
 * existing) case it's missing, so a malformed row sorts by something
 * rather than crashing on `null`. */
function departureOccurredAtMs(departure: Pick<Departure, 'leftAt' | 'startedAt'>): number {
  const iso = departure.leftAt ?? departure.startedAt;
  return iso ? new Date(iso).getTime() : 0;
}

/** Same "when did this actually happen" reasoning as departureOccurredAtMs
 * above, for a task (tasks increment) — a task has no `leftAt` equivalent
 * (there's no journey it ever left for), so `startedAt` is already the
 * single truest anchor a task ever gets. */
function taskOccurredAtMs(task: Pick<WorkTask, 'startedAt'>): number {
  return task.startedAt ? new Date(task.startedAt).getTime() : 0;
}

/** One real occurrence's contribution to a name-keyed actuals pool — either
 * a departure run or a task run, reduced down to "when it happened" and
 * "what it measured", the only two things `mergeOccurrenceActuals` below
 * needs to know. This is what lets a departure's step history and a task's
 * unit history interleave into ONE correctly recency-ordered pool per name
 * (tasks increment) instead of two separately-capped pools concatenated
 * together, which would let a name's effective window balloon past
 * RECENCY_WINDOW whenever both sources have history for it. */
interface NamedOccurrence {
  occurredAtMs: number;
  actuals: StepActual[];
}

/**
 * Shared builder behind naturalActualsByStepName/rushedActualsByStepName —
 * same shape (recency-ordered oldest-to-newest, capped per name to the
 * most recent RECENCY_WINDOW), fed by whatever mix of departure and task
 * occurrences the caller has already filtered and reduced to
 * `NamedOccurrence`s. Keeping the merge-and-cap logic in exactly one place
 * is what makes "same shape" in this file's own header comment true by
 * construction rather than by hand-kept-in-sync copies.
 */
function mergeOccurrenceActuals(occurrences: NamedOccurrence[]): Map<string, number[]> {
  // Oldest first, so appending to each per-name array below naturally
  // leaves it "recency-ordered, newest last" — the cap after the loop then
  // just takes the tail.
  const sorted = [...occurrences].sort((a, b) => a.occurredAtMs - b.occurredAtMs);

  const byName = new Map<string, number[]>();
  for (const occurrence of sorted) {
    for (const actual of occurrence.actuals) {
      const existing = byName.get(actual.name);
      if (existing) {
        existing.push(actual.actualMinutes);
      } else {
        byName.set(actual.name, [actual.actualMinutes]);
      }
    }
  }

  for (const [name, actuals] of byName) {
    if (actuals.length > RECENCY_WINDOW) byName.set(name, actuals.slice(-RECENCY_WINDOW));
  }

  return byName;
}

/** Departure occurrences eligible for either the natural or rushed pool —
 * status left/done, started, not a batched retroactive check-off —
 * differing only in which side of the wasReplanned split `runFilter`
 * selects. Shared by naturalActualsByStepName/rushedActualsByStepName. */
function departureOccurrences(
  departures: Departure[],
  runFilter: (departure: Departure) => boolean,
): NamedOccurrence[] {
  return departures
    .filter(
      (d) => (d.status === 'left' || d.status === 'done') && d.startedAt !== null && !isBatchedRun(d) && runFilter(d),
    )
    .map((d) => ({ occurredAtMs: departureOccurredAtMs(d), actuals: deriveStepActuals(d) }));
}

/** Task occurrences eligible for the natural pool (tasks increment) — a
 * `done` task, started, not a batched retroactive check-off. There is no
 * task equivalent of rushedActualsByStepName's compressed-run pool: tasks
 * have no compression at all (see db/types.ts's header comment on this
 * section for why), so every eligible task occurrence is natural, full
 * stop — nothing to split on the way departures split on wasReplanned.
 * `isBatchedRun` is reused verbatim against `{ steps: task.units }` — the
 * same field-for-field TaskUnit/DepartureStep shape every other reused
 * function in this feature leans on (db/types.ts's TaskUnit doc comment). */
function taskOccurrences(tasks: WorkTask[]): NamedOccurrence[] {
  return tasks
    .filter((t) => t.status === 'done' && t.startedAt !== null && !isBatchedRun({ steps: t.units }))
    .map((t) => ({ occurredAtMs: taskOccurredAtMs(t), actuals: deriveTaskUnitActuals(t) }));
}

/**
 * Per step/task NAME, actual minutes from every UNCOMPRESSED, non-batched,
 * genuinely-lived run — the "how long does this really take" pool.
 * Excludes `wasReplanned` departure runs (see this file's header comment)
 * and batched check-offs (`isBatchedRun`) from either source. Each list is
 * recency-ordered (newest last) and capped to the most recent
 * `RECENCY_WINDOW` (14) occurrences — ACROSS both sources together, not 14
 * departures plus a separate 14 tasks, since they're joined by the same
 * name and measuring the same real-world quantity.
 *
 * `tasks` (tasks increment, default `[]`): a task's units join this pool
 * under the task's own name — see db/types.ts's TaskUnit doc comment for
 * why that's the correct join key. Defaulted to `[]` so every pre-existing
 * call site (TemplateEdit, autoLearn.ts — neither has a reason to load the
 * tasks table) is unaffected without an explicit empty array at each one.
 */
export function naturalActualsByStepName(departures: Departure[], tasks: WorkTask[] = []): Map<string, number[]> {
  return mergeOccurrenceActuals([
    ...departureOccurrences(departures, (d) => d.wasReplanned !== true),
    ...taskOccurrences(tasks),
  ]);
}

/**
 * Per step NAME, actual minutes from ONLY compressed (`wasReplanned`) runs
 * — the "how fast can this go under real pressure" pool, used exclusively
 * to set personalized compression floors (replan.ts's `floorsByStepName`),
 * never to learn a normal estimate. Same batched-run guard as
 * naturalActualsByStepName above: a compressed run that was ALSO
 * retroactively checked off teaches nothing about either distribution.
 */
export function rushedActualsByStepName(departures: Departure[]): Map<string, number[]> {
  return mergeOccurrenceActuals(departureOccurrences(departures, (d) => d.wasReplanned === true));
}

export interface LearnedEstimate {
  minutes: number;
  runCount: number;
  low: number;
  high: number;
}

/**
 * Turns a step name's natural actuals into a single learned estimate.
 * `null` under 3 samples — same "suggestion needs real evidence" floor
 * calibration.ts's old computeSuggestions used, now enforced here instead.
 *
 * `minutes` is the ROUNDED 75th percentile, not the median. This is a
 * deliberate departure from calibration.ts's original median-based
 * suggestions: planning at the median is, by construction, late roughly
 * half the time — half of Deepak's real showers take longer than his
 * median shower. P75 means the planned estimate covers three out of every
 * four real runs instead of one out of two, which is what actually reduces
 * "the plan says 15 but it's already been 18" mornings. `low`/`high` (P25/
 * P90) are the spread around it, for anything that wants to show a range
 * rather than just the point estimate.
 */
export function learnedEstimate(actuals: number[]): LearnedEstimate | null {
  if (actuals.length < 3) return null;
  const sorted = [...actuals].sort((a, b) => a - b);
  return {
    minutes: Math.round(quantile(sorted, 0.75)),
    runCount: actuals.length,
    low: Math.round(quantile(sorted, 0.25)),
    high: Math.round(quantile(sorted, 0.9)),
  };
}

/**
 * The floor a step's compressed time is allowed to shrink to, learned from
 * how far it's actually been squeezed before (rushedActualsByStepName).
 * `null` under 2 samples — one data point can't distinguish "this step
 * truly compresses to 4 min" from "that one morning was unusually fast."
 * P25 (not the median or P75) because a FLOOR should describe a
 * conservative, provably-achievable-most-of-the-time squeeze, not a
 * typical one — the whole point of a floor is that compression can safely
 * ask for it. `min 1`: the same "a 0-minute step isn't a step, it's a
 * deleted step" rule replan.ts's own MIN_STEP_MINUTES already enforces —
 * this floor must never undercut that invariant even if the lived data
 * technically supports something less than a minute.
 */
export function learnedRushedFloor(actuals: number[]): number | null {
  if (actuals.length < 2) return null;
  const sorted = [...actuals].sort((a, b) => a - b);
  return Math.max(1, Math.round(quantile(sorted, 0.25)));
}

/** How many of the most recent left/done runs feed the buffer suggestion —
 * deliberately smaller than RECENCY_WINDOW's 14: "how late am I typically
 * leaving lately" is a much more time-sensitive question than "how long
 * does this step take," and a 10-run window (roughly the last couple of
 * weeks of real departures) stays closer to Deepak's CURRENT habits than a
 * longer one would. */
const BUFFER_SLIP_WINDOW = 10;

/** Below this many recent runs, a median slip is just noise dressed up as
 * a statistic — same "needs real evidence" reasoning as learnedEstimate's
 * 3-sample floor, tuned down slightly because a slip measurement (one
 * number per whole departure) accumulates evidence far slower than a
 * per-step actual does. */
const MIN_BUFFER_SLIP_RUNS = 5;

/** A suggestion only fires when the slip is persistent AND worth acting on
 * — 2 minutes of median slip is well within the noise a friction buffer
 * already exists to absorb; anything past that is the buffer genuinely
 * under-covering, not rounding error. */
const MIN_BUFFER_SLIP_MINUTES = 2;

export interface BufferSlipSuggestion {
  minutes: number;
  runCount: number;
}

/**
 * "Your buffer under-covers by N minutes" — the median out-the-door slip
 * (slipMinutes, calibration.ts) over the most recent BUFFER_SLIP_WINDOW
 * left/done runs, only surfaced when there's enough evidence
 * (MIN_BUFFER_SLIP_RUNS) and the slip is persistently positive (late) past
 * MIN_BUFFER_SLIP_MINUTES. Returns just the median-slip minutes and how
 * many runs it's based on — deliberately NOT "current buffer + N" or any
 * other presentation decision; the caller (Home.tsx's suggestion card)
 * decides how to phrase and apply it, same separation of pure math from
 * presentation this whole file follows.
 *
 * Unlike learnedEstimate/learnedRushedFloor above, this deliberately does
 * NOT exclude wasReplanned runs — a replan compresses STEP time and
 * buffer, but the slip this measures is "how late did you actually leave
 * vs. the plan," which is exactly as real for a replanned morning as an
 * uncompressed one. Excluding compressed mornings would hide the very
 * mornings most likely to reveal a chronically undersized buffer.
 */
export function learnedBufferSuggestion(departures: Departure[]): BufferSlipSuggestion | null {
  const eligible = departures.filter((d) => d.status === 'left' || d.status === 'done');
  eligible.sort((a, b) => departureOccurredAtMs(b) - departureOccurredAtMs(a)); // newest first
  const recent = eligible.slice(0, BUFFER_SLIP_WINDOW);

  const slips = recent.map(slipMinutes).filter((value): value is number => value !== undefined);
  if (slips.length < MIN_BUFFER_SLIP_RUNS) return null;

  const rawMedian = medianMinutes(slips);
  if (rawMedian === null) return null;

  const median = Math.round(rawMedian);
  if (median <= MIN_BUFFER_SLIP_MINUTES) return null;

  return { minutes: median, runCount: slips.length };
}

// --- Suggestion cards (Home.tsx) ---
// Moved here from calibration.ts (learning increment) rather than left in
// place, to avoid a circular import: computeSuggestions now needs
// naturalActualsByStepName/learnedEstimate (this file), and this file
// already needs calibration.ts's deriveStepActuals/medianMinutes/
// slipMinutes — one file has to depend on the other, and calibration.ts
// stays the base layer (calibration primitives, no knowledge of the
// natural/rushed split) with this file built on top of it.

export interface Suggestion {
  templateId: string;
  templateName: string;
  stepName: string;
  plannedMinutes: number;
  learnedMinutes: number;
  runCount: number;
}

// RUNWAY_PLAN.md §5.4: "After 3+ runs of a template: ... suggestion, never
// silent adjustment." The delta threshold is inclusive (>=), not strict
// (>) — exactly a 3-minute delta still qualifies. The run-count threshold
// is enforced structurally now: learnedEstimate itself returns null under 3
// samples, so there's no separate MIN_RUNS constant to keep in sync with it.
const MIN_DELTA_MINUTES = 3;

/**
 * For each current template step, looks at real-world history and proposes
 * an update when the learned P75 estimate (learnedEstimate, this file) has
 * drifted meaningfully from the plan.
 *
 * Steps are joined across a Template and its historical Departures **by
 * name**, not by id — see the original comment on this design (preserved
 * from calibration.ts's prior version): DepartureStep is copied from
 * StepTemplate at departure-creation time, so a step checked off six months
 * ago carries an id with no relationship to the current template's step
 * ids; name is the only field both sides still share. Renaming a template
 * step orphans that step's history — an accepted v1 tradeoff, not an
 * oversight.
 *
 * Actuals come from naturalActualsByStepName, so a compressed
 * (`wasReplanned`) or batched-checkoff run never contributes to a
 * suggestion here — see this file's header comment for why. `plannedMinutes`
 * on the returned Suggestion is always the template's *current* value for
 * that step name, so a suggestion reflects "here's what's true now," not a
 * stale snapshot from whenever the matching departures were created.
 *
 * Deliberately scoped to `template.steps` (prep) only, NOT
 * `template.arrivalSteps` — arrival-steps increment. Auto-learn
 * (autoLearn.ts) does treat arrival steps as steps for its opt-in,
 * writes-itself update; this suggest-and-confirm card is left prep-only
 * for now, a narrower scope than it could have, worth reconsidering once
 * there's real arrival-step history to look at (v1.5 candidate, not a
 * design decision this comment claims is final).
 */
export function computeSuggestions(templates: Template[], departures: Departure[]): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const template of templates) {
    const templateRuns = departures.filter((departure) => departure.templateId === template.id);
    const naturalByName = naturalActualsByStepName(templateRuns);

    for (const step of template.steps) {
      const actuals = naturalByName.get(step.name);
      if (!actuals) continue;

      const learned = learnedEstimate(actuals);
      if (!learned) continue; // under 3 samples

      const delta = Math.abs(learned.minutes - step.minutes);
      if (delta < MIN_DELTA_MINUTES) continue;

      suggestions.push({
        templateId: template.id,
        templateName: template.name,
        stepName: step.name,
        plannedMinutes: step.minutes,
        learnedMinutes: learned.minutes,
        runCount: learned.runCount,
      });
    }
  }

  return suggestions;
}

export interface BufferSuggestion {
  templateId: string;
  templateName: string;
  currentBufferMinutes: number;
  slipMinutes: number;
  runCount: number;
}

/**
 * Per-template wrapper around learnedBufferSuggestion, for Home's buffer
 * suggestion card — mirrors computeSuggestions' per-template loop shape
 * immediately above. Unlike autoLearn (which only ever touches step
 * minutes, and only for templates that opted in), a buffer suggestion is
 * ALWAYS suggest-only, for every template with enough history, regardless
 * of that template's `autoLearn` flag — the two are independent knobs.
 */
export function computeBufferSuggestions(templates: Template[], departures: Departure[]): BufferSuggestion[] {
  const suggestions: BufferSuggestion[] = [];

  for (const template of templates) {
    const templateRuns = departures.filter((departure) => departure.templateId === template.id);
    const result = learnedBufferSuggestion(templateRuns);
    if (!result) continue;

    suggestions.push({
      templateId: template.id,
      templateName: template.name,
      currentBufferMinutes: template.bufferMinutes,
      slipMinutes: result.minutes,
      runCount: result.runCount,
    });
  }

  return suggestions;
}

// --- Learning-transparency screen (src/screens/Learning.tsx) ---

export interface LearningReportEntry {
  name: string;
  runCount: number;
  estimate: LearnedEstimate | null;
  rushedFloor: number | null;
}

/**
 * One row per step/task name that the app has learned SOMETHING about, from
 * either distribution this file keeps (see the header comment above): a
 * natural-run estimate, a rushed-run compression floor, or both. This is
 * deliberately narrower than stepNameLibrary — that function also lists
 * template-only names with zero runs, because its job is autocomplete
 * ("you've called this before"); this one is a report of what's actually
 * been LEARNED, so a name that's only ever sat in a template unused earns no
 * row here at all.
 *
 * Union of both pools' keys, not just naturalActualsByStepName's: a step
 * that has only ever been run compressed (e.g. always squeezed under a
 * replan, never once run naturally) still taught the app its rushed floor,
 * and that's real, worth-showing evidence — dropping it because
 * runCount is 0 would hide the one thing this screen exists to surface.
 *
 * Sorted by runCount descending (most-evidenced first), then name ascending
 * as a deterministic tiebreak — same shape as stepNameLibrary's own sort,
 * mirrored rather than reused since that one only sorts on runCount (ties
 * broken by Set insertion order, which isn't reproducible input-to-input the
 * way a name-ascending tiebreak is, and this screen's row order needs to be
 * stable for testing and for a calm, unsurprising re-render).
 */
export function learningReport(departures: Departure[], tasks: WorkTask[]): LearningReportEntry[] {
  const naturalByName = naturalActualsByStepName(departures, tasks);
  const rushedByName = rushedActualsByStepName(departures);

  const names = new Set<string>([...naturalByName.keys(), ...rushedByName.keys()]);

  const entries: LearningReportEntry[] = [...names].map((name) => {
    const naturalActuals = naturalByName.get(name) ?? [];
    const rushedActuals = rushedByName.get(name);
    return {
      name,
      runCount: naturalActuals.length,
      estimate: learnedEstimate(naturalActuals),
      rushedFloor: rushedActuals ? learnedRushedFloor(rushedActuals) : null,
    };
  });

  entries.sort((a, b) => b.runCount - a.runCount || a.name.localeCompare(b.name));
  return entries;
}

// --- Task-memory autocomplete (TemplateEdit + DepartureSetup, learning
// increment §5) ---

export interface StepNameLibraryEntry {
  name: string;
  learnedMinutes: number | null;
  runCount: number;
}

/**
 * Every distinct step name that's ever appeared, across both live history
 * (departures, any status — even a planned/abandoned run typed a real name
 * worth remembering) and every template's current steps, with a learned
 * estimate attached where there's enough natural history to support one.
 * Sorted by run count descending, so the autocomplete's "best matches"
 * (StepNameAutocomplete.tsx) are the names actually used most, not an
 * arbitrary or alphabetical order.
 *
 * Deliberately global — not scoped to one template — because the whole
 * point is surfacing "you've called this 'Shoes and door' before" even
 * while setting up a brand-new template that has no history of its own
 * yet.
 *
 * `tasks` (tasks increment, default `[]`): every task's own name joins this
 * same corpus — TaskSetup's name field gets the identical "you've called
 * this before" autocomplete a step name field gets, and a task name with
 * enough natural history (naturalActualsByStepName below already merges
 * task actuals in) surfaces its learned per-unit minutes exactly the way a
 * step name does. Defaulted to `[]` for the same "existing call sites stay
 * unaffected" reason naturalActualsByStepName's own `tasks` default does.
 */
export function stepNameLibrary(
  departures: Departure[],
  templates: Template[],
  tasks: WorkTask[] = [],
): StepNameLibraryEntry[] {
  const names = new Set<string>();
  for (const departure of departures) {
    for (const step of departure.steps) {
      if (step.name.trim() !== '') names.add(step.name);
    }
    // Arrival-steps increment: arrival steps are steps too — a name typed
    // into DepartureSetup's or TemplateEdit's ARRIVAL STEPS section (e.g.
    // "Change into scrubs") deserves the same task-memory autocomplete
    // treatment as a prep step name, via the same shared StepNameAutocomplete
    // component both sections reuse.
    for (const step of departure.arrivalSteps ?? []) {
      if (step.name.trim() !== '') names.add(step.name);
    }
  }
  for (const template of templates) {
    for (const step of template.steps) {
      if (step.name.trim() !== '') names.add(step.name);
    }
    for (const step of template.arrivalSteps ?? []) {
      if (step.name.trim() !== '') names.add(step.name);
    }
  }
  // Tasks increment: a task's own name IS its units' shared name (see
  // db/types.ts's TaskUnit doc comment) — one add per task covers every
  // unit, there's no separate per-unit name to walk the way there is for
  // departure/template steps above.
  for (const task of tasks) {
    if (task.name.trim() !== '') names.add(task.name);
  }

  // naturalActualsByStepName already covers arrival-step actuals AND task
  // unit actuals too — see deriveStepActuals' (calibration.ts) two-chain
  // split and this file's own taskOccurrences — so a name that's only ever
  // appeared as an arrival step or a task still gets a learned estimate
  // here where the sample size supports one, no separate lookup needed.
  const naturalByName = naturalActualsByStepName(departures, tasks);

  const entries: StepNameLibraryEntry[] = [...names].map((name) => {
    const actuals = naturalByName.get(name);
    const learned = actuals ? learnedEstimate(actuals) : null;
    return {
      name,
      learnedMinutes: learned ? learned.minutes : null,
      runCount: actuals?.length ?? 0,
    };
  });

  // Array#sort is stable (ES2019+), so names tied on run count (including
  // the common "0 runs, never lived" case for a template-only name) keep
  // whatever order Set iteration produced them in — first-seen order,
  // which is as good a tiebreak as any and at least deterministic given a
  // fixed input.
  entries.sort((a, b) => b.runCount - a.runCount);
  return entries;
}
