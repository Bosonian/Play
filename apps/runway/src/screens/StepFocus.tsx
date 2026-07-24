import { useEffect, useRef, useState } from 'react';
import type { DepartureStep } from '../db/types';
import { elapsedSecondsSince } from '../lib/currentStepElapsed';
import { isSecondTap } from '../lib/doubleTap';
import { focusTone } from '../lib/focusTone';
import type { FocusTone } from '../lib/focusTone';
import { formatCountdown, formatTime } from '../lib/format';

/** How long the "Double-tap to check off." hint stays on screen after a
 * first tap, in milliseconds. Long enough to read at a glance, short
 * enough that it's gone well before it could be mistaken for a permanent
 * label sitting next to the countdown. */
const HINT_VISIBLE_MS = 1400;

interface StepFocusProps {
  step: DepartureStep;
  /** Whether `step` is the departure's current (first unchecked) step. Only
   * the current step has an honest anchor to count from - see the header
   * comment below. */
  isCurrentStep: boolean;
  /** currentStepAnchor(departure)'s result - the ISO instant the CURRENT
   * step started from. Passed in rather than recomputed here so this stays
   * a dumb presentational component with no Dexie/departure knowledge of
   * its own; meaningless (and unused) when `isCurrentStep` is false. */
  anchorIso: string | null;
  now: Date;
  /**
   * The bottom line's time and its label — different callers, different
   * honest readings of "when this all needs to land":
   *   - prep phase (Runway.tsx's main view): `{ label: 'Leave by',
   *     time: projection.leaveBy }` — live, from computeProjection.
   *   - arrival phase (Runway.tsx's arrival-steps branch, ward-station
   *     increment): `{ label: 'Appointment', time: appointmentAt }` —
   *     "Leave by" would be actively wrong copy once you've already left;
   *     the true target left to name at that point is the appointment
   *     itself, not a door that's already behind you.
   *   - task focus (TaskRun.tsx, tasks increment): `{ label: 'Deadline',
   *     time: deadline }` when the task has one, `undefined` when it
   *     doesn't — a task genuinely has nothing to land against without a
   *     deadline, unlike a departure, which always has an appointment. The
   *     prop stays a single pair (not two independently-optional fields)
   *     for the reason below whenever it IS supplied; it's the whole pair
   *     that's optional, not just the time.
   * A single prop pair (rather than two optional fields) so a caller can't
   * accidentally supply a time with no label or vice versa.
   */
  bottomLine?: { label: string; time: Date };
  onBack: () => void;
  /** Whole-screen tap-to-check-and-advance - called only on a confirmed
   * DOUBLE-tap (field report #14: a single-tap version of this let a
   * pocket brush falsely finish a real departure step). The gating itself
   * lives inside this component (see the container's `onClick` below,
   * `handleTap`); this prop is invoked exactly where the old single-tap
   * version invoked it, so callers (Runway.tsx/TaskRun.tsx) are unchanged
   * - the haptic they fire from inside their own check+advance handler
   * still happens, just one confirmed double-tap later than before. Only
   * ever provided by the caller when `isCurrentStep` is true - a step that
   * hasn't started yet has no "done" action, so there's nothing to wire up
   * here for it. */
  onTap?: () => void;
  /** Backdating increment: "the step already finished, a while ago" — a
   * small, quiet escape hatch beside the back chevron, deliberately NOT
   * part of the whole-screen tap zone `onTap` owns (same "excluded from
   * the tap-to-check zone" treatment the back chevron itself already
   * gets, for the same reason: a stray tap here must never silently
   * check the step off at `now`). Rendered only when `isCurrentStep` is
   * also true - see this prop's own render guard below and `onTap`'s
   * comment above for why a step that hasn't started can't honestly be
   * "done earlier" either. The caller (Runway.tsx/TaskRun.tsx) owns what
   * happens next; this component only ever fires the callback, never
   * opens anything itself - see those callers' own comments on the
   * close-focus-then-open-the-card's-dialog handoff. */
  onBackdate?: () => void;
}

const DIGIT_COLOR: Record<FocusTone['phase'], string> = {
  // #F8FAFC is Tailwind's slate-50 - true white would fight the pure-black
  // background at this size; slate-50 reads as white without vibrating
  // against #000000 the way #FFFFFF can on OLED panels.
  calm: 'text-slate-50',
  closing: 'text-amber-400',
  critical: 'text-red-400',
  overrun: 'text-red-400',
};

/**
 * Full-screen focus countdown for a single departure step (step-focus
 * increment). Rendered as an overlay INSIDE Runway.tsx, not a routed
 * screen — see Runway.tsx's own comment on `focusStepId` for why: this is
 * a lens over the live departure, not a place with its own identity.
 *
 * Background is pure #000000 (true OLED black), deliberately NOT the app's
 * usual `bg-slate-950` (#020617) — the whole point of this view is a
 * countdown that's legible across a room with the lights low, and an OLED
 * panel only truly turns pixels off at pure black. #020617 is dark enough
 * to look black in the rest of the app but still measurably lit here.
 */
export function StepFocus({ step, isCurrentStep, anchorIso, now, bottomLine, onBack, onTap, onBackdate }: StepFocusProps) {
  const plannedSeconds = step.plannedMinutes * 60;

  // A step that hasn't started yet has no real "time since it began" - any
  // countdown here would be fiction (the increment spec's own phrase).
  // Non-current steps show their full planned box instead, static, and
  // never go into a warning phase (there's nothing running to warn about).
  const remainingSeconds = isCurrentStep && anchorIso ? plannedSeconds - elapsedSecondsSince(now, anchorIso) : plannedSeconds;
  const tone = focusTone(remainingSeconds, plannedSeconds);
  const phase: FocusTone['phase'] = isCurrentStep ? tone.phase : 'calm';

  // Double-tap check-off guard (field report #14: a pocket brush falsely
  // finished a real departure step when ANY tap checked it off). This ref
  // - not state - holds the timestamp of the last unconfirmed tap:
  // `isSecondTap` (doubleTap.ts) is the whole debounce, comparing this
  // value against the next tap's own `Date.now()`, so no timer is needed
  // to "arm" or "expire" it. A tap that arrives too late to count just
  // fails the check and becomes the new stored timestamp itself (see
  // `handleTap` below) - that's what makes a tap 10s after the last one
  // read as a fresh first tap with no extra bookkeeping. A ref rather than
  // state because writing it must never trigger a re-render on its own;
  // only the hint (below) needs one.
  const lastTapAtRef = useRef<number | null>(null);

  // The "Double-tap to check off." hint IS state, because it has to
  // re-render the hint text in and out. `hintTimeoutRef` holds the
  // setTimeout id that hides it again ~1.4s after a first tap - this is
  // the one place in this file that genuinely needs a timer, unlike the
  // tap-window debounce above.
  const [hintVisible, setHintVisible] = useState(false);
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Belt-and-braces cleanup: if StepFocus unmounts (back chevron, or the
  // caller clearing focusStepId after a confirmed check-off) while a hint
  // is still showing, don't leave a stray timeout trying to setState on an
  // unmounted component.
  useEffect(() => {
    return () => {
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    };
  }, []);

  const handleTap = () => {
    if (!onTap) return;
    const nowMs = Date.now();

    if (isSecondTap(lastTapAtRef.current, nowMs)) {
      // Confirmed double-tap: run the existing check-and-advance path
      // unchanged, haptic included (it lives inside `onTap` itself - see
      // that prop's own doc comment). Reset the ref so a stray third tap
      // right after can't chain into a false second double-tap.
      lastTapAtRef.current = null;
      setHintVisible(false);
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      onTap();
      return;
    }

    // First tap (or the window since the last one expired): store the
    // timestamp and show the teaching hint. Deliberately NO haptic here -
    // a pocket brush must produce zero feedback, not even a buzz that
    // could tip someone off mid-pocket that something happened. Only a
    // CONFIRMED double-tap above ever fires haptic feedback.
    lastTapAtRef.current = nowMs;
    setHintVisible(true);
    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => setHintVisible(false), HINT_VISIBLE_MS);
  };

  return (
    <div
      // pb-safe-bottom here, pb-8 on the inner wrapper below (not both on
      // one element) - same split as Runway.tsx's own pt-safe-top
      // (container) / pt-8 (inner) pairing, so the two spacing concerns
      // (safe-area inset vs. visual breathing room) stay on separate
      // elements instead of two padding-bottom utilities silently
      // clobbering each other on the same one.
      className="fixed inset-0 z-50 flex flex-col bg-black pb-safe-bottom"
      // The wet-hands case: mid-shower, hands full of toothpaste, whatever
      // - a single small "done" button is a bad target when you're not
      // free to aim carefully. The entire screen (minus the back chevron
      // and "Done earlier", both excluded below) is the tap target instead,
      // so a clumsy, distracted, or one-handed tap still lands - but as of
      // field report #14, landing once only shows a hint, never checks the
      // step off. A CONFIRMED DOUBLE-tap is what actually checks off and
      // advances (`handleTap` above) - still aim-free (any two taps
      // anywhere on the glass within the window count), just no longer
      // single-touch-fireable by an undeliberate brush. Only wired when
      // `onTap` is provided (current step only) - see that prop's own doc
      // comment.
      onClick={onTap ? handleTap : undefined}
      role={onTap ? 'button' : undefined}
      tabIndex={onTap ? 0 : undefined}
      onKeyDown={
        onTap
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTap();
              }
            }
          : undefined
      }
    >
      {/* Overrun fill: a slow rise from the bottom, growing with how deep
          the overrun goes (focusTone's fillFraction). Per-second growth at
          this transition speed reads as a slow, ambient rise rather than a
          snap - CLAUDE.md's "no theatrics" rule is sanctioned to bend here
          on purpose (per the increment spec): this is distance-legibility
          INFORMATION, not decoration - the same reason the digits below are
          the largest text anywhere in this app. */}
      {phase === 'overrun' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-red-950/60 motion-safe:transition-[height] motion-safe:duration-1000 motion-safe:ease-linear"
          style={{ height: `${tone.fillFraction * 100}%` }}
        />
      )}

      {/* Backdating increment: the back chevron and "Done earlier" now
          share one top row rather than the chevron sitting alone - both are
          "excluded from the tap-to-check zone" escape hatches, so they read
          as one family of quiet controls at the top of the screen. Doesn't
          touch the landscape name/digits/bottom-line pinning below, which
          is absolutely positioned independent of this row's height either
          way.

          Both stay SINGLE-tap even after field report #14's double-tap
          change to the whole-glass surface above - the double-tap gate
          exists because the glass is a large, unaimed, aim-free target a
          pocket brush can land on by accident. These two buttons are the
          opposite: small, deliberately AIMED targets (a 44px chevron, a
          short text button) that a stray brush is unlikely to hit at all,
          so the extra confirmation step would only slow down a genuinely
          deliberate tap without buying any real accidental-touch
          protection. */}
      <div className="relative z-10 mt-safe-top flex items-center justify-between">
        <button
          type="button"
          onClick={(e) => {
            // Excluded from the tap-to-check zone: without this, tapping
            // "back" would also bubble to the container's onClick above and
            // silently check the step off on the way out.
            e.stopPropagation();
            onBack();
          }}
          aria-label="Back"
          className="flex h-12 w-12 shrink-0 items-center justify-center self-start text-2xl text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          ‹
        </button>
        {/* Only the CURRENT step gets this - see onBackdate's own doc
            comment above for why a step that hasn't started can't
            honestly have finished "earlier." */}
        {isCurrentStep && onBackdate && (
          <button
            type="button"
            onClick={(e) => {
              // Same exclusion as the back chevron above, same reason.
              e.stopPropagation();
              onBackdate();
            }}
            className="mr-2 min-h-11 shrink-0 rounded-lg px-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Done earlier
          </button>
        )}
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        {/* landscape (landscape focus increment): the step name moves out of
            this flex column entirely and pins to the true top of the
            (rotated) viewport instead - freeing the whole flex-1 middle for
            the digits alone, which is the point of going landscape here at
            all. `top-safe-top`/`inset-x-0` use the same `safe-top` spacing
            token pt-safe-top/mt-safe-top already use elsewhere in this file
            (tailwind.config.ts) - env(safe-area-inset-top) correctly
            reports the ROTATED top inset in landscape, not the physical
            portrait-top, so this stays correct on a cutout/notch device.
            landscape:pt-3 is a fixed nudge below that inset for devices
            (like the S25 Ultra, no notch) where the env() value is 0. */}
        <p className="text-sm uppercase tracking-widest text-slate-500 landscape:absolute landscape:inset-x-0 landscape:top-safe-top landscape:pt-3">
          {step.name || 'Step'}
        </p>
        {/* text-7xl/8xl in portrait (not the app's usual text-huge) - this
            screen is meant to be read from further away than anything else
            in the app, so it earns the largest digits anywhere here. Sized
            to stay inside a phone-width viewport even at "+12:34" (the
            longest possible string: overrun sign + two digit minutes +
            seconds).

            landscape:text-[11rem] - landscape has ~2x the width to work
            with (915px on the S25 Ultra vs. ~412px in portrait), so the
            digits jump to the largest size that still comfortably fits the
            widest possible string, computed rather than guessed:
              - worst case string is "+88:88" (formatCountdown's overrun
                sign + unpadded minutes that happen to land on two digits +
                ":" + two-digit seconds) = 6 characters.
              - tabular-nums digits advance at ~0.6em per character (a
                standard estimate for monospaced/tabular figures in a
                sans-serif face - there's no narrower "1" to throw the
                estimate off since tabular-nums fixes every digit to the
                same width).
              - 6ch * 0.6em/ch = 3.6em of width at font-size F, so the
                string's pixel width is 3.6 * F.
              - target: stay under ~92vw of the 915px landscape viewport,
                i.e. 3.6F <= 0.92 * 915 = 841.8px, so F <= 233.8px = 14.6rem
                at the browser's 16px root.
              - 11rem (176px) is chosen well inside that ceiling (3.6 *
                176px = 633.6px = ~69% of 915px, not 92%) rather than
                maxed-out, because the actual on-screen box also has to
                clear the px-6 side padding (48px) and the absolutely
                positioned name/leave-by lines above/below it - 11rem is
                the largest round Tailwind arbitrary value that leaves
                comfortable headroom for all of that rather than landing
                exactly on the computed ceiling. */}
        <p
          className={`text-7xl font-bold tabular-nums motion-safe:transition-colors motion-safe:duration-1000 sm:text-8xl landscape:text-[11rem] ${DIGIT_COLOR[phase]}`}
        >
          {formatCountdown(remainingSeconds)}
        </p>
        {!isCurrentStep && <p className="text-sm text-slate-500">Starts when the steps before it are done.</p>}
        {/* Double-tap hint (field report #14): shares the same slot/style
            the "Starts when..." line above uses (`text-sm text-slate-500`,
            centered under the digits) rather than inventing a second
            instruction spot - the two are mutually exclusive anyway (this
            one only ever shows for the current step, which is exactly the
            case the line above excludes itself from). Small and
            slate-toned on purpose: it must read as a quiet aside, never as
            something that could be mistaken for the countdown itself. */}
        {isCurrentStep && hintVisible && <p className="text-sm text-slate-500">Double-tap to check off.</p>}
      </div>

      {/* landscape: same "pin to the true edge of the rotated viewport"
          treatment as the step name above, mirrored to the bottom -
          `bottom-safe-bottom` is the same `safe-bottom` spacing token the
          outer container's own `pb-safe-bottom` already uses. Pinning this
          absolutely (rather than trusting flex-col's normal end-of-column
          placement, which is what portrait relies on) keeps it exactly
          bottom-center regardless of how tall the name/digits stack above
          it ends up being on a 412px-tall landscape viewport. */}
      {/* Tasks increment: omitted entirely for a deadline-less task — see
          `bottomLine`'s own doc comment above for why there's honestly
          nothing to show here in that case, rather than a blank or
          placeholder line. */}
      {bottomLine && (
        <div className="relative z-10 pb-8 landscape:absolute landscape:inset-x-0 landscape:bottom-safe-bottom landscape:pb-3">
          <p className="text-center text-sm tabular-nums text-slate-500">
            {bottomLine.label} {formatTime(bottomLine.time)}
          </p>
        </div>
      )}
    </div>
  );
}
