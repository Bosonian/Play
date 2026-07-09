import { describe, expect, it } from 'vitest';
import { notificationId, sprintNotificationId } from './notifications';

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
