import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { TaskUnit } from '../db/types';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Button } from '../ui/Button';
import { TextAction } from '../ui/TextAction';
import { BackdateDialog } from '../ui/BackdateDialog';
import { taskProjection, deriveTaskUnitActuals, taskDeadlineResult } from '../lib/taskProjection';
import type { TaskProjection } from '../lib/taskProjection';
import { currentStepAnchor, currentStepElapsed } from '../lib/currentStepElapsed';
import { useNow } from '../hooks/useNow';
import { StepFocus } from './StepFocus';
import { formatSlackLine, formatTime } from '../lib/format';
import { allowSleep, keepAwake } from '../native/keepAwake';
import { hapticImpact } from '../native/haptics';
import { pushBackOverride } from '../lib/backOverride';
import { FOCUS_SOUND_ON_SETTING, readFocusSoundConfig } from '../lib/focusSoundSettings';
import { startFocusSound, stopFocusSound } from '../audio/focusSound';

/** Distinct from Runway's departure-abandon copy — a task has no alarms to
 * cancel (tasks increment: no scheduled notifications in v1, see README's
 * "Tasks" section), so the honest consequence to state here is simpler. */
const ABANDON_CONFIRM = 'Abandon this task? It moves off Home; its progress stays on record.';

interface TaskRunProps {
  taskId: string;
  onNavigate: (screen: Screen) => void;
}

// Same state -> accent-class shape as Runway.tsx's own STATE_TEXT/
// STATE_BORDER, extended with a `null` entry for a deadline-less task —
// taskProjection.state is null exactly when there's nothing to be
// calm/tight/late ABOUT, which reads as the same plain slate the 'calm'
// case already uses, not a fourth visual state.
const STATE_TEXT: Record<Exclude<TaskProjection['state'], null> | 'none', string> = {
  calm: 'text-slate-100',
  tight: 'text-amber-400',
  late: 'text-red-400',
  none: 'text-slate-100',
};

const STATE_BORDER: Record<Exclude<TaskProjection['state'], null> | 'none', string> = {
  calm: 'border-slate-800',
  tight: 'border-amber-700/60',
  late: 'border-red-700/60',
  none: 'border-slate-800',
};

/**
 * Task mode's live screen — the instrument a task is deliberately started
 * FROM (see README's "Tasks" section: no scheduled notifications, because a
 * task begins at a desk with this screen already open, unlike a departure's
 * "wake me up to start getting ready" moment). Mirrors Runway.tsx's live
 * structure closely — same useNow/keep-awake/transactional-modify/
 * step-focus patterns — with travel, buffer, arrival phase and plan
 * compression all absent, because a task has none of those (db/types.ts's
 * header comment on the Tasks section explains why compression specifically
 * is a considered cut, not a missing feature).
 */
export function TaskRun({ taskId, onNavigate }: TaskRunProps) {
  const task = useLiveQuery(() => db.tasks.get(taskId), [taskId]);
  const now = useNow(1000);

  const [focusUnitId, setFocusUnitId] = useState<string | null>(null);

  // Backdating increment: same "quiet correction dialog" flag as Runway.tsx's
  // stepBackdateOpen — see that state's own comment for why this is plain,
  // unpersisted component state.
  const [unitBackdateOpen, setUnitBackdateOpen] = useState(false);

  // Defensive clear — same reasoning as Runway.tsx's own focusStepId effect:
  // if the task stops being 'running' (finishes, is abandoned) while this
  // screen happens to already be open, or the focused unit disappears from
  // under it, the overlay has nothing honest left to show.
  useEffect(() => {
    if (focusUnitId === null) return;
    if (!task) return;
    if (task.status !== 'running' && task.status !== 'planned') {
      setFocusUnitId(null);
      return;
    }
    if (!task.units.some((u) => u.id === focusUnitId)) setFocusUnitId(null);
  }, [task, focusUnitId]);

  // Back-gesture support: same reasoning as Runway.tsx's own equivalent
  // effect on `focusStepId` — while StepFocus is open, a back gesture
  // closes the overlay instead of navigating the screen underneath it.
  useEffect(() => {
    if (focusUnitId === null) return;
    return pushBackOverride(() => setFocusUnitId(null));
  }, [focusUnitId]);

  // Keep the screen on for exactly as long as work is live — 'running'
  // only, same as Runway.tsx's own keep-awake effect scoped to its
  // equivalent status.
  useEffect(() => {
    if (task?.status !== 'running') return;
    void keepAwake();
    return () => {
      void allowSleep();
    };
  }, [task?.status]);

  // Focus sound (0.33.0): reads the remembered 'focusSoundOn' preference
  // fresh here, same reasoning as Sprint.tsx's own equivalent read -
  // Settings.tsx writes the same row, and this needs the current value
  // each time this screen mounts, not just at first paint.
  const focusSoundConfig = useLiveQuery(() => readFocusSoundConfig(), []);

  // Same live window as keep-awake above ('running' only, never 'planned' -
  // a task Deepak hasn't pressed Start on yet has nothing to hold
  // attention on background noise FOR). "Remembered, not reset" is the
  // point of reading `focusSoundConfig.on` fresh here: turn it on once and
  // every SUBSEQUENT task run starts with the sound already going, nothing
  // to re-arm. The cleanup below is the single reliable net UNDER every
  // other stop path (toggleUnit's and handleUnitBackdateConfirm's own
  // explicit calls when a task finishes, handleAbandon's own explicit
  // call, the toggle row's own explicit call) - whatever else changed or
  // however this screen stopped being mounted in the running state, this
  // always runs and always stops the sound. stopFocusSound is idempotent,
  // so calling it here on top of an explicit call elsewhere costs nothing.
  useEffect(() => {
    if (task?.status !== 'running') return;
    if (!focusSoundConfig) return; // still loading the settings rows
    if (focusSoundConfig.on) startFocusSound(focusSoundConfig.kind, focusSoundConfig.volume0to1);
    return () => {
      stopFocusSound();
    };
  }, [task?.status, focusSoundConfig]);

  const toggleFocusSound = async () => {
    void hapticImpact('light');
    const next = !(focusSoundConfig?.on ?? false);
    await db.settings.put({ key: FOCUS_SOUND_ON_SETTING, value: next ? 'true' : 'false' });
    // Immediate, on top of the effect above (which will also notice the
    // settings row changed once Dexie's live query re-emits) - a tap on
    // this row should be heard right away, not after a query round-trip.
    if (next) {
      startFocusSound(focusSoundConfig?.kind ?? 'brown', focusSoundConfig?.volume0to1 ?? 0.4);
    } else {
      stopFocusSound();
    }
  };

  if (!task) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
        <div className="pt-8">
          <ScreenHeader title="Task" onBack={() => onNavigate({ name: 'home' })} />
        </div>
      </div>
    );
  }

  // Checking a unit also starts the task if it's still 'planned' — same
  // forgivable-shortcut reasoning as Runway.tsx's toggleStep: diving
  // straight into the checklist without pressing "Start" first shouldn't be
  // an error state. Checking the LAST unit resolves the task automatically
  // to 'done' — unlike a departure, a task has no separate "I'm out the
  // door" confirmation step; once every unit is checked, the work is
  // simply finished.
  const toggleUnit = async (unit: TaskUnit) => {
    void hapticImpact('light');
    const nowIso = new Date().toISOString();
    // Focus sound (0.33.0): captured from inside the modify() callback
    // below, since that's the only place that knows whether THIS check-off
    // is the one that resolves the task to 'done'.
    let becameDone = false;
    await db.tasks.where('id').equals(task.id).modify((t) => {
      if (t.status === 'planned') {
        t.status = 'running';
        t.startedAt = t.startedAt ?? nowIso;
      }
      const u = t.units.find((x) => x.id === unit.id);
      if (!u) return;
      const checking = u.checkedAt === null;
      u.checkedAt = checking ? nowIso : null;
      if (checking && t.units.every((x) => x.checkedAt !== null)) {
        t.status = 'done';
        becameDone = true;
      }
    });
    // Explicit and immediate, on top of the mount-effect's own cleanup
    // (which will also notice `task.status` changed once the live query
    // re-emits) - see that effect's own comment for why both exist.
    if (becameDone) stopFocusSound();
  };

  const handleStart = async () => {
    void hapticImpact('light');
    await db.tasks.where('id').equals(task.id).modify((t) => {
      if (t.status === 'planned') {
        t.status = 'running';
        t.startedAt = t.startedAt ?? new Date().toISOString();
      }
    });
  };

  // Backdating increment ("Done earlier"): the task twin of Runway.tsx's
  // handleStepBackdateConfirm — same write toggleUnit does when checking
  // the current unit (including the last-unit auto-resolve to 'done'), but
  // stamping the chosen PAST instant instead of `new Date()`. Same "no
  // planned -> running transition to replicate" reasoning: the "Done
  // earlier" TextAction below only renders once `task.startedAt` already
  // exists, so a task reaching this handler is already 'running'.
  // deriveTaskUnitActuals (taskProjection.ts) reads `checkedAt` straight
  // off the unit, so a backdated last unit's corrected time is exactly
  // what the 'done' summary's total-minutes figure ends up built from —
  // nothing extra to wire for that.
  const handleUnitBackdateConfirm = async (at: Date) => {
    void hapticImpact('light');
    const atIso = at.toISOString();
    // Focus sound (0.33.0): same capture-inside-modify() shape as
    // toggleUnit's own becameDone flag, and the same reasoning.
    let becameDone = false;
    await db.tasks.where('id').equals(task.id).modify((t) => {
      const u = t.units.find((x) => x.checkedAt === null);
      if (!u) return;
      u.checkedAt = atIso;
      if (t.units.every((x) => x.checkedAt !== null)) {
        t.status = 'done';
        becameDone = true;
      }
    });
    if (becameDone) stopFocusSound();
    setUnitBackdateOpen(false);
  };

  const handleAbandon = async () => {
    if (!window.confirm(ABANDON_CONFIRM)) return;
    // Focus sound (0.33.0): explicit and immediate, same reasoning as the
    // finish paths above - don't wait on the mount-effect's cleanup.
    stopFocusSound();
    await db.tasks.update(task.id, { status: 'abandoned' });
    onNavigate({ name: 'home' });
  };

  if (task.status === 'done') {
    // Recomputed every time this is opened, not a one-shot "just now"
    // flourish (unlike Runway.tsx's justLeft) — a task's finished summary
    // is a fixed fact reconstructable from its own checkedAt timestamps at
    // any time, so there's no reason to special-case "the instant it
    // happened" the way a departure's out-the-door slip does.
    const actualTotalMinutes = deriveTaskUnitActuals(task).reduce((sum, a) => sum + a.actualMinutes, 0);
    // Field bug fix: the deadline verdict used to exist nowhere — this is
    // the plain-stated truth CLAUDE.md asks for over a reassuring "nice
    // work" the app can't actually back up. `null` (no deadline was ever
    // set) renders no line at all, same "nothing to be honest ABOUT here"
    // reasoning taskDeadlineResult's own doc comment gives.
    const deadlineResult = taskDeadlineResult(task);
    // Estimation-bias increment (0.30.0): the "see" half of "guess-then-see"
    // — shown only when EVERY unit was Deepak's own felt guess
    // (estimateSource === 'manual'), never for a learned or unknown-
    // provenance unit, because feedback on a number he didn't choose
    // himself trains nothing (estimateBias.ts's own header comment makes
    // the same exclusion for the same reason). Summed per-unit rather than
    // `units.length * minutesPerUnit` — units are field-for-field
    // independent rows (db/types.ts's TaskUnit comment), and nothing
    // guarantees they still share one value by the time this renders.
    // text-slate-400/tabular-nums/no color coding, deliberately — this is a
    // measurement Runway is handing back, not a verdict on how the guess
    // went; CLAUDE.md's no-shame rule is binding here.
    const allUnitsManual = task.units.length > 0 && task.units.every((unit) => unit.estimateSource === 'manual');
    const guessedTotalMinutes = task.units.reduce((sum, unit) => sum + unit.plannedMinutes, 0);
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 px-4 pb-12 pt-safe-top text-center">
        <p className="text-lg text-slate-100">{task.name}</p>
        <p className="mt-2 tabular-nums text-emerald-300">
          {task.units.length} unit{task.units.length === 1 ? '' : 's'} · {actualTotalMinutes} min.
        </p>
        {allUnitsManual && (
          <p className="tabular-nums text-slate-400">
            Guessed {guessedTotalMinutes} min. Took {actualTotalMinutes} min.
          </p>
        )}
        {deadlineResult !== null && (
          <p className={`tabular-nums ${deadlineResult.kind === 'overshot' ? 'text-red-400' : 'text-slate-400'}`}>
            {deadlineResult.kind === 'overshot'
              ? `Finished ${deadlineResult.minutes} min past the deadline.`
              : deadlineResult.minutes === 0
                ? 'Finished on the deadline.'
                : `Finished ${deadlineResult.minutes} min before the deadline.`}
          </p>
        )}
        <Button onClick={() => onNavigate({ name: 'home' })} className="mt-8 w-full">
          Back to home
        </Button>
      </div>
    );
  }

  if (task.status === 'abandoned') {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 px-4 pb-12 pt-safe-top text-center">
        <p className="text-lg text-slate-100">{task.name}</p>
        <p className="text-slate-400">This task is finished.</p>
        <Button onClick={() => onNavigate({ name: 'home' })} className="mt-8 w-full">
          Back to home
        </Button>
      </div>
    );
  }

  // Live view — 'planned' (Start not yet pressed, same live projection and
  // unit list already visible, matching Runway's own "planned already
  // shows the plan" pattern) or 'running'.
  const projection = taskProjection(now, task);
  const elapsed = currentStepElapsed(now, { steps: task.units, startedAt: task.startedAt });
  const stateKey = projection.state ?? 'none';
  const textAccent = STATE_TEXT[stateKey];
  const border = STATE_BORDER[stateKey];

  // Ordinal built from list position, not stored — see db/types.ts's
  // TaskUnit doc comment for why the stored name is always the task's own
  // name, and this concatenation happens only at render time.
  const ordinalUnits = task.units.map((unit, index) => ({ unit, ordinal: index + 1 }));
  const uncheckedUnits = ordinalUnits.filter((u) => u.unit.checkedAt === null);
  const checkedUnits = ordinalUnits.filter((u) => u.unit.checkedAt !== null);
  const currentUnit = uncheckedUnits[0] ?? null;
  const laterUnits = uncheckedUnits.slice(1);

  // Computed unconditionally (not just while focus is open) — backdating
  // increment: the current-unit card's own "Done earlier" dialog (below)
  // needs this exact anchor as its lower bound too, same reuse Runway.tsx's
  // stepAnchorIso relies on for the equivalent departure-step card.
  const unitAnchorIso = currentStepAnchor({ steps: task.units, startedAt: task.startedAt });

  const focusedUnit = focusUnitId ? (ordinalUnits.find((u) => u.unit.id === focusUnitId) ?? null) : null;
  const focusedUnitIsCurrent = !!focusedUnit && !!currentUnit && focusedUnit.unit.id === currentUnit.unit.id;
  const focusAnchorIso = focusedUnitIsCurrent ? unitAnchorIso : null;

  // Tap-anywhere-to-advance — same shape as Runway.tsx's advanceFocusAfterCheck.
  const advanceFocusAfterCheck = async () => {
    if (!currentUnit) return;
    const nextUnitId = laterUnits[0]?.unit.id ?? null;
    await toggleUnit(currentUnit.unit);
    setFocusUnitId(nextUnitId);
  };

  const overrunTone = projection.state === 'late' ? 'text-red-400' : 'text-amber-400';

  // The honest doesn't-fit line (binding design decision: no compression
  // for tasks — see db/types.ts's header comment). Only worth saying once
  // there's a deadline AND it's genuinely short of covering every remaining
  // unit; a task with no deadline, or one whose remaining units all fit,
  // has nothing to be honest ABOUT here.
  const doesntFit =
    task.deadlineAt !== null && projection.unitsThatFit !== null && projection.unitsThatFit < projection.remainingUnits;

  return (
    <>
      <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
        <div className="pt-8">
          <ScreenHeader title={task.name} onBack={() => onNavigate({ name: 'home' })} />
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          <p
            className={`text-huge font-bold tracking-tight tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}
          >
            {formatTime(projection.projectedFinish)}
          </p>
          {task.deadlineAt !== null && (
            <>
              <p className="text-lg tabular-nums text-slate-500">Deadline {formatTime(new Date(task.deadlineAt))}</p>
              <p
                className={`text-base font-medium tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}
              >
                {formatSlackLine(projection.slackMinutes ?? 0, 'past the deadline')}
              </p>
            </>
          )}
        </div>

        {doesntFit && (
          <p className="text-sm text-amber-400">
            {projection.unitsThatFit} of {projection.remainingUnits} remaining units fit before{' '}
            {formatTime(new Date(task.deadlineAt!))}.
          </p>
        )}

        {task.status === 'planned' && (
          <Button onClick={() => void handleStart()} className="w-full">
            Start
          </Button>
        )}

        <div className="flex flex-col gap-6">
          {currentUnit && (
            <div className={`rounded-xl border ${border} bg-surface p-4 motion-safe:transition-colors motion-safe:duration-300`}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggleUnit(currentUnit.unit)}
                    aria-label={`Check off ${task.name} ${currentUnit.ordinal}`}
                    className="size-6 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  />
                </span>
                <button
                  type="button"
                  onClick={() => setFocusUnitId(currentUnit.unit.id)}
                  className="flex min-h-11 flex-1 flex-col gap-1 rounded-lg py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <span className="text-xl font-medium text-slate-100">
                    {task.name} {currentUnit.ordinal}
                  </span>
                  {elapsed ? (
                    <span
                      className={`text-sm tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${
                        elapsed.elapsedMinutes > currentUnit.unit.plannedMinutes ? overrunTone : 'text-slate-500'
                      }`}
                    >
                      {elapsed.elapsedMinutes} min on this unit · planned {currentUnit.unit.plannedMinutes} min
                    </span>
                  ) : (
                    <span className="text-sm tabular-nums text-slate-500">
                      planned {currentUnit.unit.plannedMinutes} min
                    </span>
                  )}
                </button>
              </div>
              {/* Backdating increment: "Done earlier" — current unit only,
                  same "a later unit hasn't started, so it can't have
                  finished earlier" reasoning as Runway.tsx's equivalent
                  step card. Gated on `task.startedAt`: this card also
                  renders before Start is pressed (still 'planned'), and an
                  unstarted task has no lower bound to correct against. */}
              {task.startedAt != null && unitAnchorIso && (
                unitBackdateOpen ? (
                  <div className="mt-3">
                    <BackdateDialog
                      caption="When did this actually finish?"
                      lowerBound={new Date(unitAnchorIso)}
                      now={now}
                      onConfirm={(at) => void handleUnitBackdateConfirm(at)}
                      onCancel={() => setUnitBackdateOpen(false)}
                    />
                  </div>
                ) : (
                  <TextAction className="mt-2" onClick={() => setUnitBackdateOpen(true)}>
                    Done earlier
                  </TextAction>
                )
              )}
            </div>
          )}

          {laterUnits.length > 0 && (
            <div className="flex flex-col gap-2">
              {laterUnits.map(({ unit, ordinal }) => (
                <div
                  key={unit.id}
                  className="flex min-h-12 items-center gap-3 rounded-lg border border-slate-800/60 bg-surface px-4 py-2"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => toggleUnit(unit)}
                      aria-label={`Check off ${task.name} ${ordinal}`}
                      className="size-6 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocusUnitId(unit.id)}
                    className="flex min-h-11 flex-1 items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  >
                    <span className="flex-1 text-slate-300">
                      {task.name} {ordinal}
                    </span>
                    <span className="text-sm tabular-nums text-slate-500">{unit.plannedMinutes} min</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {checkedUnits.length > 0 && (
            <div className="flex flex-col gap-1">
              {checkedUnits.map(({ unit, ordinal }) => (
                <label
                  key={unit.id}
                  className="flex min-h-12 items-center gap-3 rounded-lg px-4 py-1 opacity-50 motion-safe:transition-opacity motion-safe:duration-200"
                >
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => toggleUnit(unit)}
                    className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  />
                  <span className="flex-1 text-slate-500 line-through">
                    {task.name} {ordinal}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {Capacitor.isNativePlatform() && (
          <p className="text-center text-sm text-slate-600">Screen stays on while this is open.</p>
        )}

        <div className="flex items-center justify-center gap-6">
          {/* Focus sound (0.33.0), 'running' only - same scoping as the
              keep-awake effect above, and the same "no enable toggle on
              Settings" reasoning as Sprint.tsx's own row: this is the one
              place the on/off decision actually gets made. */}
          {task.status === 'running' && (
            <TextAction onClick={() => void toggleFocusSound()}>
              Focus sound: {focusSoundConfig?.on ? 'on' : 'off'}
            </TextAction>
          )}
          <TextAction onClick={() => void handleAbandon()}>Abandon this task</TextAction>
        </div>
      </div>
      {focusedUnit && (
        <StepFocus
          step={focusedUnit.unit}
          isCurrentStep={focusedUnitIsCurrent}
          anchorIso={focusAnchorIso}
          now={now}
          bottomLine={task.deadlineAt !== null ? { label: 'Deadline', time: new Date(task.deadlineAt) } : undefined}
          onBack={() => setFocusUnitId(null)}
          onTap={focusedUnitIsCurrent ? () => void advanceFocusAfterCheck() : undefined}
          onBackdate={() => {
            // Backdating increment: same handoff as Runway.tsx's StepFocus
            // usages — close the overlay, open the dialog on the card
            // underneath it.
            setFocusUnitId(null);
            setUnitBackdateOpen(true);
          }}
        />
      )}
    </>
  );
}
