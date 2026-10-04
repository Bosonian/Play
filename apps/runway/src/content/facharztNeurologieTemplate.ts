/**
 * A DRAFT topic list for the Facharztprüfung Neurologie, offered by
 * TopicEdit as an optional starting point when the topic list is empty
 * (increment: guided layer, §3). The chapter names and hour estimates below
 * are placeholders sketched from the rough shape of a German neurology
 * board exam — they are NOT sourced from Deepak's actual
 * Landesärztekammer curriculum, exam syllabus, or any official document.
 * Every number here is a guess meant to be overwritten, not a claim about
 * how long any topic actually takes. TopicEdit's own UI copy repeats this
 * "draft, not guidance" framing right at the point of insertion so it can
 * never be silently mistaken for a real curriculum once it's in the list.
 *
 * CLAUDE.md ("Things to ask vs. things to assume"): modifying this content
 * beyond minor cleanup should be a question, not a silent edit.
 */
export interface TemplateTopic {
  name: string;
  estimatedHours: number;
}

export const FACHARZT_NEUROLOGIE_TEMPLATE: TemplateTopic[] = [
  { name: 'Vascular neurology', estimatedHours: 40 },
  { name: 'Epilepsy and seizures', estimatedHours: 30 },
  { name: 'Movement disorders', estimatedHours: 30 },
  { name: 'Neuromuscular disease', estimatedHours: 35 },
  { name: 'Neuroimmunology and MS', estimatedHours: 30 },
  { name: 'Dementia and neurodegeneration', estimatedHours: 25 },
  { name: 'Neuroinfectiology', estimatedHours: 20 },
  { name: 'Headache and facial pain', estimatedHours: 15 },
  { name: 'Neurointensive care', estimatedHours: 25 },
  { name: 'Peripheral nerve and electrophysiology', estimatedHours: 25 },
  { name: 'Vertigo and neurootology', estimatedHours: 10 },
  { name: 'Sleep disorders', estimatedHours: 10 },
  { name: 'Neurooncology', estimatedHours: 15 },
];
