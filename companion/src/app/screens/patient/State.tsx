import { useState } from 'react';
import type { PrimaryTap, DyskinesiaRefinement } from '../../../domain/motor';

interface StateProps {
  onLog: (primary: PrimaryTap) => void;
  onRefine: (r: DyskinesiaRefinement) => void;
  onDone: () => void;
  onBack: () => void;
}

// Shared slab styling for both phases — one full-width tap target with a
// headline + gloss, sized well above the 20mm/76px floor (RESEARCH §1).
const slabClass =
  'w-full rounded-md border border-line bg-surface px-4 py-6 min-h-[88px] text-left';

export function State({ onLog, onRefine, onDone, onBack }: StateProps) {
  // 'pick' = the three primary taps; 'refine' = the optional troublesome
  // follow-up, shown only after ON with dyskinesia is tapped. The dyskinesia
  // event is already stored by the time 'refine' renders — this phase only
  // ever mutates or skips, it never creates a new event.
  const [phase, setPhase] = useState<'pick' | 'refine'>('pick');

  if (phase === 'refine') {
    return (
      <div className="flex flex-col">
        <button
          type="button"
          onClick={onDone}
          className="self-start py-3 pr-3 text-label text-fg-muted underline underline-offset-2"
        >
          Back
        </button>
        <h1 className="text-title text-fg">Logged.</h1>
        <p className="mt-2 text-title text-fg">Was it troublesome?</p>
        <p className="mt-1 text-body text-fg-muted">Optional. Skip is fine.</p>
        <div className="mt-8 space-y-8">
          <button type="button" onClick={() => onRefine('troublesome')} className={slabClass}>
            <span className="block text-title font-medium text-fg">Yes</span>
          </button>
          <button type="button" onClick={() => onRefine('nontroublesome')} className={slabClass}>
            <span className="block text-title font-medium text-fg">No</span>
          </button>
          <button type="button" onClick={onDone} className={slabClass}>
            <span className="block text-title font-medium text-fg">Skip</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="self-start py-3 pr-3 text-label text-fg-muted underline underline-offset-2"
      >
        Back
      </button>
      <h1 className="text-title text-fg">How I feel now</h1>
      <div className="mt-8 space-y-8">
        <button type="button" onClick={() => onLog('on')} className={slabClass}>
          <span className="block text-title font-medium text-fg">ON</span>
          <span className="block text-body text-fg-muted">Moving well</span>
        </button>
        {/* OFF is the centre slab, most-impaired-hand reach: the OFF state is
            when the tapping hand is at its worst (bradykinetic/rigid/
            tremulous), so it gets the position with margin on both sides
            rather than an edge. */}
        <button type="button" onClick={() => onLog('off')} className={slabClass}>
          <span className="block text-title font-medium text-fg">OFF</span>
          <span className="block text-body text-fg-muted">Slow, stiff, or frozen</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onLog('on-dyskinesia');
            setPhase('refine');
          }}
          className={slabClass}
        >
          <span className="block text-title font-medium text-fg">ON with dyskinesia</span>
          <span className="block text-body text-fg-muted">Moving well, but with extra movements</span>
        </button>
      </div>
    </div>
  );
}
