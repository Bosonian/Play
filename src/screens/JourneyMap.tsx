// The journey map — home, and the emotional center (design doc §8.2).
//
// The neuraxis is drawn as a single vertical spine travelled bottom-up: the
// spinal cord sits at the bottom, the cerebrum at the top, so scrolling *up*
// is moving rostrally — the navigation gesture and the anatomy are the same
// motion. Nodes show locked / available / learned / retained state; one
// computed CTA pill answers "what do I do next?".
//
// Increment 1 renders the skeleton from the curriculum (no content authored
// yet), so the map shows the brand-new state: tutorial open, the first cord
// chapter as the frontier, everything above locked-but-visible.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Mastery } from '../db/types';
import { CURRICULUM } from '../content';
import type { Act, Chapter } from '../content/types';
import {
  deriveNodeStates,
  type ChapterNode,
  type NodeState,
} from '../engine/progression';
import { tr } from '../lib/text';
import { NodeSheet, type ModeKey } from '../ui/NodeSheet';
import { ArrowIcon, LockIcon } from '../ui/icons';

// One node circle on the spine. State drives fill/stroke/glyph — and crucially
// never *only* colour: locked has a lock glyph, learned a check, retained a
// halo ring, so the map reads in greyscale too (design doc §8.6).
function MapNode({ state }: { state: NodeState }) {
  const shell =
    'relative flex h-11 w-11 items-center justify-center rounded-full border-2';
  if (state === 'locked') {
    return (
      <span className={`${shell} border-line bg-surface text-fg-faint`}>
        <LockIcon className="h-4 w-4" />
      </span>
    );
  }
  if (state === 'available') {
    return (
      <span className={`${shell} border-accent bg-accent-soft text-accent`}>
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
    );
  }
  // learned / retained
  return (
    <span className={`${shell} border-accent bg-accent text-white`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 12.5l3.5 3.5L18 8"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {state === 'retained' && (
        // The "retention halo" — a ring that will drain as review comes due
        // (§8.2). Full here as a placeholder.
        <span className="absolute -inset-1 rounded-full border-2 border-accent/40" />
      )}
    </span>
  );
}

export function JourneyMap({
  dueCount,
  onGoToday,
  onLaunch,
}: {
  dueCount: number;
  onGoToday: () => void;
  onLaunch: (mode: ModeKey, act: Act, chapter: Chapter) => void;
}) {
  // Mastery drives node state. Empty in Increment 1 → all-locked-but-frontier.
  const mastery = useLiveQuery(() => db.mastery.toArray(), [], [] as Mastery[]);
  const masteryMap = new Map<string, Mastery>(
    (mastery ?? []).map((m) => [m.structureId, m]),
  );
  const nodes = deriveNodeStates(CURRICULUM, masteryMap);
  const nodeByChapter = new Map<string, ChapterNode>(
    nodes.map((n) => [n.chapterId, n]),
  );

  const [selected, setSelected] = useState<{
    act: Act;
    chapter: Chapter;
  } | null>(null);

  // The frontier: first available chapter in a graded (non-tutorial) act.
  const frontier = nodes.find((n) => {
    const act = CURRICULUM.find((a) => a.id === n.actId);
    return n.state === 'available' && !act?.isTutorial;
  });
  const frontierAct = frontier
    ? CURRICULUM.find((a) => a.id === frontier.actId)
    : undefined;

  // The one computed CTA (design doc §8.2), in priority order.
  let cta: { label: string; onClick: () => void } | null = null;
  if (dueCount > 0) {
    cta = { label: `Review — ${dueCount} due`, onClick: onGoToday };
  } else if (frontier && frontierAct) {
    const started = frontier.learned > 0;
    const chapter = frontierAct.chapters.find(
      (c) => c.id === frontier.chapterId,
    )!;
    cta = {
      label: `${started ? 'Continue' : 'Begin'} — ${tr(frontierAct.title)}`,
      onClick: () => setSelected({ act: frontierAct, chapter }),
    };
  }

  // Render top→bottom as rostral→caudal, so the map reads bottom-up.
  const actsTopDown = [...CURRICULUM].sort((a, b) => b.index - a.index);

  return (
    <div className="relative flex h-full flex-col">
      <header className="px-4 pb-2 pt-3">
        <h1 className="text-title font-semibold text-fg">The neuraxis</h1>
        <p className="text-caption text-fg-muted">
          Travel it bottom to top, the way a signal does.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-28">
        {actsTopDown.map((act) => (
          <section key={act.id} className="pt-4">
            <div className="mb-1 flex items-baseline gap-2">
              <h2 className="text-label font-semibold uppercase tracking-wide text-fg-muted">
                {act.isTutorial ? 'Start here' : `Act ${act.index}`}
              </h2>
              <span className="text-label text-fg">{tr(act.title)}</span>
            </div>
            <p className="mb-2 text-caption text-fg-faint">{tr(act.subtitle)}</p>

            {/* Chapters, rendered top→bottom in reverse so the spine reads
                bottom-up within the act too. */}
            <ul className="relative">
              {[...act.chapters].reverse().map((chapter) => {
                const node = nodeByChapter.get(chapter.id);
                const state = node?.state ?? 'locked';
                return (
                  <li key={chapter.id} className="relative flex gap-3">
                    {/* Spine column: connector line behind the node. */}
                    <div className="relative flex w-11 flex-none justify-center">
                      <span className="absolute inset-y-0 w-0.5 bg-line" />
                      <button
                        type="button"
                        onClick={() => setSelected({ act, chapter })}
                        aria-label={`${tr(chapter.title)} — ${state}`}
                        className="relative my-1.5"
                      >
                        <MapNode state={state} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelected({ act, chapter })}
                      className="flex-1 py-1.5 text-left"
                    >
                      <span
                        className={`text-body ${
                          state === 'locked' ? 'text-fg-faint' : 'text-fg'
                        }`}
                      >
                        {tr(chapter.title)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* The docked CTA pill — one action, in the reach zone. */}
      {cta && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4">
          <button
            type="button"
            onClick={cta.onClick}
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-body font-medium text-white shadow-lg"
          >
            {cta.label}
            <ArrowIcon className="h-5 w-5" />
          </button>
        </div>
      )}

      {selected && (
        <NodeSheet
          act={selected.act}
          chapter={selected.chapter}
          state={nodeByChapter.get(selected.chapter.id)?.state ?? 'locked'}
          learned={nodeByChapter.get(selected.chapter.id)?.learned ?? 0}
          retained={nodeByChapter.get(selected.chapter.id)?.retained ?? 0}
          onLaunch={(mode, act, chapter) => {
            setSelected(null);
            onLaunch(mode, act, chapter);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
