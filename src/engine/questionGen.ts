// Generate Drill questions from the content model (design doc §0, §7). One
// authored fact yields several questions "for free" — this is the "many lenses"
// idea paying off in retention.
//
// Two design commitments live here:
//  - Distractors TEACH: they're drawn from sibling records (another tract's
//    decussation level, another structure's function), i.e. the adjacent
//    confusions a resident actually makes — not random noise (design doc §7).
//  - Every wrong option carries `whyWrong`, and every question an `explanation`,
//    so the feedback moment can explain rather than just buzz.

import { byId } from '../content';
import type { Structure, Tract } from '../content/types';
import type { Rung } from '../db/types';
import { tr } from '../lib/text';

export interface Choice {
  label: string;
  correct: boolean;
  whyWrong?: string;
}

export interface Question {
  id: string; // stable per template+fact
  factId: string; // the SRS-scheduled fact
  masteryKey?: string; // structure/tract id, for mastery attribution
  rung: Rung;
  stem: string;
  choices: Choice[];
  explanation: string;
  crossLink?: string;
}

// Scope: which content this Drill covers.
export interface Scope {
  structureIds?: string[];
  tractIds?: string[];
  syndromeIds?: string[];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Assemble a 4-option MCQ (fewer if the pool is small) from the correct answer
// plus teaching distractors. Each distractor keeps its own whyWrong.
function assemble(
  correctLabel: string,
  distractors: { label: string; whyWrong: string }[],
): Choice[] {
  const picked = shuffle(distractors)
    .filter((d) => d.label !== correctLabel)
    .slice(0, 3);
  const choices: Choice[] = [
    { label: correctLabel, correct: true },
    ...picked.map((d) => ({ label: d.label, correct: false, whyWrong: d.whyWrong })),
  ];
  return shuffle(choices);
}

// Static padding so small pools still reach ~4 plausible options.
const DECUSSATION_PAD = [
  { label: 'It does not cross the midline', whyWrong: 'All three long tracts here do cross — the question is only where.' },
  { label: 'At the optic chiasm', whyWrong: 'The optic chiasm is a visual-pathway crossing, unrelated to these tracts.' },
];
const LESION_PAD = [
  { label: 'Bilateral flaccid weakness confined to the level of the lesion', whyWrong: 'That is a ventral-horn (LMN) pattern, not a long-tract pattern.' },
];

export function generateQuestions(scope: Scope): Question[] {
  const structures = (scope.structureIds ?? [])
    .map((id) => byId.structure.get(id))
    .filter((s): s is Structure => !!s);
  const tracts = (scope.tractIds ?? [])
    .map((id) => byId.tract.get(id))
    .filter((t): t is Tract => !!t);

  const questions: Question[] = [];

  // --- Structure: function ---------------------------------------------------
  for (const s of structures) {
    const distractors = structures
      .filter((o) => o.id !== s.id)
      .map((o) => ({
        label: tr(o.function),
        whyWrong: `That describes the ${tr(o.name).toLowerCase()}.`,
      }));
    questions.push({
      id: `struct:${s.id}:function`,
      factId: `struct:${s.id}:function`,
      masteryKey: s.id,
      rung: 'name',
      stem: `What is the role of the ${tr(s.name).toLowerCase()}?`,
      choices: assemble(tr(s.function), distractors),
      explanation: s.clinicalNote ? tr(s.clinicalNote) : tr(s.function),
    });
  }

  // --- Tract: decussation level ---------------------------------------------
  for (const t of tracts) {
    const distractors = [
      ...tracts
        .filter((o) => o.id !== t.id)
        .map((o) => ({
          label: tr(o.decussationLevel),
          whyWrong: `That is where the ${tr(o.name).toLowerCase()} crosses.`,
        })),
      ...DECUSSATION_PAD,
    ];
    questions.push({
      id: `tract:${t.id}:decussation`,
      factId: `tract:${t.id}:decussation`,
      masteryKey: t.id,
      rung: 'connect',
      stem: `Where does the ${tr(t.name).toLowerCase()} decussate?`,
      choices: assemble(tr(t.decussationLevel), distractors),
      explanation: `${tr(t.name)}: ${tr(t.decussationLevel)}`,
    });
  }

  // --- Tract: lesion effect (localization) ----------------------------------
  for (const t of tracts) {
    const distractors = [
      ...tracts
        .filter((o) => o.id !== t.id)
        .map((o) => ({
          label: tr(o.lesionEffect),
          whyWrong: `That is the effect of losing the ${tr(o.name).toLowerCase()}.`,
        })),
      ...LESION_PAD,
    ];
    // Does this tract feature in an authored syndrome? If so, cross-link it.
    let crossLink: string | undefined;
    for (const syn of byId.syndrome.values()) {
      if (syn.deficits.some((d) => d.causedBy === t.id)) {
        crossLink = tr(syn.name);
        break;
      }
    }
    questions.push({
      id: `tract:${t.id}:lesion`,
      factId: `tract:${t.id}:lesion`,
      masteryKey: t.id,
      rung: 'localize',
      stem: `A spinal-cord lesion of the ${tr(t.name).toLowerCase()} causes what?`,
      choices: assemble(tr(t.lesionEffect), distractors),
      explanation: `${tr(t.lesionEffect)} (Crossing: ${tr(t.decussationLevel)})`,
      crossLink,
    });
  }

  return questions;
}
