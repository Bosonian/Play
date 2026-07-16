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
// Drugs (v1: levodopa/carbidopa only; model extends to agonists/COMT/MAO-B)
// ---------------------------------------------------------------------------
export type DrugId =
  | 'levodopa-carbidopa-ir' // immediate release
  | 'levodopa-carbidopa-cr'; // controlled/extended release

export const DRUGS: Record<DrugId, { label: string; formulation: 'IR' | 'CR' }> = {
  'levodopa-carbidopa-ir': { label: 'Levodopa/carbidopa (IR)', formulation: 'IR' },
  'levodopa-carbidopa-cr': { label: 'Levodopa/carbidopa (CR/ER)', formulation: 'CR' },
};

// ---------------------------------------------------------------------------
// Events — the patient's log. A discriminated union on `kind`.
// ---------------------------------------------------------------------------
interface EventBase {
  id: string; // globally unique (uuid) — the idempotent merge key
  patient: string; // patient code
  at: ISODateTime;
}

// A dose taken.
export interface DoseEvent extends EventBase {
  kind: 'dose';
  drug: DrugId;
  doseMgLevodopa: number; // levodopa component in mg
}

// A motor state the patient reports (event-based diary — logged when it
// happens, per the adherence decision).
export type MotorState = 'on' | 'off' | 'on-dyskinesia';
export interface MotorEvent extends EventBase {
  kind: 'motor';
  state: MotorState;
  note?: string;
}

// A meal — protein load matters for levodopa absorption, so we capture a coarse
// protein level rather than full diet.
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
