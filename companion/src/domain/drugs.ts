// PD medication catalog.
//
// This is a DOMAIN file: no Dexie, no browser APIs, no import from
// src/engine/* (see the ADDENDUM note on `populationPk` below for why that
// last rule matters even though it costs us a little duplication).

export type DrugId =
  | 'levodopa'
  | 'benserazide'
  | 'carbidopa'
  | 'rotigotine'
  | 'madopar-lt'
  | 'entacapone'
  | 'safinamide'
  | 'opicapone'
  | 'baclofen';

export type DrugClass =
  | 'dopamine-precursor'
  | 'ddci'
  | 'dopamine-agonist'
  | 'comt-inhibitor'
  | 'mao-b-inhibitor'
  | 'gaba-b-agonist';

export type Formulation =
  | 'oral-ir'
  | 'oral-cr'
  | 'dispersible'
  | 'transdermal-patch'
  | 'oral-capsule';

// How the (future) PK/PD engine treats this drug. Only 'own-curve' and
// 'own-curve-fast-ka' have a simulated concentration curve today (levodopa,
// madopar-lt); the rest are placeholders the engine will grow into later —
// recorded here now so the catalog doesn't need reshaping when it does.
export type EngineHandling =
  | 'own-curve'
  | 'own-curve-fast-ka'
  | 'modifies-levodopa-clearance-per-dose'
  | 'modifies-levodopa-clearance-all-day'
  | 'modifies-levodopa-effect'
  | 'parallel-agonist'
  | 'ddci-baseline'
  | 'log-only';

// How a drug contributes to Levodopa-Equivalent Daily Dose (LEDD):
//  - reference: this drug IS a levodopa reference (its own mg count 1:1).
//  - per-mg: multiply the dose's own mg by a fixed factor (e.g. rotigotine).
//  - fraction: a fraction of the day's total reference-levodopa base, applied
//    ONCE per day regardless of dose count (e.g. entacapone, opicapone).
//  - fixed: a flat mg contribution ONCE per day the drug is taken at all,
//    regardless of dose count (e.g. safinamide).
//  - none: no LEDD contribution (DDCIs counted via the levodopa they enable;
//    baclofen isn't a dopaminergic drug at all).
export type LedFactor =
  | { kind: 'reference'; value: number }
  | { kind: 'per-mg'; value: number }
  | { kind: 'fraction'; value: number }
  | { kind: 'fixed'; value: number }
  | { kind: 'none' };

// How settled the LEDD conversion factor is in the literature.
export type Confidence = 'established' | 'variable' | 'contested';

// Population PK parameters, in the same shape the engine's Bateman/effect-site
// model consumes. Declared as a local, inline shape (not imported from
// src/engine/pkpd.ts) so the domain layer stays engine-free — see the
// ADDENDUM comment on the `levodopa` entry below for the tradeoff this makes.
export interface PopulationPk {
  ka: number; // absorption rate constant (1/h)
  ke: number; // elimination rate constant (1/h)
  ke0: number; // effect-compartment equilibration rate (1/h)
  F: number; // bioavailability
  Vd: number; // apparent volume of distribution (L)
}

export interface DrugSpec {
  id: DrugId;
  generic: string;
  brands: string[];
  drugClass: DrugClass;
  formulation: Formulation;
  engineHandling: EngineHandling;
  ledFactor: LedFactor;
  confidence: Confidence;
  populationPk?: PopulationPk;
}

export const DRUG_CATALOG: Record<DrugId, DrugSpec> = {
  levodopa: {
    id: 'levodopa',
    generic: 'Levodopa',
    brands: ['Madopar', 'Sinemet', 'Nacom', 'Isicom'],
    drugClass: 'dopamine-precursor',
    formulation: 'oral-ir',
    engineHandling: 'own-curve',
    ledFactor: { kind: 'reference', value: 1.0 },
    confidence: 'established',
    // ADDENDUM (orchestrator-approved): these numbers are DELIBERATE
    // DUPLICATES of src/engine/pkpd.ts's DEFAULT_PK. The domain layer must
    // not import from the engine (see file-level comment above), so for this
    // increment the two live as separate inline literals. That's a drift
    // risk — if one changes, the other won't follow automatically — and is
    // meant to be unified in a later engine increment where the engine reads
    // its PK defaults from this catalog instead of hard-coding its own.
    // Tracked here rather than silently accepted.
    populationPk: { ka: 2.0, ke: Math.LN2 / 1.5, ke0: 0.7, F: 0.84, Vd: 70 },
  },
  benserazide: {
    id: 'benserazide',
    generic: 'Benserazide',
    brands: ['Madopar (component)'],
    drugClass: 'ddci',
    formulation: 'oral-ir',
    engineHandling: 'ddci-baseline',
    ledFactor: { kind: 'none' },
    confidence: 'established',
  },
  carbidopa: {
    id: 'carbidopa',
    generic: 'Carbidopa',
    brands: ['Sinemet (component)', 'Nacom (component)'],
    drugClass: 'ddci',
    formulation: 'oral-ir',
    engineHandling: 'ddci-baseline',
    ledFactor: { kind: 'none' },
    confidence: 'established',
  },
  rotigotine: {
    id: 'rotigotine',
    generic: 'Rotigotine',
    brands: ['Neupro'],
    drugClass: 'dopamine-agonist',
    formulation: 'transdermal-patch',
    engineHandling: 'parallel-agonist',
    ledFactor: { kind: 'per-mg', value: 30 },
    confidence: 'variable',
    // No populationPk: a transdermal patch's flat-plateau release curve isn't
    // a Bateman one-compartment absorption — it needs its own model, deferred.
  },
  'madopar-lt': {
    id: 'madopar-lt',
    generic: 'Levodopa/benserazide (dispersible)',
    brands: ['Madopar LT'],
    drugClass: 'dopamine-precursor',
    formulation: 'dispersible',
    engineHandling: 'own-curve-fast-ka',
    ledFactor: { kind: 'reference', value: 1.0 },
    confidence: 'variable',
    // No populationPk this increment: the dispersible form's faster ka isn't
    // separately fitted yet. Acceptable gap for a data-model-only increment —
    // flagged rather than guessed at.
  },
  entacapone: {
    id: 'entacapone',
    generic: 'Entacapone',
    brands: ['Comtan'],
    drugClass: 'comt-inhibitor',
    formulation: 'oral-ir',
    engineHandling: 'modifies-levodopa-clearance-per-dose',
    ledFactor: { kind: 'fraction', value: 0.33 },
    confidence: 'established',
  },
  safinamide: {
    id: 'safinamide',
    generic: 'Safinamide',
    brands: ['Xadago'],
    drugClass: 'mao-b-inhibitor',
    formulation: 'oral-ir',
    engineHandling: 'modifies-levodopa-effect',
    ledFactor: { kind: 'fixed', value: 100 },
    confidence: 'contested',
  },
  opicapone: {
    id: 'opicapone',
    generic: 'Opicapone',
    brands: ['Ongentys'],
    drugClass: 'comt-inhibitor',
    formulation: 'oral-capsule',
    engineHandling: 'modifies-levodopa-clearance-all-day',
    ledFactor: { kind: 'fraction', value: 0.5 },
    confidence: 'established',
  },
  baclofen: {
    id: 'baclofen',
    generic: 'Baclofen',
    brands: ['Lioresal'],
    drugClass: 'gaba-b-agonist',
    formulation: 'oral-ir',
    engineHandling: 'log-only',
    ledFactor: { kind: 'none' },
    confidence: 'established',
  },
};

// NOTE ON SCOPE (SPEC RISK #7, orchestrator-approved): there is no standalone
// controlled-release (CR) drug entry in this catalog. `levodopa` above is the
// immediate-release basis only. A CR formulation (LEDD commonly ×0.75 versus
// IR) is a deferred later addition, not modelled here.
