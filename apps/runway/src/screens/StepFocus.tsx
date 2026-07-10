import type { DepartureStep } from '../db/types';
import { elapsedSecondsSince } from '../lib/currentStepElapsed';
import { focusTone } from '../lib/focusTone';
import type { FocusTone } from '../lib/focusTone';
import { formatCountdown, formatTime } from '../lib/format';

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
   * The bottom line's time and its label — two different callers, two
   * different honest readings of "when this all needs to land":
   *   - prep phase (Runway.tsx's main view): `{ label: 'Leave by',
   *     time: projection.leaveBy }` — live, from computeProjection.
   *   - arrival phase (Runway.tsx's arrival-steps branch, ward-station
   *     increment): `{ label: 'Appointment', time: appointmentAt }` —
   *     "Leave by" would be actively wrong copy once you've already left;
   *     the true target left to name at that point is the appointment
   *     itself, not a door that's already behind you.
   * A single prop pair, not two optional ones, so a caller can't
   * accidentally supply a time with no label or vice versa.
   */
  bottomLine: { label: string; time: Date };
  onBack: () => void;
  /** Whole-screen tap-to-check-and-advance. Only ever provided by the
   * caller when `isCurrentStep` is true - a step that hasn't started yet
   * has no "done" action, so there's nothing to wire up here for it. */
  onTap?: () => void;
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
export function StepFocus({ step, isCurrentStep, anchorIso, now, bottomLine, onBack, onTap }: StepFocusProps) {
  const plannedSeconds = step.plannedMinutes * 60;

  // A step that hasn't started yet has no real "time since it began" - any
  // countdown here would be fiction (the increment spec's own phrase).
  // Non-current steps show their full planned box instead, static, and
  // never go into a warning phase (there's nothing running to warn about).
  const remainingSeconds = isCurrentStep && anchorIso ? plannedSeconds - elapsedSecondsSince(now, anchorIso) : plannedSeconds;
  const tone = focusTone(remainingSeconds, plannedSeconds);
  const phase: FocusTone['phase'] = isCurrentStep ? tone.phase : 'calm';

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
      // below) is the tap target instead, so a clumsy, distracted, or
      // one-handed tap still lands. Only wired when `onTap` is provided
      // (current step only) - see this prop's own doc comment.
      onClick={onTap}
      role={onTap ? 'button' : undefined}
      tabIndex={onTap ? 0 : undefined}
      onKeyDown={
        onTap
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTap();
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
        className="relative z-10 mt-safe-top flex h-12 w-12 shrink-0 items-center justify-center self-start text-2xl text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        ‹
      </button>

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
      </div>

      {/* landscape: same "pin to the true edge of the rotated viewport"
          treatment as the step name above, mirrored to the bottom -
          `bottom-safe-bottom` is the same `safe-bottom` spacing token the
          outer container's own `pb-safe-bottom` already uses. Pinning this
          absolutely (rather than trusting flex-col's normal end-of-column
          placement, which is what portrait relies on) keeps it exactly
          bottom-center regardless of how tall the name/digits stack above
          it ends up being on a 412px-tall landscape viewport. */}
      <div className="relative z-10 pb-8 landscape:absolute landscape:inset-x-0 landscape:bottom-safe-bottom landscape:pb-3">
        <p className="text-center text-sm tabular-nums text-slate-500">
          {bottomLine.label} {formatTime(bottomLine.time)}
        </p>
      </div>
    </div>
  );
}
