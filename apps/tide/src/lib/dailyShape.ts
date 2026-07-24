// Daily shape — TIDE_PLAN.md §5's signal 5, "the day-sized target headline
// (configurable), emerald when met, nothing-shaming when not." Pure and
// dependency-free by design (no Dexie import here), same discipline as
// trend.ts: narrow input types, screens/Settings pass in whatever they read
// from `db.settings`/`db.movement`/the check-in count query, this file never
// touches the database itself.
//
// CRITICAL DESIGN CONSTRAINT, stated once here because it shapes every
// function below: unlike Runway's own dailyShape.ts (todayLine), which
// REPLACES ExamOverview's headline once a daily target is set, Tide's daily
// shape NEVER displaces the weight-trend headline. TIDE_PLAN.md §5 ranks
// "Daily shape" as signal 5, strictly below "Weight trend" (signal 1) and
// "Body-fat trend" (signal 2) — a day-sized to-do list is useful scaffolding,
// but it is not the north star, and letting it swap the headline the way
// Runway's does would quietly make it one. Home.tsx renders this as its own
// subordinate block, never as a replacement for `formatTrendLine`'s output.

/** The two components of a day-sized shape — TIDE_PLAN.md §2's example,
 * "3 honest check-ins + a 15-min walk today". `steps` stands in for the
 * "walk" half: Health Connect reports steps, not minutes, so the target is
 * denominated in what the app can actually measure passively rather than a
 * self-reported duration nothing here observes. */
export interface DailyShapeTarget {
  checkIns: number;
  steps: number;
}

/**
 * Serialised form stored in a single `settings` row (see
 * dailyShapeSettings.ts) — `"<checkIns>,<steps>"`, e.g. `"3,6000"`. A plain
 * comma-joined pair, not JSON: every other multi-value settings row in this
 * app (healthSettings.ts's `MOVEMENT_STEP_SOURCES_SETTING`) already uses a
 * delimited string rather than JSON for the same reason — two integers have
 * no need for a parser heavier than `split(',')`, and a hand-edited or
 * corrupted row fails obviously (wrong element count, a non-numeric part)
 * rather than throwing a JSON.parse exception a caller would have to guard
 * against separately.
 */
export function serializeDailyShapeTarget(target: DailyShapeTarget): string {
  return `${target.checkIns},${target.steps}`;
}

/**
 * Defensive parse: anything that isn't EXACTLY two non-negative integers
 * returns `null` ("no target set"), never a partial or NaN-bearing target.
 * This matters because a target this file can't fully trust would silently
 * corrupt `dailyShapeProgress`'s `met` math (NaN comparisons are always
 * false, which would read as "never met" — a quiet, confusing failure mode,
 * not an honest "off" state).
 *
 * `0` for either half is a LEGITIMATE target, not malformed input — see
 * `dailyShapeProgress`'s own doc comment for what a 0-component means. Only
 * absence, non-numeric text, negative numbers, or a non-integer (a stray
 * decimal from a corrupted row) fail the parse.
 */
export function parseDailyShapeTarget(value: string | undefined): DailyShapeTarget | null {
  if (!value) return null;
  const parts = value.split(',');
  if (parts.length !== 2) return null;

  // Trimmed, and explicitly rejected if empty AFTER trimming — `Number('')`
  // and `Number('   ')` both evaluate to `0`, which would otherwise let a
  // malformed row like `"3,"` or `"3, "` silently parse as a legitimate
  // `{checkIns: 3, steps: 0}` rather than the corrupted value it actually
  // is. `serializeDailyShapeTarget` never produces an empty segment, so this
  // guards a hand-edited/corrupted row, not a live write path.
  const rawCheckIns = parts[0].trim();
  const rawSteps = parts[1].trim();
  if (rawCheckIns === '' || rawSteps === '') return null;

  const checkIns = Number(rawCheckIns);
  const steps = Number(rawSteps);
  if (!Number.isInteger(checkIns) || !Number.isInteger(steps)) return null;
  if (checkIns < 0 || steps < 0) return null;

  return { checkIns, steps };
}

/** One component's progress — actual vs. target, and whether it's met. */
export interface DailyShapeComponentProgress {
  actual: number | null;
  target: number;
  met: boolean;
}

export interface DailyShapeProgress {
  checkIns: DailyShapeComponentProgress;
  steps: DailyShapeComponentProgress;
  /** True only when every IN-PLAY component (target > 0) is met — a
   * component whose target is 0 is excluded from this, not counted as
   * failing it (see the component-level doc comment below). */
  met: boolean;
}

/** Today's actuals the progress calculation needs — deliberately narrower
 * than `Meal`/`Movement` (db/types.ts), same "no db import" reasoning as
 * `trend.ts`'s `WeighInPoint`. `steps: null` stands for "no movement row
 * synced yet today" (Health Connect hasn't reported, or isn't connected) —
 * see this file's header and `dailyShapeProgress`'s own comment for why that
 * must never be conflated with a genuine 0. `checkIns` has no such gap: the
 * count query it comes from (Home's existing `todayMealCount`) always
 * resolves to a real number, 0 included, once Dexie answers. */
export interface DailyShapeActuals {
  checkIns: number;
  steps: number | null;
}

/**
 * Computes per-component and overall progress against a target.
 *
 * A component whose target is 0 OPTS OUT of the shape — TIDE_PLAN.md §2's
 * day-sized target should let Deepak track just check-ins, or just steps,
 * without a separate on/off toggle for each half; setting the other half to
 * 0 IS that toggle. Such a component is always `met: true` (it has nothing
 * to fall short of) and — per this function's own contract, honoured by
 * `formatDailyShapeComponents` below — is not rendered at all, since a line
 * reading "0 of 0 check-ins" would be a confusing non-fact, not scaffolding.
 *
 * Steps may be `null` (see `DailyShapeActuals`'s doc comment) — a null
 * steps reading is NOT the same claim as zero steps taken, so it must not
 * mark the steps component met even when the target is small. This mirrors
 * `formatMovementLine`'s own established honesty rule (healthSync.ts): a
 * missing reading renders as "not yet", never as an implicit zero. The one
 * exception: if the steps TARGET itself is 0, the component is opted out
 * regardless of whether a steps reading exists yet — an unset target has
 * nothing for a null reading to fall short of either.
 */
export function dailyShapeProgress(target: DailyShapeTarget, actuals: DailyShapeActuals): DailyShapeProgress {
  const checkInsMet = target.checkIns === 0 || actuals.checkIns >= target.checkIns;
  const checkIns: DailyShapeComponentProgress = {
    actual: actuals.checkIns,
    target: target.checkIns,
    met: checkInsMet,
  };

  const stepsMet = target.steps === 0 || (actuals.steps !== null && actuals.steps >= target.steps);
  const steps: DailyShapeComponentProgress = {
    actual: actuals.steps,
    target: target.steps,
    met: stepsMet,
  };

  return { checkIns, steps, met: checkInsMet && stepsMet };
}

/** "2 of 3 check-ins." — `null` when the check-ins target is 0 (opted out,
 * see `dailyShapeProgress`'s doc comment) — that component simply isn't
 * rendered, matching Home's "absent when there's nothing to show" idiom
 * (bfTrend/movementLine on Home.tsx). Actual is always a real number here
 * (never null, unlike steps) since the check-in count query always
 * resolves. */
export function formatCheckInsLine(progress: DailyShapeComponentProgress): string | null {
  if (progress.target === 0) return null;
  return `${progress.actual} of ${progress.target} check-in${progress.target === 1 ? '' : 's'}.`;
}

/** "4,120 of 6,000 steps." or, with no movement row synced yet today,
 * "6,000 steps — no reading yet." — `null` when the steps target is 0
 * (opted out).
 * `en-US` thousands separator, matching `formatMovementLine`'s own choice
 * (healthSync.ts: CLAUDE.md pins English UI for v1, so the ambient device
 * locale — which could format thousands differently on a German-locale
 * phone — is deliberately not used here). */
export function formatStepsLine(progress: DailyShapeComponentProgress): string | null {
  if (progress.target === 0) return null;
  const targetPart = progress.target.toLocaleString('en-US');
  // The null case deliberately BREAKS the "N of M" parallel of the met/unmet
  // lines rather than forcing itself into it: "not yet of 6,000 steps" (the
  // first draft) is awkward English, and awkward copy in the one place the
  // app admits it doesn't know something reads as a glitch rather than as
  // the honest statement it is. A genuinely different state gets a
  // genuinely different sentence — and still never an implied zero.
  if (progress.actual === null) return `${targetPart} steps — no reading yet.`;
  return `${progress.actual.toLocaleString('en-US')} of ${targetPart} steps.`;
}

/**
 * The overall met-state line — calm and exact, no exclamation, no
 * "great job" (CLAUDE.md's no-shame/no-gamification rule, which cuts both
 * ways: this app doesn't shame an unmet day, and it doesn't cheerlead a met
 * one either). Only meaningful when `progress.met` is true; callers render
 * this ALONGSIDE the component lines above (never as a replacement for
 * them) so the met state still shows the numbers it was computed from, not
 * just a bare claim.
 */
export function formatDailyShapeMetLine(): string {
  return "Today's shape is met.";
}
