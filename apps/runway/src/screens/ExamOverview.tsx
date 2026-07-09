import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Button } from '../ui/Button';
import { useNow } from '../hooks/useNow';
import {
  DEFAULT_PACE_HOURS_PER_WEEK,
  examProjection,
  hoursThisWeek,
  loggedHoursByTopic,
  milestoneProjection,
} from '../lib/examProjection';
import type { ExamProjectionResult } from '../lib/examProjection';
import {
  formatDateLong,
  formatDateMedium,
  formatExamAnchorLine,
  formatExamMarginLine,
  formatRequiredPaceLine,
  formatTime,
} from '../lib/format';

interface ExamOverviewProps {
  onNavigate: (screen: Screen) => void;
}

// Same calm/tight/late palette as the Runway screen's STATE_TEXT
// (RUNWAY_PLAN.md §5.2: colour only ever touches text, never backgrounds or
// icons or motion) — 'done' is added here and reuses calm's colour per the
// increment-2 spec: finishing every topic's estimate early is not a state
// that should read as a warning.
const STATE_TEXT: Record<ExamProjectionResult['state'], string> = {
  calm: 'text-slate-100',
  done: 'text-slate-100',
  tight: 'text-amber-400',
  late: 'text-red-400',
};

// Built from the same constant examProjection.ts uses for the fallback
// pace, so this copy can't quietly drift out of sync with the number it's
// describing.
const PACE_ASSUMPTION_LINE = `Pace is an assumption (${DEFAULT_PACE_HOURS_PER_WEEK} h/week) until sprints are logged.`;

// How long an unfinished sprint (endedAt === null) still counts as
// currently-running for the "A sprint is running" banner below. A crash or
// force-close can leave a sprint stuck with no endedAt forever; without a
// cutoff, that dead row would haunt this screen indefinitely, always
// inviting a tap into a sprint that isn't actually happening.
//
// This threshold ONLY controls the banner. It has no bearing on the hour
// math above: examProjection.ts's loggedHoursByTopic already skips every
// sprint with endedAt === null unconditionally, with no age check of its
// own - an unfinished sprint (crashed or merely still live) contributes
// zero logged hours either way, which is the correct answer regardless of
// how old it is.
const LIVE_SPRINT_THRESHOLD_MS = 12 * 60 * 60_000;

// How many past milestones stay visible, dimmed, at the bottom of the
// Milestones section (increment-4 spec). Deliberately small and deliberately
// NOT "show everything" — a completed mock oral from four months ago isn't
// useful context on the app's home screen, and the milestones themselves
// (not a rebuilt History-style log of them) are what preserve that record.
const MAX_PAST_MILESTONES = 3;

/**
 * Prüfung's home screen (RUNWAY_PRUFUNG_PLAN.md §4.1) — the real thing this
 * time. Increment 1 shipped a placeholder (name, anchor line, topic count);
 * this increment adds the actual point of the mode: the live ready-date
 * projection, the weekly pace requirement, and the per-topic hour list.
 * Sprint logging (the "Start a sprint" button's destination) and milestones
 * are increments 3–4.
 *
 * Takes no `examId` prop and instead reads the single exam directly,
 * because v1 supports exactly one (db/types.ts's Exam doc comment) — a prop
 * here would just be a second place that "which exam" could get out of sync
 * with the one true answer db.exams holds.
 */
export function ExamOverview({ onNavigate }: ExamOverviewProps) {
  const exam = useLiveQuery(() => db.exams.toCollection().first(), []);
  const topics = useLiveQuery(
    async () => (exam ? db.topics.where('examId').equals(exam.id).sortBy('order') : []),
    [exam],
  );
  const sprints = useLiveQuery(
    async () => (exam ? db.sprints.where('examId').equals(exam.id).toArray() : []),
    [exam],
  );
  const milestones = useLiveQuery(
    async () => (exam ? db.milestones.where('examId').equals(exam.id).sortBy('at') : []),
    [exam],
  );

  // A readyDate doesn't need second precision the way the live Runway
  // screen's projected arrival does — a minute-level tick keeps "Ready by
  // ..." honest as the day rolls over without re-rendering this screen 60x
  // more often than the displayed number could ever visibly change.
  const now = useNow(60_000);

  // Reachable only from Home's Prüfung link, which already routes to
  // examSetup instead of here when no exam exists — so `exam` being
  // undefined at this point means the first Dexie read simply hasn't
  // resolved yet, not a real empty state to design copy for. `topics`,
  // `sprints` and `milestones` start as `undefined` too, for the same
  // reason.
  if (!exam || !topics || !sprints || !milestones) return null;

  const projection = examProjection(now, exam, topics, sprints);
  const loggedByTopic = loggedHoursByTopic(sprints);
  const textAccent = STATE_TEXT[projection.state];
  const thisWeekHours = hoursThisWeek(now, sprints);

  // `milestones` is already chronological ascending (Dexie's sortBy('at')
  // above) so both slices below stay in that same order without a second
  // sort: upcoming milestones read soonest-first, and taking the LAST
  // MAX_PAST_MILESTONES of the past subset (still ascending) is exactly
  // "the most recent ones", not the oldest.
  const upcomingMilestones = milestones.filter((m) => new Date(m.at).getTime() >= now.getTime());
  const pastMilestones = milestones
    .filter((m) => new Date(m.at).getTime() < now.getTime())
    .slice(-MAX_PAST_MILESTONES);

  // LIVE_SPRINT_THRESHOLD_MS above is what keeps a crashed, never-ended
  // sprint from pinning this banner up forever.
  const liveSprint = sprints.find(
    (sprint) => sprint.endedAt === null && now.getTime() - new Date(sprint.startedAt).getTime() < LIVE_SPRINT_THRESHOLD_MS,
  );
  const liveSprintTopicName = liveSprint ? topics.find((topic) => topic.id === liveSprint.topicId)?.name : undefined;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title={exam.name} onBack={() => onNavigate({ name: 'home' })} />
      </div>

      {/* THE CENTERPIECE — same text-huge treatment as the Runway screen's
          projected arrival (RUNWAY_PLAN.md §4). */}
      <div className="flex flex-col items-center gap-1 text-center">
        {projection.readyDate ? (
          <p className={`text-huge font-bold tabular-nums ${textAccent}`}>
            Ready by {formatDateMedium(projection.readyDate)}
          </p>
        ) : (
          <>
            <p className={`text-huge font-bold ${textAccent}`}>Never</p>
            <p className="text-base text-slate-400">
              At the current pace of {projection.pace} h/week, no projection is possible.
            </p>
          </>
        )}

        <p className="text-lg tabular-nums text-slate-500">{formatExamAnchorLine(exam)}</p>

        {projection.state === 'done' ? (
          <p className={`text-base font-medium ${textAccent}`}>All topics at their estimated hours.</p>
        ) : (
          // slackDays is only null alongside a null readyDate (the "Never"
          // case above already explains itself) — nothing more to say here
          // in that state, so the line is omitted rather than forced.
          projection.slackDays !== null && (
            <p className={`text-base font-medium tabular-nums ${textAccent}`}>
              {formatExamMarginLine(projection.slackDays)}
            </p>
          )
        )}
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm tabular-nums text-slate-400">
          {formatRequiredPaceLine(projection.anchor, projection.requiredPaceHoursPerWeek, thisWeekHours)}
        </p>
        {!projection.paceIsMeasured && <p className="text-sm text-slate-500">{PACE_ASSUMPTION_LINE}</p>}
      </div>

      <Button onClick={() => onNavigate({ name: 'sprintSetup' })} className="w-full">
        Start a sprint
      </Button>

      {/* Milestones — the real external dates (RUNWAY_PRUFUNG_PLAN.md §3,
          §4.1, increment 4). Placed right after the primary "Start a
          sprint" action and before the topic breakdown: milestones give
          the topic list below its "ready for what" context, but the one
          action on this screen that actually matters stays first. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Milestones</h2>

        {milestones.length === 0 && <p className="text-sm text-slate-500">No milestones yet.</p>}

        <div className="flex flex-col gap-2">
          {upcomingMilestones.map((milestone) => {
            const milestoneResult = milestoneProjection(now, milestone, topics, sprints);
            const milestoneAccent = STATE_TEXT[milestoneResult.state];
            const at = new Date(milestone.at);
            return (
              <div
                key={milestone.id}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-4 py-3"
              >
                <div className="flex flex-col">
                  <p className="text-slate-100">{milestone.name}</p>
                  <p className="text-sm tabular-nums text-slate-400">
                    {formatDateLong(at)} {formatTime(at)}
                  </p>
                </div>
                <p className={`text-sm font-medium tabular-nums ${milestoneAccent}`}>
                  {milestoneResult.readyDate ? `Ready ${formatDateMedium(milestoneResult.readyDate)}` : 'Never'}
                </p>
              </div>
            );
          })}

          {/* Past milestones: dimmed, no projection line (a mock oral that
              already happened has nothing left to be "ready by"), capped at
              MAX_PAST_MILESTONES and older ones hidden entirely — history
              lives in the milestones themselves; this is not another
              History screen. */}
          {pastMilestones.map((milestone) => {
            const at = new Date(milestone.at);
            return (
              <div
                key={milestone.id}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/60 px-4 py-3 opacity-50"
              >
                <div className="flex flex-col">
                  <p className="text-slate-100">{milestone.name}</p>
                  <p className="text-sm tabular-nums text-slate-400">
                    {formatDateLong(at)} {formatTime(at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => onNavigate({ name: 'milestoneEdit', examId: exam.id })}
          className="min-h-11 self-start text-sm font-medium text-sky-400 hover:text-sky-300"
        >
          Add milestone
        </button>
      </section>

      {/* Topic list — plain numbers, no progress bars
          (RUNWAY_PRUFUNG_PLAN.md §4.1: a bar sitting at 8% is
          demoralising, a number is just true). Ordered by `order`, the
          same field TopicEdit's reorder controls write. */}
      <div className="flex flex-col gap-2">
        {topics.length === 0 && <p className="text-sm text-slate-500">No topics yet.</p>}
        {topics.map((topic) => {
          const logged = loggedByTopic.get(topic.id) ?? 0;
          return (
            <div
              key={topic.id}
              className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-4 py-3"
            >
              <p className="text-slate-100">{topic.name}</p>
              <p className="text-sm tabular-nums text-slate-400">
                {logged.toFixed(1)} of {topic.estimatedHours.toFixed(1)} h
              </p>
            </div>
          );
        })}
      </div>

      {/* Quiet by design (plan §1: "not a fake-urgency machine") — this is
          a pointer back to real work already in progress, not a nudge to
          start something. */}
      {liveSprint && (
        <button
          onClick={() => onNavigate({ name: 'sprint', sprintId: liveSprint.id })}
          className="min-h-11 self-start text-sm font-medium text-slate-400 hover:text-slate-200"
        >
          A sprint is running: {liveSprintTopicName ?? 'Untitled topic'}.
        </button>
      )}

      <div className="flex flex-col items-start gap-1">
        <button
          onClick={() => onNavigate({ name: 'examSetup', examId: exam.id })}
          className="min-h-11 text-sm font-medium text-sky-400 hover:text-sky-300"
        >
          Edit exam
        </button>
        <button
          onClick={() => onNavigate({ name: 'topicEdit', examId: exam.id })}
          className="min-h-11 text-sm font-medium text-sky-400 hover:text-sky-300"
        >
          Edit topics
        </button>
      </div>
    </div>
  );
}
