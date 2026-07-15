import { startOfWeek } from 'date-fns';
import type { Departure, Exam, Sprint, Topic, WorkTask } from '../db/types';
import { examProjection, hoursThisWeek } from './examProjection';
import { formatDateTimeShort, formatExamAnchorLine, formatTime } from './format';
import { PAST_DEPARTURE_THRESHOLD_MS } from './departureThreshold';
import { computeProjection, computeStartBy } from './projection';
import { taskStartBy } from './taskProjection';

// Widgets increment (Runway 0.10.0 W1, 0.11.0 W2, 0.39.0 W3, 0.40.0 progress
// bar): the JSON shape written to Android SharedPreferences and read by the
// three native widgets
// (android/app/src/main/java/de/bosonian/runway/PruefungWidgetProvider.java,
// DepartureWidgetProvider.java, and TaskWidgetProvider.java).
//
// ARCHITECTURE RULE: this file is where every number any widget shows gets
// computed. The native side may only do two things with numbers from here —
// calendar-slide readyDayEpochMs forward by whole days, and diff two
// dates/epoch millis — both a 1:1 mirror of a time slide, never a
// re-derivation of examProjection's or projection.ts's math (the tasks
// widget, W3, does neither — see TaskWidgetProvider's own header comment for
// why it's pure display plumbing with zero arithmetic at all). Every string
// any widget renders verbatim (anchorLabel, weekLine, nameLine,
// appointmentLine, planLine, and W3's nameLine/dueLine/countsLine) is built
// here too, so a copy change never needs a matching native change.
// weekProgressPercent/weekAtTarget (0.40.0) extend this same rule to the
// Prüfung widget's progress bar: the ratio and the emerald/sky decision are
// both computed here, never in PruefungWidgetProvider.java, which only
// picks which of two pre-coloured ProgressBar views to show.

/** Same tight/late threshold the app's own STATE_TEXT (ExamOverview.tsx)
 * switches colour at — passed through in the snapshot rather than hardcoded
 * again on the native side, so the widget's colour bands can't drift out of
 * sync with the app's own definition of "tight" by editing only one of the
 * two places that would otherwise both need to agree on it. */
const PRUEFUNG_STATE_THRESHOLD_DAYS = 14;

/** Local midnight (device timezone) of the calendar day `date` falls on —
 * the shared building block behind readyDayEpochMs/generatedDayEpochMs
 * below (m3). Both examProjection.daysBetween (used by the live
 * ExamOverview screen) and the native widget's own day-diffing floor
 * whole calendar days at midnight-to-midnight, so building both fields from
 * this exact construction — rather than, say, "now + N days" arithmetic on
 * a millisecond offset — is what makes the widget and the live app agree BY
 * CONSTRUCTION instead of by coincidence. Replaces the old offsetDays
 * scheme (ceil((readyDate − now) / MS_PER_DAY)), which mixed a
 * whole-days-floor rule (examProjection/ExamOverview) with a ceil of a
 * partial-day difference that also carried readyDate's own time-of-day —
 * the two could land a day apart depending on what time of day either was
 * computed, which is exactly the m3 bug this replaces. */
function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export interface PruefungWidgetData {
  /** Local midnight (device timezone) of the projected ready date's
   * calendar day. The native side slides this forward by however many
   * whole calendar days have passed since generatedDayEpochMs (below)
   * before rendering "Ready by ..." — see PruefungWidgetProvider.updateOne
   * — so a snapshot that's sat unrefreshed for a few days still shows the
   * right date without the app needing to reopen just to keep "today"
   * current. Meaningless (and left at 0) when `neverReady` is true; the
   * widget must check `neverReady` first. */
  readyDayEpochMs: number;
  /** Local midnight (device timezone) of the calendar day this snapshot was
   * built on — the native side's reference point for "how many days old is
   * this snapshot" (see readyDayEpochMs above). */
  generatedDayEpochMs: number;
  /** Mirrors examProjection's readyDate === null EXCLUDING the 'empty'
   * state (zero measured pace, or an overflowed projection) — the widget
   * shows "Ready: never at current pace" instead of a date. `emptyExam`
   * below is the separate, distinct flag for the vacuous case; a snapshot
   * is never both `neverReady` and `emptyExam` at once. */
  neverReady: boolean;
  /** Empty-exam honesty (the same fix as examProjection.ts's 'empty'
   * state): true when the exam has zero topics, or every topic reads 0
   * estimated hours — there is nothing to project, so the widget must not
   * render "Ready by {today}" the way it used to (remainingHours sums to 0
   * over an empty/all-zero topic list exactly like a genuinely finished
   * exam does). The native side checks this before `neverReady` and shows
   * a distinct "No topics yet." line instead of either a date or "never".
   * Old snapshots (written before this field existed) parse this as
   * `false` via `optBoolean` on the Java side — org.json tolerates a
   * missing key, and a pre-update snapshot simply falls through to its old
   * (buggy) rendering until the app is next opened and overwrites it,
   * same as every other schema-upgrade window this file's own header
   * comment already accepts. */
  emptyExam: boolean;
  anchorEpochMs: number;
  /** "Exam window opens 1 Nov 2026" / "Exam 1 Nov 2026" — prebaked via
   * formatExamAnchorLine so the widget never needs its own date-formatting
   * rules. */
  anchorLabel: string;
  /** "This week: 1.5 of 6.5 h" (or a shorter form when there's no meaningful
   * weekly target right now — see buildWeekLine below) — prebaked. The
   * colon (0.40.0) was missing from this line even though format.ts's own
   * longer prose version of the same fact ("Ready by ... needs ... This
   * week: x of y.") has always had one — an inconsistency noticed while
   * building the progress-bar polish, fixed here rather than left as
   * "close enough". */
  weekLine: string;
  /** Start-of-week (Monday-start, CLAUDE.md's European-default rule) this
   * weekLine describes. The widget hides weekLine once the real device
   * clock has moved past weekStartEpochMs + 7 days — a stale snapshot
   * should stop claiming to describe "this week" once it no longer does. */
  weekStartEpochMs: number;
  stateThresholdDays: number;
  /** Progress polish (0.40.0): the SAME ratio ExamOverview.tsx's weekly bar
   * fills to — `Math.min(100, (thisWeekHours / requiredPaceHoursPerWeek) *
   * 100)` — but floored to a whole int and prebaked here, because
   * RemoteViews.setProgressBar wants a plain int and this file's own
   * ARCHITECTURE RULE keeps every bit of arithmetic on the TS side, never
   * in PruefungWidgetProvider.java. 0 when there's no real weekly target to
   * compare against (requiredPaceHoursPerWeek null or <= 0 — the same
   * condition buildWeekLine's own null branch checks) — an honest empty
   * bar, not a hidden one; see the widget's own "render at zero" rule. */
  weekProgressPercent: number;
  /** True once this week's logged hours have met or passed the required
   * pace — mirrors ExamOverview.tsx's own emerald-vs-sky decision
   * (`thisWeekHours >= projection.requiredPaceHoursPerWeek`) exactly, so
   * this widget's bar colour can never drift out of sync with the live
   * screen's. The native side reads this to pick which of the two
   * pre-coloured ProgressBar views to show (see
   * PruefungWidgetProvider.java) — it makes no colour decision itself. */
  weekAtTarget: boolean;
}

/** The departure widget's data (W2) — mirrors PruefungWidgetData's shape:
 * every string the widget renders verbatim is prebaked here, and the native
 * side (DepartureWidgetProvider.java) only does display plumbing (the
 * expiry check against appointmentEpochMs — see that class's own comment). */
export interface DepartureWidgetData {
  id: string;
  nameLine: string;
  /** "14:30" (today) or "Thu 10 Jul 14:30" (any other day) — via
   * formatDateTimeShort, the same same-day judgment formatAppointmentLine
   * uses for this exact departure elsewhere in the app. */
  appointmentLine: string;
  /** "Leave by 14:10 · start by 13:35" while prep steps remain unchecked;
   * "Leave by 14:10" once every step is checked (there's no more "start by"
   * once there's nothing left to start). leaveBy is computeProjection's
   * appointment-minus-travel line; startBy is computeStartBy's "if you
   * start prep right now with everything ahead of you" line — see both
   * functions' own doc comments in projection.ts for why they're computed
   * differently (leaveBy ignores prep entirely; startBy assumes none of it
   * is done yet, deliberately, even mid-run — this line is a plan, not a
   * live countdown, that's what the Runway screen itself is for). */
  planLine: string;
  /** For the native expiry check: a stale snapshot from a departure whose
   * appointment has since passed must stop rendering it (see
   * DepartureWidgetProvider.java's own comment on the expiry rule). */
  appointmentEpochMs: number;
}

/** The tasks widget's data (anti-rot increment 3, "Runway Tasks", 0.39.0) —
 * every string it renders verbatim is prebaked here, same ARCHITECTURE RULE
 * as PruefungWidgetData/DepartureWidgetData above. Deliberately NOT nullable
 * the way `pruefung`/`departure` are (those are null when there's no exam /
 * nothing upcoming at all — "there is genuinely no widget to show"): a
 * tasks widget with nothing armed is still a meaningful, always-renderable
 * state ("No armed deadlines.", optionally with a counts line), so this is
 * always built, never omitted. */
export interface TaskWidgetData {
  /** The headline task — the soonest-deadline planned/running task (see
   * `selectWidgetTask`), or `null` when none carries a deadline at all.
   * `TaskWidgetProvider.java` renders "No armed deadlines." in the null
   * case, matching the other widgets' calm/muted empty-state treatment. */
  task: {
    id: string;
    /** The task's own name, rendered bold on the native side. */
    nameLine: string;
    /** "due 16:00 · start by 14:30" while `taskStartBy` is still in the
     * future; "due 16:00" once it's already passed — see
     * `buildTaskWidgetData`'s own comment for why the start-by clause is
     * dropped rather than shown false. */
    dueLine: string;
  } | null;
  /** "{N} armed · {M} to arm", prebaked — see `formatTaskCountsLine`'s own
   * doc comment for the exact counting rule and why it's `null` (omit the
   * line entirely) rather than "0 armed · 0 to arm" when there's nothing to
   * report. */
  countsLine: string | null;
}

export interface WidgetSnapshot {
  pruefung: PruefungWidgetData | null;
  departure: DepartureWidgetData | null;
  tasks: TaskWidgetData;
  generatedAtEpochMs: number;
}

/** "This week: 1.5 of 6.5 h" when there's a real weekly rate to compare
 * against; "This week: 1.5 h logged." when there isn't (the exam anchor is
 * today or already past — examProjection's requiredPaceHoursPerWeek is null
 * in exactly that case, same condition formatRequiredPaceLine in format.ts
 * checks for its own, longer, prose version of this line). Deliberately a
 * shorter, standalone line rather than reusing formatRequiredPaceLine
 * directly: that function's copy ("Ready by ... needs ... This week: x of
 * y.") is sized for the app's own actionable-line slot, not a 3-line home
 * screen widget. Colon added (0.40.0, progress-bar polish) to match that
 * same format.ts line's own punctuation — the widget's copy had silently
 * drifted from it. */
function buildWeekLine(loggedThisWeek: number, requiredPaceHoursPerWeek: number | null): string {
  const logged = loggedThisWeek.toFixed(1);
  if (requiredPaceHoursPerWeek === null) return `This week: ${logged} h logged.`;
  return `This week: ${logged} of ${requiredPaceHoursPerWeek.toFixed(1)} h`;
}

/**
 * Widget progress bar (0.40.0): floor(logged/target × 100), clamped to
 * [0, 100] — the same fill ratio ExamOverview.tsx's weekly bar computes,
 * pre-converted to the whole int RemoteViews.setProgressBar needs (see
 * PruefungWidgetData.weekProgressPercent's own doc comment for why that
 * conversion happens here and not in Java). `target` mirrors
 * requiredPaceHoursPerWeek: `null` or non-positive both mean "no real
 * weekly target exists to measure against" (an exam whose anchor has
 * already arrived, same condition buildWeekLine's null branch checks) —
 * reported as 0%, not hidden, per this increment's "render honestly at
 * zero" rule.
 */
export function computeWeekProgressPercent(logged: number, target: number | null): number {
  if (target === null || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((logged / target) * 100)));
}

/**
 * Widget progress bar (0.40.0): true once `logged` has met or passed
 * `target` — mirrors ExamOverview.tsx's own emerald/sky decision exactly
 * (see PruefungWidgetData.weekAtTarget's own doc comment). False whenever
 * there's no real target to be "at" (null or non-positive), same guard
 * computeWeekProgressPercent above uses.
 */
export function computeWeekAtTarget(logged: number, target: number | null): boolean {
  return target !== null && target > 0 && logged >= target;
}

/**
 * Picks the departure the widget should show: the soonest whose status is
 * 'planned' or 'running' and whose appointment hasn't slipped more than
 * PAST_DEPARTURE_THRESHOLD_MS into the past — the exact same "still counts
 * as upcoming" rule Home's own Upcoming/Past split uses (src/screens/
 * Home.tsx), via the shared constant rather than a second copy of the
 * number. Filtering (not just sorting) happens here rather than trusting
 * the caller's query to have already applied it, so this stays correct
 * however `departures` was gathered — src/native/widgets.ts's query mirrors
 * Home's ("same query semantics"), but doesn't itself filter by the
 * threshold, since that filtering is business logic and belongs here with
 * everything else this file computes. */
function selectUpcomingDeparture(now: Date, departures: Departure[]): Departure | null {
  const thresholdMs = now.getTime() - PAST_DEPARTURE_THRESHOLD_MS;
  const eligible = departures.filter(
    (departure) =>
      (departure.status === 'planned' || departure.status === 'running') &&
      new Date(departure.appointmentAt).getTime() >= thresholdMs,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((soonest, departure) =>
    new Date(departure.appointmentAt).getTime() < new Date(soonest.appointmentAt).getTime() ? departure : soonest,
  );
}

/** Builds DepartureWidgetData for the departure selectUpcomingDeparture
 * chose, or null when nothing qualifies (nothing planned/running, or
 * everything that is has already slipped past the threshold). */
function buildDepartureWidgetData(now: Date, departures: Departure[]): DepartureWidgetData | null {
  const departure = selectUpcomingDeparture(now, departures);
  if (!departure) return null;

  const appointmentAt = new Date(departure.appointmentAt);
  // Same equation the live Runway screen recomputes every tick
  // (src/screens/Runway.tsx) — leaveBy doesn't depend on `now` (see
  // projection.ts), so this is a fixed fact about the departure, not
  // something that goes stale between snapshot refreshes the way the
  // Prüfung widget's weekLine can.
  const leaveBy = computeProjection(now, departure).leaveBy;
  const allStepsChecked = departure.steps.every((step) => step.checkedAt !== null);
  const planLine = allStepsChecked
    ? `Leave by ${formatTime(leaveBy)}`
    : `Leave by ${formatTime(leaveBy)} · start by ${formatTime(computeStartBy(departure))}`;

  return {
    id: departure.id,
    nameLine: departure.name,
    appointmentLine: formatDateTimeShort(appointmentAt, now),
    planLine,
    appointmentEpochMs: appointmentAt.getTime(),
  };
}

/**
 * Picks the task the tasks widget should headline: the soonest deadline
 * (ascending sort) among 'planned'/'running' tasks that carry one at all —
 * `null` when no such task exists (nothing armed with a deadline, whether
 * because nothing is armed at all or every armed task is deadline-less).
 *
 * A PAST deadline still wins if it's the soonest one — deliberately, unlike
 * `selectUpcomingDeparture` above, which drops anything more than
 * `PAST_DEPARTURE_THRESHOLD_MS` stale. A departure that's already happened
 * is a fact with nothing left to act on (see DepartureWidgetProvider's own
 * expiry-rule comment); a task whose start-by moment has already blown past
 * is the opposite — it's the single most urgent thing on the board, exactly
 * what this widget exists to surface, so there is no threshold to filter it
 * out with. "Ascending sort by deadline" already produces this for free: an
 * overdue task's deadline is further in the past than any future one, so it
 * sorts first and wins without any separate past/future branch.
 *
 * `now` is accepted (not used) for the same call shape `selectUpcomingDeparture`
 * above has, and because a future revision that DOES want a staleness
 * threshold here (there's no such request today — see this function's own
 * "no threshold" reasoning) would already have the argument in place. Left
 * genuinely unused rather than faked into relevance — `noUnusedParameters`
 * needs the explicit `void now;` below to allow that honestly instead of
 * quietly renaming the parameter to `_now` and losing the self-documenting
 * name at every call site.
 */
export function selectWidgetTask(now: Date, tasks: WorkTask[]): WorkTask | null {
  void now;
  const eligible = tasks.filter(
    (task) => (task.status === 'planned' || task.status === 'running') && task.deadlineAt !== null,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((soonest, task) =>
    new Date(task.deadlineAt as string).getTime() < new Date(soonest.deadlineAt as string).getTime()
      ? task
      : soonest,
  );
}

/**
 * "{N} armed · {M} to arm" — prebaked so `TaskWidgetProvider.java` never
 * formats a number itself (this file's own ARCHITECTURE RULE). `null` when
 * both counts are zero (nothing armed, nothing captured either) — an empty
 * board has nothing to report on this line, same "nothing to show, don't
 * render a hollow sentence" reasoning the other two widgets' blank-line
 * fallbacks already use.
 *
 * Counting rule, spelled out because it's easy to misread: `armedCount` is
 * the TOTAL count of 'planned'/'running' tasks — when `selectWidgetTask`
 * above finds a headline task, that task IS one of the N being counted
 * here, not excluded from it. "3 armed" under a shown headline task means
 * "3 total, including the one above", never "3 more besides this one" — so
 * the number always matches a plain count of Home's own upcoming-tasks
 * list, with no off-by-one against what he'd see there.
 */
export function formatTaskCountsLine(armedCount: number, toArmCount: number): string | null {
  if (armedCount === 0 && toArmCount === 0) return null;
  return `${armedCount} armed · ${toArmCount} to arm`;
}

/** Builds TaskWidgetData for the given task pool — always returns a value
 * (see TaskWidgetData's own doc comment for why this, unlike
 * pruefung/departure, is never itself null). */
function buildTaskWidgetData(now: Date, tasks: WorkTask[]): TaskWidgetData {
  const armedCount = tasks.filter((task) => task.status === 'planned' || task.status === 'running').length;
  const toArmCount = tasks.filter((task) => task.status === 'captured').length;
  const countsLine = formatTaskCountsLine(armedCount, toArmCount);

  const headline = selectWidgetTask(now, tasks);
  if (!headline) return { task: null, countsLine };

  // headline.deadlineAt is guaranteed non-null by selectWidgetTask's own
  // filter — `as string` reflects that guarantee rather than re-checking it
  // needlessly (mirrors the `as string` just above in selectWidgetTask's
  // own sort).
  const deadline = new Date(headline.deadlineAt as string);
  const startBy = taskStartBy(headline);
  // taskStartBy only returns null when deadlineAt is null, which can't be
  // true here — the `!== null` check below is defensive typing, not a real
  // branch this data can reach, same "guarded anyway" caution
  // TaskRun.tsx's own handleReopen uses for an equivalently-impossible case.
  const dueLine =
    startBy !== null && startBy.getTime() > now.getTime()
      ? `due ${formatTime(deadline)} · start by ${formatTime(startBy)}`
      : `due ${formatTime(deadline)}`;

  return {
    task: { id: headline.id, nameLine: headline.name, dueLine },
    countsLine,
  };
}

/**
 * Builds the widget snapshot from data already loaded from Dexie (the
 * caller, src/native/widgets.ts, is the only place that touches Dexie for
 * this — this function stays pure and testable without a database).
 *
 * `departures` is every departure the caller could find with status
 * 'planned' or 'running' (src/native/widgets.ts mirrors Home's own Upcoming
 * query) — selectUpcomingDeparture above does the "which one, if any" work.
 *
 * `tasks` (anti-rot increment 3, 0.39.0) is every task the caller could find
 * with status 'planned', 'running', or 'captured' — the three statuses
 * `buildTaskWidgetData` above actually reads (armedCount/selectWidgetTask
 * from the first two, toArmCount from the third); 'done'/'abandoned' tasks
 * carry nothing this widget shows, so src/native/widgets.ts's query already
 * excludes them rather than filtering here.
 */
export function buildWidgetSnapshot(
  now: Date,
  exam: Exam | undefined,
  topics: Topic[],
  sprints: Sprint[],
  departures: Departure[],
  tasks: WorkTask[],
): WidgetSnapshot {
  const departureData = buildDepartureWidgetData(now, departures);
  const taskData = buildTaskWidgetData(now, tasks);

  if (!exam) {
    return { pruefung: null, departure: departureData, tasks: taskData, generatedAtEpochMs: now.getTime() };
  }

  const projection = examProjection(now, exam, topics, sprints);
  const loggedThisWeek = hoursThisWeek(now, sprints);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  const emptyExam = projection.state === 'empty';
  // 'empty' is a distinct flag, not a flavour of "never ready" — see
  // PruefungWidgetData.emptyExam's doc comment. neverReady stays false for
  // it so the native side's two branches (empty vs. genuinely-never) can't
  // be conflated even though both leave readyDate/readyDayEpochMs unset.
  const neverReady = !emptyExam && projection.readyDate === null;
  // 0 in both the neverReady and emptyExam branches is a placeholder, not a
  // real answer — see PruefungWidgetData.readyDayEpochMs's doc comment: the
  // native side must check emptyExam, then neverReady, before ever reading
  // this field.
  const readyDayEpochMs = projection.readyDate === null ? 0 : localMidnight(projection.readyDate).getTime();

  return {
    pruefung: {
      readyDayEpochMs,
      generatedDayEpochMs: localMidnight(now).getTime(),
      neverReady,
      emptyExam,
      anchorEpochMs: projection.anchor.getTime(),
      anchorLabel: formatExamAnchorLine(exam),
      weekLine: buildWeekLine(loggedThisWeek, projection.requiredPaceHoursPerWeek),
      weekStartEpochMs: weekStart.getTime(),
      stateThresholdDays: PRUEFUNG_STATE_THRESHOLD_DAYS,
      weekProgressPercent: computeWeekProgressPercent(loggedThisWeek, projection.requiredPaceHoursPerWeek),
      weekAtTarget: computeWeekAtTarget(loggedThisWeek, projection.requiredPaceHoursPerWeek),
    },
    departure: departureData,
    tasks: taskData,
    generatedAtEpochMs: now.getTime(),
  };
}
