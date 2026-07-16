// PD regimen — the doctor-authored prescription the patient's dosing follows.
//
// This is a DOMAIN file: no React, no Dexie, no browser APIs. Same rule as
// drugs.ts and ledd.ts (see their file-level comments) — keeps this testable
// in plain node and reusable from both the doctor editor and (later) patient
// dose-logging defaults.

import { DRUG_CATALOG, type DrugId } from './drugs';
import type { ISODateTime } from './types';
import type { LeddDose } from './ledd';

// One prescribed medication line: a drug at one strength, taken at fixed
// local clock times. PD regimens are clock-based, so times are plain local
// "HH:MM" strings — 24h, zero-padded, timezone-free on purpose: "08:00"
// means 08:00 wherever the patient wakes up (never round-tripped through
// Date/ISO, which would silently pull in a timezone this value doesn't have).
// Uneven regimens (e.g. 100-100-50) are modelled as TWO items of the same
// drug with different doseMg — one item = one strength.
export interface RegimenItem {
  id: string; // uuid — stable identity for edit/remove
  patient: string; // patient code (de-identified)
  drug: DrugId;
  // Per-ADMINISTRATION mg, same semantics as DoseEvent.doseMg: for levodopa
  // products the levodopa component only; for rotigotine the patch's mg/24h
  // rating; otherwise the drug's own mg.
  doseMg: number;
  times: string[]; // "HH:MM", sorted ascending, >=1 entry, no duplicates
  updatedAt: ISODateTime;
}

// Matches "HH:MM" in 24h, zero-padded form only — rejects "24:00" (hour must
// be 00-23), "8:00" (needs the leading zero), "08:60" (minute must be 00-59),
// and "" (no match at all).
export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

// New array, lexicographic sort — for zero-padded HH:MM strings, lexicographic
// order IS chronological order, so no time parsing is needed.
export function sortTimes(times: string[]): string[] {
  return [...times].sort();
}

// [] = valid. The returned strings ARE the UI copy (single source of truth —
// RegimenItemForm renders these verbatim rather than re-deriving its own).
export function validateRegimenItem(item: Pick<RegimenItem, 'doseMg' | 'times'>): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(item.doseMg) || item.doseMg <= 0) {
    errors.push('Enter a dose greater than 0.');
  }

  if (item.times.length === 0) {
    errors.push('Add at least one time.');
  } else if (item.times.some((t) => !isValidTime(t))) {
    errors.push('Enter each time as HH:MM.');
  } else if (new Set(item.times).size !== item.times.length) {
    errors.push('Times must be unique.');
  }

  return errors;
}

// Display helper for "N mg/day" — total mg across all administrations.
export function dailyMg(item: Pick<RegimenItem, 'doseMg' | 'times'>): number {
  return item.doseMg * item.times.length;
}

// Expands a regimen into a prototypical day's doses — one { drug, doseMg }
// entry PER CLOCK TIME per item, not one entry per item. This is the
// SPEC RISK #4 arithmetic trap: RegimenItem.doseMg is per-administration, and
// computeLedd's own dedup logic (fixed/fraction factors count once per day
// per drug) needs to see every administration to do that dedup correctly —
// collapsing to one doseMg*times.length*factor entry per item here would
// double-count (or under-count) drugs split across multiple RegimenItems, and
// would defeat computeLedd's per-drug dedup for fixed/fraction factors.
export function regimenDailyDoses(items: RegimenItem[]): LeddDose[] {
  const doses: LeddDose[] = [];
  for (const item of items) {
    for (const _time of item.times) {
      doses.push({ drug: item.drug, doseMg: item.doseMg });
    }
  }
  return doses;
}

// By first time ascending, tie-break by catalog generic name. New array —
// callers (e.g. DoctorHome before passing to RegimenList) rely on this not
// mutating the input.
export function sortRegimenItems(items: RegimenItem[]): RegimenItem[] {
  return [...items].sort((a, b) => {
    const aFirst = a.times[0] ?? '';
    const bFirst = b.times[0] ?? '';
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
    return DRUG_CATALOG[a.drug].generic.localeCompare(DRUG_CATALOG[b.drug].generic);
  });
}

// Catalog drugs whose drugClass !== 'ddci', in catalog key order. Derived
// from DRUG_CATALOG (not hand-hardcoded) so the drug picker can't drift out
// of sync with the catalog: benserazide/carbidopa (the DDCIs) never appear
// as standalone PD prescriptions — the levodopa/madopar-lt items already
// encode the levodopa component only (SPEC RISK #2).
export const PRESCRIBABLE_DRUG_IDS: readonly DrugId[] = (
  Object.keys(DRUG_CATALOG) as DrugId[]
).filter((id) => DRUG_CATALOG[id].drugClass !== 'ddci');

export const ONCE_DAILY_DRUGS: ReadonlySet<DrugId> = new Set(['rotigotine', 'opicapone', 'safinamide']);

// Non-blocking clinical notices about the regimen as a whole — informational,
// never validation errors (a regimen can be saved even with these present;
// see ledd.ts's own note that this class of check "belongs in a later
// validation increment" — this is that increment).
export function regimenWarnings(items: RegimenItem[]): string[] {
  const warnings: string[] = [];

  const hasEntacapone = items.some((item) => item.drug === 'entacapone');
  const hasOpicapone = items.some((item) => item.drug === 'opicapone');
  if (hasEntacapone && hasOpicapone) {
    warnings.push(
      'Entacapone and opicapone are both in the regimen. Two COMT inhibitors are not combined in standard practice.',
    );
  }

  for (const item of items) {
    if (ONCE_DAILY_DRUGS.has(item.drug) && item.times.length > 1) {
      const generic = DRUG_CATALOG[item.drug].generic;
      warnings.push(`${generic} is a once-daily drug; the regimen lists ${item.times.length} times.`);
    }
  }

  return warnings;
}
