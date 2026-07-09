import type { Departure } from '../db/types';

/** Stable position in the four-stage sequence (RUNWAY_PLAN.md §5.5). Used as
 * part of the deterministic notification id in src/native/notifications.ts,
 * so renumbering these would change which slot a given scheduled alarm maps
 * to — treat this ordering as fixed. */
export type AlarmSlot = 0 | 1 | 2 | 3;

export interface AlarmTime {
  slot: AlarmSlot;
  at: Date;
  /** The copy string for this stage, without the departure name appended —
   * the caller (src/native/notifications.ts) appends `departure.name`. */
  copy: string;
}

const SLOT_COPY: Record<AlarmSlot, string> = {
  0: 'Start getting ready.',
  1: 'Wrap up. Buffer time begins.',
  2: 'Leave in 5 minutes.',
  3: 'Leave now.',
};

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * The four staged alarm times for a departure (RUNWAY_PLAN.md §5.5):
 *
 *   startBy   ("Start getting ready.")        = appointment − travel − buffer − total planned prep
 *   wrapUp    ("Wrap up. Buffer time begins.") = appointment − travel − buffer   (== leaveBy − buffer)
 *   leaveSoon ("Leave in 5 minutes.")          = leaveBy − 5 min
 *   leaveNow  ("Leave now.")                   = appointment − travel            (== leaveBy)
 *
 * `total planned prep` is the sum of every step's plannedMinutes, not just
 * unchecked ones — these are scheduled once, at save time, before any step
 * exists to check off, so (unlike the live Runway screen's projection) there
 * is no "remaining prep" notion here.
 *
 * Deliberately pure — no Dexie access, no internal `Date.now()` — so `now`
 * is an explicit argument and this is trivial to unit test. The caller
 * (src/native/notifications.ts) is responsible for turning the *future*
 * entries this returns into scheduled native notifications; alarms already
 * in the past at scheduling time are filtered out here because Android
 * fires a past-scheduled exact alarm immediately, which would mean opening
 * DepartureSetup on a departure whose "start getting ready" time already
 * passed makes the phone buzz right away — surprising, not useful.
 *
 * Ordering (startBy <= wrapUp <= leaveSoon <= leaveNow) holds only when
 * bufferMinutes >= 5 — leaveSoon is pinned to a fixed "leaveNow − 5" offset
 * regardless of the buffer, so a smaller buffer pulls wrapUp (leaveNow −
 * bufferMinutes) later than leaveSoon. In that case "Wrap up." fires
 * *after* "Leave in 5 minutes." — a copy-order oddity, not a missed alarm:
 * both notifications are still scheduled and still fire, just not in the
 * order their labels would suggest. See alarmTimes.test.ts for a pinned
 * example of this case.
 *
 * Not enforced by dedup either way — a degenerate case (near-zero prep and
 * buffer) can produce coincident times, and that's fine: scheduling two
 * notifications for the same instant is harmless, and silently merging them
 * would hide a case worth the user noticing (their prep plan has collapsed
 * to nothing).
 */
export function computeAlarmTimes(
  now: Date,
  departure: Pick<Departure, 'appointmentAt' | 'travelMinutes' | 'bufferMinutes' | 'steps'>,
): AlarmTime[] {
  const appointmentAt = new Date(departure.appointmentAt);
  const totalPrepMinutes = departure.steps.reduce((sum, step) => sum + step.plannedMinutes, 0);

  const leaveNow = addMinutes(appointmentAt, -departure.travelMinutes);
  const wrapUp = addMinutes(leaveNow, -departure.bufferMinutes);
  const startBy = addMinutes(wrapUp, -totalPrepMinutes);
  const leaveSoon = addMinutes(leaveNow, -5);

  const all: AlarmTime[] = [
    { slot: 0, at: startBy, copy: SLOT_COPY[0] },
    { slot: 1, at: wrapUp, copy: SLOT_COPY[1] },
    { slot: 2, at: leaveSoon, copy: SLOT_COPY[2] },
    { slot: 3, at: leaveNow, copy: SLOT_COPY[3] },
  ];

  return all.filter((alarm) => alarm.at.getTime() > now.getTime());
}
