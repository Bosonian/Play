// Ride the Tract — route a signal through its relays and decussations
// (design doc §8.3.5). The board shows the neuraxis as rows (levels) and two
// columns (left/right), so a decussation is literally crossing columns. The
// signal token travels on a correct choice (the one signature animation); a
// wrong choice shows the resulting deficit and lets the player try again.

import { useState } from 'react';
import { RIDE_BY_TRACT, type Ride } from '../content/data/rides';
import type { NeuraxisLevel, Side } from '../content/types';
import { recordStudy } from '../engine/study';
import { tr } from '../lib/text';

// Board geometry. Four rows (rostral→caudal) and two columns.
const ROWS: { level: NeuraxisLevel; label: string; y: number }[] = [
  { level: 'cortex', label: 'Cortex', y: 40 },
  { level: 'thalamus', label: 'Thalamus', y: 110 },
  { level: 'medulla', label: 'Medulla', y: 180 },
  { level: 'cord', label: 'Cord', y: 250 },
];
const COL_X: Record<Side, number> = { left: 66, right: 134, midline: 100 };

function pos(level: NeuraxisLevel, side: Side): { x: number; y: number } {
  const row = ROWS.find((r) => r.level === level) ?? ROWS[ROWS.length - 1];
  return { x: COL_X[side], y: row.y };
}

export function RideTheTract({
  tractId,
  onExit,
}: {
  tractId: string;
  onExit: () => void;
}) {
  const ride: Ride | undefined = RIDE_BY_TRACT.get(tractId);

  const [stepIdx, setStepIdx] = useState(0);
  const [current, setCurrent] = useState<{ level: NeuraxisLevel; side: Side }>(
    () => ({ level: ride?.startLevel ?? 'cord', side: ride?.startSide ?? 'left' }),
  );
  const [path, setPath] = useState<{ x: number; y: number }[]>(() => [
    pos(ride?.startLevel ?? 'cord', ride?.startSide ?? 'left'),
  ]);
  const [wrongIds, setWrongIds] = useState<Set<string>>(new Set());
  const [deficit, setDeficit] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [finished, setFinished] = useState(false);

  if (!ride) {
    return (
      <div className="p-4">
        <p className="text-body text-fg">This pathway isn’t available.</p>
        <button type="button" onClick={onExit} className="mt-4 text-accent">
          Back
        </button>
      </div>
    );
  }

  // `ride` is narrowed to defined here, but TS re-widens it inside the nested
  // pick() closure — capture a stable non-optional reference.
  const activeRide = ride;
  const step = activeRide.steps[stepIdx];
  const cur = pos(current.level, current.side); // token screen position

  function pick(optId: string) {
    const opt = step.options.find((o) => o.id === optId)!;
    if (opt.correct) {
      const target = pos(opt.toLevel, opt.toSide);
      setCurrent({ level: opt.toLevel, side: opt.toSide });
      setPath((p) => [...p, target]);
      setWrongIds(new Set());
      setDeficit(null);
      if (stepIdx + 1 >= activeRide.steps.length) {
        setFinished(true);
        void recordStudy({
          factId: `ride:${activeRide.id}`,
          masteryKey: activeRide.tractId,
          rung: 'connect',
          mode: 'rideTheTract',
          correct: mistakes === 0,
        });
      } else {
        setStepIdx((i) => i + 1);
      }
    } else {
      setMistakes((m) => m + 1);
      setWrongIds((s) => new Set(s).add(optId));
      setDeficit(opt.deficitIfWrong ? tr(opt.deficitIfWrong) : 'Not that route.');
    }
  }

  const revealCorrect = wrongIds.size > 0; // after a miss, hint the right one

  return (
    <div className="flex h-full flex-col px-4 pt-3">
      <div className="flex flex-none items-center justify-between">
        <button type="button" onClick={onExit} aria-label="Close" className="-ml-1 p-1 text-fg-muted">
          ✕
        </button>
        <span className="text-label font-medium text-fg-muted">{tr(ride.title)}</span>
        <span className="w-10 text-right text-caption tabular-nums text-fg-faint">
          {finished ? '' : `${stepIdx + 1}/${ride.steps.length}`}
        </span>
      </div>

      {/* The board */}
      <div className="mx-auto mt-2 w-full max-w-[300px] flex-none">
        <svg viewBox="0 0 200 290" role="img" aria-label="Pathway board" className="w-full">
          {/* midline */}
          <line x1="100" y1="20" x2="100" y2="270" stroke="var(--line)" strokeDasharray="3 4" strokeWidth="1" />
          {/* column headers */}
          <text x={COL_X.left} y="14" textAnchor="middle" className="fill-[var(--fg-faint)]" fontSize="9">Left</text>
          <text x={COL_X.right} y="14" textAnchor="middle" className="fill-[var(--fg-faint)]" fontSize="9">Right</text>
          {/* rows */}
          {ROWS.map((r) => (
            <g key={r.level}>
              <line x1="30" y1={r.y} x2="170" y2={r.y} stroke="var(--line)" strokeWidth="0.75" strokeOpacity="0.6" />
              <text x="2" y={r.y + 3} className="fill-[var(--fg-muted)]" fontSize="8">{r.label}</text>
            </g>
          ))}
          {/* traveled path */}
          {path.length > 1 && (
            <polyline
              points={path.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeOpacity="0.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {/* candidate target markers for the current step */}
          {!finished &&
            step.options.map((o, i) => {
              const p = pos(o.toLevel, o.toSide);
              const isWrong = wrongIds.has(o.id);
              const hint = revealCorrect && o.correct;
              return (
                <g key={o.id} opacity={isWrong ? 0.3 : 1}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="9"
                    fill="none"
                    stroke={hint ? 'var(--correct)' : 'var(--dia-highlight)'}
                    strokeWidth="2"
                    strokeDasharray="3 2"
                  />
                  <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize="9" className="fill-[var(--fg)]">
                    {i + 1}
                  </text>
                </g>
              );
            })}
          {/* the signal token — transitions position on a correct move */}
          <g
            style={{
              transform: `translate(${cur.x}px, ${cur.y}px)`,
              transition: 'transform 500ms ease-out',
            }}
          >
            <circle r="6" fill="var(--accent)" />
            <circle r="10" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.4" />
          </g>
        </svg>
      </div>

      <div className="mt-1 flex-1 overflow-y-auto pb-2">
        {finished ? (
          <div className="rounded-md border border-correct/40 bg-correct/10 p-4">
            <p className="text-body-lg font-semibold text-correct">Arrived.</p>
            <p className="mt-1 text-body text-fg">{tr(ride.endLabel)}</p>
            <p className="mt-2 text-caption text-fg-muted">
              {mistakes === 0 ? 'Routed cleanly, no wrong turns.' : `${mistakes} wrong turn${mistakes > 1 ? 's' : ''} along the way.`}
            </p>
          </div>
        ) : (
          <>
            {stepIdx === 0 && (
              <p className="mb-2 text-caption text-fg-muted">{tr(ride.startLabel)}</p>
            )}
            <p className="text-body-lg font-medium text-fg">
              {step.crossing && (
                <span className="mr-1 rounded-sm bg-dia-highlight/15 px-1.5 py-0.5 text-caption font-semibold text-[var(--dia-highlight)]">
                  decussation
                </span>
              )}
              {tr(step.prompt)}
            </p>

            {deficit && (
              <div className="mt-3 rounded-md border border-incorrect/40 bg-incorrect/10 p-3">
                <p className="text-body text-fg">
                  <span className="font-semibold text-incorrect">If it went there: </span>
                  {deficit}
                </p>
              </div>
            )}

            <ul className="mt-3 space-y-2">
              {step.options.map((o, i) => {
                const isWrong = wrongIds.has(o.id);
                const hint = revealCorrect && o.correct;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={isWrong}
                      onClick={() => pick(o.id)}
                      className={`flex w-full items-start gap-2 rounded-md border px-3 py-3 text-left text-body ${
                        hint
                          ? 'border-correct bg-correct/10 text-fg'
                          : isWrong
                            ? 'border-line bg-surface text-fg-faint line-through'
                            : 'border-line bg-surface text-fg'
                      }`}
                    >
                      <span className="mt-0.5 text-caption tabular-nums text-fg-faint">{i + 1}</span>
                      <span className="flex-1">{tr(o.label)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {finished && (
        <div className="flex-none border-t border-line pt-3 pb-safe-bottom">
          <button
            type="button"
            onClick={onExit}
            className="w-full rounded-md bg-accent py-3 text-body font-medium text-white"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
