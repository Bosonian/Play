// Progression: turning mastery data into what the map shows.
//
// The two bars (design doc §5a):
//   learned  = fraction of Bloom rungs passed at least once. High-water mark,
//              does NOT decay.
//   retained = derived from SRS state; decays with neglect. (Computed in the
//              SRS engine once cards exist — Increment 3+. Stubbed to 0 here.)
//
// A node's visual state is derived from those. In Increment 1 there is no
// authored content and no mastery yet, so this produces the "brand new" map:
// the tutorial (Act 0) is open, the first real chapter is the frontier, and
// everything above is locked-but-visible (design doc §8.8 empty state).

import type { Act } from '../content/types';
import type { Mastery, Rung } from '../db/types';
import { RUNGS } from '../db/types';

export type NodeState = 'locked' | 'available' | 'learned' | 'retained';

// learned = rungsPassed / 5, where "passed" = at least one correct at that rung.
export function computeLearned(m: Mastery | undefined): number {
  if (!m) return 0;
  const passed = RUNGS.filter((r: Rung) => (m.rungs[r]?.correct ?? 0) > 0);
  return passed.length / RUNGS.length;
}

// A region is "mastered/green" when learned ≥ 0.8 AND retained ≥ 0.7 (§5a).
export function isMastered(learned: number, retained: number): boolean {
  return learned >= 0.8 && retained >= 0.7;
}

export interface ChapterNode {
  actId: string;
  chapterId: string;
  state: NodeState;
  learned: number;
  retained: number;
}

// Derive the visual state of every chapter node, in map order (caudal→rostral,
// act by act). Soft-gating (§5b) means a 'locked' node is still openable in the
// UI — this only drives appearance and the "what next" frontier.
export function deriveNodeStates(
  curriculum: Act[],
  masteryByStructure: Map<string, Mastery>,
): ChapterNode[] {
  const nodes: ChapterNode[] = [];
  let frontierPlaced = false;

  for (const act of curriculum) {
    for (const chapter of act.chapters) {
      // Aggregate learned/retained over the chapter's structures. With no
      // authored structureIds yet, this is 0 (Increment 1).
      const structureIds = chapter.structureIds ?? [];
      let learned = 0;
      let retained = 0;
      if (structureIds.length > 0) {
        for (const id of structureIds) {
          const m = masteryByStructure.get(id);
          learned += computeLearned(m);
          // retained stays 0 until the SRS engine computes it (Increment 3+).
        }
        learned /= structureIds.length;
        retained /= structureIds.length;
      }

      let state: NodeState;
      if (act.isTutorial) {
        // The tutorial is never gated — always open (design doc §3).
        state = 'available';
      } else if (isMastered(learned, retained)) {
        state = retained >= 0.7 ? 'retained' : 'learned';
      } else if (!frontierPlaced) {
        // First not-yet-mastered graded chapter = the frontier.
        state = 'available';
        frontierPlaced = true;
      } else {
        state = 'locked';
      }

      nodes.push({
        actId: act.id,
        chapterId: chapter.id,
        state,
        learned,
        retained,
      });
    }
  }

  return nodes;
}
