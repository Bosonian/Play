import type { Departure, Exam, WorkTask } from '../db/types';
import { computeProjection } from './projection';
import { HORIZON_DAYS, occurrenceDates } from './recurrence';

/** What the day gauge notification is currently counting down to. `label`
 * is the plain-language name of the commitment ("Leave for Klinik",
 * "Befunden EEG due", "Study block") — src/lib/dayGaugeRefresh.ts wraps this
 * into the notification's full "Next: {label} · {HH:mm}" title; this module
 * stays free of that formatting so it can be tested purely on which
 * candidate wins, not on string shape. */
export interface NextCommitment {
  label: string;
  at: Date;
}

/**
 * Picks the single soonest FUTURE commitment across every kind of thing
 * Runway tracks — the day gauge's whole reason to exist: Deepak's unscaffolded
 * gaps ("just five minutes" becoming forty) happen between commitments of
 * ANY kind, not just departures, so the gauge has to look across all three
 * candidate pools below rather than reusing the departure-only "next
 * upcoming" the widget snapshot picks (src/lib/widgetSnapshot.ts's
 * selectUpcomingDeparture).
 *
 * Candidate pools, each contributing at most one candidate:
 *
 *   - Departures (`status` 'planned' or 'running'): `computeProjection`'s
 *     `leaveBy` — reused verbatim, NOT re-derived, so the gauge's countdown
 *     always agrees with what the live Runway screen and the departure
 *     widget already call "leave by" for the same departure (see
 *     projection.ts's own doc comment for why leaveBy is what it is).
 *     Label: "Leave for {name}".
 *   - Tasks (`status` 'planned' or 'running', `deadlineAt` set): the
 *     deadline itself. Label: "{name} due". A task with no deadline
 *     ("befund these when you get to them" — taskProjection.ts's own
 *     comment) contributes nothing; there's no instant to count down to.
 *   - The exam's study schedule, if one exists: `occurrenceDates` (reused
 *     verbatim from recurrence.ts, the same function notifications.ts's
 *     scheduleStudyBlockAlarms and materialize.ts's
 *     materializeStudyBlockAlarms already build real alarms from) already
 *     returns only FUTURE occurrences within HORIZON_DAYS, so the first
 *     entry is exactly "the next study block, if any". Label: "Study block".
 *
 * Each pool is filtered to strictly future instants (`at.getTime() >
 * now.getTime()`) before comparison — a departure whose leaveBy has already
 * passed (Deepak is running late, or the departure just hasn't been
 * re-anchored yet) must not win against a genuinely future task deadline
 * just because it sorts "soonest" by raw instant.
 *
 * Returns `null` when no pool has a future candidate — no departures, no
 * deadlined tasks, no study schedule (or none of them land in the future) —
 * which `dayGaugeRefresh.ts` reads as "hide the gauge, there's nothing to
 * count down to."
 */
export function nextCommitment(
  now: Date,
  departures: Departure[],
  tasks: WorkTask[],
  exam: Exam | undefined,
): NextCommitment | null {
  const nowMs = now.getTime();
  const candidates: NextCommitment[] = [];

  for (const departure of departures) {
    if (departure.status !== 'planned' && departure.status !== 'running') continue;
    const leaveBy = computeProjection(now, departure).leaveBy;
    if (leaveBy.getTime() > nowMs) {
      candidates.push({ label: `Leave for ${departure.name}`, at: leaveBy });
    }
  }

  for (const task of tasks) {
    if (task.status !== 'planned' && task.status !== 'running') continue;
    if (task.deadlineAt == null) continue;
    const deadline = new Date(task.deadlineAt);
    if (deadline.getTime() > nowMs) {
      candidates.push({ label: `${task.name} due`, at: deadline });
    }
  }

  if (exam && exam.studySchedule != null) {
    const [nextOccurrence] = occurrenceDates(now, exam.studySchedule, HORIZON_DAYS);
    if (nextOccurrence) {
      candidates.push({ label: 'Study block', at: nextOccurrence.at });
    }
  }

  if (candidates.length === 0) return null;

  return candidates.reduce((soonest, candidate) => (candidate.at.getTime() < soonest.at.getTime() ? candidate : soonest));
}
