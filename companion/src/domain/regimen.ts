// PD regimen — the doctor-authored prescription the patient's dosing follows.
//
// This is a DOMAIN file: no React, no Dexie, no browser APIs. Same rule as
// drugs.ts and ledd.ts (see their file-level comments) — keeps this testable
// in plain node and reusable from both the doctor editor and (later) patient
// dose-logging defaults.

import { DRUG_CATALOG, type DrugId } from './drugs';
import type { ISODateTime } from './types';
import type { LeddDose } from './ledd';

// One prescribed administration: a clock time and the mg given AT that time.
// PD regimens are clock-based, so `time` is a plain local "HH:MM" string —
// 24h, zero-padded, timezone-free on purpose: "08:00" means 08:00 wherever
// the patient wakes up (never round-tripped through Date/ISO, which would
// silently pull in a timezone this value doesn't have).
export interface DoseTime {
  time: string; // "HH:MM"
  // Per-ADMINISTRATION mg, same semantics as DoseEvent.doseMg: for levodopa
  // products the levodopa component only; for rotigotine the patch's mg/24h
  // rating; otherwise the drug's own mg.
  doseMg: number;
}

// One prescribed medication line: a drug taken at a set of clock times, each
// with its own mg (dose-per-time — this is what lets an uneven regimen, e.g.
// 100-100-50, live in a SINGLE item instead of two items of the same drug at
// different strengths, which is how the previous model handled it).
export interface RegimenItem {
  id: string; // uuid — stable identity for edit/remove
  patient: string; // patient code (de-identified)
  drug: DrugId;
  times: DoseTime[]; // sorted ascending by .time, no duplicate times
  updatedAt: ISODateTime;
  // UI round-trip only (Phase B's grid↔mg conversion) — NEVER read by LEDD
  // or the patient dose loop, both of which only ever look at times[].doseMg.
  // Absent on rows migrated from the old shape (see store.ts's version(4)).
  strengthMg?: number;
  // Escape hatch for schedules the grid can't express (e.g. an irregular
  // taper). Mutually exclusive with a populated times[] — see
  // validateRegimenItem. A freeText-only line contributes 0 to LEDD and 0
  // slots to the patient's dose list (see regimenDailyDoses / doses.ts).
  freeText?: string;
}

// Matches "HH:MM" in 24h, zero-padded form only — rejects "24:00" (hour must
// be 00-23), "8:00" (needs the leading zero), "08:60" (minute must be 00-59),
// and "" (no match at all).
export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

// New array, lexicographic sort on .time — for zero-padded HH:MM strings,
// lexicographic order IS chronological order, so no time parsing is needed.
export function sortDoseTimes(times: DoseTime[]): DoseTime[] {
  return [...times].sort((a, b) => a.time.localeCompare(b.time));
}

// [] = valid. The returned strings ARE the UI copy (single source of truth —
// RegimenItemForm renders these verbatim rather than re-deriving its own).
export function validateRegimenItem(
  item: Pick<RegimenItem, 'times' | 'strengthMg' | 'freeText'>,
): string[] {
  const errors: string[] = [];
  const hasFreeText = (item.freeText ?? '').trim().length > 0;

  if (hasFreeText && item.times.length > 0) {
    // Mutual exclusion wins outright — no point also complaining about time
    // formatting on a line that's about to be rejected anyway.
    errors.push('Use either the schedule grid or free text, not both.');
  } else if (!hasFreeText && item.times.length === 0) {
    errors.push('Add at least one dose.');
  } else if (item.times.length > 0) {
    // Time-shape errors are else-if chained (one at a time is enough to act
    // on); the dose-per-time check below is an independent push.
    if (item.times.some((t) => !isValidTime(t.time))) {
      errors.push('Enter each time as HH:MM.');
    } else if (new Set(item.times.map((t) => t.time)).size !== item.times.length) {
      errors.push('Times must be unique.');
    }

    if (item.times.some((t) => !Number.isFinite(t.doseMg) || t.doseMg <= 0)) {
      errors.push('Enter a dose greater than 0 for each time.');
    }
  }

  if (item.strengthMg !== undefined && (!Number.isFinite(item.strengthMg) || item.strengthMg <= 0)) {
    errors.push('Enter a strength greater than 0.');
  }

  return errors;
}

// Display helper for "N mg/day" — total mg across all administrations.
export function dailyMg(item: Pick<RegimenItem, 'times'>): number {
  return item.times.reduce((sum, t) => sum + t.doseMg, 0);
}

// Expands a regimen into a prototypical day's doses — one { drug, doseMg }
// entry PER DoseTime, not one entry per item. This is the SPEC RISK #4
// arithmetic trap: computeLedd's own dedup logic (fixed/fraction factors
// count once per day per drug) needs to see every administration to do that
// dedup correctly — collapsing to one entry per item here would double-count
// (or under-count) drugs split across multiple RegimenItems, and would
// defeat computeLedd's per-drug dedup for fixed/fraction factors. A
// freeText-only item (no times) contributes nothing here — it is explicitly
// out of the LEDD total (see regimenWarnings' freeText string).
export function regimenDailyDoses(items: RegimenItem[]): LeddDose[] {
  const doses: LeddDose[] = [];
  for (const item of items) {
    for (const dt of item.times) {
      doses.push({ drug: item.drug, doseMg: dt.doseMg });
    }
  }
  return doses;
}

// By first time ascending, tie-break by catalog generic name. New array —
// callers (e.g. DoctorHome before passing to RegimenList) rely on this not
// mutating the input.
export function sortRegimenItems(items: RegimenItem[]): RegimenItem[] {
  return [...items].sort((a, b) => {
    const aFirst = a.times[0]?.time;
    const bFirst = b.times[0]?.time;
    // A timeless (freeText-only) item has no first time at all — sort it
    // LAST explicitly, rather than via a sentinel string compared through
    // localeCompare. (An earlier version tried a '~' sentinel on the theory
    // that '~' sorts after any HH:MM digit string; that's true in plain
    // ASCII/code-point order, but localeCompare's Unicode collation does NOT
    // guarantee it — Node's default collation actually sorts '~' BEFORE
    // digits, which put freeText items FIRST instead of last. Caught by the
    // dedicated test below; fixed by handling "no time" as its own case
    // instead of encoding it into the string being compared.)
    if (aFirst === undefined && bFirst === undefined) {
      return DRUG_CATALOG[a.drug].generic.localeCompare(DRUG_CATALOG[b.drug].generic);
    }
    if (aFirst === undefined) return 1;
    if (bFirst === undefined) return -1;
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

// Common tablet/patch strengths per drug, in mg — same levodopa-component
// semantics as DoseTime.doseMg for levodopa/madopar-lt. These are German-
// market defaults for the Phase B grid UI (a doctor typing a different
// strength always overrides them); no DDCI entries, matching
// PRESCRIBABLE_DRUG_IDS never listing them as standalone prescriptions.
export const COMMON_STRENGTHS_MG: Partial<Record<DrugId, readonly number[]>> = {
  levodopa: [50, 100, 200],
  'madopar-lt': [50, 100],
  rotigotine: [2, 4, 6, 8],
  entacapone: [200],
  opicapone: [25, 50],
  safinamide: [50, 100],
  baclofen: [10, 25],
};

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
    if ((item.freeText ?? '').trim().length > 0) {
      const generic = DRUG_CATALOG[item.drug].generic;
      warnings.push(
        `${generic} has a free-text schedule; it is not included in the LEDD total or the patient's dose list.`,
      );
    }
  }

  return warnings;
}
