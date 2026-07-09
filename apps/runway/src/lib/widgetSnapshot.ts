import { startOfWeek } from 'date-fns';
import type { Departure, Exam, Sprint, Topic } from '../db/types';
import { examProjection, hoursThisWeek } from './examProjection';
import { formatExamAnchorLine } from './format';

// Widgets increment (Runway 0.10.0): the JSON shape written to Android
// SharedPreferences and read by the native Prüfung widget
// (android/app/src/main/java/de/bosonian/runway/PruefungWidgetProvider.java).
//
// ARCHITECTURE RULE: this file is where every number the widget shows gets
// computed. The native side may only do two things with numbers from here —
// add offsetDays to "today", and diff two dates in days — both a 1:1 mirror
// of a time slide, never a re-derivation of examProjection's pace/remaining-
// hours math. Every string the widget renders verbatim (anchorLabel,
// weekLine) is built here too, so a copy change never needs a matching
// native change.

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

export interface WidgetSnapshot {
  pruefung: PruefungWidgetData | null;
  /** Always null in this increment (widgets W1) — departure mode's widget
   * data lands in W2. Included now, rather than added later, so the JSON
   * shape on disk never has to migrate: an old native reader and a newer
   * snapshot (or vice versa) can always find this key, even if its value
   * is still null. */
  departure: null;
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
 * Builds the widget snapshot from data already loaded from Dexie (the
 * caller, src/native/widgets.ts, is the only place that touches Dexie for
 * this — this function stays pure and testable without a database).
 *
 * `upcomingDeparture` is accepted now, ahead of departure mode's widget
 * landing in W2, so this signature doesn't have to change shape twice —
 * unused (and therefore prefixed `_`) until that increment reads it.
 */
export function buildWidgetSnapshot(
  now: Date,
  exam: Exam | undefined,
  topics: Topic[],
  sprints: Sprint[],
  _upcomingDeparture: Departure | null | undefined,
): WidgetSnapshot {
  if (!exam) {
    return { pruefung: null, departure: null, generatedAtEpochMs: now.getTime() };
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
    departure: null,
    generatedAtEpochMs: now.getTime(),
  };
}
