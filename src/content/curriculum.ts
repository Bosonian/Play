// The curriculum skeleton — Acts 0→6, caudal→rostral (design doc §3).
//
// This is the journey map's structure. In Increment 1 the chapters carry
// titles only (no content ids yet) — the map renders them as nodes so the
// whole shell can be navigated and the progression UI proven before any
// anatomy is authored. Later increments fill each chapter's structureIds /
// tractIds / syndromeIds / crossSectionIds, at which point the modes light up.
//
// Chapter *titles* are not "content that needs expert verification" — they're
// section headings straight from the design doc — so they live here rather
// than in the reviewed content tables.

import type { Act } from './types';

// Small helper so the skeleton reads cleanly. German (`de`) is intentionally
// omitted for now; `en` is all v1 needs.
const t = (en: string) => ({ en });

export const CURRICULUM: Act[] = [
  {
    id: 'act0',
    index: 0,
    isTutorial: true,
    title: t('Orientation'),
    subtitle: t('How to read the map, and how a signal travels'),
    levels: ['periphery'],
    chapters: [
      { id: 'act0-planes', title: t('Planes & directions') },
      { id: 'act0-decussation', title: t('The idea of crossing') },
      { id: 'act0-vocabulary', title: t('Nucleus, tract, nerve') },
    ],
  },
  {
    id: 'act1',
    index: 1,
    title: t('Spinal Cord'),
    subtitle: t('Where the journey begins'),
    levels: ['cord'],
    chapters: [
      { id: 'act1-external', title: t('External anatomy') },
      { id: 'act1-section', title: t('Cross-section & laminae') },
      { id: 'act1-ascending', title: t('Ascending tracts') },
      { id: 'act1-descending', title: t('Descending tracts') },
      { id: 'act1-blood', title: t('Blood supply') },
      { id: 'act1-syndromes', title: t('Cord syndromes') },
    ],
  },
  {
    id: 'act2',
    index: 2,
    title: t('Brainstem'),
    subtitle: t('Three levels, twelve nerves'),
    levels: ['medulla', 'pons', 'midbrain'],
    chapters: [
      { id: 'act2-medulla', title: t('Medulla') },
      { id: 'act2-pons', title: t('Pons') },
      { id: 'act2-midbrain', title: t('Midbrain') },
      { id: 'act2-cn-nuclei', title: t('Cranial nerve nuclei') },
      { id: 'act2-tracts', title: t('Long tracts through the stem') },
      { id: 'act2-syndromes', title: t('Brainstem syndromes') },
    ],
  },
  {
    id: 'act3',
    index: 3,
    title: t('Cerebellum'),
    subtitle: t('Coordination and its loops'),
    levels: ['cerebellum'],
    chapters: [
      { id: 'act3-anatomy', title: t('Lobes & deep nuclei') },
      { id: 'act3-peduncles', title: t('Peduncles') },
      { id: 'act3-zones', title: t('Functional zones') },
      { id: 'act3-syndromes', title: t('Cerebellar syndromes') },
    ],
  },
  {
    id: 'act4',
    index: 4,
    title: t('Diencephalon'),
    subtitle: t('The relay and the switchboard'),
    levels: ['thalamus', 'hypothalamus', 'internal-capsule'],
    chapters: [
      { id: 'act4-thalamus', title: t('Thalamic nuclei') },
      { id: 'act4-hypothalamus', title: t('Hypothalamus') },
      { id: 'act4-epi-subthalamus', title: t('Epi- & subthalamus') },
      { id: 'act4-capsule', title: t('Internal capsule') },
    ],
  },
  {
    id: 'act5',
    index: 5,
    title: t('Cerebrum'),
    subtitle: t('Cortex, connections, and circulation'),
    levels: ['cortex', 'basal-ganglia'],
    chapters: [
      { id: 'act5-cortex', title: t('Lobes & cortical areas') },
      { id: 'act5-white-matter', title: t('White-matter tracts') },
      { id: 'act5-basal-ganglia', title: t('Basal ganglia') },
      { id: 'act5-ventricles', title: t('Ventricles & CSF') },
      { id: 'act5-vascular', title: t('Cerebral circulation') },
      { id: 'act5-syndromes', title: t('Cortical syndromes') },
    ],
  },
  {
    id: 'act6',
    index: 6,
    title: t('Systems & Integration'),
    subtitle: t('The whole pathways, end to end'),
    levels: ['periphery', 'cord', 'medulla', 'pons', 'midbrain', 'cortex'],
    chapters: [
      { id: 'act6-sensory', title: t('Sensory pathways') },
      { id: 'act6-motor', title: t('Motor pathways') },
      { id: 'act6-visual', title: t('Visual pathway') },
      { id: 'act6-audvest', title: t('Auditory & vestibular') },
      { id: 'act6-autonomic', title: t('Autonomic & Horner') },
      { id: 'act6-limbic', title: t('Limbic & memory') },
      { id: 'act6-grand-rounds', title: t('Grand rounds') },
    ],
  },
];
