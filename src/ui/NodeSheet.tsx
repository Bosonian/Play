// The NodeSheet — opens when a map node is tapped (design doc §8.2). Shows the
// region, its two mastery bars, and the modes in Bloom-ladder order. A mode is
// enabled only when (a) it's built and (b) this chapter has the content it
// needs; otherwise it's disabled with the reason shown, never a silent grey.

import type { Act, Chapter } from '../content/types';
import type { NodeState } from '../engine/progression';
import { tr } from '../lib/text';
import { ArrowIcon } from './icons';

export type ModeKey = 'atlas' | 'drill' | 'cases' | 'ride' | 'timeAttack';

const MODES: { key: ModeKey; label: string; rung: string }[] = [
  { key: 'atlas', label: 'Atlas', rung: 'locate' },
  { key: 'drill', label: 'Drill', rung: 'recall' },
  { key: 'cases', label: 'Cases', rung: 'localize' },
  { key: 'ride', label: 'Ride the Tract', rung: 'connect' },
  { key: 'timeAttack', label: 'Time Attack', rung: 'master' },
];

// Which modes can this chapter launch right now? Returns null when enabled, or
// the reason string to show when not.
function disabledReason(mode: ModeKey, chapter: Chapter): string | null {
  const hasDrillContent =
    (chapter.structureIds?.length ?? 0) + (chapter.tractIds?.length ?? 0) > 0;
  const hasSection = (chapter.crossSectionIds?.length ?? 0) > 0;
  switch (mode) {
    case 'atlas':
      return hasSection ? null : 'no diagram here';
    case 'drill':
      return hasDrillContent ? null : 'no content here yet';
    // Built later; keep honest about why they can't be tapped.
    case 'cases':
    case 'ride':
    case 'timeAttack':
      return 'not built yet';
  }
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-caption text-fg-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-soft">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-caption tabular-nums text-fg-faint">
        {pct}%
      </span>
    </div>
  );
}

export function NodeSheet({
  act,
  chapter,
  state,
  learned,
  retained,
  onLaunch,
  onClose,
}: {
  act: Act;
  chapter: Chapter;
  state: NodeState;
  learned: number;
  retained: number;
  onLaunch: (mode: ModeKey, act: Act, chapter: Chapter) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-end bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="mx-auto w-full max-w-md rounded-t-lg border border-line bg-surface p-4 pb-safe-bottom"
        role="dialog"
        aria-label={tr(chapter.title)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />

        <p className="text-caption uppercase tracking-wide text-fg-faint">
          {tr(act.title)}
        </p>
        <h2 className="text-title font-semibold text-fg">{tr(chapter.title)}</h2>

        <div className="mt-3 space-y-2">
          <Bar label="Learned" value={learned} />
          <Bar label="Retained" value={retained} />
        </div>

        <p className="mt-4 text-caption font-medium uppercase tracking-wide text-fg-faint">
          Enter a mode
        </p>
        <ul className="mt-1 divide-y divide-line">
          {MODES.map((m) => {
            const reason = disabledReason(m.key, chapter);
            const enabled = reason === null;
            return (
              <li key={m.key}>
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => enabled && onLaunch(m.key, act, chapter)}
                  className="flex w-full items-center justify-between py-3 text-left disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-2">
                    <ArrowIcon
                      className={`h-4 w-4 ${enabled ? 'text-accent' : 'text-fg-faint'}`}
                    />
                    <span className={`text-body ${enabled ? 'text-fg' : 'text-fg-muted'}`}>
                      {m.label}
                    </span>
                  </span>
                  <span className="text-caption text-fg-faint">
                    {reason ?? m.rung}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {state === 'locked' && (
          <p className="mt-3 text-caption text-fg-faint">
            This region is ahead of where you are. You can still open it — it
            will be harder than it needs to be.
          </p>
        )}
      </div>
    </div>
  );
}
