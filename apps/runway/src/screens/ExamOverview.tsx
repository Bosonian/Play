import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Sprint } from '../db/types';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Button } from '../ui/Button';
import { TextAction } from '../ui/TextAction';
import { useNow } from '../hooks/useNow';
import {
  DEFAULT_PACE_HOURS_PER_WEEK,
  bestWeekHours,
  examProjection,
  findLiveSprint,
  hoursThisWeek,
  loggedHoursByTopic,
  milestoneProjection,
  zombieSprints,
} from '../lib/examProjection';
import type { ExamProjectionResult } from '../lib/examProjection';
import { isoWeekday, todayLine } from '../lib/dailyShape';
import { nextMove } from '../lib/nextMove';
import type { NextMove } from '../lib/nextMove';
import { PRUEFUNG_GUIDED_DONE_KEY, isGuidedPassActive, markGuidedPassDone } from '../lib/guidedPass';
import {
  formatDateLong,
  formatDateMedium,
  formatExamAnchorLine,
  formatExamMarginLine,
  formatRequiredPaceLine,
  formatScheduleDays,
  formatTime,
} from '../lib/format';
import { cancelSprintEndAlarm } from '../native/notifications';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from '../lib/dayGaugeRefresh';

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
  empty: 'text-slate-400',
  tight: 'text-amber-400',
  late: 'text-red-400',
};

// Built from the same constant examProjection.ts uses for the fallback
// pace, so this copy can't quietly drift out of sync with the number it's
// describing.
const PACE_ASSUMPTION_LINE = `Pace is an assumption (${DEFAULT_PACE_HOURS_PER_WEEK} h/week) until sprints are logged.`;

// Next-move card copy (guided-layer increment §1). One line of reasoning
// per `NextMove['reason']`, kept as a lookup rather than inline in the JSX
// below so the reasoning is always visible right next to the suggestion —
// "a suggestion with its work shown, never an oracle" (increment brief) —
// and so a new reason added to nextMove.ts later can't compile without its
// copy being added here too.
const NEXT_MOVE_REASON_LINE: Record<NextMove['reason'], (topicName: string) => string> = {
  momentum: (topicName) => `Continuing ${topicName} — recently worked.`,
  behind: (topicName) => `${topicName} is furthest behind its estimate.`,
  start: () => 'Nothing logged yet. First topic in your list.',
};

// findLiveSprint/zombieSprints/LIVE_SPRINT_THRESHOLD_MS (examProjection.ts)
// draw the line between "still genuinely running" (the quiet banner below)
// and "a zombie needing reconciliation" (the card below that) — shared with
// SprintSetup's double-start guard so the two screens can't disagree on
// which is which. See that file's comment for the full threshold rationale.
//
// Neither has any bearing on the hour math above: examProjection.ts's
// loggedHoursByTopic already skips every sprint with endedAt === null
// unconditionally, with no age check of its own - an unfinished sprint
// (crashed, zombie, or merely still live) contributes zero logged hours
// either way, which is the correct answer regardless of how old it is.

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

  // Guided-layer increment (§2): read up front, alongside the other Dexie
  // queries above, rather than after the early return below — hooks have
  // to run unconditionally on every render, so this can't wait until
  // `exam`/`topics`/etc. are confirmed loaded the way the plain variables
  // further down can.
  const guidedSetting = useLiveQuery(() => db.settings.get(PRUEFUNG_GUIDED_DONE_KEY), []);
  const guidedPassActive = isGuidedPassActive(guidedSetting);

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
  const bestWeek = bestWeekHours(now, sprints);
  // Daily shape (this increment): `null` whenever Deepak hasn't set a
  // dailyTarget (undefined-as-null read, same discipline as
  // `exam.studySchedule` below) — the Today line is then omitted entirely,
  // never a dash or a "0 of 0". See db/types.ts's DailyTarget doc comment
  // for why this is computed from sprint COUNTS only, never hours, and
  // never touches `projection` above.
  const daily = todayLine(now, exam.dailyTarget ?? null, sprints);

  // Headline swap (0.41.1): CLAUDE.md's follow-up on 0.41.0, verbatim —
  // "even after edit it didn't change". Putting "Today: 1 of 3 sprints." in
  // small grey text under the weekly bar left the giant red "Ready by ..."
  // still leading, which is exactly the big-number paralysis 0.41.0 was
  // meant to fix. `dailyHeadline` is what actually promotes to the
  // text-huge centerpiece below (and, correspondingly, what the old small
  // Today line under the bar stops rendering for) — `null` whenever there's
  // nothing to promote (no target set) OR the state is 'done': finishing
  // every topic's own estimate already gets its own acknowledgment line
  // ("All topics at their estimated hours.") and isn't a day this count
  // should visually outrank. 'empty' needs no explicit exclusion here — its
  // branch below is checked first and never reads this at all.
  const dailyHeadline = projection.state === 'done' ? null : daily;

  // Same isoWeekday/restDay comparison Sprint.tsx's PostSprintView already
  // uses to know it's a rest day (`isRestDay`, that file's own local const)
  // — reused here rather than string-matching dailyHeadline?.text ===
  // 'Rest day.' against dailyShape.ts's literal, which would silently break
  // if that copy ever changed.
  const isRestDay =
    exam.dailyTarget != null && exam.dailyTarget.restDay !== null && isoWeekday(now) === exam.dailyTarget.restDay;

  // Next-move card's suggestion (guided-layer increment §1) — see
  // showNextMoveArea below, where this combines with `liveSprint` (defined
  // further down) to decide whether the card actually renders.
  const nextMoveResult = nextMove(now, topics, sprints);

  // `milestones` is already chronological ascending (Dexie's sortBy('at')
  // above) so both slices below stay in that same order without a second
  // sort: upcoming milestones read soonest-first, and taking the LAST
  // MAX_PAST_MILESTONES of the past subset (still ascending) is exactly
  // "the most recent ones", not the oldest.
  const upcomingMilestones = milestones.filter((m) => new Date(m.at).getTime() >= now.getTime());
  const pastMilestones = milestones
    .filter((m) => new Date(m.at).getTime() < now.getTime())
    .slice(-MAX_PAST_MILESTONES);

  const liveSprint = findLiveSprint(sprints, now);
  const liveSprintTopicName = liveSprint ? topics.find((topic) => topic.id === liveSprint.topicId)?.name : undefined;

  // Next-move card visibility (guided-layer increment §1): hidden when
  // there's nothing to suggest (nextMove() returned null — no topics, or
  // every topic already at its estimate) and hidden while a live sprint
  // exists, because the quiet "A sprint is running" pointer further down
  // already owns that state — suggesting a *next* move while one is
  // already under way would be a second, contradictory thing to decide.
  const showNextMoveArea = nextMoveResult !== null && !liveSprint;
  // The one-time walkthrough card (§2) replaces the ordinary next-move card
  // for exactly one appearance: while the guided pass hasn't finished yet
  // AND there's something to suggest. Tapping either of its two actions
  // (Start or Later) sets pruefungGuidedDone, so this condition can only
  // ever be true once per install — after that this always falls through
  // to the ordinary card below.
  const showGuidedCard = showNextMoveArea && guidedPassActive;

  // Shared by both the ordinary and guided-walkthrough "Start" buttons:
  // the ritual gate on SprintSetup still applies either way (App.tsx's
  // Screen comment) — this only prefills the topic/length choice, it never
  // routes around the start ritual itself. Ending the guided pass here (not
  // just on "Later.") means starting the very first sprint already counts
  // as "walkthrough done" — there's no reason to show onboarding copy again
  // to someone who's already sprinting.
  function startNextMove(target: NextMove) {
    if (guidedPassActive) void markGuidedPassDone();
    onNavigate({ name: 'sprintSetup', topicId: target.topicId, plannedMinutes: target.plannedMinutes });
  }

  // Zombie reconciliation (F3): a sprint the live screen never got to end
  // (crash, force-close, forgotten) is unreachable through normal
  // navigation once SprintSetup refuses a second concurrent sprint — this
  // card is the only way back to it. zombieSprints() is oldest-first and
  // only the first is shown, so resolving one reveals the next rather than
  // listing them all at once.
  const zombie = zombieSprints(sprints, now)[0];
  const zombieTopicName = zombie ? topics.find((topic) => topic.id === zombie.topicId)?.name ?? 'Untitled topic' : undefined;

  async function resolveZombie(target: Sprint, endedAt: string | null) {
    // `endedAt: null` means "Discard": DELETE the row entirely rather than
    // leaving it around with, say, a 0-minute endedAt. This matters beyond
    // tidiness — TopicEdit.removeTopic blocks deleting any topic with
    // sprintCount > 0, so a discarded zombie left in place would
    // permanently pin its topic in the list even though the "work" it
    // represents was never real and Deepak explicitly said to throw it
    // away.
    if (endedAt === null) {
      await db.sprints.delete(target.id);
    } else {
      await db.sprints.update(target.id, { endedAt });
    }
    // Harmless if the alarm already fired or was never scheduled (see
    // cancelSprintEndAlarm's own doc comment) — cancelled either way so a
    // long-dead sprint can't still ring.
    await cancelSprintEndAlarm(target.id);
    // Widgets increment: a resolved zombie changes logged hours exactly
    // like an ordinary sprint end (Discard also removes hours that were
    // never real in the first place — either way the widget's numbers are
    // now stale until this runs).
    await refreshWidgets();
    await refreshDayGauge();
  }

  /** The endedAt the card's "Log planned N min" button writes — startedAt
   * plus the box that was planned, not whatever elapsed (which, for a
   * zombie, isn't even known: the sprint was never ended, so there's no
   * real "actual minutes" to log, only the box it was set up for). */
  function zombiePlannedEndIso(target: Sprint): string {
    return new Date(new Date(target.startedAt).getTime() + target.plannedMinutes * 60_000).toISOString();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title={exam.name} onBack={() => onNavigate({ name: 'home' })} />
      </div>

      {/* THE CENTERPIECE — same text-huge treatment as the Runway screen's
          projected arrival (RUNWAY_PLAN.md §4). Centerpiece text and the
          margin line below it share the same motion-safe 300ms colour
          crossfade Runway's own state-tinted elements use. */}
      <div className="flex flex-col items-center gap-1 text-center">
        {projection.state === 'empty' ? (
          // Empty-exam honesty: no topics yet, or every topic reads 0
          // estimated hours — there is nothing for the projection to
          // measure against, so nothing here pretends there is one. Plain
          // slate, not the huge-date treatment below — a missing topic
          // list is a setup step, not a projection result, and shouldn't
          // borrow that result's visual weight.
          <p className="text-2xl font-medium text-slate-400">No topics yet.</p>
        ) : dailyHeadline ? (
          // Headline swap (0.41.1, see `dailyHeadline`'s own comment
          // above): same type scale/classes the "Ready by ..." headline
          // below uses — this isn't a smaller or lighter treatment, the
          // day-sized number gets exactly the visual weight the date used
          // to get. 'Rest day.' reads slate-400 — a rest day is
          // unconditionally `met: true` (dailyShape.ts's todayLine) but
          // isn't an achievement to celebrate the way meeting a real target
          // is, so it stays plain rather than borrowing the emerald
          // acknowledgment tone. Not-met stays slate-100, not a warning
          // colour — a daily target is a floor to reach, not a deadline to
          // miss (CLAUDE.md's honesty-about-tradeoffs rule, applied to
          // colour instead of copy: red here would imply lateness that
          // isn't real).
          <p
            className={`text-huge font-bold tracking-tight tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${
              isRestDay ? 'text-slate-400' : dailyHeadline.met ? 'text-emerald-300' : 'text-slate-100'
            }`}
          >
            {dailyHeadline.text}
          </p>
        ) : projection.readyDate ? (
          <p
            className={`text-huge font-bold tracking-tight tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}
          >
            Ready by {formatDateMedium(projection.readyDate, now)}
          </p>
        ) : (
          <>
            <p className={`text-huge font-bold tracking-tight motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}>
              Never
            </p>
            <p className="text-base text-slate-400">
              At the current pace of {projection.pace} h/week, no projection is possible.
            </p>
          </>
        )}

        {projection.state === 'empty' ? (
          <p className="text-base text-slate-400">
            The projection starts when the exam has topics with hour estimates.
          </p>
        ) : (
          <>
            <p className="text-lg tabular-nums text-slate-500">{formatExamAnchorLine(exam)}</p>

            {projection.state === 'done' ? (
              // Moments (UI-polish increment): the one place on this screen
              // that reads as an acknowledgment rather than a status — every
              // topic at its estimate — so this line alone gets emerald-300,
              // independent of `textAccent` (which stays slate-100 for 'done'
              // on the centerpiece above; the finished *state* isn't a warning,
              // but it isn't the specific "well done" moment either — this
              // margin line is).
              <p className="text-base font-medium text-emerald-300 motion-safe:transition-colors motion-safe:duration-300">
                All topics at their estimated hours.
              </p>
            ) : dailyHeadline ? (
              // Compressed projection line (0.41.1): the truth the giant
              // headline used to state, at the same visual weight as the
              // anchor line just above it, now that the Today count has
              // taken that slot. Not a new sentence — `formatDateMedium` and
              // `formatExamMarginLine` are the exact same calls the old
              // headline + margin line made, on the exact same `textAccent`
              // colour (red-400 late, amber-400 tight, slate-100 calm),
              // just recomposed onto one line so the projection reads as a
              // single calm fact rather than two. The null-readyDate
              // ("Never") case has no margin figure to attach to a combined
              // line — `formatExamMarginLine` is only ever called alongside
              // a non-null readyDate elsewhere on this screen too — so it
              // keeps its original two-line shape ("Never" + the pace
              // sentence), just sized down to match; combining those two
              // into one line read like it was hiding the "no projection is
              // possible" caveat inside a date-shaped sentence that has no
              // date. Judgment call, flagged per the increment brief.
              projection.readyDate ? (
                <p className={`text-base font-medium tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}>
                  Ready by {formatDateMedium(projection.readyDate, now)} ·{' '}
                  {formatExamMarginLine(projection.slackDays as number)}
                </p>
              ) : (
                <>
                  <p className={`text-base font-medium tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}>
                    Never
                  </p>
                  <p className="text-base text-slate-400">
                    At the current pace of {projection.pace} h/week, no projection is possible.
                  </p>
                </>
              )
            ) : (
              // slackDays is only null alongside a null readyDate (the
              // "Never" case above already explains itself) — nothing more
              // to say here in that state, so the line is omitted rather
              // than forced.
              projection.slackDays !== null && (
                <p className={`text-base font-medium tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${textAccent}`}>
                  {formatExamMarginLine(projection.slackDays)}
                </p>
              )
            )}
          </>
        )}
      </div>

      {/* Actionable pace line + weekly tactical surface — omitted entirely
          for 'empty': formatRequiredPaceLine's own null-anchor branch
          ("The exam window is open.") is meant for a real exam that's
          simply past its anchor, not for an exam with nothing to pace
          against yet, so this whole block would say something true-looking
          but pointless rather than nothing at all. */}
      {projection.state !== 'empty' && (
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm tabular-nums text-slate-400">
            {formatRequiredPaceLine(projection.anchor, projection.requiredPaceHoursPerWeek, thisWeekHours, now)}
          </p>
          {!projection.paceIsMeasured && <p className="text-sm text-slate-500">{PACE_ASSUMPTION_LINE}</p>}

          {/* Weekly tactical surface: a thin progress bar for this week's
              logged hours against the required weekly pace. Deliberately
              the ONE progress bar in this app — topic coverage below stays
              plain numbers, per RUNWAY_PRUFUNG_PLAN.md §4.1's "a bar at 8%
              is demoralising" rule. A week bar is a different shape of
              fact and doesn't fall under that rule: it fills across DAYS,
              not months, and resets to empty every Monday regardless of
              how last week went — it can never accumulate into the kind of
              standing low-percentage indictment a topic-coverage bar would
              become over a months-long prep window. Hidden (not shown at
              0%) whenever there's no real weekly target to compare
              against. */}
          {projection.requiredPaceHoursPerWeek !== null && projection.requiredPaceHoursPerWeek > 0 && (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full motion-safe:transition-all motion-safe:duration-300 ${
                  thisWeekHours >= projection.requiredPaceHoursPerWeek ? 'bg-emerald-300' : 'bg-sky-500'
                }`}
                style={{ width: `${Math.min(100, (thisWeekHours / projection.requiredPaceHoursPerWeek) * 100)}%` }}
              />
            </div>
          )}

          {/* Daily shape (0.41.0), demoted to 'done' only (0.41.1): this
              line used to render for every state — it's now the headline
              above for calm/tight/late instead (`dailyHeadline`'s own
              comment up top), so rendering it again here in those states
              would just repeat the centerpiece in miniature underneath
              itself. 'done' is the one state `dailyHeadline` deliberately
              excludes from the swap (finishing every topic's estimate gets
              its own acknowledgment line instead), so this is where the
              Today count still lives for that state — same position,
              same styling, unchanged from 0.41.0. Still never gated on or
              blended with `projection.state` beyond this one exclusion, per
              DailyTarget's own CRITICAL HONESTY CONSTRAINT: a 'done' exam
              doesn't make today's sprint count any less real. */}
          {daily && projection.state === 'done' && (
            <p
              className={`text-sm tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${
                daily.met ? 'text-emerald-300' : 'text-slate-400'
              }`}
            >
              {daily.text}
            </p>
          )}

          {/* Self-Competitor line (CLAUDE.md's secondary play personality)
              — a personal-best fact, not a comparison to anyone else and
              not a streak. Omitted entirely (bestWeekHours returns null)
              until a full Monday-start week of history exists. */}
          {bestWeek !== null && (
            <p className="text-sm tabular-nums text-slate-500">Best week: {bestWeek.toFixed(1)} h.</p>
          )}

          {/* Prüfung rework 2: the commitment made visible, not a per-block
              list — study blocks are scheduled ALARMS, not entities (see
              db/types.ts's Exam.studySchedule and notifications.ts's
              scheduleStudyBlockAlarms for the "no ledger" decision), so
              there is nothing here to enumerate, only the standing schedule
              itself. `exam.studySchedule` is checked with `!= null` rather
              than plain truthiness only as a matter of habit — both read
              identically for this field, but every other reader of a
              non-indexed, possibly-`undefined` field in this app uses the
              explicit form (see the field's own undefined-as-null doc
              comment) and this stays consistent with that. */}
          {exam.studySchedule != null && (
            <p className="text-sm tabular-nums text-slate-500">
              Study blocks: {formatScheduleDays(exam.studySchedule.days)} · {exam.studySchedule.time} ·{' '}
              {exam.studySchedule.minutes} min.
            </p>
          )}
        </div>
      )}

      {/* Next-move card (guided-layer increment §1) — directly under the
          actionable pace line, above milestones. Two mutually-exclusive
          variants share this one slot: the one-time guided-walkthrough
          framing (§2) while that's still active, and the ordinary
          always-on next-move card once it isn't. Both always show their
          reasoning alongside the suggestion — never just a button with no
          explanation — and both route through SprintSetup's start ritual
          exactly like every other way into a sprint; neither skips it. */}
      {showNextMoveArea && nextMoveResult && (
        showGuidedCard ? (
          <div className="flex flex-col gap-3 rounded-xl border border-sky-800/60 bg-sky-950/30 p-4 motion-safe:animate-fade-in">
            <p className="text-slate-100">A 25-minute sprint breaks the seal. Start one now?</p>
            <div className="flex gap-3">
              <Button onClick={() => startNextMove(nextMoveResult)} className="flex-1">
                Start
              </Button>
              <Button variant="secondary" onClick={() => void markGuidedPassDone()} className="flex-1">
                Later.
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
            <div>
              <p className="text-slate-100">
                Next: {nextMoveResult.plannedMinutes} min on {nextMoveResult.topicName}.
              </p>
              <p className="text-sm text-slate-500">{NEXT_MOVE_REASON_LINE[nextMoveResult.reason](nextMoveResult.topicName)}</p>
            </div>
            <div className="flex items-center gap-4">
              <Button onClick={() => startNextMove(nextMoveResult)} className="flex-1">
                Start
              </Button>
              <TextAction onClick={() => onNavigate({ name: 'sprintSetup' })}>Choose differently</TextAction>
            </div>
          </div>
        )
      )}

      {/* Zombie reconciliation card (F3) — placed ahead of "Start a sprint"
          so an unresolved sprint from a crash or a forgotten end gets
          noticed before starting fresh work, but it's a resolve-when-ready
          nudge, not a gate: SprintSetup only blocks on a genuinely LIVE
          sprint, never on a zombie. */}
      {zombie && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-900 bg-amber-950/40 p-4">
          <p className="text-sm text-slate-100">
            {zombieTopicName}: a sprint from {formatDateLong(new Date(zombie.startedAt))}{' '}
            {formatTime(new Date(zombie.startedAt))} was never ended.
          </p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => void resolveZombie(zombie, zombiePlannedEndIso(zombie))}
              className="flex-1"
            >
              Log planned {zombie.plannedMinutes} min
            </Button>
            <Button variant="secondary" onClick={() => void resolveZombie(zombie, null)} className="flex-1">
              Discard
            </Button>
          </div>
        </div>
      )}

      {/* Falls back to a plain, unprefilled "Start a sprint" whenever the
          next-move card isn't showing — every topic already at its
          estimate, or a live sprint already running (its own quiet pointer
          is further down). Kept as the one remaining path into SprintSetup
          in those states rather than removed outright: the card replaces
          this button when it can offer a real suggestion, it doesn't
          replace the ability to start a sprint at all.

          Empty-exam honesty: `showNextMoveArea` is already false here
          whenever `projection.state === 'empty'` (nextMove() itself
          returns null with no topics, or with every topic at 0 remaining
          hours — see nextMove.ts) — there is nothing to sprint on yet, so
          the primary action switches to "Edit topics" instead of offering
          a sprint button with nowhere real to point it. SprintSetup's own
          "No topics yet." guard (its own empty-topics branch) stays as the
          backstop for any other path that might still reach it. */}
      {!showNextMoveArea &&
        (projection.state === 'empty' ? (
          <Button onClick={() => onNavigate({ name: 'topicEdit', examId: exam.id })} className="w-full">
            Edit topics
          </Button>
        ) : (
          <Button onClick={() => onNavigate({ name: 'sprintSetup' })} className="w-full">
            Start a sprint
          </Button>
        ))}

      {/* Milestones — the real external dates (RUNWAY_PRUFUNG_PLAN.md §3,
          §4.1, increment 4). Placed right after the primary "Start a
          sprint" action and before the topic breakdown: milestones give
          the topic list below its "ready for what" context, but the one
          action on this screen that actually matters stays first. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Milestones</h2>

        {/* This IS the empty state, not a nag toward booking one —
            RUNWAY_PRUFUNG_PLAN.md §7: the app renders milestones, it never
            invents them. The line says so plainly rather than prompting
            "add a milestone" the way an ordinary empty-list placeholder
            would. */}
        {milestones.length === 0 && (
          <p className="text-sm text-slate-500">
            No milestones yet. A booked mock oral is the strongest deadline this app can render.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {upcomingMilestones.map((milestone) => {
            const milestoneResult = milestoneProjection(now, milestone, topics, sprints);
            const milestoneAccent = STATE_TEXT[milestoneResult.state];
            const at = new Date(milestone.at);
            return (
              <div
                key={milestone.id}
                className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-surface p-4"
              >
                <div className="flex flex-col">
                  <p className="text-slate-100">{milestone.name}</p>
                  <p className="text-sm tabular-nums text-slate-400">
                    {formatDateLong(at)} {formatTime(at)}
                  </p>
                </div>
                <p className={`text-sm font-medium tabular-nums motion-safe:transition-colors motion-safe:duration-300 ${milestoneAccent}`}>
                  {milestoneResult.readyDate ? `Ready ${formatDateMedium(milestoneResult.readyDate, now)}` : 'Never'}
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
                className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-surface/60 p-4 opacity-50"
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

        <TextAction onClick={() => onNavigate({ name: 'milestoneEdit', examId: exam.id })} className="self-start">
          Add milestone
        </TextAction>
      </section>

      {/* Topic list — plain numbers, no progress bars
          (RUNWAY_PRUFUNG_PLAN.md §4.1: a bar sitting at 8% is
          demoralising, a number is just true). Ordered by `order`, the
          same field TopicEdit's reorder controls write. */}
      <div className="flex flex-col gap-2">
        {topics.length === 0 && <p className="text-sm text-slate-500">No topics yet.</p>}
        {topics.map((topic) => {
          const logged = loggedByTopic.get(topic.id) ?? 0;
          // "Topics as chapters": a topic at or past its own estimate reads
          // as a closed chapter — emerald-300, same accent the exam-level
          // "done" moment uses, plus a trailing "· complete". Still no bar
          // and no percentage (the ban stands for topic rows — see the
          // comment above); this is a colour + word change on the same
          // plain number, not a new visual element. `estimatedHours > 0`
          // guards a 0-estimate topic from reading "complete" the moment
          // it's created with nothing logged yet (0 >= 0 is true).
          const complete = topic.estimatedHours > 0 && logged >= topic.estimatedHours;
          return (
            <div
              key={topic.id}
              className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-surface p-4"
            >
              <p className="text-slate-100">{topic.name}</p>
              <p className={`text-sm tabular-nums ${complete ? 'text-emerald-300' : 'text-slate-400'}`}>
                {logged.toFixed(1)} of {topic.estimatedHours.toFixed(1)} h{complete ? ' · complete' : ''}
              </p>
            </div>
          );
        })}
      </div>

      {/* Quiet by design (plan §1: "not a fake-urgency machine") — this is
          a pointer back to real work already in progress, not a nudge to
          start something. */}
      {liveSprint && (
        <TextAction onClick={() => onNavigate({ name: 'sprint', sprintId: liveSprint.id })} className="self-start">
          A sprint is running: {liveSprintTopicName ?? 'Untitled topic'}.
        </TextAction>
      )}

      <div className="flex flex-col items-start gap-1">
        <TextAction onClick={() => onNavigate({ name: 'examSetup', examId: exam.id })}>Edit exam</TextAction>
        <TextAction onClick={() => onNavigate({ name: 'topicEdit', examId: exam.id })}>Edit topics</TextAction>
      </div>
    </div>
  );
}
