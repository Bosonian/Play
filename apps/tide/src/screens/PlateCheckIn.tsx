import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { db } from '../db/db';
import type { Screen } from '../App';
import type { MealKind, PortionTier } from '../db/types';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { estimatePlateKcal, formatPlateKcal, type PlateComposition } from '../lib/plateEstimate';
import { logEvent } from '../lib/eventLog';
import { hapticImpact } from '../native/haptics';

interface PlateCheckInProps {
  onNavigate: (screen: Screen) => void;
}

/** The four kinds this screen's segmented control offers — `'skipped'`
 * (the fifth `MealKind` value, db/types.ts) is deliberately NOT one of
 * them; a skip is a distinct, separately-triggered action (the "Log a
 * skipped meal" TextAction below), never a state this segmented control can
 * land on by tapping through it. */
type CheckInMealKind = Exclude<MealKind, 'skipped'>;

/** The draft's own type — `PlateComposition` but with `kind` narrowed to
 * `CheckInMealKind`, so the compiler ENFORCES (not merely convention) that
 * an in-progress draft can never be `'skipped'`: `setDraft((d) => ({ ...d,
 * kind: 'skipped' }))` would fail to typecheck. This is what makes
 * `estimatePlateKcal(draft)`'s null-for-skipped branch genuinely
 * unreachable from this screen — the "the estimate is always a number here"
 * reasoning below rests on this type, not on a UI convention that a future
 * edit could quietly break. (Review fix, 0.4.1: the previous comment
 * claimed this was already type-enforced when the draft was still typed as
 * the full `PlateComposition`; this narrowing makes the claim true.) A skip
 * is built as its own `Meal` literal in `handleSkip`, never from this
 * draft. */
type PlateDraft = Omit<PlateComposition, 'kind'> & { kind: CheckInMealKind };

const MEAL_KIND_OPTIONS: { value: CheckInMealKind; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

const TIER_OPTIONS: readonly PortionTier[] = ['none', 'some', 'lot'];
const TIER_LABELS: Record<PortionTier, string> = { none: 'None', some: 'Some', lot: 'Lot' };

/** Picks the segmented control's starting selection from the current
 * 24-hour clock (CLAUDE.md's European time-format default) — one tap
 * overrides it, this only saves that tap for the common case. Boundaries
 * are deliberately round hours, not meal-specific research: 04:00 (not
 * midnight) keeps a very-early riser's breakfast from defaulting to
 * "Snack", and the four bands cover the full 24h with no gap or overlap.
 * `else Snack` (04:00 is unreachable as a genuine "else" since the bands
 * already span 0000-2359, but is kept as the function's total fallback so
 * an out-of-range hour — never possible from `Date#getHours()`'s own 0-23
 * contract, but not asserted away — still returns a valid `MealKind`
 * rather than `undefined`). */
function defaultMealKindForHour(hour: number): CheckInMealKind {
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 22) return 'dinner';
  return 'snack';
}

/** A "normal plate": every composition tier defaults to `'some'` (not
 * `'none'`) — CLAUDE.md's defaults-lean-smaller rule is about UNCERTAIN
 * choices, not this one; a plate with nothing on it isn't the common case a
 * 3-tap flow should be optimised for, so the default represents an
 * ordinary meal and Deepak adjusts only the tiers that genuinely differ
 * today (this IS the 3-tap promise — kind, then only the tiers that need
 * changing, then Save). Both toggles default off, which IS the smaller/
 * uncertain-leaning default: "not fried, not sugary" is the right
 * assumption absent any signal either way. */
function defaultDraft(): PlateDraft {
  return {
    kind: defaultMealKindForHour(new Date().getHours()),
    carbPortion: 'some',
    protein: 'some',
    veg: 'some',
    fried: false,
    sugary: false,
  };
}

/**
 * The 3-tap plate check-in — TIDE_PLAN.md §5.3/§7 increment 4. Local-draft
 * state, same pattern as WeighInEntry.tsx: every tap updates React state
 * only, nothing touches Dexie until Save (or the separate skip action)
 * fires, so an abandoned check-in leaves no partial row behind.
 *
 * No text input anywhere on this screen (unlike WeighInEntry), so there's
 * no parse-and-validate step — every tap already produces a valid
 * `PlateComposition`, which is what makes the live estimate always safe to
 * compute directly off `draft` with no error state to gate it.
 */
export function PlateCheckIn({ onNavigate }: PlateCheckInProps) {
  const [draft, setDraft] = useState<PlateDraft>(defaultDraft);
  // In-flight guard (review fix, 0.4.1): both save paths are async and
  // write a row. Without a guard, a fast double-tap on Save writes a
  // duplicate plate, and a stray tap on the skip action writes a false
  // skip — and a skip is a FALSE EVENT in a log whose whole point is
  // honesty (TIDE_PLAN.md §2), worse than a duplicate weigh-in that an EMA
  // barely notices. `saving` disables both actions the instant one fires
  // and both handlers early-return while it's set. On success the screen
  // navigates away (this component unmounts), so there's nothing to reset;
  // only a failed write resets it, so a transient Dexie error leaves the
  // screen usable rather than locked.
  const [saving, setSaving] = useState(false);

  function clearDraft() {
    setDraft(defaultDraft());
  }

  // Esc-to-clear (CLAUDE.md's keyboard-shortcut guidance, same as
  // WeighInEntry.tsx) — Enter's half is the <form>'s native submit
  // behaviour via the Save button's `type="submit"`, needing no handler of
  // its own. Every OTHER control on this form is `type="button"` precisely
  // so a stray Enter while one of them is focused toggles that control
  // (its own native behaviour) rather than submitting early.
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') clearDraft();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);

    const estimatedKcal = estimatePlateKcal(draft);

    // No Dexie version() bump needed for this write — see db/db.ts's own
    // comment at the top of its version(1)/version(2) block: `meals` and
    // its `at` index were already declared in v1, and every field written
    // below was already part of the v1 `Meal` shape (db/types.ts). This is
    // `meals`' first real writer, not a schema change.
    try {
      await db.meals.add({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        kind: draft.kind,
        carbPortion: draft.carbPortion,
        protein: draft.protein,
        veg: draft.veg,
        fried: draft.fried,
        sugary: draft.sugary,
        photoRef: null, // Photo capture is a later increment (TIDE_PLAN.md §7).
        // Stored as a snapshot, not recomputed on read: freezes today's
        // estimate at write-time. TRADEOFF, named plainly per CLAUDE.md: if
        // plateEstimate.ts's portion table is later refined (a real
        // possibility — TIDE_PLAN.md §6 calls the current table "rough"),
        // every OLD row keeps showing the estimate computed under the OLD
        // table, not a retroactively-updated one. Acceptable because this
        // value is explicitly secondary and de-emphasised (TIDE_PLAN.md §9)
        // — a rough estimate quietly drifting from "what today's formula
        // would say" is a far smaller honesty problem than a displayed
        // number silently changing under a past date with no visible cause.
        estimatedKcal,
      });
    } catch {
      // A failed write (quota, corruption — rare) must not strand the screen
      // with both actions disabled forever: re-enable so Deepak can retry.
      // The half-open guard is the point — a duplicate is prevented, a
      // failure is recoverable.
      setSaving(false);
      return;
    }

    // formatPlateKcal never returns "" here — `draft.kind` is a
    // `CheckInMealKind`, never `'skipped'`, so `estimatedKcal` is always a
    // number, never null (see `estimatePlateKcal`'s own doc comment).
    void logEvent('meal', `Plate logged: ${draft.kind}, ${formatPlateKcal(estimatedKcal)}.`);
    // Haptic-on-save (increment 6 polish) — see WeighInEntry.tsx's own
    // comment on the same call for why.
    void hapticImpact('light');

    onNavigate({ name: 'home' });
  }

  /** The skip path — a distinct action, not a fifth segmented-control
   * option (see `CheckInMealKind`'s own doc comment for why). Saves
   * immediately with no intermediate draft state of its own to review,
   * matching TIDE_PLAN.md §2's "a skipped meal is logged as an honest
   * event... never a 0-calorie win": there is nothing to compose for a
   * skip, so there is nothing to tap through before it's logged. */
  async function handleSkip() {
    if (saving) return;
    setSaving(true);
    try {
      await db.meals.add({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        kind: 'skipped',
        carbPortion: 'none',
        protein: 'none',
        veg: 'none',
        fried: false,
        sugary: false,
        photoRef: null,
        estimatedKcal: null,
      });
    } catch {
      // See handleSubmit's own catch — a failed write re-enables the screen
      // rather than locking it. A false skip is the honesty-sensitive case
      // (TIDE_PLAN.md §2) the `saving` guard above exists to prevent.
      setSaving(false);
      return;
    }
    void logEvent('meal', 'Skipped meal logged.');
    // Haptic-on-save (increment 6 polish) — a skip is still a save (see
    // this function's own header comment: "a skip is a real check-in"), so
    // it gets the same acknowledgement tap as a real plate.
    void hapticImpact('light');
    onNavigate({ name: 'home' });
  }

  const liveEstimateKcal = estimatePlateKcal(draft);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Add plate" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} onKeyDown={handleKeyDown} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-400">Meal</span>
          <div className="flex gap-2">
            {MEAL_KIND_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                // aria-pressed so a screen reader announces which kind is
                // selected — selection is otherwise colour-only (variant),
                // invisible to assistive tech. Same on every segmented
                // control on this screen (tiers, Fried/Sugary).
                aria-pressed={draft.kind === option.value}
                variant={draft.kind === option.value ? 'primary' : 'secondary'}
                className="flex-1 px-2 py-2 text-sm"
                onClick={() => setDraft((d) => ({ ...d, kind: option.value }))}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <TierRow
            label="Carbs"
            hint="Rice, roti, idli"
            value={draft.carbPortion}
            onChange={(carbPortion) => setDraft((d) => ({ ...d, carbPortion }))}
          />
          <TierRow
            label="Protein"
            hint="Dal, curd, egg, chicken, fish"
            value={draft.protein}
            onChange={(protein) => setDraft((d) => ({ ...d, protein }))}
          />
          <TierRow
            label="Veg"
            hint="Sabzi, salad"
            value={draft.veg}
            onChange={(veg) => setDraft((d) => ({ ...d, veg }))}
          />
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            aria-pressed={draft.fried}
            variant={draft.fried ? 'primary' : 'secondary'}
            className="flex-1"
            onClick={() => setDraft((d) => ({ ...d, fried: !d.fried }))}
          >
            Fried
          </Button>
          <Button
            type="button"
            aria-pressed={draft.sugary}
            variant={draft.sugary ? 'primary' : 'secondary'}
            className="flex-1"
            onClick={() => setDraft((d) => ({ ...d, sugary: !d.sugary }))}
          >
            Sugary
          </Button>
        </div>

        {/* Live estimate — quiet and subordinate on purpose (TIDE_PLAN.md
            §9: "the weight trend must always visibly outrank it"). Small
            slate-500 text, no card, no emphasis — the number exists to
            give a rough sense of scale while composing the plate, not to
            compete with the weight trend for attention anywhere in this
            app, including here on its own entry screen. */}
        <p className="text-sm text-slate-500">
          {formatPlateKcal(liveEstimateKcal)} — a rough guess. The weight trend is the real measure.
        </p>

        <Button type="submit" className="w-full" disabled={saving}>
          Save
        </Button>
      </form>

      <TextAction onClick={() => void handleSkip()} disabled={saving} className="self-start disabled:opacity-40">
        Log a skipped meal
      </TextAction>
    </div>
  );
}

interface TierRowProps {
  label: string;
  hint: string;
  value: PortionTier;
  onChange: (tier: PortionTier) => void;
}

/** One composition row (Carbs/Protein/Veg): a label, a one-line example
 * hint (CLAUDE.md's "exact, not approximate" copy rule — "Carbs" alone
 * is ambiguous about what counts), and a 3-segment none/some/lot control.
 * Private to this file, not promoted to `ui/` — three call sites in one
 * screen doesn't yet justify a shared primitive (see Button.tsx's own
 * header comment on the bar for that: genuinely generic, reused across
 * screens). */
function TierRow({ label, hint, value, onChange }: TierRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-400">{label}</span>
        <span className="text-xs text-slate-500">{hint}</span>
      </div>
      <div className="flex gap-2">
        {TIER_OPTIONS.map((tier) => (
          <Button
            key={tier}
            type="button"
            aria-pressed={value === tier}
            variant={value === tier ? 'primary' : 'secondary'}
            className="flex-1 px-2 py-1.5 text-sm"
            onClick={() => onChange(tier)}
          >
            {TIER_LABELS[tier]}
          </Button>
        ))}
      </div>
    </div>
  );
}
