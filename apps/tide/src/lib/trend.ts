// The trend engine — TIDE_PLAN.md §2/§4: "the de-noised weight trend is the
// north star". Pure and dependency-free by design (no Dexie import here),
// same discipline as Runway's projection.ts/calibration.ts — screens pass
// in whatever db.weighIns.toArray() read, this file never touches the
// database itself, which is what makes it exhaustively unit-testable with
// plain fixtures and no test double for Dexie.

/**
 * EMA smoothing factor. 0.1 means each new reading contributes 10% of the
 * smoothed value, the previous smoothed value the other 90% — the same
 * "trend weight" idea popularised by scales that show a smoothed number
 * alongside the raw one.
 *
 * TRADEOFF, stated plainly per CLAUDE.md's "truth over reassurance" rule:
 * this is a dial between noise and lag, and 0.1 sits on the slow-and-calm
 * side of it, not a neutral middle. A single day's water-weight swing
 * (a heavy-salt meal, a bad night's sleep, hydration) can easily be
 * 0.5–1.5 kg — with alpha=0.1 one such reading moves the smoothed line by
 * at most 10% of that swing, which is the point (day-to-day noise should
 * not read as "the trend changed"). The cost is real: a GENUINE change in
 * trajectory (a diet actually taking hold, or a holiday actually reversing
 * it) takes roughly 1/alpha = 10 readings — about 10 days at daily
 * cadence, longer at Deepak's realistic every-2-3-days cadence — before
 * the smoothed line has mostly caught up to it. A higher alpha (e.g. 0.3)
 * would halve that lag but let noise back in; this app is betting Deepak
 * checks in over weeks, not days, so slow-and-calm is the right side of
 * the dial to sit on. Revisit if real use shows the lag itself becomes the
 * frustration (see CLAUDE.md's "worth flagging" guidance).
 */
export const EMA_ALPHA = 0.1;

/**
 * Evidence floor before the trend engine will speak at all — same
 * discipline as Runway's learning-increment floors (calibration.ts's
 * `MIN_TREND_WINDOW`, learning.ts's various minimums): a slope computed
 * from 2 points is a straight line between two noisy readings, not a
 * trend. 3 is the smallest number where "line through the data" and "a
 * single day's noise" stop being indistinguishable — two points can only
 * ever describe a line, three is the first count where the DATA gets a
 * say in whether that line is a good fit.
 */
export const MIN_POINTS = 3;

/** Minimal shape the trend engine needs from a weigh-in — deliberately
 * narrower than the full `WeighIn` row (db/types.ts) so this file has no
 * import from db/ at all, and so a caller can pass synthetic fixtures in
 * tests without constructing an entire WeighIn (id, source, bodyFatPct...)
 * just to exercise the math. */
export interface WeighInPoint {
  at: string;
  weightKg: number;
}

export interface TrendPoint {
  at: string;
  smoothed: number;
}

/** The minimal shape the EMA math itself needs — `{at, value}`, no domain
 * concept (kg, %, ...) baked in. Body-fat trend (increment 3, Health Connect)
 * reuses this exact function for `bodyFatPct` the same way `trendSeries`
 * below uses it for `weightKg` — the smoothing algorithm doesn't care what
 * the number MEANS, only that it's a value on a timeline. Not exported: this
 * is an implementation seam, not a second public API surface to keep stable
 * — `trendSeries`/`bodyFatSeries` are the typed, domain-specific entry
 * points every caller outside this file should use instead. */
interface GenericPoint {
  at: string;
  value: number;
}

/**
 * Sorts by `at` ascending and produces an EMA-smoothed series. Pure and
 * deterministic — same input always produces the same output, no
 * `Date.now()` or other hidden state anywhere in this file.
 *
 * The first point seeds the series at its own raw value (nothing to smooth
 * against yet) — the alternative, seeding at 0 or at some assumed starting
 * value, would make the very first smoothed point meaningless. Every point
 * after that blends `EMA_ALPHA` of the new raw reading into
 * `(1 - EMA_ALPHA)` of the previous smoothed value.
 *
 * ISO 8601 datetime strings sort correctly with plain string comparison
 * (`localeCompare`) as long as they're all the same format — same idiom
 * Runway's calibration.ts uses for `checkedAt` — so there's no need to
 * parse each one into a Date just to establish order.
 */
function emaSeries(points: readonly GenericPoint[]): TrendPoint[] {
  const sorted = [...points].sort((a, b) => a.at.localeCompare(b.at));

  const series: TrendPoint[] = [];
  let previousSmoothed: number | null = null;
  for (const entry of sorted) {
    const smoothed: number =
      previousSmoothed === null ? entry.value : EMA_ALPHA * entry.value + (1 - EMA_ALPHA) * previousSmoothed;
    series.push({ at: entry.at, smoothed });
    previousSmoothed = smoothed;
  }
  return series;
}

/** Weight's own entry point into `emaSeries` — unchanged behaviour/signature
 * from before the body-fat generalization (increment 3): every existing
 * caller and test keeps working exactly as it did, since this is now a
 * one-line adapter around the same math rather than the math itself. */
export function trendSeries(weighIns: readonly WeighInPoint[]): TrendPoint[] {
  return emaSeries(weighIns.map((entry) => ({ at: entry.at, value: entry.weightKg })));
}

export interface CurrentTrend {
  /** The latest point on the smoothed line — what Home's headline number
   * shows, not the latest RAW reading (which is exactly the noise this
   * engine exists to look past). */
  smoothedKg: number;
  /** Signed slope of the smoothed line across its actual date span,
   * kg/week. Negative means losing, positive means gaining. */
  slopeKgPerWeek: number;
  /** How many weigh-ins the trend is built from — shown alongside the
   * headline (formatTrendLine) so "the trend" never reads as a claim with
   * an unstated sample size. */
  points: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

/**
 * How far back from the latest weigh-in the slope fit looks — TIDE_PLAN.md
 * §4's "robust smoothing... across the actual date span" reads as CURRENT
 * rate of change, not a lifetime average, and a window is what makes that
 * true. Same idea as Runway's `learning.ts` `RECENCY_WINDOW` (its own doc
 * comment: "habits drift... an uncapped history would let old behaviour
 * permanently drag down a learned value that should track recent
 * reality") — here the mechanism is different (a time window in days,
 * since weigh-ins arrive irregularly, rather than a fixed COUNT of
 * occurrences) but the reasoning is the same one.
 *
 * 21 days (three weeks): long enough that a handful of weigh-ins spread
 * across it is a real trend rather than a single week's noise, short
 * enough that it reflects what's happening NOW rather than blending in a
 * diet phase that ended a month ago. It's also comfortably past
 * `1 / EMA_ALPHA` (10 readings' worth of lag) at Deepak's realistic
 * every-2-3-days cadence, so by the end of the window the smoothed series
 * has mostly caught up to whatever the current rate actually is — see
 * `fitSlopeKgPerWeek`'s own doc comment for why fitting a shorter, more
 * recent stretch is what fixes the full-history bias an earlier version
 * of this file had (worked out and documented during this increment's own
 * testing, then corrected once the bias was understood — see
 * trend.test.ts's "tracks the current rate, not the net" test for the
 * concrete case this constant exists to get right).
 */
const TREND_WINDOW_DAYS = 21;

/**
 * Picks which points of a full smoothed series the slope is fit over —
 * the most recent `TREND_WINDOW_DAYS`, with a fallback for sparse data.
 * Kept as its own function (rather than inlined into `currentTrend`) so
 * `fitSlopeKgPerWeek` below stays a plain, generic "fit whatever series
 * you're given" function with no knowledge of windowing at all — the
 * windowing POLICY lives here, the windowing MATH lives there.
 *
 * Fallback: Deepak won't weigh in daily, so a strict 21-day window can
 * easily contain fewer than `MIN_POINTS` readings (e.g. he weighs in
 * roughly every two weeks) — a window that's too sparse to fit is exactly
 * the "not enough evidence" case `MIN_POINTS` exists to guard against
 * elsewhere in this file, so rather than fit a near-meaningless one- or
 * two-point line, this widens to the most recent `MIN_POINTS` points
 * REGARDLESS of how far back they reach, and fits over whatever real date
 * span they actually cover. This trades window recency for having enough
 * points to fit at all — the right tradeoff here, since `currentTrend`
 * only ever calls this once the OVERALL evidence floor (weighIns.length
 * >= MIN_POINTS) is already satisfied, so this fallback can always find
 * enough points somewhere in the full history.
 */
function selectSlopeWindow(series: readonly TrendPoint[]): TrendPoint[] {
  const latestAtMs = new Date(series[series.length - 1].at).getTime();
  const cutoffMs = latestAtMs - TREND_WINDOW_DAYS * MS_PER_DAY;
  const withinWindow = series.filter((point) => new Date(point.at).getTime() >= cutoffMs);

  if (withinWindow.length >= MIN_POINTS) return withinWindow;
  return series.slice(-MIN_POINTS);
}

/**
 * Ordinary least-squares regression of a (already-windowed, already
 * EMA-denoised) series against elapsed days, converted to kg/week.
 * "Robust" here (per TIDE_PLAN.md §4's "robust smoothing... with a
 * minimum-points floor") means robust in the sense that matters for this
 * data: the regression runs over the ALREADY EMA-DENOISED series, never
 * over raw daily readings. A fit computed straight off raw weigh-ins would
 * still get dragged around by any single noisy day the way a naive
 * average would; running it over `trendSeries`'s output instead means
 * that noise has already been damped out before the slope calculation
 * ever sees it. A more elaborate robust estimator (Theil-Sen, RANSAC, ...)
 * would resist a remaining single wild point better still, but would also
 * be considerably harder for a reader who isn't a statistician to verify
 * by eye — and since EMA has already done the heavy lifting against
 * single-point noise, the marginal benefit here is small. Revisit if real
 * use surfaces a case this doesn't handle well.
 *
 * This function itself is windowing-agnostic — it fits whatever series
 * it's given, full history or not. `currentTrend` is the one caller, and
 * it always passes `selectSlopeWindow`'s output (see that function's own
 * doc comment for WHY a window: fitting the full history biases the slope
 * toward zero for a long time after a genuine change in trend, because
 * EMA's own lagged early readings never leave the regression).
 *
 * Precondition: `series` is non-empty (callers only reach this once
 * `weighIns.length >= MIN_POINTS`, so this is never called on zero or one
 * point in practice) and sorted ascending by `at` (guaranteed by
 * `trendSeries`, the only producer of this shape, and preserved by
 * `selectSlopeWindow`'s filter/slice, neither of which reorders).
 */
function fitSlopeKgPerWeek(series: readonly TrendPoint[]): number {
  const firstAtMs = new Date(series[0].at).getTime();
  const days = series.map((point) => (new Date(point.at).getTime() - firstAtMs) / MS_PER_DAY);
  const weights = series.map((point) => point.smoothed);

  const n = days.length;
  const meanDay = days.reduce((sum, d) => sum + d, 0) / n;
  const meanWeight = weights.reduce((sum, w) => sum + w, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dDay = days[i] - meanDay;
    numerator += dDay * (weights[i] - meanWeight);
    denominator += dDay * dDay;
  }

  // denominator is 0 only when every point shares the exact same
  // timestamp (all `days[i]` equal `meanDay`) — no time axis to fit a
  // slope against. Defensive, not expected in practice: WeighInEntry
  // stamps `at` from `new Date().toISOString()` at save time, so two
  // manual entries would need to land in the same millisecond.
  if (denominator === 0) return 0;

  const slopePerDay = numerator / denominator;
  return slopePerDay * DAYS_PER_WEEK;
}

/**
 * The engine's single public entry point for "what is the trend right
 * now". Returns `null` below `MIN_POINTS` — see that constant's doc
 * comment — rather than a trend built from too little evidence to mean
 * anything. Callers (Home.tsx) are expected to render a distinct
 * "N more weigh-ins to a trend" state in that case, never a trend line
 * with a hedge stapled onto it.
 *
 * `smoothedKg` and `points` are read straight off the FULL smoothed
 * series/history — the current smoothed weight is a fact about the whole
 * record, and "N weigh-ins" in the headline copy (`formatTrendLine`)
 * should mean the whole record too, not just however many fell inside the
 * slope's window. Only `slopeKgPerWeek` is windowed (`selectSlopeWindow`,
 * `TREND_WINDOW_DAYS`) — the rate of change is the one number that's
 * supposed to answer "right now", not "ever".
 */
export function currentTrend(weighIns: readonly WeighInPoint[]): CurrentTrend | null {
  if (weighIns.length < MIN_POINTS) return null;

  const series = trendSeries(weighIns);
  const latest = series[series.length - 1];

  return {
    smoothedKg: latest.smoothed,
    slopeKgPerWeek: fitSlopeKgPerWeek(selectSlopeWindow(series)),
    points: series.length,
  };
}

/**
 * Renders a CurrentTrend as the exact, calm sentence Home's headline uses
 * — CLAUDE.md's "UI copy should be exact, not approximate" rule, applied
 * to a number that updates constantly rather than a static label.
 *
 * Rounds to one decimal place before deciding wording, so a slope that's
 * technically -0.03 kg/week (a rounding artifact of the regression, not a
 * real trend) reads as "holding steady" rather than a falsely precise
 * "−0.0 kg/week" — the plan's own example for why 0.0 gets its own phrase
 * rather than a signed zero. The unicode minus sign (−, U+2212) is used
 * for the negative case rather than a plain hyphen, matching how a
 * negative number is typeset outside of code (TIDE_PLAN.md §5's own
 * example: "trend: −0.4 kg/week").
 */
export function formatTrendLine(trend: Pick<CurrentTrend, 'slopeKgPerWeek' | 'points'>): string {
  const rounded = Math.round(trend.slopeKgPerWeek * 10) / 10;
  const pointsLabel = `${trend.points} weigh-in${trend.points === 1 ? '' : 's'}`;

  if (rounded === 0) {
    return `Trend: holding steady over ${pointsLabel}.`;
  }

  const sign = rounded > 0 ? '+' : '−';
  return `Trend: ${sign}${Math.abs(rounded).toFixed(1)} kg/week over ${pointsLabel}.`;
}

// --- Body-fat trend (Health Connect increment, 0.3.0) ---
// TIDE_PLAN.md §5.2: "Body-fat trend — same treatment, secondary." Reuses
// `emaSeries`/`selectSlopeWindow`/`fitSlopeKgPerWeek` verbatim (all three
// were already unit-agnostic — "kg" in a couple of their names is a
// leftover from when weight was the only caller, not an actual dependency
// on the unit) rather than duplicating the EMA/regression math a second
// time. Kept as separate exported types/functions from `CurrentTrend`/
// `currentTrend` rather than a shared generic type, specifically so Home.tsx
// never has to read a field called `smoothedKg` and remember that for THIS
// call it actually means a percentage — the numbers are generic, the public
// API stays honestly typed per domain.

/** The minimal shape body-fat trend needs from a weigh-in row — deliberately
 * structural (any object with these two fields matches, `WeighIn` included)
 * same reasoning as `WeighInPoint`'s own doc comment. `bodyFatPct` is
 * nullable because most weigh-ins in practice won't carry one (see
 * `db/types.ts`'s own doc comment on the field) — `bodyFatSeries` below
 * filters those out before the EMA math ever sees them, rather than treating
 * a missing reading as a 0%. */
export interface BodyFatPoint {
  at: string;
  bodyFatPct: number | null;
}

export interface BodyFatTrend {
  /** The latest point on the smoothed body-fat line — a percentage, not kg. */
  smoothedPct: number;
  /** Signed slope in percentage points per week — same windowed-fit
   * treatment as `CurrentTrend.slopeKgPerWeek` (see `selectSlopeWindow`'s
   * doc comment; the same `TREND_WINDOW_DAYS`/`EMA_ALPHA` tuning is reused
   * here rather than a body-fat-specific pair, since there's no research
   * basis yet to justify a different noise/lag tradeoff for this signal —
   * revisit if real use shows body-fat readings warrant their own dial). */
  slopePctPerWeek: number;
  /** How many ACTUAL body-fat readings (after filtering out weigh-ins with
   * none) the trend is built from — not the same count as the weight
   * trend's `points` alongside it, since not every weigh-in carries a
   * body-fat reading. */
  points: number;
}

/** Filters to weigh-ins that actually carry a body-fat reading, then EMA-
 * smooths just like `trendSeries` does for weight — see that function's own
 * doc comment for the smoothing/sort behaviour, identical here. */
function bodyFatSeries(rows: readonly BodyFatPoint[]): TrendPoint[] {
  const present = rows.filter((row): row is BodyFatPoint & { bodyFatPct: number } => row.bodyFatPct !== null);
  return emaSeries(present.map((row) => ({ at: row.at, value: row.bodyFatPct })));
}

/**
 * Body-fat's analogue of `currentTrend` — same evidence floor (`MIN_POINTS`),
 * same "null below the floor, never a hedge-stapled trend" contract, but
 * checked against the FILTERED count (only rows with an actual body-fat
 * reading), not `rows.length` — a weigh-in with no body-fat reading doesn't
 * count as evidence for this trend, only for the weight one alongside it.
 */
export function bodyFatTrend(rows: readonly BodyFatPoint[]): BodyFatTrend | null {
  const series = bodyFatSeries(rows);
  if (series.length < MIN_POINTS) return null;

  const latest = series[series.length - 1];
  return {
    smoothedPct: latest.smoothed,
    slopePctPerWeek: fitSlopeKgPerWeek(selectSlopeWindow(series)),
    points: series.length,
  };
}

/**
 * Body-fat's analogue of `formatTrendLine` — same rounding-before-wording
 * and unicode-minus discipline (see that function's own doc comment), "pts"
 * rather than "kg" as the unit label, "reading"/"readings" rather than
 * "weigh-in"/"weigh-ins" since not every weigh-in has one.
 */
export function formatBodyFatTrendLine(trend: Pick<BodyFatTrend, 'slopePctPerWeek' | 'points'>): string {
  const rounded = Math.round(trend.slopePctPerWeek * 10) / 10;
  const pointsLabel = `${trend.points} reading${trend.points === 1 ? '' : 's'}`;

  if (rounded === 0) {
    return `Body fat: holding steady over ${pointsLabel}.`;
  }

  const sign = rounded > 0 ? '+' : '−';
  return `Body fat: ${sign}${Math.abs(rounded).toFixed(1)} pts/week over ${pointsLabel}.`;
}
