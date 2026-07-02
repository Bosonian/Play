import type { Config } from 'tailwindcss';

// Head-in design tokens. Colours are defined as CSS custom properties in
// src/index.css (one set for light, one for dark) and referenced here via
// var(). This is what lets the whole app switch light/dark by toggling a
// single attribute on <html> — Tailwind classes like `bg-bg` or `text-fg`
// resolve to whichever value the active theme has set.
//
// Naming note: the foreground colour is `fg` (not `text`) and the hairline
// colour is `line` (not `border`) on purpose — naming them `text`/`border`
// would collide confusingly with Tailwind's own `text-*` / `border-*`
// utilities. So: `text-fg`, `border-line`.
//
// The palette (hex values live in index.css):
//   neutrals  bg / surface / surface-soft / line / fg / fg-muted / fg-faint
//   accent    calm teal-blue — primary actions, active nav, the frontier node
//   status    correct (teal-green) / incorrect (amber-orange) / partial (ochre)
//             deliberately NOT red/green, so they survive colour-blindness;
//             always paired with a glyph + text in the UI, never colour alone.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          soft: 'var(--surface-soft)',
        },
        line: 'var(--line)',
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          faint: 'var(--fg-faint)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
        },
        correct: 'var(--correct)',
        incorrect: 'var(--incorrect)',
        partial: 'var(--partial)',
      },
      fontFamily: {
        // System stack — no web-font fetch, so first paint is instant and the
        // app works fully offline. Roboto/Noto cover the Samsung S25.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Noto Sans"',
          'sans-serif',
        ],
      },
      fontSize: {
        // Scale from the design doc §8.5 — [size, line-height].
        display: ['1.75rem', '2.125rem'], // 28 / 34
        title: ['1.375rem', '1.75rem'], // 22 / 28
        'body-lg': ['1.125rem', '1.625rem'], // 18 / 26 — question stems, vignettes
        body: ['1rem', '1.5rem'], // 16 / 24
        label: ['0.875rem', '1.25rem'], // 14 / 20
        caption: ['0.75rem', '1rem'], // 12 / 16
      },
      borderRadius: {
        sm: '8px', // chips
        md: '12px', // cards, buttons
        lg: '20px', // sheets, the CTA pill
      },
      spacing: {
        // Safe-area insets exposed as spacing utilities (e.g. pt-safe-top).
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [],
} satisfies Config;
