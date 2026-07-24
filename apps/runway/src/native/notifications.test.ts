import { describe, expect, it } from 'vitest';
import {
  milestoneNotificationId,
  notificationId,
  sprintNotificationId,
  studyBlockNotificationId,
  studyBlockNotificationIds,
} from './notifications';
import { calendarDates, occurrenceDates } from '../lib/recurrence';
import type { TemplateSchedule } from '../db/types';

// Android LocalNotifications ids are signed 32-bit ints
// (Integer.MIN_VALUE..Integer.MAX_VALUE). This app only ever produces
// non-negative ids, so the only bound that actually matters in practice is
// the upper one.
const INT32_MAX = 2147483647; // 2^31 - 1

describe('notificationId', () => {
  it('never exceeds the documented worst case (0x1fffffff * 4 + 3)', () => {
    // The four departure slots for the same id, at the theoretical maximum
    // base value, must still fit inside a signed 32-bit int.
    const worstCase = 0x1fffffff * 4 + 3;
    expect(worstCase).toBe(INT32_MAX);
    for (let slot = 0; slot < 4; slot++) {
      expect(notificationId('any-id', slot)).toBeLessThanOrEqual(INT32_MAX);
      expect(notificationId('any-id', slot)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic for the same (id, slot) pair', () => {
    expect(notificationId('departure-1', 2)).toBe(notificationId('departure-1', 2));
  });
});

describe('sprintNotificationId', () => {
  // The collision-space assertion this increment's spec calls for: sprints
  // deliberately do NOT get a disjoint numeric range (see the doc comment
  // on sprintNotificationId in notifications.ts for why widening SLOT_COUNT
  // would break cancellation of already-scheduled departure alarms). This
  // test documents and locks in that decision, rather than silently
  // depending on it: a sprint's id is exactly notificationId(id, slot 0),
  // the same formula and the same value range departures already use.
  it('reuses notificationId(id, 0) exactly - same formula, same range as departure slot 0', () => {
    const sprintId = 'sprint-1';
    expect(sprintNotificationId(sprintId)).toBe(notificationId(sprintId, 0));
  });

  it('stays within the signed-32-bit range every departure id already relies on', () => {
    const ids = ['sprint-a', 'sprint-b', crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids) {
      const computed = sprintNotificationId(id);
      expect(computed).toBeGreaterThanOrEqual(0);
      expect(computed).toBeLessThanOrEqual(INT32_MAX);
    }
  });

  it('is deterministic, so cancelSprintEndAlarm can recompute the same id on a fresh launch', () => {
    const sprintId = crypto.randomUUID();
    expect(sprintNotificationId(sprintId)).toBe(sprintNotificationId(sprintId));
  });
});

describe('milestoneNotificationId', () => {
  // Same reuse rationale as sprintNotificationId's own test above, restated
  // for milestones: notificationId(id, 0), no disjoint range.
  it('reuses notificationId(id, 0) exactly - same formula, same range as sprints and departure slot 0', () => {
    const milestoneId = 'milestone-1';
    expect(milestoneNotificationId(milestoneId)).toBe(notificationId(milestoneId, 0));
  });

  it('stays within the signed-32-bit range every departure id already relies on', () => {
    const ids = ['milestone-a', 'milestone-b', crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids) {
      const computed = milestoneNotificationId(id);
      expect(computed).toBeGreaterThanOrEqual(0);
      expect(computed).toBeLessThanOrEqual(INT32_MAX);
    }
  });

  it('is deterministic, so cancelMilestoneAlarm can recompute the same id on a fresh launch', () => {
    const milestoneId = crypto.randomUUID();
    expect(milestoneNotificationId(milestoneId)).toBe(milestoneNotificationId(milestoneId));
  });
});

// Prüfung rework 2 (armed study blocks).
describe('studyBlockNotificationId', () => {
  it('is deterministic for the same (examId, date) pair — required so cancelStudyBlockAlarms can recompute it on a fresh launch', () => {
    const examId = crypto.randomUUID();
    expect(studyBlockNotificationId(examId, '2026-07-14')).toBe(studyBlockNotificationId(examId, '2026-07-14'));
  });

  it('differs by date for the same exam — one alarm id per occurrence, not one shared id for the whole schedule', () => {
    const examId = 'exam-1';
    expect(studyBlockNotificationId(examId, '2026-07-14')).not.toBe(studyBlockNotificationId(examId, '2026-07-15'));
  });

  it('differs by exam for the same date — two exams (however unlikely in v1) never fight over the same id', () => {
    const date = '2026-07-14';
    expect(studyBlockNotificationId('exam-a', date)).not.toBe(studyBlockNotificationId('exam-b', date));
  });

  it('stays within the signed-32-bit range every other notification id in this file already relies on', () => {
    const INT32_MAX = 2147483647;
    const id = studyBlockNotificationId(crypto.randomUUID(), '2026-12-25');
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThanOrEqual(INT32_MAX);
  });
});

describe('studyBlockNotificationIds', () => {
  it('maps each date through studyBlockNotificationId, in order', () => {
    const examId = 'exam-1';
    const dates = ['2026-07-14', '2026-07-16', '2026-07-21'];
    expect(studyBlockNotificationIds(examId, dates)).toEqual(dates.map((date) => studyBlockNotificationId(examId, date)));
  });

  it("cancelStudyBlockAlarms's 14-day date window covers every id scheduleStudyBlockAlarms's 7-day occurrenceDates call could have minted", () => {
    // The binding design constraint from notifications.ts's own
    // STUDY_BLOCK_CANCEL_WINDOW_DAYS comment: the cancel window must be wide
    // enough that a schedule edit (a day removed, or the whole schedule
    // turned off) can never leave an orphaned alarm the next cancel pass
    // fails to reach. Checked here as a property over a handful of
    // "now" instants and every possible day-of-week schedule, rather than
    // one hand-picked example, since the whole point of the 14-day margin is
    // that it holds regardless of which day `now` happens to be.
    const examId = 'exam-1';
    const dailySchedule: TemplateSchedule = { time: '19:00', days: [1, 2, 3, 4, 5, 6, 7] };
    const nowInstants = [
      new Date(2026, 6, 9, 8, 0, 0), // Thursday
      new Date(2026, 6, 12, 23, 0, 0), // Sunday, late
      new Date(2026, 9, 21, 7, 0, 0), // the DST-week Wednesday recurrence.test.ts also uses
    ];

    for (const now of nowInstants) {
      const scheduledDates = occurrenceDates(now, dailySchedule, 7).map((occurrence) => occurrence.date);
      const cancelWindowIds = new Set(studyBlockNotificationIds(examId, calendarDates(now, 14)));
      for (const date of scheduledDates) {
        expect(cancelWindowIds.has(studyBlockNotificationId(examId, date))).toBe(true);
      }
    }
  });
});
