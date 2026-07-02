// Atlas — spatial identification on a schematic cross-section (design doc
// §8.3.1). Name → locate: the player is asked to find a structure and taps it
// on the diagram. The reveal marks the tapped structure correct/incorrect and,
// when wrong, highlights where the target actually was (never leave them not
// knowing). Each answer records to SRS + mastery (rung: locate).

import { useMemo, useState } from 'react';
import { byId } from '../content';
import { DIAGRAMS } from '../diagrams';
import type { DiagramState } from '../diagrams/types';
import { recordStudy } from '../engine/study';
import { tr } from '../lib/text';
import { Feedback } from '../ui/Feedback';

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function Atlas({
  crossSectionId,
  title,
  onExit,
}: {
  crossSectionId: string;
  title: string;
  onExit: () => void;
}) {
  const section = byId.crossSection.get(crossSectionId);
  const Diagram = section ? DIAGRAMS[section.diagramKey] : undefined;

  // Fixed round order for this session (one round per hotspot).
  const targets = useMemo(
    () => (section ? shuffle(section.hotspots.map((h) => h.structureId)) : []),
    [section],
  );

  const [idx, setIdx] = useState(0);
  const [tapped, setTapped] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);

  if (!section || !Diagram) {
    return (
      <div className="p-4">
        <p className="text-body text-fg">This diagram isn’t available.</p>
        <button type="button" onClick={onExit} className="mt-4 text-accent">
          Back
        </button>
      </div>
    );
  }

  const done = idx >= targets.length;
  const targetId = targets[idx];
  const target = byId.structure.get(targetId);
  const revealed = tapped !== null;
  const wasCorrect = tapped === targetId;

  // Diagram state map for the current moment.
  const states: Record<string, DiagramState> = {};
  if (revealed) {
    states[targetId] = wasCorrect ? 'correct' : 'highlight';
    if (!wasCorrect && tapped) states[tapped] = 'incorrect';
  }

  function pick(structureId: string) {
    if (revealed) return;
    setTapped(structureId);
    if (structureId === targetId) setCorrectCount((c) => c + 1);
  }

  async function next() {
    await recordStudy({
      factId: `atlas:${section!.id}:${targetId}`,
      masteryKey: targetId,
      rung: 'locate',
      mode: 'atlas',
      correct: wasCorrect,
    });
    setTapped(null);
    setIdx((i) => i + 1);
  }

  if (done) {
    return (
      <div className="flex h-full flex-col px-4 pt-3">
        <ModeBar title={title} onExit={onExit} progress={null} />
        <div className="mt-10">
          <p className="text-display font-semibold text-fg">Round complete.</p>
          <p className="mt-2 text-body text-fg-muted">
            {correctCount} of {targets.length} located.
          </p>
          <button
            type="button"
            onClick={onExit}
            className="mt-8 rounded-md bg-accent px-5 py-3 text-body font-medium text-white"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-4 pt-3">
      <ModeBar
        title={title}
        onExit={onExit}
        progress={`${idx + 1} / ${targets.length}`}
      />

      {/* The diagram fills the upper region. */}
      <div className="mx-auto mt-2 w-full max-w-[320px] flex-none">
        <div className="aspect-[200/210]">
          <Diagram
            states={states}
            onPick={revealed ? null : pick}
            title={tr(section.name)}
          />
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto pb-2">
        {!revealed ? (
          <p className="text-body-lg font-medium text-fg">
            Find the {target ? tr(target.name).toLowerCase() : 'structure'}.
          </p>
        ) : (
          <Feedback
            correct={wasCorrect}
            chosenLabel={
              tapped ? tr(byId.structure.get(tapped)!.name) : undefined
            }
            correctLabel={target ? tr(target.name) : ''}
            explanation={
              target?.clinicalNote
                ? tr(target.clinicalNote)
                : target
                  ? tr(target.function)
                  : ''
            }
          />
        )}
      </div>

      {revealed && (
        <div className="flex-none border-t border-line pt-3 pb-safe-bottom">
          <button
            type="button"
            onClick={next}
            className="w-full rounded-md bg-accent py-3 text-body font-medium text-white"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}

function ModeBar({
  title,
  onExit,
  progress,
}: {
  title: string;
  onExit: () => void;
  progress: string | null;
}) {
  return (
    <div className="flex flex-none items-center justify-between">
      <button
        type="button"
        onClick={onExit}
        aria-label="Close"
        className="-ml-1 p-1 text-fg-muted"
      >
        ✕
      </button>
      <span className="text-label font-medium text-fg-muted">{title}</span>
      <span className="w-10 text-right text-caption tabular-nums text-fg-faint">
        {progress ?? ''}
      </span>
    </div>
  );
}
