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
      fontSize: {
        // The projected-arrival number on the Runway screen needs to be
        // legible from across a room; nothing in default Tailwind is big
        // enough.
        huge: ['4rem', { lineHeight: '4.25rem', letterSpacing: '-0.02em' }],
      },
      spacing: {
        // Safe-area insets exposed as spacing utilities (e.g. pt-safe-top),
        // same convention as head-in — matters once this runs full-screen
        // as an installed PWA/APK on the S25 Ultra.
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [],
} satisfies Config;
