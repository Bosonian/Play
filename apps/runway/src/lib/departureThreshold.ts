/**
 * How far into the past a 'planned'/'running' departure's appointment can
 * slip before it stops counting as "upcoming" — shared between Home's own
 * Upcoming/Past split (src/screens/Home.tsx) and the departure widget's
 * source-selection logic (src/lib/widgetSnapshot.ts).
 *
 * Pulled into its own lib file (rather than left as a screen-local const,
 * which is where it lived before the widgets increment) so widgetSnapshot.ts
 * — a lib file with no business importing a screen component — can share
 * the exact same threshold without redeclaring the number and risking the
 * two definitions drifting apart.
 */
export const PAST_DEPARTURE_THRESHOLD_MS = 60 * 60_000;
