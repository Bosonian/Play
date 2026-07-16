// Phase B grid UI support — pure model↔grid conversion + the sig-line
// summary string. A DOMAIN file: no React, no Dexie, no browser APIs. Kept
// separate from regimen.ts because this is UI-shape logic (a 4-slot grid,
// tablet quantities) layered ON TOP of the RegimenItem model, not the model
// itself — regimen.ts stays usable even if the grid UI is later replaced.
//
// NOTE (Phase A): RegimenItemForm does NOT use this module's grid editing
// yet — Phase A keeps the current minimal form. This module (and its tests)
// exist now because RegimenList already needs sigLine for its display line,
// and because building the pure logic ahead of the form lets Phase B start
// directly on the UI instead of also inventing the model math under time
// pressure.
import { DRUG_CATALOG } from './drugs';
import type { DoseTime, RegimenItem } from './regimen';
import { sortDoseTimes } from './regimen';
import { formatQuantity, roundMg } from './quantity';

export type SlotId = 'morgens' | 'mittags' | 'abends' | 'nachts';

export interface SlotDef {
  id: SlotId;
  label: string; // German — the doctor-facing grid label (BMP convention)
  helper: string; // English — short gloss for anyone reading the code/UI
  defaultTime: string; // "HH:MM" shown before the doctor edits it
}

// Fixed order: morgens (morning) / mittags (midday) / abends (evening) /
// nachts (night) — the standard German Blister-/Medikamentenplan (BMP)
// column order, which is why the labels stay German even though the rest of
// the app's copy is English for v1 (see CLAUDE.md's language note — this is
// a domain convention, not app UI chrome).
// The `id`s stay as the original German day-part keys — they're internal
// identifiers (used by slotForTime/itemToGrid and the tests), never shown.
// The user-facing `label`s are English (the UI is English; see CLAUDE.md).
export const SLOT_DEFS: readonly SlotDef[] = [
  { id: 'morgens', label: 'Morning', helper: 'morning', defaultTime: '08:00' },
  { id: 'mittags', label: 'Midday', helper: 'midday', defaultTime: '12:00' },
  { id: 'abends', label: 'Evening', helper: 'evening', defaultTime: '18:00' },
  { id: 'nachts', label: 'Night', helper: 'night', defaultTime: '22:00' },
];

// Which BMP slot a clock time falls into. Windows are an APP CONVENTION, not
// a clinical rule (comment, per spec) — the BMP itself fixes the slot ORDER,
// not the boundary times, so these boundaries are our own reasonable-default
// split of the day into quarters. 'nachts' wraps midnight (21:00-03:59).
export function slotForTime(time: string): SlotId {
  const [hh] = time.split(':');
  const hour = Number(hh);
  if (hour >= 4 && hour <= 10) return 'morgens';
  if (hour >= 11 && hour <= 14) return 'mittags';
  if (hour >= 15 && hour <= 20) return 'abends';
  return 'nachts'; // 21:00-23:59 and 00:00-03:59
}

export interface GridSlot {
  qty: number; // tablets (or patches) at this slot; 0 = not taken
  time: string; // "HH:MM" — editable, defaults to the slot's defaultTime
}

export interface GridState {
  strengthMg: number | null; // null = mg-direct mode (no tablet math)
  slots: Record<SlotId, GridSlot>;
}

// Converts a GridState into DoseTime[], sorted. Slots with qty===0 are
// skipped (not taken that slot). Tablet mode (strengthMg set) computes
// doseMg = qty × strengthMg, rounded to 2dp (float-dust guard, SPEC RISK 6);
// mg mode (strengthMg null) treats qty AS the mg value directly.
export function gridToTimes(grid: GridState): DoseTime[] {
  const times: DoseTime[] = [];
  for (const def of SLOT_DEFS) {
    const slot = grid.slots[def.id];
    if (slot.qty === 0) continue;
    const doseMg = grid.strengthMg !== null ? roundMg(slot.qty * grid.strengthMg) : slot.qty;
    times.push({ time: slot.time, doseMg });
  }
  return sortDoseTimes(times);
}

export type GridMapping = { kind: 'grid'; grid: GridState } | { kind: 'custom' };

// Tolerance for "is qty a multiple of 0.25" — float comparisons need slack,
// not exact equality (SPEC RISK 6, same float-dust family as roundMg).
const QUARTER_EPSILON = 1e-9;

function isPositiveQuarterMultiple(qty: number): boolean {
  if (qty <= 0) return false;
  const quarters = qty / 0.25;
  return Math.abs(quarters - Math.round(quarters)) < QUARTER_EPSILON / 0.25;
}

// Attempts to represent an existing RegimenItem's times as a 4-slot grid.
// Falls back to {kind:'custom'} for anything the grid genuinely can't show
// (SPEC RISK 3) — the Phase B form is expected to detect 'custom' and fall
// back to a raw times-list editor for that item rather than losing data.
//
// Round-trip invariant (enforced by grid.test.ts): whenever this returns
// kind:'grid', gridToTimes(grid) reproduces item.times exactly. That's what
// makes the grid safe to show at all — a lossy round-trip through the UI
// would silently rewrite the doctor's prescription on the next save.
export function itemToGrid(item: Pick<RegimenItem, 'times' | 'strengthMg'>): GridMapping {
  // Rule 1: each BMP window may hold at most one dose. Two doses landing in
  // the same slot (e.g. 07:00 and 10:00, both 'morgens') can't be shown by a
  // grid with one qty/time per slot — custom is the only honest option.
  const bySlot = new Map<SlotId, DoseTime>();
  for (const dt of item.times) {
    const slotId = slotForTime(dt.time);
    if (bySlot.has(slotId)) return { kind: 'custom' };
    bySlot.set(slotId, dt);
  }

  function emptyGrid(strengthMg: number | null): GridState {
    const slots = {} as Record<SlotId, GridSlot>;
    for (const def of SLOT_DEFS) {
      const dt = bySlot.get(def.id);
      slots[def.id] = dt
        ? { qty: strengthMg !== null ? dt.doseMg / strengthMg : dt.doseMg, time: dt.time }
        : { qty: 0, time: def.defaultTime };
    }
    return { strengthMg, slots };
  }

  if (item.strengthMg !== undefined) {
    // Rule 2: strength set AND every occupied slot's qty is a positive
    // quarter-tablet multiple (≤20, matching parseQuantity's fat-finger cap)
    // -> genuine tablet mode.
    const qtys = [...bySlot.values()].map((dt) => dt.doseMg / item.strengthMg!);
    const allQuarterMultiples = qtys.every((q) => isPositiveQuarterMultiple(q) && q <= 20);
    if (allQuarterMultiples) {
      return { kind: 'grid', grid: emptyGrid(item.strengthMg) };
    }
    // Rule 3 (judgment call): strength is set but at least one dose isn't a
    // quarter-tablet multiple of it — the strength no longer describes the
    // doses (e.g. edited after the fact). A strength that doesn't fit is
    // worse than none: fall back to mg mode and DISCARD the strength rather
    // than show a tablet count that's silently wrong.
    return { kind: 'grid', grid: emptyGrid(null) };
  }

  // Rule 4: no strength recorded at all -> mg mode.
  return { kind: 'grid', grid: emptyGrid(null) };
}

export interface FrequencyPreset {
  id: string;
  label: string; // English UI label (see SLOT_DEFS)
  slots: SlotId[];
}

export const FREQUENCY_PRESETS: readonly FrequencyPreset[] = [
  { id: 'od-morning', label: '1× morning', slots: ['morgens'] },
  { id: 'bid', label: '2× (morning–evening)', slots: ['morgens', 'abends'] },
  { id: 'tid', label: '3× (morning–midday–evening)', slots: ['morgens', 'mittags', 'abends'] },
  { id: 'qid', label: '4× (morning–midday–evening–night)', slots: ['morgens', 'mittags', 'abends', 'nachts'] },
  { id: 'night', label: 'At night', slots: ['nachts'] },
];

// Applies a frequency preset: qty=1 in the preset's slots, 0 elsewhere.
// Times are left exactly as they were (a doctor who already nudged a slot's
// time shouldn't have it reset by picking a frequency preset). Returns a new
// GridState — does not mutate the input.
export function applyPreset(grid: GridState, preset: FrequencyPreset): GridState {
  const slots = {} as Record<SlotId, GridSlot>;
  for (const def of SLOT_DEFS) {
    const current = grid.slots[def.id];
    slots[def.id] = { qty: preset.slots.includes(def.id) ? 1 : 0, time: current.time };
  }
  return { strengthMg: grid.strengthMg, slots };
}

// One-line prescription summary — shared by RegimenList's row caption and
// (Phase B) the form's live preview, so the two can never drift apart.
// Exact separators (spec, verbatim): '·' (U+00B7) spaced for a time list,
// '—' (em dash) spaced between the drug clause and the schedule clause, a
// plain hyphen (no spaces) between pattern fields.
export function sigLine(
  item: Pick<RegimenItem, 'drug' | 'times' | 'strengthMg' | 'freeText'>,
): string {
  const generic = DRUG_CATALOG[item.drug].generic;

  if ((item.freeText ?? '').trim().length > 0) {
    return `${generic} — ${item.freeText}`;
  }

  const isPatch = DRUG_CATALOG[item.drug].formulation === 'transdermal-patch';
  if (isPatch && item.times.length === 1) {
    const [dt] = item.times;
    return `${generic} ${dt.doseMg} mg/24h — Patch, daily ${dt.time}`;
  }

  const mapping = itemToGrid(item);
  if (mapping.kind === 'grid' && mapping.grid.strengthMg !== null) {
    const { grid } = mapping;
    const pattern = SLOT_DEFS.map((def) => formatQuantity(grid.slots[def.id].qty)).join('-');
    const times = SLOT_DEFS.filter((def) => grid.slots[def.id].qty !== 0)
      .map((def) => grid.slots[def.id].time)
      .join(' · ');
    return `${generic} ${grid.strengthMg} mg — ${pattern} — ${times}`;
  }

  // mg mode or custom: a plain time-ordered list of "HH:MM N mg".
  return `${generic} — ${item.times.map((dt) => `${dt.time} ${dt.doseMg} mg`).join(' · ')}`;
}
