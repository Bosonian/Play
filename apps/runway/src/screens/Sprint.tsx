import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Sprint as SprintRow } from '../db/types';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Button } from '../ui/Button';
import { useNow } from '../hooks/useNow';
import { remainingHours, sprintMinutes } from '../lib/examProjection';
import { formatCountdown } from '../lib/format';
import { allowSleep, keepAwake } from '../native/keepAwake';
import { hapticImpact } from '../native/haptics';
import { cancelSprintEndAlarm } from '../native/notifications';
import { refreshWidgets } from '../native/widgets';

interface SprintProps {
  sprintId: string;
  onNavigate: (screen: Screen) => void;
}

interface PostSprintViewProps {
  sprint: SprintRow;
  topicName: string;
  onNavigate: (screen: Screen) => void;
}

/**
 * The one-time confirmation shown immediately after ending a sprint
 * (RUNWAY_PRUFUNG_PLAN.md §4.4) — its own component (not inline in Sprint,
 * below) purely so its two useLiveQuery reads only run while this view is
 * actually showing, mirroring the reasoning that keeps Runway's justLeft
 * math (leaveBy) computed inline rather than hoisted to the top of that
 * component. `remainingHours` needs FRESH topic/sprint data (the sprint
 * that was just ended has to be counted), so this re-queries by examId
 * rather than trusting anything computed before the end.
 */
function PostSprintView({ sprint, topicName, onNavigate }: PostSprintViewProps) {
  const topics = useLiveQuery(() => db.topics.where('examId').equals(sprint.examId).toArray(), [sprint.examId]);
  const sprints = useLiveQuery(() => db.sprints.where('examId').equals(sprint.examId).toArray(), [sprint.examId]);

  const remaining = topics && sprints ? remainingHours(topics, sprints) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 px-4 pb-12 pt-safe-top text-center">
      {/* Moments (UI-polish increment): the acknowledgment-tone line for
          finishing a sprint at all — unconditional, not tied to whether it
          ran over or under the box, since the moment being marked is "the
          work happened," not "you hit the target." */}
      <p className="text-2xl font-semibold tracking-tight tabular-nums text-emerald-300">
        {sprintMinutes(sprint)} min on {topicName}.
      </p>
      {/* Omitted (not "0.0 h", not a placeholder) until the fresh query
          resolves - a wrong number would read worse than a beat of nothing
          here (plan §4.4: no celebration, no guilt, and definitely no
          guessing). */}
      {remaining !== null && (
        <p className="tabular-nums text-slate-400">{remaining.toFixed(1)} h remaining across all topics.</p>
      )}
      <Button onClick={() => onNavigate({ name: 'exam' })} className="mt-8 w-full">
        Back to overview
      </Button>
    </div>
  );
}

/** Elapsed-past-planned threshold (F2) beyond which "End sprint" stops
 * ending immediately and instead asks which duration to log. Below this,
 * the honest-overrun behaviour is unchanged (plan §4.3): a sprint that ran
 * a bit long just logs its real length, no dialog. Above it, the overrun is
 * large enough that it's more likely Deepak forgot the sprint was running
 * (walked away, got pulled into something else) than that he deliberately
 * worked 60+ minutes past the box he set — silently logging 9 real hours
 * against a 50-minute sprint would corrupt the pace math this whole mode
 * is built on, so this asks instead of guessing either way. */
const OVERRUN_CONFIRM_THRESHOLD_MINUTES = 60;

interface PendingEndChoice {
  elapsedMinutes: number;
  plannedMinutes: number;
}

/**
 * Sprint mode's live screen (RUNWAY_PRUFUNG_PLAN.md §4.3) — mirrors
 * Runway.tsx's structure (useNow, keep-awake tied to liveness, transactional
 * `.modify()` writes, a `justEnded` local flag distinguishing "I just ended
 * this" from "I reopened an already-finished one") but the mechanic itself
 * is simpler: a sprint has no steps, no calm/tight/late projection of its
 * own — one job, the box of time.
 */
export function Sprint({ sprintId, onNavigate }: SprintProps) {
  const sprint = useLiveQuery(() => db.sprints.get(sprintId), [sprintId]);
  const topic = useLiveQuery(() => (sprint ? db.topics.get(sprint.topicId) : undefined), [sprint?.topicId]);
  const now = useNow(1000);

  // Same reasoning as Runway's justLeft: flipping endedAt happens
  // immediately in Dexie regardless, but the richer one-time post-sprint
  // copy (PostSprintView) is only right in the instant the sprint actually
  // ends. Reopening an already-ended sprint later shows the plain terminal
  // note instead - local state (not the persisted endedAt) is what
  // distinguishes those two moments.
  const [justEnded, setJustEnded] = useState(false);

  // F13: the exact endedAt this screen just wrote, captured locally at the
  // moment of writing rather than read back from `sprint` (the useLiveQuery
  // above). Dexie's liveQuery re-emission after a write is asynchronous, so
  // there's a window where `justEnded` is already true but `sprint` hasn't
  // re-fetched yet — PostSprintView would then compute sprintMinutes()
  // against a still-`endedAt: null` sprint and flash "0 min" for a frame.
  // Passing this captured value through sidesteps that race entirely rather
  // than trying to win it.
  const [finishedEndedAt, setFinishedEndedAt] = useState<string | null>(null);

  // F2: set when the sprint ran far enough past its planned box that
  // ending should ask which duration to log, rather than silently logging
  // whatever elapsed. Cleared once resolved either way.
  const [pendingEndChoice, setPendingEndChoice] = useState<PendingEndChoice | null>(null);

  // Keep the screen on for exactly as long as this sprint is live
  // (endedAt === null) - same cleanup-on-status-change shape as Runway's
  // keep-awake effect, so the lock releases whether the sprint ends or the
  // screen itself unmounts.
  useEffect(() => {
    if (!sprint || sprint.endedAt !== null) return;
    void keepAwake();
    return () => {
      void allowSleep();
    };
  }, [sprint?.endedAt]);

  if (!sprint) {
    // Still loading from Dexie (or a stale id) - nothing to show yet.
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
        <div className="pt-8">
          <ScreenHeader title="Sprint" onBack={() => onNavigate({ name: 'exam' })} />
        </div>
      </div>
    );
  }

  // Ending EARLY is honest logging, not a failure state (plan §4.3): a
  // 31-minute sprint is 31 minutes. No confirm dialog, no warning tone -
  // contrast with Runway's "Abandon this departure", which does confirm,
  // because abandoning a departure discards a plan whereas ending a sprint
  // simply records what actually happened.
  //
  // Writes `endedAtIso` exactly as given - the caller (handleEnd directly
  // below, or one of the two pendingEndChoice buttons) has already decided
  // what that timestamp should be, including F2's "log planned instead of
  // actual" choice.
  const finishSprint = async (endedAtIso: string) => {
    void hapticImpact('medium');
    await db.sprints.where('id').equals(sprint.id).modify((s) => {
      if (s.endedAt === null) s.endedAt = endedAtIso;
    });
    // Terminal - the planned-end alarm would otherwise still fire later
    // for a sprint that's already been logged as finished.
    await cancelSprintEndAlarm(sprint.id);
    // Widgets increment: logged hours just changed - the widget's ready
    // date, week line, and colour band all depend on them.
    await refreshWidgets();
    setFinishedEndedAt(endedAtIso); // F13 - see its declaration above
    setJustEnded(true);
  };

  const handleEnd = async () => {
    const elapsedMinutes = Math.floor((Date.now() - new Date(sprint.startedAt).getTime()) / 60_000);
    if (elapsedMinutes > sprint.plannedMinutes + OVERRUN_CONFIRM_THRESHOLD_MINUTES) {
      // F2: a large forgotten-sprint overrun asks which duration to log
      // instead of silently writing 9 real hours against a 50-minute box.
      // No write happens yet - resolved by one of the two choice buttons
      // below.
      setPendingEndChoice({ elapsedMinutes, plannedMinutes: sprint.plannedMinutes });
      return;
    }
    await finishSprint(new Date().toISOString());
  };

  if (justEnded) {
    // F13: prefer the locally-captured endedAt over `sprint.endedAt` so
    // this renders correctly even before the liveQuery above has re-fetched
    // the write finishSprint just made - see finishedEndedAt's declaration.
    const displaySprint = finishedEndedAt !== null ? { ...sprint, endedAt: finishedEndedAt } : sprint;
    return <PostSprintView sprint={displaySprint} topicName={topic?.name ?? ''} onNavigate={onNavigate} />;
  }

  if (pendingEndChoice) {
    const { elapsedMinutes, plannedMinutes } = pendingEndChoice;
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
        <div className="pt-8">
          <ScreenHeader title="Sprint" onBack={() => onNavigate({ name: 'exam' })} />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p className="text-lg text-slate-100">
            This sprint ran {elapsedMinutes} min against {plannedMinutes} planned. Log which?
          </p>
          <div className="flex w-full flex-col gap-3">
            <Button
              onClick={() => {
                setPendingEndChoice(null);
                void finishSprint(new Date().toISOString());
              }}
              className="w-full"
            >
              Log {elapsedMinutes} min
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPendingEndChoice(null);
                const plannedEndIso = new Date(
                  new Date(sprint.startedAt).getTime() + plannedMinutes * 60_000,
                ).toISOString();
                void finishSprint(plannedEndIso);
              }}
              className="w-full"
            >
              Log {plannedMinutes} min
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (sprint.endedAt !== null) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 px-4 pb-12 pt-safe-top text-center">
        <p className="text-lg text-slate-100">{topic?.name ?? 'Sprint'}</p>
        <p className="text-slate-400">This sprint is finished.</p>
        <Button onClick={() => onNavigate({ name: 'exam' })} className="mt-8 w-full">
          Back to overview
        </Button>
      </div>
    );
  }

  // Live view. The countdown deliberately does NOT clamp at 0:00 once
  // plannedMinutes elapses - stopping the clock there would falsify the
  // log by silently capping every sprint's recorded length at what was
  // planned, even when Deepak kept going. So it counts up past zero
  // instead, in the overrun tone, and the sprint stays live until "End
  // sprint" is actually tapped (formatCountdown, format.ts, carries the
  // "+3:12" display form for this).
  const elapsedSeconds = Math.floor((now.getTime() - new Date(sprint.startedAt).getTime()) / 1000);
  const remainingSeconds = sprint.plannedMinutes * 60 - elapsedSeconds;
  const overrun = remainingSeconds < 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Sprint" onBack={() => onNavigate({ name: 'exam' })} />
      </div>

      {/* THE CENTERPIECE - one job, the box of time (plan §4.3). No
          hoursThisWeek-style context here on purpose; that belongs to
          ExamOverview, not to a screen whose whole point is not thinking
          about anything except the current sprint. */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p
          className={`text-huge font-bold tracking-tight tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${overrun ? 'text-amber-400' : 'text-slate-100'}`}
        >
          {formatCountdown(remainingSeconds)}
        </p>
        <p className="text-lg text-slate-100">{topic?.name ?? ''}</p>
        <p className="text-base tabular-nums text-slate-500">planned {sprint.plannedMinutes} min</p>
      </div>

      {Capacitor.isNativePlatform() && (
        <p className="text-center text-sm text-slate-600">Screen stays on while this is open.</p>
      )}

      <Button variant="secondary" onClick={() => void handleEnd()} className="w-full">
        End sprint
      </Button>
    </div>
  );
}
