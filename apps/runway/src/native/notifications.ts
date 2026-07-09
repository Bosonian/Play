import { Capacitor } from '@capacitor/core';
import type { ActionPerformed, Channel, ScheduleOptions } from '@capacitor/local-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Departure, Sprint } from '../db/types';
import { computeAlarmTimes } from '../lib/alarmTimes';

// The ONLY file in this app that imports @capacitor/local-notifications
// (increment-4 spec) — every screen goes through the functions exported
// here, so the plugin's real API surface only has one place to change if it
// moves under us on a future upgrade. Every export below is safe to call on
// a plain web build: it either no-ops or falls through to the plugin's own
// (harmless, in-memory) web implementation, gated by
// Capacitor.isNativePlatform() so dev mode never touches native code paths.

const STAGED_CHANNEL_ID = 'runway-staged';
const LEAVE_CHANNEL_ID = 'runway-leave';
const SLOT_COUNT = 4;
const MS_PER_MINUTE = 60_000;

let channelsReady = false;

/**
 * Creates the two notification channels Android needs before it will show
 * anything on a per-channel importance/sound. Idempotent per JS session via
 * `channelsReady` — Android channel settings are sticky after first
 * creation anyway (the user can retune sound/vibration in system settings
 * afterwards; re-creating with the same id does not reset that), so there's
 * nothing to gain from calling this more than once per launch.
 */
async function ensureChannels(): Promise<void> {
  if (!Capacitor.isNativePlatform() || channelsReady) return;
  channelsReady = true;

  const staged: Channel = {
    id: STAGED_CHANNEL_ID,
    name: 'Getting ready',
    description: 'Getting-ready stages',
    importance: 3, // IMPORTANCE_DEFAULT
  };
  const leave: Channel = {
    id: LEAVE_CHANNEL_ID,
    name: 'Leave now',
    description: 'Leave now',
    importance: 4, // IMPORTANCE_HIGH — heads-up banner + sound
    vibration: true,
  };
  await Promise.all([LocalNotifications.createChannel(staged), LocalNotifications.createChannel(leave)]);
}

/**
 * Requests the Android 13+ runtime POST_NOTIFICATIONS permission (via the
 * plugin's checkPermissions/requestPermissions — there is no separate
 * "post notifications" method; this single `display` permission covers it).
 * Resolves to `true` immediately on web/dev. Call lazily — the first time a
 * departure is saved, never at app launch — per CLAUDE.md's "no permission
 * ambush on first open".
 */
export async function ensurePermissions(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  await ensureChannels();

  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'granted') return true;

  const requested = await LocalNotifications.requestPermissions();
  return requested.display === 'granted';
}

/**
 * Whether Runway currently has permission to post notifications at all —
 * distinct from `ensurePermissions()`, which *requests* permission (and
 * therefore surfaces the Android system dialog); this only *reads* the
 * current state, so it's safe to call from a passive Home-screen banner
 * check without accidentally re-prompting the user. 'granted' on web/dev,
 * same reasoning as `getExactAlarmStatus` below — there's no such
 * permission to check outside native, and a banner should never appear
 * there.
 */
export async function getNotificationPermissionStatus(): Promise<'granted' | 'denied'> {
  if (!Capacitor.isNativePlatform()) return 'granted';
  const current = await LocalNotifications.checkPermissions();
  return current.display === 'granted' ? 'granted' : 'denied';
}

/**
 * djb2 string hash folded to an unsigned 32-bit int. Used only to turn a
 * departure's UUID into a deterministic number — this is not a
 * cryptographic hash, collisions are theoretically possible, and that's an
 * acceptable tradeoff here (a collision would at worst cancel/overwrite
 * another departure's alarm at the same slot, not corrupt data).
 */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0; // coerce to unsigned 32-bit
}

/**
 * Deterministic notification id for a (departureId, slot) pair — needed so
 * cancelDepartureAlarms() can recompute the same four ids on a fresh app
 * launch without having the original ScheduleResult around (Dexie only
 * stores the Departure, not which notification ids were scheduled for it).
 *
 * Android notification ids are signed 32-bit ints. Folding the hash into 29
 * bits (`% 0x1fffffff`, i.e. mod 2^29 - 1) before `* SLOT_COUNT(4) + slot`
 * keeps the result inside the positive 31-bit range — worst case
 * 0x1fffffff * 4 + 3 = 2147483647 = 2^31 - 1 — with no overlap between the
 * four slots of the same departure.
 */
export function notificationId(departureId: string, slot: number): number {
  const base = hashString(departureId) % 0x1fffffff;
  return base * SLOT_COUNT + slot;
}

function allSlotIds(departureId: string): number[] {
  return [0, 1, 2, 3].map((slot) => notificationId(departureId, slot));
}

/**
 * Deterministic notification id for a sprint's single end-of-sprint alarm.
 *
 * A sprint only ever gets one alarm (not four staged ones like a
 * departure), so there's no real slot to assign — but the id still has to
 * live somewhere that can't collide with `notificationId`'s departure ids.
 * The tempting-looking fix is a disjoint numeric range (e.g. widen
 * SLOT_COUNT, or shift sprint ids into the top half of the 31-bit space).
 * Both are wrong: SLOT_COUNT must stay 4, because changing it would change
 * what `notificationId(someExistingDepartureId, slot)` computes for every
 * departure already on a user's device, and cancelDepartureAlarms() has no
 * record of *what was actually scheduled* — only the ability to recompute
 * the same ids again. Silently recomputing different ids means an old
 * alarm can never be found and cancelled again.
 *
 * The actual fix: don't build a new range at all. Reuse
 * `notificationId(sprintId, 0)` as-is. This is safe because a departure id
 * and a sprint id are both `crypto.randomUUID()` values drawn from two
 * different tables that this app never compares to each other — so a hash
 * collision between "some departure's slot-0 startBy alarm" and "some
 * sprint's end alarm" is exactly the same already-documented,
 * theoretically-possible-but-accepted collision class `hashString()`
 * above already lives with (worst case: one alert silently overwrites or
 * cancels the other at that id, not data corruption). See
 * notifications.test.ts for the bit-width assertion this relies on.
 */
export function sprintNotificationId(sprintId: string): number {
  return notificationId(sprintId, 0);
}

/**
 * Cancels any of the four staged alarms currently pending for a departure.
 * Safe to call unconditionally — cancel() silently ignores ids that aren't
 * pending (never scheduled, already fired, or already cancelled), which is
 * exactly what "terminal status cancels alarms" and "reschedule on edit"
 * both need without first checking what's actually pending.
 */
export async function cancelDepartureAlarms(departureId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({
    notifications: allSlotIds(departureId).map((id) => ({ id })),
  });
}

/**
 * Cancels any existing alarms for this departure, then schedules whichever
 * of the four staged times (src/lib/alarmTimes.ts) are still in the future.
 * `leaveNow` (slot 3) goes to the high-importance 'runway-leave' channel;
 * the other three go to the gentler 'runway-staged' channel.
 *
 * `allowWhileIdle: true` is what makes these fire through Doze with the app
 * closed (RUNWAY_PLAN.md §5.5) — Android still rate-limits idle alarms to
 * roughly once per 9 minutes per app, which is a non-issue here since the
 * four slots are always spaced further apart than that in any real
 * departure plan.
 */
export async function scheduleDepartureAlarms(departure: Departure): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await ensureChannels();
  await cancelDepartureAlarms(departure.id);

  const alarms = computeAlarmTimes(new Date(), departure);
  if (alarms.length === 0) return;

  const options: ScheduleOptions = {
    notifications: alarms.map((alarm) => ({
      id: notificationId(departure.id, alarm.slot),
      title: 'Runway',
      body: `${alarm.copy} ${departure.name}`,
      channelId: alarm.slot === 3 ? LEAVE_CHANNEL_ID : STAGED_CHANNEL_ID,
      schedule: { at: alarm.at, allowWhileIdle: true },
      extra: { departureId: departure.id },
    })),
  };
  await LocalNotifications.schedule(options);
}

/**
 * Schedules the single alarm for a sprint's planned end, on the same
 * high-importance 'runway-leave' channel a departure's "leave now" alert
 * uses — a sprint's timer going off is a real event (RUNWAY_PRUFUNG_PLAN.md
 * §5: "a timer ringing is real, not simulated"), not a softer nudge.
 *
 * Scheduled once, at sprint start, for startedAt + plannedMinutes. Reaching
 * that instant does NOT end the sprint (Sprint.tsx keeps the countdown
 * running past zero, into overrun) — this alarm is purely informational,
 * telling Deepak the box of time is up, not stopping anything itself.
 *
 * No-ops if that instant has already passed — scheduling a notification for
 * a moment already behind us isn't meaningful, and there's no legitimate
 * caller of this that would ever need it (it's only ever invoked once, at
 * sprint creation, with a startedAt of "now").
 */
export async function scheduleSprintEndAlarm(sprint: Sprint, topicName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await ensureChannels();

  const endAt = new Date(new Date(sprint.startedAt).getTime() + sprint.plannedMinutes * MS_PER_MINUTE);
  if (endAt.getTime() <= Date.now()) return;

  await LocalNotifications.schedule({
    notifications: [
      {
        id: sprintNotificationId(sprint.id),
        title: 'Runway',
        body: `Sprint complete. ${topicName}`,
        channelId: LEAVE_CHANNEL_ID,
        schedule: { at: endAt, allowWhileIdle: true },
        extra: { sprintId: sprint.id },
      },
    ],
  });
}

/**
 * Cancels a sprint's end alarm, if one is still pending — same "safe to
 * call unconditionally" reasoning as cancelDepartureAlarms: cancel()
 * silently ignores an id that was never scheduled, already fired, or
 * already cancelled.
 */
export async function cancelSprintEndAlarm(sprintId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: [{ id: sprintNotificationId(sprintId) }] });
}

/**
 * Whether Android's per-app "use exact alarms" toggle is on. Always
 * 'granted' on web/dev (there's no such setting to check, and we don't want
 * a banner to ever show outside native). See checkExactNotificationSetting
 * in the plugin's definitions.d.ts — the exact_alarm field of its result is
 * itself a PermissionState ('granted' | 'denied' | 'prompt' |
 * 'prompt-with-rationale'); anything other than 'granted' is treated as
 * "off" for the purposes of the Home banner (§6 of this increment's spec).
 */
export async function getExactAlarmStatus(): Promise<'granted' | 'denied'> {
  if (!Capacitor.isNativePlatform()) return 'granted';
  const status = await LocalNotifications.checkExactNotificationSetting();
  return status.exact_alarm === 'granted' ? 'granted' : 'denied';
}

/**
 * Opens Android's exact-alarm settings screen for this app (via the
 * plugin's changeExactNotificationSetting — its doc comment notes that on
 * Android < 12 there is no such screen and it resolves 'granted' directly
 * instead of navigating anywhere; either way this call is safe to fire and
 * forget). No-ops on web/dev.
 */
export async function openExactAlarmSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.changeExactNotificationSetting();
}

/**
 * Registers the tap-to-open handler once, for the lifetime of the app.
 * Returns an unsubscribe function so the caller (App.tsx, in a mount
 * effect) can clean up under React 18 StrictMode's double-invoke.
 *
 * Cold-start caveat (increment-4 spec §4): @capacitor/local-notifications
 * has no getLaunchNotification()-style API — unlike
 * @capacitor/push-notifications, this plugin's definitions.d.ts exposes no
 * way to ask "was the app just launched by tapping a notification".
 * @capacitor/app isn't part of this increment's plugin list either, so
 * there's no fallback API available to check that reliably.
 *
 * Capacitor's native bridge is generally documented to buffer
 * notifyListeners() calls that fire before any JS listener has attached,
 * and deliver them once one does — which would mean registering this
 * listener at the very top of the app (main.tsx, before the first React
 * render) also catches the cold-start-by-tap case. That's inferred
 * general Capacitor bridge behaviour, not something this plugin's .d.ts
 * documents or guarantees, so treat "tapping a notification while the app
 * is fully closed opens the right departure" as UNVERIFIED until tested on
 * a real device — this is the flagged <90%-certain item for this increment.
 */
export async function registerNotificationNavigation(
  handler: (departureId: string) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const listenerHandle = await LocalNotifications.addListener(
    'localNotificationActionPerformed',
    (action: ActionPerformed) => {
      const departureId = action.notification.extra?.departureId;
      if (typeof departureId === 'string') handler(departureId);
    },
  );

  return () => {
    void listenerHandle.remove();
  };
}
