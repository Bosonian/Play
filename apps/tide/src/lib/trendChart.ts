// The trend chart's geometry — TIDE_PLAN.md §5.1: "Weight trend — smoothed
// line... North star." This file turns weigh-ins into SVG path data; it
// imports `trendSeries`/`MIN_POINTS` from trend.ts and does NOT reimplement
// or re-tune the smoothing itself — the chart must draw exactly the series
// that engine already computes, nothing more confident and nothing less.
//
// Pure geometry, no React, no DOM — same "testable with plain fixtures"
// discipline as trend.ts itself (see that file's own header comment). The
// presentational half (src/ui/TrendChart.tsx) is a thin SVG wrapper around
// this file's output.

import { MIN_POINTS, trendSeries, type WeighInPoint } from './trend';

export interface ChartDot {
  x: number;
  y: number;
}

export interface TrendChartGeometry {
  /** SVG path `d` for the smoothed (EMA) line — empty string when `isEmpty`. */
  linePath: string;
  /** `linePath` closed down to the bottom padded edge, for the area fill —
   * empty string when `isEmpty`. */
  areaPath: string;
  /** RAW weigh-ins' positions — the noise the smoothed line ignores. Empty
   * array when `isEmpty`. */
  dots: ChartDot[];
  /** True when there is technically enough evidence (`weighIns.length >=
   * MIN_POINTS`, so this function returns an object rather than `null`) but
   * no honest geometry can be drawn from it — see the "degenerate time span"
   * comment below for the one case this currently guards. Callers should
   * treat `isEmpty: true` the same as a `null` return: render nothing. */
  isEmpty: boolean;
}

export interface TrendChartOptions {
  width: number;
  height: number;
  /** Uniform padding on all four sides — keeps the smoothed line's own
   * peaks/troughs and the SVG stroke width itself from touching the box
   * edge. Applied to both axes, not just vertically: the leftmost/rightmost
   * dot would otherwise sit exactly on the edge and read as clipped. */
  padding: number;
}

/** Extra vertical headroom above/below the raw min/max, as a fraction of
 * the raw range — so the smoothed (EMA) line, which is always a convex
 * combination of raw values and therefore never leaves [rawMin, rawMax]
 * (see this file's own proof sketch further down, at `yForValue`'s call
 * site), never sits flush against the top/bottom of the box either. 15% is
 * a small, deliberately unremarkable choice — enough headroom to read as
 * "the line has room to breathe", not enough to visually compress the
 * data. */
const Y_DOMAIN_PADDING_FRACTION = 0.15;

/** Fixed headroom (in kg) used only on a flat day — every raw weigh-in
 * identical, so `rawMax - rawMin === 0` and the 15% fraction above would
 * itself be zero, reproducing the exact divide-by-zero this constant
 * exists to avoid. 1kg is arbitrary but harmless: with `domainMin =
 * value - 1` and `domainMax = value + 1`, the single value maps to exactly
 * the vertical centre of the box by construction, with no special-cased
 * "centre it" branch needed in `yForValue` itself. */
const FLAT_DOMAIN_PAD_KG = 1;

/**
 * Builds the chart's geometry from a list of weigh-ins, or `null` below the
 * evidence floor — identical contract and identical constant (`MIN_POINTS`)
 * to `trend.ts`'s `currentTrend`, so the chart and the headline sentence
 * above it always agree on when there's enough data to speak at all.
 */
export function buildTrendChartGeometry(
  weighIns: readonly WeighInPoint[],
  { width, height, padding }: TrendChartOptions,
): TrendChartGeometry | null {
  if (weighIns.length < MIN_POINTS) return null;

  const sorted = [...weighIns].sort((a, b) => a.at.localeCompare(b.at));
  const times = sorted.map((w) => new Date(w.at).getTime());
  const minAt = times[0];
  const maxAt = times[times.length - 1];
  const timeRangeMs = maxAt - minAt;

  const usableWidth = width - 2 * padding;
  const usableHeight = height - 2 * padding;

  // X-AXIS HONESTY — the load-bearing decision in this file. Deepak's
  // weigh-ins are IRREGULAR: he may step on the scale twice in one
  // morning, then not again for four days. If x were spaced by INDEX
  // (each weigh-in claiming one equal-width step, the way a naive
  // sparkline often works), that four-day gap would occupy exactly the
  // same horizontal distance as the same-morning pair — visually
  // compressing four days of real drift into the width of same-day noise,
  // and stretching a same-day pair out to look like it spans real time.
  // That is a distortion of the actual RATE the trend line exists to be
  // honest about (TIDE_PLAN.md §2's "measure the outcome... a de-noised
  // signal"). Mapping `at` LINEARLY across the width — real elapsed time,
  // not position in the list — is the only projection where the slope you
  // SEE on screen approximates the slope `trend.ts`'s regression actually
  // computes. Every x below is `at`-proportional, never index-proportional.
  const timeRangeIsDegenerate = timeRangeMs === 0;

  if (timeRangeIsDegenerate) {
    // Every weigh-in landed at the identical millisecond — the one case
    // where there is no time axis left to be honest about (the same
    // "denominator is 0" edge trend.ts's own fitSlopeKgPerWeek guards
    // defensively, for the same reason: two manual entries would need to
    // share a millisecond, not expected in practice). Rather than collapse
    // every point onto one x and draw a vertical smear that LOOKS like a
    // chart, this returns the chart's own "nothing to honestly draw"
    // state — callers treat it exactly like `null` (see `isEmpty`'s own
    // doc comment).
    return { linePath: '', areaPath: '', dots: [], isEmpty: true };
  }

  const xForTime = (t: number) => padding + ((t - minAt) / timeRangeMs) * usableWidth;

  const rawValues = sorted.map((w) => w.weightKg);
  const rawMin = Math.min(...rawValues);
  const rawMax = Math.max(...rawValues);
  const rawRange = rawMax - rawMin;
  // Flat-day guard (a Y-axis analogue of the degenerate-time-span guard
  // above): identical raw values would otherwise make `domainSpan` zero, a
  // second divide-by-zero waiting to happen in `yForValue`. See
  // FLAT_DOMAIN_PAD_KG's own doc comment for why a fixed pad both avoids
  // that AND centres the line, with no separate branch needed below.
  const domainPad = rawRange === 0 ? FLAT_DOMAIN_PAD_KG : rawRange * Y_DOMAIN_PADDING_FRACTION;
  const domainMin = rawMin - domainPad;
  const domainMax = rawMax + domainPad;
  const domainSpan = domainMax - domainMin;

  // SVG y grows downward; a higher weight reads as higher on screen (the
  // ordinary chart convention), hence the `(1 - ...)` flip.
  const yForValue = (value: number) => padding + (1 - (value - domainMin) / domainSpan) * usableHeight;

  const dots: ChartDot[] = sorted.map((w, i) => ({ x: xForTime(times[i]), y: yForValue(w.weightKg) }));

  // The smoothed (EMA) series — `trendSeries` is 1:1 with its input, still
  // ascending by `at` (it re-sorts internally but `sorted` is already
  // sorted the same way), so `linePoints[i]` and `dots[i]` share an x.
  // PROOF SKETCH that this line never leaves [rawMin, rawMax], hence never
  // touches the padded box's edge: `trendSeries` seeds at the first raw
  // value, then each step is `alpha * v + (1 - alpha) * previous` — a
  // convex combination of two values already in [rawMin, rawMax] (by
  // induction, starting from a raw value), so it stays in that interval
  // forever. The domain padding above only needs to keep [rawMin, rawMax]
  // itself off the edge, not guard the line separately.
  const smoothed = trendSeries(sorted);
  const linePoints: ChartDot[] = smoothed.map((p, i) => ({ x: xForTime(times[i]), y: yForValue(p.smoothed) }));

  const linePath = monotoneCubicPath(linePoints);
  const baselineY = height - padding;
  const areaPath =
    linePath === ''
      ? ''
      : `${linePath} L${fmt(linePoints[linePoints.length - 1].x)},${fmt(baselineY)} L${fmt(linePoints[0].x)},${fmt(baselineY)} Z`;

  return { linePath, areaPath, dots, isEmpty: false };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Draws a monotone cubic Hermite spline through `points`, returned as an
 * SVG path `d` string (`M`, then one `C` per segment).
 *
 * CURVE CHOICE, stated per CLAUDE.md's truth-over-reassurance rule: this is
 * the Fritsch–Carlson construction (the same one D3's `curveMonotoneX`
 * uses), chosen over a plain Catmull-Rom spline specifically because it is
 * PROVABLY non-overshooting — between any two consecutive smoothed points
 * the curve never rises above the higher of the two or dips below the
 * lower one (see trendChart.test.ts's "stays within the padded box" test).
 * A Catmull-Rom curve has no such guarantee: its tangents are fixed at the
 * average of neighbouring secants regardless of local shape, so it can
 * bulge past a data point it's supposed to pass through — here, that would
 * literally draw a weight Deepak never had, the exact honesty failure this
 * whole feature exists to avoid (see this file's header comment and
 * TIDE_PLAN.md §2). The tradeoff: monotone cubic is a few more lines of
 * arithmetic than Catmull-Rom's fixed formula. Worth it for a chart whose
 * entire job is to be trusted at a glance.
 *
 * Algorithm: for each point, start from the average of its two adjacent
 * secant slopes (zero at a local max/min, where the two secants disagree
 * in sign — this alone prevents overshoot AT turning points); then, for
 * each segment, rescale the pair of endpoint tangents if their combined
 * magnitude would otherwise pull the curve past the segment's own two
 * y-values (the Fritsch–Carlson step). The resulting Hermite segment is
 * converted to a cubic Bezier the standard way (control points at 1/3 and
 * 2/3 along x, offset by the tangent).
 */
function monotoneCubicPath(points: readonly ChartDot[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${fmt(points[0].x)},${fmt(points[0].y)}`;

  const dx: number[] = [];
  const secantSlope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const segDx = points[i + 1].x - points[i].x;
    const segDy = points[i + 1].y - points[i].y;
    dx.push(segDx);
    secantSlope.push(segDx === 0 ? 0 : segDy / segDx);
  }

  const tangent: number[] = new Array(n).fill(0);
  tangent[0] = secantSlope[0];
  tangent[n - 1] = secantSlope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const s0 = secantSlope[i - 1];
    const s1 = secantSlope[i];
    tangent[i] = s0 === 0 || s1 === 0 || s0 > 0 !== s1 > 0 ? 0 : (s0 + s1) / 2;
  }

  // Fritsch–Carlson rescale: for each segment, clamp the pair of endpoint
  // tangents so their combined pull can never carry the curve past either
  // of the segment's own two y-values.
  for (let i = 0; i < n - 1; i++) {
    if (secantSlope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / secantSlope[i];
    const b = tangent[i + 1] / secantSlope[i];
    const magnitude = Math.hypot(a, b);
    if (magnitude > 3) {
      const tau = 3 / magnitude;
      tangent[i] = tau * a * secantSlope[i];
      tangent[i + 1] = tau * b * secantSlope[i];
    }
  }

  let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const third = dx[i] / 3;
    const c1x = p0.x + third;
    const c1y = p0.y + tangent[i] * third;
    const c2x = p1.x - third;
    const c2y = p1.y - tangent[i + 1] * third;
    d += ` C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p1.x)},${fmt(p1.y)}`;
  }
  return d;
}
