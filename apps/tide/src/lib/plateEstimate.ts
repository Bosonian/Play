// Rough plate -> kcal estimate — TIDE_PLAN.md §5.6/§6: "Soft energy picture
// (secondary, de-emphasised)... a plate estimate from Indian composition
// data. The weight trend overrules both." Pure and dependency-free by
// design (no Dexie import here), same discipline as trend.ts (see that
// file's own header comment): PlateCheckIn passes in the tapped tiers, this
// file never touches the database, which is what makes it exhaustively
// unit-testable against plain fixtures with no test double for Dexie.

import type { MealKind, PortionTier } from '../db/types';

/** Minimal shape the estimate needs from a plate check-in — deliberately
 * narrower than the full `Meal` row (db/types.ts), same reasoning as
 * trend.ts's `WeighInPoint`: no `id`/`at`/`photoRef`/`estimatedKcal` needed
 * to run the math, so PlateCheckIn's live-estimate preview can pass its
 * in-progress draft straight in, and tests can build fixtures without
 * constructing an entire `Meal` row. `MealKind`/`PortionTier` are imported
 * as TYPES ONLY from db/types.ts (a pure type-level import, erased at
 * build time — no runtime dependency on db.ts or Dexie) rather than
 * redefined here, so the two can't quietly drift into two different
 * spellings of the same union. */
export interface PlateComposition {
  kind: MealKind;
  carbPortion: PortionTier;
  protein: PortionTier;
  veg: PortionTier;
  fried: boolean;
  sugary: boolean;
}

/**
 * Per-component kcal at each portion tier — TIDE_PLAN.md §6: grounded in
 * the ICMR-NIN Indian Food Composition Tables 2017 / the open Indian
 * Nutrient Databank (INDB), NOT a per-dish lookup. These are deliberately
 * imprecise TIER MIDPOINTS for a rough, mixed Indian home plate (rice/roti/
 * idli for carbs; dal/curd/egg/chicken/fish for protein; sabzi/salad for
 * veg) — one "some"/"lot" number stands in for a whole category of dishes
 * whose real kcal varies a lot (a katori of dal and a katori of chicken
 * curry are not the same number of calories, and this table doesn't
 * pretend otherwise).
 *
 * TRADEOFF, stated plainly per CLAUDE.md's truth-over-reassurance rule:
 * this buys a 3-tap check-in with no per-dish selection UI, at the cost of
 * a single meal's estimate plausibly being off by a few hundred kcal in
 * either direction. That's an acceptable cost for a SECONDARY,
 * de-emphasised signal that the weight trend always outranks
 * (TIDE_PLAN.md §9) — it would NOT be acceptable if this number were ever
 * promoted to a primary measure or a calorie-counting UI.
 */
const CARB_KCAL: Record<PortionTier, number> = { none: 0, some: 200, lot: 400 };
const PROTEIN_KCAL: Record<PortionTier, number> = { none: 0, some: 120, lot: 240 };
const VEG_KCAL: Record<PortionTier, number> = { none: 0, some: 80, lot: 150 };

/** Flat kcal adders for a fried preparation / added sugar — not tiered
 * (there's no none/some/lot for a yes-or-no toggle), and deliberately in
 * the same rough order of magnitude as a "some" carb portion: a fried
 * preparation or a sugary drink/dessert is exactly the kind of addition
 * that can quietly double a plate's real energy content, which is why
 * these get their own toggle rather than being folded into the composition
 * tiers above. */
const FRIED_ADDER_KCAL = 150;
const SUGARY_ADDER_KCAL = 150;

/** Rounds a raw kcal sum to the nearest 50 — a deliberate anti-false-
 * precision choice. The portion table above is already a rough tier
 * midpoint, not a measurement; displaying "463 kcal" would claim a
 * precision this estimate has no way to back up, while "450 kcal" reads,
 * correctly, as the rough figure it is. */
const ROUNDING_STEP_KCAL = 50;

/**
 * Estimates a plate's kcal from its composition tiers + toggles.
 *
 * Returns `null` for a skipped meal — TIDE_PLAN.md §2: "a skipped meal is
 * logged as an honest event... never a 0-calorie win." `0` would be a real,
 * wrong claim (that nothing was eaten AND that this is somehow a good
 * outcome, the exact reframe a skip->binge pattern needs the app to NOT
 * make); `null` is the honest "no estimate applies to this row" — every
 * caller must render nothing for it (see `formatPlateKcal` below), never a
 * fabricated zero.
 */
export function estimatePlateKcal(plate: PlateComposition): number | null {
  if (plate.kind === 'skipped') return null;

  const raw =
    CARB_KCAL[plate.carbPortion] +
    PROTEIN_KCAL[plate.protein] +
    VEG_KCAL[plate.veg] +
    (plate.fried ? FRIED_ADDER_KCAL : 0) +
    (plate.sugary ? SUGARY_ADDER_KCAL : 0);

  return Math.round(raw / ROUNDING_STEP_KCAL) * ROUNDING_STEP_KCAL;
}

/**
 * "~350 kcal" for a number, `""` (render nothing) for `null`/skipped — the
 * same "don't fabricate a zero" discipline as `estimatePlateKcal` itself,
 * pushed one layer out so PlateCheckIn/PlatesToday never have to
 * special-case `null` at their own call sites.
 *
 * DESIGN CALL: plain ASCII tilde (`~`), not the U+2248 "approximately
 * equal" glyph (≈) trend.ts's own doc comments use in prose. Both read the
 * same to a person, but `~` has zero font/encoding risk across every
 * surface this string can land on — a Capacitor WebView TextView-backed
 * render, a future backup-file export, a notification — where a multi-byte
 * unicode glyph could in principle render as a tofu box on a misconfigured
 * font stack. This is the OPPOSITE call from `formatTrendLine`'s unicode
 * MINUS sign (−, U+2212, trend.ts): that one exists because a plain hyphen
 * is genuinely ambiguous with a dash in running prose and has no
 * unambiguous ASCII substitute. "Approximately" has a perfectly good,
 * universally-supported ASCII form (`~`), so there's no reason to take on
 * the encoding risk for it here.
 */
export function formatPlateKcal(kcal: number | null): string {
  if (kcal === null) return '';
  return `~${kcal} kcal`;
}

/**
 * Short human labels for a plate's non-empty parts — PlatesToday's row
 * display. `["Skipped meal"]` for a skipped meal, checked first rather than
 * relying on its tiers all being `'none'` by construction (PlateCheckIn.tsx
 * always writes them that way, but this function stays correct even if
 * that invariant is ever violated).
 *
 * `none` tiers are omitted entirely, not listed as "Carbs: none" — chips
 * exist to say what WAS on the plate; a tier that was never tapped past
 * "not present" isn't information worth a chip, it's the absence of one.
 * Fried/Sugary render as bare labels ("Fried", not "Fried: yes") since
 * they're booleans with no tier to report.
 */
export function compositionChips(plate: PlateComposition): string[] {
  if (plate.kind === 'skipped') return ['Skipped meal'];

  const chips: string[] = [];
  if (plate.carbPortion !== 'none') chips.push(`Carbs: ${plate.carbPortion}`);
  if (plate.protein !== 'none') chips.push(`Protein: ${plate.protein}`);
  if (plate.veg !== 'none') chips.push(`Veg: ${plate.veg}`);
  if (plate.fried) chips.push('Fried');
  if (plate.sugary) chips.push('Sugary');
  return chips;
}
