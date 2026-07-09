import { startOfWeek } from 'date-fns';
import type { Departure, Exam, Sprint, Topic } from '../db/types';
import { examProjection, hoursThisWeek } from './examProjection';
import { formatDateTimeShort, formatExamAnchorLine, formatTime } from './format';
import { PAST_DEPARTURE_THRESHOLD_MS } from './departureThreshold';
import { computeProjection, computeStartBy } from './projection';

// Widgets increment (Runway 0.10.0 W1, 0.11.0 W2): the JSON shape written to
// Android SharedPreferences and read by the two native widgets
// (android/app/src/main/java/de/bosonian/runway/PruefungWidgetProvider.java
// and DepartureWidgetProvider.java).
//
// ARCHITECTURE RULE: this file is where every number either widget shows
// gets computed. The native side may only do two things with numbers from
// here — add offsetDays to "today", and diff two dates/epoch millis — both a
// 1:1 mirror of a time slide, never a re-derivation of examProjection's or
// projection.ts's math. Every string either widget renders verbatim
// (anchorLabel, weekLine, nameLine, appointmentLine, planLine) is built here
// too, so a copy change never needs a matching native change.

/** Same tight/late threshold the app's own STATE_TEXT (ExamOverview.tsx)
 * switches colour at — passed through in the snapshot rather than hardcoded
 * again on the native side, so the widget's colour bands can't drift out of
 * sync with the app's own definition of "tight" by editing only one of the
 * two places that would otherwise both need to agree on it. */
const PRUEFUNG_STATE_THRESHOLD_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PruefungWidgetData {
  /** ceil((readyDate − now) in days) — the widget renders "Ready by
   * {today + offsetDays}". Meaningless (and left at 0) when `neverReady` is
   * true; the widget must check `neverReady` first. */
  offsetDays: number;
  /** Mirrors examProjection's readyDate === null (zero measured pace, or an
   * overflowed projection) — the widget shows "Ready: never at current
   * pace" instead of a date. */
  neverReady: boolean;
  anchorEpochMs: number;
  /** "Exam window opens 1 Nov 2026" / "Exam 1 Nov 2026" — prebaked via
   * formatExamAnchorLine so the widget never needs its own date-formatting
   * rules. */
  anchorLabel: string;
  /** "This week 1.5 of 6.5 h" (or a shorter form when there's no meaningful
   * weekly target right now — see buildWeekLine below) — prebaked. */
  weekLine: string;
  /** Start-of-week (Monday-start, CLAUDE.md's European-default rule) this
   * weekLine describes. The widget hides weekLine once the real device
   * clock has moved past weekStartEpochMs + 7 days — a stale snapshot
   * should stop claiming to describe "this week" once it no longer does. */
  weekStartEpochMs: number;
  stateThresholdDays: number;
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

export interface WidgetSnapshot {
  pruefung: PruefungWidgetData | null;
  departure: DepartureWidgetData | null;
  generatedAtEpochMs: number;
}

/** "This week 1.5 of 6.5 h" when there's a real weekly rate to compare
 * against; "This week 1.5 h logged." when there isn't (the exam anchor is
 * today or already past — examProjection's requiredPaceHoursPerWeek is null
 * in exactly that case, same condition formatRequiredPaceLine in format.ts
 * checks for its own, longer, prose version of this line). Deliberately a
 * shorter, standalone line rather than reusing formatRequiredPaceLine
 * directly: that function's copy ("Ready by ... needs ... This week: x of
 * y.") is sized for the app's own actionable-line slot, not a 3-line home
 * screen widget. */
function buildWeekLine(loggedThisWeek: number, requiredPaceHoursPerWeek: number | null): string {
  const logged = loggedThisWeek.toFixed(1);
  if (requiredPaceHoursPerWeek === null) return `This week ${logged} h logged.`;
  return `This week ${logged} of ${requiredPaceHoursPerWeek.toFixed(1)} h`;
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
 * Builds the widget snapshot from data already loaded from Dexie (the
 * caller, src/native/widgets.ts, is the only place that touches Dexie for
 * this — this function stays pure and testable without a database).
 *
 * `departures` is every departure the caller could find with status
 * 'planned' or 'running' (src/native/widgets.ts mirrors Home's own Upcoming
 * query) — selectUpcomingDeparture above does the "which one, if any" work.
 */
export function buildWidgetSnapshot(
  now: Date,
  exam: Exam | undefined,
  topics: Topic[],
  sprints: Sprint[],
  departures: Departure[],
): WidgetSnapshot {
  const departureData = buildDepartureWidgetData(now, departures);

  if (!exam) {
    return { pruefung: null, departure: departureData, generatedAtEpochMs: now.getTime() };
  }

  const projection = examProjection(now, exam, topics, sprints);
  const loggedThisWeek = hoursThisWeek(now, sprints);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  const neverReady = projection.readyDate === null;
  // Math.ceil, per the increment spec — a readyDate a few hours from now
  // still reads as "1 day away" on the widget's whole-day display, the same
  // direction the app's own live screens round overdue/remaining figures.
  // 0 in the neverReady branch is a placeholder, not a real answer — see
  // PruefungWidgetData.offsetDays's doc comment: the native side must check
  // neverReady before ever reading this field.
  const offsetDays =
    projection.readyDate === null ? 0 : Math.ceil((projection.readyDate.getTime() - now.getTime()) / MS_PER_DAY);

  return {
    pruefung: {
      offsetDays,
      neverReady,
      anchorEpochMs: projection.anchor.getTime(),
      anchorLabel: formatExamAnchorLine(exam),
      weekLine: buildWeekLine(loggedThisWeek, projection.requiredPaceHoursPerWeek),
      weekStartEpochMs: weekStart.getTime(),
      stateThresholdDays: PRUEFUNG_STATE_THRESHOLD_DAYS,
    },
    departure: departureData,
    generatedAtEpochMs: now.getTime(),
  };
}
