// Patient-reported motor state.
//
// These patient-reported categories are informed by Hauser diary states, but
// this app flow (including an uncertain option) is not itself a validated
// Hauser diary instrument.
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
  | 'uncertain'
  | 'asleep';

export type PrimaryTap = 'on' | 'off' | 'on-dyskinesia' | 'uncertain';

export const PRIMARY_TAP_OPTIONS: ReadonlyArray<{
  value: PrimaryTap;
  label: string;
  description: string;
}> = [
  { value: 'on', label: 'ON', description: 'Moving well' },
  { value: 'off', label: 'OFF', description: 'Slow, stiff, or frozen' },
  { value: 'on-dyskinesia', label: 'ON with dyskinesia', description: 'Moving well, but with extra movements' },
  { value: 'uncertain', label: 'Not sure / changing', description: 'My state is unclear or changing now' },
];

export function motorStateLabel(state: MotorState): string {
  switch (state) {
    case 'on': return 'ON';
    case 'off': return 'OFF';
    case 'on-dyskinesia-unspecified': return 'ON with dyskinesia';
    case 'on-dyskinesia-troublesome': return 'ON with dyskinesia · troublesome';
    case 'on-dyskinesia-nontroublesome': return 'ON with dyskinesia · not troublesome';
    case 'uncertain': return 'Not sure / changing';
    case 'asleep': return 'Asleep';
  }
}

// Optional one-tap refinement offered only after "on-dyskinesia" is tapped.
export type DyskinesiaRefinement = 'troublesome' | 'nontroublesome';

// Map a patient's tap (plus optional refinement) onto the canonical
// MotorState. Kept as a pure function, separate from the UI, so the mapping
// rule is testable without rendering anything.
export function mapPatientTap(primary: PrimaryTap, refine?: DyskinesiaRefinement): MotorState {
  if (primary === 'off') return 'off';
  if (primary === 'on') return 'on';
  if (primary === 'uncertain') return 'uncertain';
  // primary === 'on-dyskinesia'
  if (refine === 'troublesome') return 'on-dyskinesia-troublesome';
  if (refine === 'nontroublesome') return 'on-dyskinesia-nontroublesome';
  return 'on-dyskinesia-unspecified';
}
