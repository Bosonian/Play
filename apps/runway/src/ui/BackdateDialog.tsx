import { useEffect, useRef, useState } from 'react';
import { TextField } from './TextField';
import { TextAction } from './TextAction';
import { clampBackdate, hhmmToDateNear } from '../lib/backdate';
import { formatTime, formatTimeInput } from '../lib/format';
import { pushBackOverride } from '../lib/backOverride';

interface BackdateDialogProps {
  /** What's being asked, exact and specific per call site (CLAUDE.md: exact
   * copy, not approximate) — e.g. "When did this actually finish?" for a
   * step, "When did you actually leave?" for the door. */
  caption: string;
  /** The earliest honest instant this correction can name — the previous
   * event in this departure/task's own chain (currentStepAnchor for a
   * step, the last checked step's timestamp for leaving, leftAt for
   * arriving). Every call site computes this from data already on screen;
   * this component has no notion of "previous event" of its own. */
  lowerBound: Date;
  now: Date;
  onConfirm: (at: Date) => void;
  onCancel: () => void;
}

/**
 * Backdating increment: the shared inline correction panel every "Done
 * earlier" / "Left earlier" / "Arrived earlier" action opens. An inline
 * panel, never a modal — same "never a modal" rule the replan/re-anchor
 * confirmation blocks in Runway.tsx already follow, so a correction reads
 * as one more quiet, in-place offer rather than an interruption.
 *
 * Deliberately dumb: no Dexie access, no knowledge of what it's correcting
 * — it takes a caption and a lower bound, and hands back a validated Date.
 * Every call site owns its own write (a different field, sometimes a
 * different transactional shape), so there's nothing generic left for this
 * component to do beyond "pick a time, tell me honestly whether it's
 * allowed."
 */
export function BackdateDialog({ caption, lowerBound, now, onConfirm, onCancel }: BackdateDialogProps) {
  // Defaults to now, formatted for <input type="time"> — the ordinary case
  // is "just now, but I forgot to tap it a moment ago," so starting the
  // field at the current time means most corrections are a small nudge
  // backward, not typing a time from scratch. useState(() => ...) (lazy
  // initializer), not useState(formatTimeInput(now)) - the same "compute
  // once, on mount, not on every render" reasoning any expensive-ish
  // initial value gets; `now` ticks every second on the caller (useNow),
  // and re-deriving this on each of those ticks would silently reset
  // whatever the user has already typed.
  const [value, setValue] = useState(() => formatTimeInput(now));

  // Back-gesture support: every call site only ever mounts this component
  // while its own "xBackdateOpen" flag is true (Runway.tsx/TaskRun.tsx's
  // own comments on those flags) — mounted IS open here, there's no
  // separate open/closed prop to key off, so a plain mount/unmount effect
  // covers every usage in one place, per CLAUDE.md's "one component, not a
  // duplicated wiring point per call site". `onCancel` is read through a
  // ref rather than depended on directly: the caller hands this component a
  // fresh `onCancel` closure every render (`now` ticks once a second on
  // Runway.tsx/TaskRun.tsx, re-rendering their inline `() => setXOpen(false)`
  // arrows), and depending on it directly would re-run this effect — an
  // unregister immediately followed by a re-register — every single tick.
  // Still correct either way (the override stack dedupes by identity, and
  // nothing observes the brief gap), just pointless churn; the ref avoids
  // it while keeping "always call the LATEST onCancel" true.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    return pushBackOverride(() => onCancelRef.current());
  }, []);

  // hhmmToDateNear rolls backward across midnight for a time-of-day that's
  // still ahead of `now` (see its own doc comment - the mirror of
  // nextOccurrenceOf) - correct here because a correction always looks
  // into the past, never forward.
  const chosen = hhmmToDateNear(value, now);
  const result = Number.isNaN(chosen.getTime()) ? null : clampBackdate(chosen, lowerBound, now);

  const errorLine =
    result === null || result.ok
      ? null
      : result.reason === 'before-previous'
        ? `That's before the previous event (${formatTime(lowerBound)}).`
        : "That's in the future.";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4 motion-safe:animate-fade-in">
      <p className="text-sm text-slate-200">{caption}</p>
      <TextField label="Actual time" type="time" value={value} onChange={(e) => setValue(e.target.value)} />
      {errorLine && <p className="text-sm text-red-300">{errorLine}</p>}
      <div className="flex gap-2">
        <TextAction
          onClick={() => {
            if (result?.ok) onConfirm(result.at);
          }}
          disabled={!result?.ok}
          className="disabled:pointer-events-none disabled:opacity-40"
        >
          Confirm
        </TextAction>
        <TextAction onClick={onCancel}>Cancel</TextAction>
      </div>
    </div>
  );
}
