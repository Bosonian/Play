import type { Config } from 'tailwindcss';

// Calm, spare palette baseline. The design tokens (colors, spacing scale)
// are tuned as we build actual UI — see CLAUDE.md "Copy and default choices".
// Avoid loud accent colors and high-saturation palettes by default.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
