import type { Config } from 'tailwindcss';

// Runway design tokens. Unlike head-in, this app is dark-only (the Runway
// live screen is meant to be read across a room while getting dressed —
// a light theme would fight that). No CSS-custom-property theme switch is
// needed, so we just use Tailwind's built-in slate (neutrals) and sky/amber
// (accent) palettes directly in components rather than indirecting through
// var(). If a light theme is ever wanted, revisit this the way head-in did.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Card/input surfaces one step up from the page background
        // (slate-950, unchanged) — not part of Tailwind's default slate
        // scale, so these need explicit hex tokens rather than reusing
        // e.g. slate-900. `surface` is where a card sits; `raised` is one
        // step brighter again, for inputs and pressed states, so a text
        // field inside a card is still visibly separate from the card
        // around it.
        surface: '#0B1220',
        raised: '#131C2E',
      },
      fontSize: {
        // The projected-arrival number on the Runway screen needs to be
        // legible from across a room; nothing in default Tailwind is big
        // enough. Letter-spacing is intentionally NOT baked in here — call
        // sites pair this with the `tracking-tight` utility instead, so
        // there's exactly one source of letter-spacing rather than two
        // rules that could disagree.
        huge: ['4rem', { lineHeight: '4.25rem' }],
      },
      spacing: {
        // Safe-area insets exposed as spacing utilities (e.g. pt-safe-top),
        // same convention as head-in — matters once this runs full-screen
        // as an installed PWA/APK on the S25 Ultra.
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
      keyframes: {
        // The complete motion vocabulary (UI-polish increment design
        // system doc): a plain opacity fade, nothing else. Always paired
        // with the `motion-safe:` variant at the call site (built into
        // Tailwind, maps to `@media (prefers-reduced-motion: no-preference)`)
        // so a reduced-motion user gets the end state immediately with no
        // animation property applied at all, rather than a fade that still
        // runs but shouldn't.
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
