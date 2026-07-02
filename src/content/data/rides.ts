// Ride-the-Tract routes (design doc §8.3.5 — the signature connectivity mode).
// A signal travels a pathway; at each relay/decussation the player chooses the
// next stop. A wrong route shows the resulting deficit rather than just buzzing.
//
// These are gameplay scaffolding over the authored tracts (not part of the
// validated content bundle). Positions are (level, side) on the board. The
// teaching payload is the contrast: fine touch (DCML) crosses in the MEDULLA,
// pain (spinothalamic) crosses IN THE CORD — so both left-body sensations end
// at the right cortex, but cross at different places.

import type { LocalizedString, NeuraxisLevel, Side } from '../types';

export interface RideOption {
  id: string;
  label: LocalizedString;
  correct: boolean;
  toLevel: NeuraxisLevel;
  toSide: Side;
  deficitIfWrong?: LocalizedString; // shown when this wrong route is taken
}

export interface RideStep {
  prompt: LocalizedString;
  crossing?: boolean; // the decussation decision, emphasised on the board
  options: RideOption[];
}

export interface Ride {
  id: string;
  tractId: string;
  title: LocalizedString;
  startLabel: LocalizedString;
  startLevel: NeuraxisLevel;
  startSide: Side;
  steps: RideStep[];
  endLabel: LocalizedString;
}

const L = (en: string): LocalizedString => ({ en });

export const RIDES: Ride[] = [
  // --- DCML: fine touch from the LEFT leg -----------------------------------
  {
    id: 'ride-dcml',
    tractId: 'dcml',
    title: L('Fine touch — left leg'),
    startLabel: L('A vibration on the left foot. The signal enters the cord and ascends the ipsilateral dorsal column.'),
    startLevel: 'cord',
    startSide: 'left',
    steps: [
      {
        prompt: L('The signal is in the left gracile fasciculus. Where does it go next?'),
        options: [
          {
            id: 'to-gracile-nucleus',
            label: L('Gracile nucleus, still on the left (medulla)'),
            correct: true,
            toLevel: 'medulla',
            toSide: 'left',
          },
          {
            id: 'cross-in-cord',
            label: L('Cross to the right here, in the cord'),
            correct: false,
            toLevel: 'cord',
            toSide: 'right',
            deficitIfWrong: L('No — the DCML has not crossed yet. It stays ipsilateral all the way up the cord.'),
          },
        ],
      },
      {
        prompt: L('The signal is at the left gracile nucleus. This is the decussation.'),
        crossing: true,
        options: [
          {
            id: 'decussate',
            label: L('Cross the midline as internal arcuate fibres → medial lemniscus (right)'),
            correct: true,
            toLevel: 'medulla',
            toSide: 'right',
          },
          {
            id: 'stay-left',
            label: L('Stay on the left and keep ascending'),
            correct: false,
            toLevel: 'thalamus',
            toSide: 'left',
            deficitIfWrong: L('The DCML must cross here. Staying left would send left-foot sensation to the left cortex — the wrong hemisphere.'),
          },
        ],
      },
      {
        prompt: L('The signal ascends the right medial lemniscus. Next relay?'),
        options: [
          {
            id: 'to-vpl',
            label: L('VPL nucleus of the thalamus (right)'),
            correct: true,
            toLevel: 'thalamus',
            toSide: 'right',
          },
          {
            id: 'to-cerebellum',
            label: L('Into the cerebellum'),
            correct: false,
            toLevel: 'medulla',
            toSide: 'right',
            deficitIfWrong: L('Cerebellar routes are for unconscious proprioception (spinocerebellar). Conscious touch relays in the thalamus.'),
          },
        ],
      },
      {
        prompt: L('From the right VPL, the final leg:'),
        options: [
          {
            id: 'to-cortex',
            label: L('Primary somatosensory cortex (right)'),
            correct: true,
            toLevel: 'cortex',
            toSide: 'right',
          },
        ],
      },
    ],
    endLabel: L('Left-foot fine touch reaches the RIGHT somatosensory cortex — crossed in the medulla.'),
  },

  // --- Spinothalamic: pain/temperature from the LEFT leg --------------------
  {
    id: 'ride-spinothalamic',
    tractId: 'spinothalamic-lateral',
    title: L('Pain & temperature — left leg'),
    startLabel: L('A pinprick on the left foot. First-order fibres synapse in the dorsal horn.'),
    startLevel: 'cord',
    startSide: 'left',
    steps: [
      {
        prompt: L('The second-order neuron leaves the left dorsal horn. This is the decussation.'),
        crossing: true,
        options: [
          {
            id: 'cross-cord',
            label: L('Cross in the anterior white commissure to the right (within 1–2 segments)'),
            correct: true,
            toLevel: 'cord',
            toSide: 'right',
          },
          {
            id: 'ascend-ipsi',
            label: L('Ascend on the left without crossing'),
            correct: false,
            toLevel: 'medulla',
            toSide: 'left',
            deficitIfWrong: L('That is the DCML pattern. Spinothalamic fibres cross IN THE CORD, near their entry level.'),
          },
        ],
      },
      {
        prompt: L('The signal ascends the right anterolateral cord. Next relay?'),
        options: [
          {
            id: 'to-vpl',
            label: L('VPL nucleus of the thalamus (right)'),
            correct: true,
            toLevel: 'thalamus',
            toSide: 'right',
          },
          {
            id: 'to-cortex-direct',
            label: L('Straight to the cortex, skipping the thalamus'),
            correct: false,
            toLevel: 'cortex',
            toSide: 'right',
            deficitIfWrong: L('Almost all sensory pathways relay in the thalamus before the cortex.'),
          },
        ],
      },
      {
        prompt: L('From the right VPL:'),
        options: [
          {
            id: 'to-cortex',
            label: L('Primary somatosensory cortex (right)'),
            correct: true,
            toLevel: 'cortex',
            toSide: 'right',
          },
        ],
      },
    ],
    endLabel: L('Left-foot pain reaches the RIGHT cortex too — but it crossed in the CORD, not the medulla.'),
  },

  // --- Corticospinal: voluntary movement of the RIGHT hand ------------------
  {
    id: 'ride-corticospinal',
    tractId: 'corticospinal-lateral',
    title: L('Voluntary movement — right hand'),
    startLabel: L('Intent to move the right hand. The command leaves the left motor cortex and descends.'),
    startLevel: 'cortex',
    startSide: 'left',
    steps: [
      {
        prompt: L('The fibres reach the medulla. This is the decussation (the pyramids).'),
        crossing: true,
        options: [
          {
            id: 'decussate',
            label: L('Cross to the right at the pyramidal decussation'),
            correct: true,
            toLevel: 'medulla',
            toSide: 'right',
          },
          {
            id: 'stay',
            label: L('Continue on the left without crossing'),
            correct: false,
            toLevel: 'cord',
            toSide: 'left',
            deficitIfWrong: L('~85–90% cross at the pyramids to form the lateral corticospinal tract. Staying left would move the left hand.'),
          },
        ],
      },
      {
        prompt: L('The signal descends the right lateral corticospinal tract. Final synapse?'),
        options: [
          {
            id: 'to-ventral-horn',
            label: L('Lower motor neuron in the right ventral horn'),
            correct: true,
            toLevel: 'cord',
            toSide: 'right',
          },
          {
            id: 'to-dorsal-horn',
            label: L('Dorsal horn'),
            correct: false,
            toLevel: 'cord',
            toSide: 'right',
            deficitIfWrong: L('The dorsal horn is sensory. Motor commands synapse on the ventral-horn LMN.'),
          },
        ],
      },
    ],
    endLabel: L('The left motor cortex drives the RIGHT hand — crossed at the pyramids.'),
  },
];

export const RIDE_BY_TRACT = new Map(RIDES.map((r) => [r.tractId, r]));
