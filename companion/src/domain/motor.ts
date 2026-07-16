// Patient-reported motor state.
//
// The 5-state Hauser diary (off / on / on-dyskinesia-{non}troublesome) is the
// validated clinical instrument this app is built around — see the brief.
// `on-dyskinesia-unspecified` is a pragmatic fallback: the patient tapped
// "ON with dyskinesia" but didn't take the extra step to say whether it was
// troublesome. `asleep` is canonical for the doctor view (and a later
// sleep-diary pairing) but is NOT reachable from the 3-tap patient flow below
// — sleep logging is deferred to a later increment, so no code path in this
// file can ever produce it.
export type MotorState =
  | 'off'
  | 'on'
  | 'on-dyskinesia-nontroublesome'
  | 'on-dyskinesia-troublesome'
  | 'on-dyskinesia-unspecified'
  | 'asleep';

// The 3 primary buttons the patient actually taps.
export type PrimaryTap = 'on' | 'off' | 'on-dyskinesia';

// Optional one-tap refinement offered only after "on-dyskinesia" is tapped.
export type DyskinesiaRefinement = 'troublesome' | 'nontroublesome';

// Map a patient's tap (plus optional refinement) onto the canonical
// MotorState. Kept as a pure function, separate from the UI, so the mapping
// rule is testable without rendering anything.
export function mapPatientTap(primary: PrimaryTap, refine?: DyskinesiaRefinement): MotorState {
  if (primary === 'off') return 'off';
  if (primary === 'on') return 'on';
  // primary === 'on-dyskinesia'
  if (refine === 'troublesome') return 'on-dyskinesia-troublesome';
  if (refine === 'nontroublesome') return 'on-dyskinesia-nontroublesome';
  return 'on-dyskinesia-unspecified';
}
