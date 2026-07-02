// The spinal-cord vertical slice (design doc §11a — the first content, built to
// exercise every part of the model before the wider pour). Deliberately small:
// a handful of structures, the three long tracts that define cord localization,
// one cross-section, and Brown-Séquard as the payoff syndrome.
//
// Everything here is authored at resident level and shipped `verified` where I'm
// confident and `draft` where a detail is worth a second look (surfaced in
// ContentReview). Ids are the join keys: cross-section hotspots and syndrome
// deficits reference these.

import type {
  Structure,
  Tract,
  Syndrome,
  CrossSection,
} from '../types';

// --- External / gross anatomy of the cord (no cross-section; Drill only) ------
export const cordExternalStructures: Structure[] = [
  {
    id: 'cervical-enlargement',
    reviewStatus: 'verified',
    name: { en: 'Cervical enlargement' },
    level: 'cord',
    type: 'region',
    function: {
      en: 'Segments ~C5–T1 where the cord widens to supply the upper limbs (the brachial plexus originates here).',
    },
  },
  {
    id: 'lumbosacral-enlargement',
    reviewStatus: 'verified',
    name: { en: 'Lumbosacral enlargement' },
    level: 'cord',
    type: 'region',
    function: {
      en: 'Segments ~L1–S3 where the cord widens to supply the lower limbs (the lumbosacral plexus).',
    },
  },
  {
    id: 'conus-medullaris',
    reviewStatus: 'verified',
    name: { en: 'Conus medullaris' },
    level: 'cord',
    type: 'region',
    function: {
      en: 'The tapered caudal end of the spinal cord, ending at about the L1–L2 vertebral level in adults.',
    },
    clinicalNote: {
      en: 'Conus lesions give early, symmetric bladder/bowel and saddle sensory loss with relatively mild leg weakness — contrast with cauda equina.',
    },
  },
  {
    id: 'cauda-equina',
    reviewStatus: 'verified',
    name: { en: 'Cauda equina' },
    level: 'cord',
    type: 'nerve',
    function: {
      en: 'The bundle of lumbosacral nerve roots descending below the conus medullaris within the thecal sac.',
    },
    clinicalNote: {
      en: 'Cauda equina lesions give asymmetric LMN leg weakness, radicular pain, and later bladder involvement — a surgical emergency.',
    },
  },
  {
    id: 'filum-terminale',
    reviewStatus: 'verified',
    name: { en: 'Filum terminale' },
    level: 'cord',
    type: 'region',
    function: {
      en: 'A fibrous strand of pia extending from the conus to the coccyx, anchoring the cord within the canal.',
    },
  },
];

// --- Structures visible on the cervical cord cross-section --------------------
export const cordStructures: Structure[] = [
  {
    id: 'gracile-fasciculus',
    reviewStatus: 'verified',
    name: { en: 'Gracile fasciculus' },
    aliases: ['fasciculus gracilis', 'gracile tract'],
    level: 'cord',
    type: 'tract-column',
    function: {
      en: 'Carries fine touch, vibration, and conscious proprioception from the LOWER limb and lower trunk. Uncrossed in the cord.',
    },
    clinicalNote: {
      en: 'Medial of the two dorsal columns. Present at all cord levels (the lower-body column).',
    },
    mnemonic: { en: 'Gracile = ground (legs); it sits medially — legs are “closest to the midline of the body’s map”.' },
  },
  {
    id: 'cuneate-fasciculus',
    reviewStatus: 'verified',
    name: { en: 'Cuneate fasciculus' },
    aliases: ['fasciculus cuneatus', 'cuneate tract'],
    level: 'cord',
    type: 'tract-column',
    function: {
      en: 'Carries fine touch, vibration, and conscious proprioception from the UPPER limb and upper trunk. Uncrossed in the cord.',
    },
    clinicalNote: {
      en: 'Lateral of the two dorsal columns, and only present above ~T6.',
    },
    mnemonic: { en: 'Cuneate = “cune” up high; lateral column, upper limb.' },
  },
  {
    id: 'cst-lateral',
    reviewStatus: 'verified',
    name: { en: 'Lateral corticospinal tract' },
    aliases: ['lateral CST', 'crossed pyramidal tract'],
    level: 'cord',
    type: 'tract-column',
    function: {
      en: 'The main voluntary motor pathway to the limbs. Already crossed (at the medullary pyramids), so in the cord it controls the IPSILATERAL side.',
    },
    clinicalNote: {
      en: 'Sits in the lateral white column, just medial to the dorsal spinocerebellar tract. A cord lesion here gives ipsilateral UMN weakness below the level.',
    },
  },
  {
    id: 'stt-lateral',
    reviewStatus: 'verified',
    name: { en: 'Lateral spinothalamic tract' },
    aliases: ['spinothalamic tract', 'anterolateral system'],
    level: 'cord',
    type: 'tract-column',
    function: {
      en: 'Carries pain and temperature from the CONTRALATERAL side of the body — fibres cross in the cord within 1–2 segments of entry.',
    },
    clinicalNote: {
      en: 'Anterolateral white column. Because it crosses low, a cord lesion causes contralateral pain/temperature loss starting 1–2 levels BELOW the lesion.',
    },
  },
  {
    id: 'dorsal-horn',
    reviewStatus: 'verified',
    name: { en: 'Dorsal (posterior) horn' },
    aliases: ['posterior horn'],
    level: 'cord',
    type: 'gray-region',
    function: {
      en: 'Sensory gray matter: where primary afferents synapse. Pain/temperature second-order neurons arise here and cross to form the spinothalamic tract.',
    },
  },
  {
    id: 'ventral-horn',
    reviewStatus: 'verified',
    name: { en: 'Ventral (anterior) horn' },
    aliases: ['anterior horn'],
    level: 'cord',
    type: 'gray-region',
    function: {
      en: 'Motor gray matter: houses the lower motor neurons (alpha motor neurons) whose axons leave via the ventral root to skeletal muscle.',
    },
    clinicalNote: {
      en: 'Selective loss here (e.g. ALS, polio, spinal muscular atrophy) gives a pure LOWER motor neuron picture.',
    },
  },
  {
    id: 'central-canal',
    reviewStatus: 'verified',
    name: { en: 'Central canal' },
    level: 'cord',
    type: 'ventricle',
    function: {
      en: 'CSF-containing remnant of the neural-tube lumen, at the centre of the gray commissure.',
    },
    clinicalNote: {
      en: 'Expansion here (syringomyelia) first interrupts the crossing spinothalamic fibres in the anterior white commissure — a “cape” of lost pain/temperature.',
    },
  },
];

// --- Long-tract pathway records ----------------------------------------------
export const cordTracts: Tract[] = [
  {
    id: 'dcml',
    reviewStatus: 'verified',
    name: { en: 'Dorsal column–medial lemniscus' },
    aliases: ['DCML', 'posterior column pathway'],
    modality: 'ascending-sensory',
    origin: { en: 'Peripheral mechanoreceptors → dorsal root ganglion; first-order axon ascends the ipsilateral dorsal column.' },
    decussationLevel: {
      en: 'The MEDULLA — second-order neurons in the gracile/cuneate nuclei send internal arcuate fibres across the midline to form the medial lemniscus.',
    },
    destination: { en: 'VPL nucleus of the thalamus → primary somatosensory cortex.' },
    function: { en: 'Fine (discriminative) touch, vibration, conscious proprioception.' },
    lesionEffect: {
      en: 'A cord lesion gives IPSILATERAL loss of fine touch/vibration/proprioception below the level (it hasn’t crossed yet).',
    },
  },
  {
    id: 'spinothalamic-lateral',
    reviewStatus: 'verified',
    name: { en: 'Lateral spinothalamic tract' },
    aliases: ['anterolateral system'],
    modality: 'ascending-sensory',
    origin: { en: 'Second-order neurons in the dorsal horn (substantia gelatinosa).' },
    decussationLevel: {
      en: 'IN THE CORD — fibres cross in the anterior white commissure within 1–2 segments of entry, then ascend contralaterally.',
    },
    destination: { en: 'VPL nucleus of the thalamus → primary somatosensory cortex.' },
    function: { en: 'Pain and temperature.' },
    lesionEffect: {
      en: 'A cord lesion gives CONTRALATERAL loss of pain/temperature beginning 1–2 levels below the lesion.',
    },
  },
  {
    id: 'corticospinal-lateral',
    reviewStatus: 'verified',
    name: { en: 'Lateral corticospinal tract' },
    aliases: ['pyramidal tract'],
    modality: 'descending-motor',
    origin: { en: 'Primary motor cortex (and other frontal areas) → internal capsule → cerebral peduncle → pons → medullary pyramid.' },
    decussationLevel: {
      en: 'The MEDULLA — ~85–90% of fibres cross at the pyramidal decussation to descend as the lateral corticospinal tract.',
    },
    destination: { en: 'Lower motor neurons in the ventral horn.' },
    function: { en: 'Voluntary movement, especially skilled distal limb movement.' },
    lesionEffect: {
      en: 'A cord lesion (below the decussation) gives IPSILATERAL upper-motor-neuron weakness below the level.',
    },
  },
];

// --- Syndrome: Brown-Séquard (the payoff for the slice) ----------------------
export const cordSyndromes: Syndrome[] = [
  {
    id: 'brown-sequard',
    reviewStatus: 'verified',
    name: { en: 'Brown-Séquard syndrome' },
    aliases: ['cord hemisection', 'spinal cord hemisection'],
    level: 'cord',
    side: 'left', // the lesion side used by the example vignette
    lesionSite: { en: 'Hemisection of one half of the spinal cord.' },
    vignette: {
      en: 'After a stab wound to the back, a man has weakness and loss of vibration sense in his LEFT leg, and loss of pain and temperature sensation in his RIGHT leg beginning a couple of segments below the injury.',
    },
    deficits: [
      {
        description: { en: 'Ipsilateral (left) UMN weakness below the lesion.' },
        causedBy: 'corticospinal-lateral',
      },
      {
        description: { en: 'Ipsilateral (left) loss of fine touch, vibration, and proprioception below the lesion.' },
        causedBy: 'dcml',
      },
      {
        description: { en: 'Contralateral (right) loss of pain and temperature beginning 1–2 levels below the lesion.' },
        causedBy: 'spinothalamic-lateral',
      },
    ],
    mnemonic: {
      en: 'The crossed one (pain/temp) is the odd one out: everything is ipsilateral EXCEPT pain and temperature, which is contralateral — because spinothalamic already crossed in the cord.',
    },
  },
];

// --- Cross-section: cervical cord (the Atlas diagram) ------------------------
// readingOrder follows dorsal→ventral, medial→lateral for accessible focus
// order (design doc §8.6).
export const cordCrossSections: CrossSection[] = [
  {
    id: 'cord-cervical',
    reviewStatus: 'verified',
    name: { en: 'Cervical spinal cord' },
    level: 'cord',
    diagramKey: 'cord-cervical',
    hotspots: [
      { structureId: 'gracile-fasciculus', readingOrder: 0 },
      { structureId: 'cuneate-fasciculus', readingOrder: 1 },
      { structureId: 'dorsal-horn', readingOrder: 2 },
      { structureId: 'central-canal', readingOrder: 3 },
      { structureId: 'cst-lateral', readingOrder: 4 },
      { structureId: 'stt-lateral', readingOrder: 5 },
      { structureId: 'ventral-horn', readingOrder: 6 },
    ],
  },
];
