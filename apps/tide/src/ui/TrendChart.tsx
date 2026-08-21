// The trend chart — TIDE_PLAN.md §5.1's "smoothed line," drawn. Home.tsx is
// the only call site: placed directly under the trend headline and its
// sentence, as part of the north star rather than a competing block.
import { buildTrendChartGeometry } from '../lib/trendChart';
import type { WeighInPoint } from '../lib/trend';

interface TrendChartProps {
  weighIns: readonly WeighInPoint[];
}

// Internal coordinate space — arbitrary, since the SVG is stretched to the
// container's actual width via `width="100%"` + `preserveAspectRatio="none"`
// below (a uniform horizontal stretch preserves the RELATIVE time spacing
// trendChart.ts computed, so this scaling never distorts the honesty that
// geometry exists to protect). Height sits in the spec's ~72–96px band.
const WIDTH = 400;
const HEIGHT = 80;
const PADDING = 8;

const GRADIENT_ID = 'tide-trend-area-gradient';

/**
 * A true sparkline: faint raw weigh-ins beneath a single confident smoothed
 * line, nothing else. No axes, gridlines, labels, tooltips, or
 * interactivity — the number and sentence directly above this component on
 * Home already carry every value this chart could otherwise be asked to
 * label; adding any of that back here would be decoration competing with
 * the north star, exactly what CLAUDE.md's calm/spare rule forbids.
 *
 * `aria-hidden="true"`: this SVG restates, visually, exactly what the
 * trend headline number and `formatTrendLine`'s sentence (rendered as
 * plain text immediately above it in Home.tsx) already say. It carries no
 * information a screen reader user doesn't already have from those two
 * text nodes, so it's excluded from the accessibility tree rather than
 * announced as an unlabelled, uninterpretable image.
 *
 * Renders nothing (returns `null`) below the evidence floor OR in the
 * chart's own degenerate-time-span state (`isEmpty` — see trendChart.ts) —
 * Home's existing "N more weigh-ins to a trend" line already covers the
 * former, and the latter has no honest line to draw at all.
 */
export function TrendChart({ weighIns }: TrendChartProps) {
  const geometry = buildTrendChartGeometry(weighIns, { width: WIDTH, height: HEIGHT, padding: PADDING });
  if (!geometry || geometry.isEmpty) return null;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      width="100%"
      height={HEIGHT}
      aria-hidden="true"
      // Fade-in only, same motion vocabulary as every other screen-mount
      // fade in this app (tailwind.config.ts's `fade-in` keyframe) — no
      // animated line-drawing, which the brief rules out as decoration.
      className="motion-safe:animate-fade-in"
    >
      <defs>
        <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
          {/* Barely perceptible on purpose: the LINE is the chart's one
              confident mark (TIDE_PLAN.md §5.1's north star), not the fill
              beneath it. This gradient exists only to give the eye a faint
              sense of "area", never to compete with the line for
              attention — if in doubt while tuning this, make it fainter. */}
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={geometry.areaPath} fill={`url(#${GRADIENT_ID})`} stroke="none" />

      {/* Raw weigh-ins, faint and small — the noise the smoothed line
          exists to look past. Deliberately VISIBLE, not hidden: a 1.5kg
          overnight swing sitting well off the calm line is the app's own
          thesis (TIDE_PLAN.md §2) drawn on screen, not a rough edge to
          polish away. */}
      {geometry.dots.map((dot, i) => (
        <circle key={i} cx={dot.x} cy={dot.y} r="2.2" fill="#94a3b8" fillOpacity="0.55" />
      ))}

      {/* The smoothed line — sky-400 (#38bdf8), the app's one existing
          accent (Button.tsx's primary variant, every focus ring), reused
          here rather than introducing a second "confident" colour. A
          light-slate line was the other option this component considered:
          slate would blend into this screen's own slate-800 card borders
          and slate-400/500 secondary text, reading as one more quiet fact
          among several — exactly wrong for the ONE line on this screen
          that IS the north star. Sky is already tuned for contrast against
          this app's #0B1220/#020617 backgrounds (it's legible in every
          button and focus ring today), so no new contrast math was needed
          to justify it here. */}
      <path
        d={geometry.linePath}
        fill="none"
        stroke="#38bdf8"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
