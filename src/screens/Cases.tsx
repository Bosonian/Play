// Cases — lesion detective (design doc §8.3.2). A vignette of deficits, then a
// structured three-part localization: Level + Side + Diagnosis. The reveal
// grades each axis independently (partial credit — the resident learns *which*
// part they missed) and explains each deficit mechanistically via the
// syndrome's causedBy links. This is the Storyteller heart of the game.

import { useState } from 'react';
import { byId } from '../content';
import type { NeuraxisLevel, Side } from '../content/types';
import { recordStudy } from '../engine/study';
import { tr } from '../lib/text';

// Readable labels for the level axis (a relevant subset of the neuraxis).
const LEVELS: { id: NeuraxisLevel; label: string }[] = [
  { id: 'cord', label: 'Cord' },
  { id: 'medulla', label: 'Medulla' },
  { id: 'pons', label: 'Pons' },
  { id: 'midbrain', label: 'Midbrain' },
  { id: 'thalamus', label: 'Thalamus' },
  { id: 'cortex', label: 'Cortex' },
];

const SIDES: { id: Side; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'midline', label: 'Midline' },
];

// Differential diagnoses for cord cases — real cord syndromes used as
// distractors (names are facts, not protected content). The correct answer is
// mixed in from the authored syndrome.
const CORD_DIFFERENTIALS = [
  'Central cord syndrome',
  'Anterior spinal artery syndrome',
  'Posterior cord syndrome',
  'Complete cord transection',
  'Cauda equina syndrome',
];

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function AxisResult({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-caption font-medium ${
        ok ? 'text-correct' : 'text-incorrect'
      }`}
    >
      <span aria-hidden>{ok ? '✓' : '✗'}</span>
      {label}
    </span>
  );
}

export function Cases({
  syndromeIds,
  title,
  onExit,
}: {
  syndromeIds: string[];
  title: string;
  onExit: () => void;
}) {
  const syndromes = syndromeIds
    .map((id) => byId.syndrome.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s);

  const [idx, setIdx] = useState(0);
  const [level, setLevel] = useState<NeuraxisLevel | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const [dx, setDx] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const syndrome = syndromes[idx];
  const done = idx >= syndromes.length;

  // Build the diagnosis options once per case.
  const dxOptions = syndrome
    ? shuffle([
        tr(syndrome.name),
        ...shuffle(CORD_DIFFERENTIALS.filter((d) => d !== tr(syndrome.name))).slice(0, 3),
      ])
    : [];

  if (done || !syndrome) {
    return (
      <div className="flex h-full flex-col px-4 pt-3">
        <ModeBar title={title} onExit={onExit} progress={null} />
        <div className="mt-10">
          <p className="text-display font-semibold text-fg">Case closed.</p>
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

  const levelOK = level === syndrome.level;
  const sideOK = side === (syndrome.side ?? 'midline');
  const dxOK = dx === tr(syndrome.name);
  const allOK = levelOK && sideOK && dxOK;
  const canSubmit = level !== null && side !== null && dx !== null;

  async function next() {
    await recordStudy({
      factId: `case:${syndrome.id}`,
      masteryKey: syndrome.id,
      rung: 'localize',
      mode: 'cases',
      correct: allOK,
      axes: { level: levelOK, side: sideOK, structure: dxOK },
    });
    setLevel(null);
    setSide(null);
    setDx(null);
    setRevealed(false);
    setIdx((i) => i + 1);
  }

  return (
    <div className="flex h-full flex-col px-4 pt-3">
      <ModeBar
        title={title}
        onExit={onExit}
        progress={`${idx + 1} / ${syndromes.length}`}
      />

      <div className="mt-3 flex-1 overflow-y-auto pb-4">
        {/* Vignette */}
        <div className="rounded-md border border-line bg-surface p-4">
          <p className="text-body-lg text-fg">{tr(syndrome.vignette)}</p>
        </div>

        {!revealed ? (
          <div className="mt-4 space-y-4">
            <Axis label="Level">
              <div className="flex flex-wrap gap-2">
                {LEVELS.map((l) => (
                  <Chip
                    key={l.id}
                    active={level === l.id}
                    onClick={() => setLevel(l.id)}
                    label={l.label}
                  />
                ))}
              </div>
            </Axis>
            <Axis label="Side">
              <div className="flex gap-2">
                {SIDES.map((s) => (
                  <Chip
                    key={s.id}
                    active={side === s.id}
                    onClick={() => setSide(s.id)}
                    label={s.label}
                  />
                ))}
              </div>
            </Axis>
            <Axis label="Diagnosis">
              <div className="flex flex-col gap-2">
                {dxOptions.map((d) => (
                  <Chip
                    key={d}
                    active={dx === d}
                    onClick={() => setDx(d)}
                    label={d}
                    full
                  />
                ))}
              </div>
            </Axis>
          </div>
        ) : (
          <div className="mt-4">
            {/* Per-axis grading — partial credit made visible. */}
            <div className="flex flex-wrap items-center gap-2">
              <AxisResult label="Level" ok={levelOK} />
              <AxisResult label="Side" ok={sideOK} />
              <AxisResult label="Diagnosis" ok={dxOK} />
            </div>

            <div className="mt-3 rounded-md border border-line bg-surface p-4">
              <p className="text-title font-semibold text-fg">
                {tr(syndrome.name)}
              </p>
              <p className="mt-1 text-body text-fg-muted">
                {tr(syndrome.lesionSite)}
              </p>

              <p className="mt-3 text-caption font-medium uppercase tracking-wide text-fg-faint">
                Why each deficit
              </p>
              <ul className="mt-1 space-y-1.5">
                {syndrome.deficits.map((d, i) => {
                  const cause = d.causedBy
                    ? (byId.tract.get(d.causedBy) ?? byId.structure.get(d.causedBy))
                    : undefined;
                  return (
                    <li key={i} className="text-body text-fg">
                      {tr(d.description)}
                      {cause && (
                        <span className="text-fg-muted">
                          {' '}
                          — {tr(cause.name)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {syndrome.mnemonic && (
                <p className="mt-3 border-t border-line pt-3 text-body text-fg-muted">
                  {tr(syndrome.mnemonic)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-none border-t border-line pt-3 pb-safe-bottom">
        {!revealed ? (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => setRevealed(true)}
            className="w-full rounded-md bg-accent py-3 text-body font-medium text-white disabled:opacity-40"
          >
            Localize
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            className="w-full rounded-md bg-accent py-3 text-body font-medium text-white"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

function Axis({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-caption font-medium uppercase tracking-wide text-fg-faint">
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
  full,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-sm border px-3 py-2 text-label ${full ? 'w-full text-left' : ''} ${
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-surface text-fg'
      }`}
    >
      {label}
    </button>
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
      <button type="button" onClick={onExit} aria-label="Close" className="-ml-1 p-1 text-fg-muted">
        ✕
      </button>
      <span className="text-label font-medium text-fg-muted">{title}</span>
      <span className="w-10 text-right text-caption tabular-nums text-fg-faint">
        {progress ?? ''}
      </span>
    </div>
  );
}
