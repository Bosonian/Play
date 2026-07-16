// De-identified domain model for the Parkinson's dosing companion.
//
// PRIVACY BY DESIGN (per the "no names or identification" decision):
//  - A patient is only ever a short CODE the doctor assigns. There is NO field
//    anywhere for name, date of birth, contact, address, or medical-record
//    number. The code↔person link lives OUTSIDE the software, with the doctor.
//  - Everything is local. The patient app stores events on the patient's
//    device; the doctor's device is the system of record for analysis.
//
// SYNC MODEL (store-and-forward, peer-to-peer):
//  - The patient app appends events to a local log AND an outbox queue.
//  - When a peer connection opens, queued events transfer to the doctor's
//    device and merge there. Every event has a globally-unique `id`, so merging
//    is idempotent — re-sending an already-received event is a harmless no-op,
//    which makes partial syncs and retries safe.

export type ISODateTime = string; // e.g. "2026-07-16T08:30:00+05:30"

// ---------------------------------------------------------------------------
// Patient (de-identified)
// ---------------------------------------------------------------------------
export interface Patient {
  code: string; // the doctor-assigned alias, e.g. "P-01". NOT a name.
  // Optional NON-identifying clinical label to help the doctor recognise the
  // record (e.g. "tremor-dominant, dx 2019"). Deliberately free-text and the
  // doctor's responsibility to keep non-identifying.
  label?: string;
  createdAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Drugs — the 9-drug catalog (dopamine precursors, DDCIs, agonist, COMT/MAO-B
// inhibitors, and baclofen) now lives in ./drugs.ts, alongside LEDD and
// PK/PD-engine metadata per drug. Re-exported here so existing call sites
// don't need to know the catalog moved out of this file.
// ---------------------------------------------------------------------------
export type { DrugId } from './drugs';
export { DRUG_CATALOG } from './drugs';
import type { DrugId } from './drugs';

// ---------------------------------------------------------------------------
// Events — the patient's log. A discriminated union on `kind`.
// ---------------------------------------------------------------------------
interface EventBase {
  id: string; // globally unique (uuid) — the idempotent merge key
  patient: string; // patient code
  at: ISODateTime;
  // Who logged this event. Most events are 'self' (the patient, in the
  // moment). 'caregiver' events are entered on the patient's behalf and may
  // carry a retroactive `at` — `at` is already a plain ISO string, so
  // backdating a caregiver entry needs no extra field, just an earlier `at`.
  //
  // JUDGMENT CALL: kept OPTIONAL rather than required. The spec's own
  // acceptance gate says the baseline types.test.ts (explicitly DO-NOT-TOUCH)
  // must keep passing, but its `ev()` test helper builds MotorEvents without
  // a `source` field. Required would fail that file's typecheck. Optional
  // satisfies both: existing/omitted call sites are untyped-safe, and new
  // code can start setting it. Flagged for the orchestrator to reconcile —
  // if `source` should truly be mandatory, types.test.ts needs an update too.
  source?: 'self' | 'caregiver';
}

// A dose taken.
export interface DoseEvent extends EventBase {
  kind: 'dose';
  drug: DrugId;
  // For levodopa products (levodopa, madopar-lt), this is the levodopa
  // component in mg. For every other drug, it's that drug's OWN mg — e.g.
  // rotigotine's `doseMg` is the patch's mg/24h rating, not a levodopa
  // equivalent. LEDD conversion (see ./ledd.ts) is what turns this into a
  // comparable number across drugs.
  doseMg: number;
  // Local "HH:MM" of the regimen slot the patient tapped to log this dose —
  // patient-asserted intent ("this was my 08:00 dose"), recorded at log time.
  // Absent = an unscheduled/extra dose. Same timezone-free clock-time semantics
  // as RegimenItem.times (see regimen.ts). The actual intake moment is always
  // `at`; the at-vs-scheduledTime delta is the adherence signal. Display-side
  // slot matching keys on drug + scheduledTime (see app/patient/doses.ts).
  scheduledTime?: string;
}

// A motor state the patient reports (event-based diary — logged when it
// happens, per the adherence decision). The validated 5-state Hauser model
// (plus the 'on-dyskinesia-unspecified' fallback and canonical 'asleep') now
// lives in ./motor.ts, along with the 3-tap → MotorState mapping.
export type { MotorState } from './motor';
import type { MotorState } from './motor';
export interface MotorEvent extends EventBase {
  kind: 'motor';
  state: MotorState;
  note?: string;
}

// A meal — protein load matters for levodopa absorption, so we capture a
// coarse protein level rather than full diet. 'low' | 'high' are the primary
// values a patient actually taps; 'unknown' is a fallback for when they log a
// meal without specifying (or can't recall).
export interface MealEvent extends EventBase {
  kind: 'meal';
  protein: 'low' | 'high' | 'unknown';
}

export type PatientEvent = DoseEvent | MotorEvent | MealEvent;

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
// A transfer bundle: the encrypted payload is the doctor's concern; this is the
// plaintext shape that gets serialized, encrypted, and sent peer-to-peer.
export interface SyncBundle {
  patient: Patient;
  events: PatientEvent[];
  producedAt: ISODateTime;
}

// Patient-side outbox: which events haven't been confirmed-received yet.
export interface Outbox {
  patient: string;
  pendingEventIds: string[];
}

// Merge incoming events into an existing set, idempotently by id. Returns the
// merged, chronologically-sorted list. Safe to call repeatedly with overlapping
// bundles (store-and-forward retries).
export function mergeEvents(
  existing: PatientEvent[],
  incoming: PatientEvent[],
): PatientEvent[] {
  const byId = new Map<string, PatientEvent>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e); // last-writer-wins per id
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
}

// ---------------------------------------------------------------------------
// Per-patient model parameters (individualized from the diary)
// ---------------------------------------------------------------------------
export interface PatientModel {
  patient: string;
  // Effect-site concentration thresholds (same relative units as the engine).
  onThreshold: number; // at/above this → clinically ON
  dyskThreshold: number; // at/above this → likely peak-dose dyskinesia
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Consent (kept even for de-identified data — good practice)
// ---------------------------------------------------------------------------
export interface Consent {
  patient: string;
  agreedAt: ISODateTime;
  version: string;
}
