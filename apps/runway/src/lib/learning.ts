import type { Departure, Template } from '../db/types';
import { deriveStepActuals, medianMinutes, slipMinutes } from './calibration';

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
 * window is the retroactive-door-checking pattern this exists to catch. */
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

/**
 * Shared builder behind naturalActualsByStepName/rushedActualsByStepName
 * below — same shape (status left/done, startedAt set, batched runs
 * excluded, recency-capped per name), differing only in which side of the
 * wasReplanned split `runFilter` selects. Keeping the shared shape in one
 * place is what makes "same shape" in this file's own header comment true
 * by construction rather than by two hand-kept-in-sync copies.
 */
function actualsByStepName(
  departures: Departure[],
  runFilter: (departure: Departure) => boolean,
): Map<string, number[]> {
  const eligible = departures.filter(
    (d) => (d.status === 'left' || d.status === 'done') && d.startedAt !== null && !isBatchedRun(d) && runFilter(d),
  );
  // Oldest first, so appending to each per-name array below naturally
  // leaves it "recency-ordered, newest last" — the cap after the loop then
  // just takes the tail.
  eligible.sort((a, b) => departureOccurredAtMs(a) - departureOccurredAtMs(b));

  const byName = new Map<string, number[]>();
  for (const departure of eligible) {
    for (const actual of deriveStepActuals(departure)) {
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

/**
 * Per step NAME, actual minutes from every UNCOMPRESSED, non-batched,
 * genuinely-lived run — the "how long does this really take" pool.
 * Excludes `wasReplanned` runs (see this file's header comment) and
 * batched check-offs (`isBatchedRun`). Each list is recency-ordered
 * (newest last) and capped to the most recent `RECENCY_WINDOW` (14)
 * occurrences.
 */
export function naturalActualsByStepName(departures: Departure[]): Map<string, number[]> {
  return actualsByStepName(departures, (d) => d.wasReplanned !== true);
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
  return actualsByStepName(departures, (d) => d.wasReplanned === true);
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
 */
export function stepNameLibrary(departures: Departure[], templates: Template[]): StepNameLibraryEntry[] {
  const names = new Set<string>();
  for (const departure of departures) {
    for (const step of departure.steps) {
      if (step.name.trim() !== '') names.add(step.name);
    }
  }
  for (const template of templates) {
    for (const step of template.steps) {
      if (step.name.trim() !== '') names.add(step.name);
    }
  }

  const naturalByName = naturalActualsByStepName(departures);

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
