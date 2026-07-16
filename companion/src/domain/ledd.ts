// Levodopa-Equivalent Daily Dose (LEDD) — a single number clinicians use to
// compare a patient's total dopaminergic exposure across drug regimens.
//
// This module computes LEDD for a set of doses (typically one calendar day's
// worth — the caller decides what "a day" means, e.g. by pre-filtering
// DoseEvents to a local-day window before calling this).

import type { DrugId } from './drugs';
import { DRUG_CATALOG } from './drugs';
import type { DoseEvent } from './types';

export interface LeddResult {
  totalMg: number;
  levodopaBaseMg: number;
  byDrug: Partial<Record<DrugId, number>>;
}

// Narrowed input type: computeLedd only ever reads `drug` and `doseMg`, so
// any caller that has those two fields (e.g. a regimen expanded into a
// prototypical day's doses, which has no event `id`/`at`) can reuse this
// function without first fabricating a full DoseEvent. Every DoseEvent
// already satisfies this shape, so this is a non-breaking, type-only change.
export type LeddDose = Pick<DoseEvent, 'drug' | 'doseMg'>;

// Compute LEDD from a list of dose events (domain rule, per SPEC RISK #2/#3,
// orchestrator-approved):
//  - `reference` and `per-mg` LED contributions are summed PER DOSE — every
//    dose counts (e.g. 3 levodopa doses in a day each add their own mg).
//  - `fixed` and `fraction` LED contributions are counted ONCE PER DAY per
//    distinct drug present, no matter how many times that drug was dosed
//    that day (e.g. safinamide taken twice still adds 100mg once). This
//    matches how these factors are meant clinically: safinamide's LEDD
//    contribution is a flat daily-dose equivalent, not a per-tablet one, and
//    entacapone/opicapone's contribution is a fraction of the day's total
//    levodopa exposure, not of each individual levodopa tablet.
export function computeLedd(doses: LeddDose[]): LeddResult {
  // Step 1: the day's total reference-levodopa base — the sum of every dose
  // whose LED kind is 'reference' (levodopa + madopar-lt today). This is the
  // denominator `fraction` factors apply to.
  let levodopaBaseMg = 0;
  for (const dose of doses) {
    const spec = DRUG_CATALOG[dose.drug];
    if (spec.ledFactor.kind === 'reference') {
      levodopaBaseMg += dose.doseMg * spec.ledFactor.value;
    }
  }

  // Step 2: per-drug contributions.
  const byDrug: Partial<Record<DrugId, number>> = {};
  const fixedOrFractionCounted = new Set<DrugId>();

  for (const dose of doses) {
    const spec = DRUG_CATALOG[dose.drug];
    const f = spec.ledFactor;
    let contribution = 0;

    switch (f.kind) {
      case 'reference':
      case 'per-mg':
        // Per-dose: every dose adds its own contribution.
        contribution = dose.doseMg * f.value;
        break;
      case 'fixed':
        // Once per day per distinct drug — dedupe by id.
        if (!fixedOrFractionCounted.has(dose.drug)) {
          contribution = f.value;
          fixedOrFractionCounted.add(dose.drug);
        }
        break;
      case 'fraction':
        // Once per day per distinct drug, applied to the day's levodopa
        // base. DOCUMENTED APPROXIMATION (SPEC RISK #3, orchestrator-
        // approved): clinically, a COMT inhibitor like entacapone only
        // potentiates the levodopa dose it's co-administered with, not the
        // whole day's levodopa. We don't yet track per-dose co-administration
        // (which levodopa tablet was taken alongside which entacapone
        // tablet), so this approximates using the WHOLE day's levodopa base.
        // Deferred: per-dose co-admin tracking in a later increment.
        if (!fixedOrFractionCounted.has(dose.drug)) {
          contribution = f.value * levodopaBaseMg;
          fixedOrFractionCounted.add(dose.drug);
        }
        break;
      case 'none':
        contribution = 0;
        break;
    }

    if (contribution !== 0) {
      byDrug[dose.drug] = (byDrug[dose.drug] ?? 0) + contribution;
    } else if (!(dose.drug in byDrug)) {
      // Still record a 0 entry for drugs present that day but contributing
      // nothing (e.g. baclofen), so callers can see "this drug was logged".
      byDrug[dose.drug] = 0;
    }
  }

  const totalMg = Object.values(byDrug).reduce((sum, v) => sum + (v ?? 0), 0);

  // NOTE: this function does NOT enforce or flag the entacapone+opicapone
  // mutual-exclusion rule (co-prescribing two COMT inhibitors is not
  // standard practice). That's a clinical-safety check, not an arithmetic
  // one, and belongs in a later engine/validation increment, not here.
  return { totalMg, levodopaBaseMg, byDrug };
}
