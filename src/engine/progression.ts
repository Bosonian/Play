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
// Used by Stats as a depth metric across all authored structures.
export function computeLearned(m: Mastery | undefined): number {
  if (!m) return 0;
  const passed = RUNGS.filter((r: Rung) => (m.rungs[r]?.correct ?? 0) > 0);
  return passed.length / RUNGS.length;
}

// Has this item been answered correctly at least once, in any mode/rung? This
// is the per-item signal the map uses: a chapter progresses as its items are
// engaged. (Rung-depth learning — /5 above — needs questions at every rung,
// which most structures don't have yet, so it can't drive map progress.)
export function hasAnyCorrect(m: Mastery | undefined): boolean {
  if (!m) return false;
  return RUNGS.some((r: Rung) => (m.rungs[r]?.correct ?? 0) > 0);
}

// A region counts as climbed once learned ≥ 0.8 (§5a). The design's full
// "green/retained" state additionally needs retained ≥ 0.7, but retained isn't
// computed per-node yet (see deriveNodeStates) — so gating the frontier on it
// would freeze the whole map. We advance on `learned` here; the retained ring
// is a later increment.
export function isMastered(learned: number, _retained: number): boolean {
  return learned >= 0.8;
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
      // A chapter's progress = the fraction of its content items (structures,
      // tracts, syndromes) the learner has answered correctly at least once.
      // Completing a chapter's questions once fills it and advances the frontier.
      const itemIds = [
        ...(chapter.structureIds ?? []),
        ...(chapter.tractIds ?? []),
        ...(chapter.syndromeIds ?? []),
      ];
      let learned = 0;
      const retained = 0; // per-node retained not computed yet (see isMastered)
      if (itemIds.length > 0) {
        const engaged = itemIds.filter((id) =>
          hasAnyCorrect(masteryByStructure.get(id)),
        ).length;
        learned = engaged / itemIds.length;
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
