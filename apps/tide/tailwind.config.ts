import type { Config } from 'tailwindcss';

// Copied verbatim from apps/runway's design tokens (per TIDE_PLAN.md §3:
// "reuse verbatim where possible" — the design system/tokens are explicitly
// named). Dark-only, same reasoning as Runway: a health app checked first
// thing in the morning or last thing at night shouldn't force a bright
// white flash. If a light theme is ever wanted, revisit this the way
// head-in did (see Runway's own tailwind.config.ts comment).
//
// Contrast floor (increment 6 polish pass): Tailwind's default `slate-600`
// measures ≈2.7:1 against this config's dark background — below WCAG AA's
// 4.5:1 floor for text, and below even the 3.0:1 floor for large text.
// `slate-500` (≈4.2:1 — still marginally under AA's 4.5:1 for normal text,
// so treat it as the practical minimum for SECONDARY text, never as
// AA-compliant) is the dimmest shade used for secondary/placeholder
// text throughout src/ (TextField.tsx's own comment repeats this locally,
// closer to its one call site). Do not reintroduce `text-slate-600` or
// `placeholder:text-slate-600` for anything meant to be read — this app has
// no lint rule enforcing that, so this comment is the only guardrail.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Card/input surfaces one step up from the page background
        // (slate-950, unchanged) — not part of Tailwind's default slate
        // scale, so these need explicit hex tokens rather than reusing
        // e.g. slate-900. `surface` is where a card sits; `raised` is one
        // step brighter again, for inputs and pressed states.
        surface: '#0B1220',
        raised: '#131C2E',
      },
      fontSize: {
        // The trend headline on Home needs to read as the north star at a
        // glance — same "huge" token as Runway's projected-arrival number,
        // reused here for the same "legible from across the room" reason.
        // Letter-spacing intentionally NOT baked in — pair with
        // `tracking-tight` at the call site (see Runway's own comment).
        huge: ['4rem', { lineHeight: '4.25rem' }],
      },
      spacing: {
        // Safe-area insets as spacing utilities (e.g. pt-safe-top) — matters
        // once this runs full-screen as an installed PWA/APK on the S25
        // Ultra, same as Runway.
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
      keyframes: {
        // Same complete motion vocabulary as Runway: a plain opacity fade,
        // always paired with `motion-safe:` at the call site.
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
