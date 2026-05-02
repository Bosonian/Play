import type { Config } from 'tailwindcss';

// Warm earth palette — calibrated for "calm, spare" per brief §10.
// Inspired by aged paper, terracotta tile, southwest evening light. Low
// saturation throughout; the single accent (clay) shows up sparingly on
// focus borders and the ▸ arrows in the reframe flow.
//
// If you change a value here, also update src/index.css (body bg) and
// vite.config.ts (PWA manifest theme_color / background_color).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#FAF7F2', // page background — warm off-white
          soft: '#F4EFE7',    // subtly darker areas
        },
        ink: {
          DEFAULT: '#2A2520', // primary text — warm near-black
          soft: '#5A4F46',    // body text
          mute: '#857A70',    // labels, secondary
          fade: '#B5A99E',    // very soft / placeholders
          ghost: '#D5CCC2',   // borders, dividers
        },
        clay: {
          DEFAULT: '#B86A4A', // accent — terracotta
          soft: '#D4906F',
          pale: '#E8D5C8',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
