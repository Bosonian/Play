import { Capacitor } from '@capacitor/core';
import type {
  ActionPerformed,
  Channel,
  LocalNotificationSchema,
  ScheduleOptions,
} from '@capacitor/local-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Departure, Milestone, Sprint } from '../db/types';
import { computeAlarmTimes } from '../lib/alarmTimes';
import { formatTime } from '../lib/format';

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

/**
 * F2 (recover-instead-of-forfeit spec): the action type attached ONLY to
 * slot 0's "Start getting ready." notification (see the comment where it's
 * assigned in scheduleDepartureAlarms below for why the other three slots
 * deliberately don't get this). One action, `SNOOZE_ACTION_ID` — its
 * `title` is the literal button label Android renders.
 */
const START_ACTION_TYPE_ID = 'runway-start-alarm';
const SNOOZE_ACTION_ID = 'snooze-10';
const SNOOZE_MINUTES = 10;

let channelsReady = false;

/**
 * Creates the two notification channels Android needs before it will show
 * anything on a per-channel importance/sound, and registers the snooze
 * action type (F2) alongside them. Idempotent per JS session via
 * `channelsReady` — Android channel settings are sticky after first
 * creation anyway (the user can retune sound/vibration in system settings
 * afterwards; re-creating with the same id does not reset that), so there's
 * nothing to gain from calling this more than once per launch; the same
 * reasoning covers registerActionTypes, which the plugin's .d.ts doesn't
 * document as harmful to call repeatedly but which also has nothing to
 * gain from it.
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
  await Promise.all([
    LocalNotifications.createChannel(staged),
    LocalNotifications.createChannel(leave),
    LocalNotifications.registerActionTypes({
      types: [{ id: START_ACTION_TYPE_ID, actions: [{ id: SNOOZE_ACTION_ID, title: 'Snooze 10 min' }] }],
    }),
  ]);
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
 *
 * milestoneNotificationId (below) makes exactly the same call for the same
 * reason: a milestone also only ever gets one alarm (its morning-of
 * reminder), and a milestone id is drawn from the same `crypto.randomUUID()`
 * id space as departures and sprints, so `notificationId(milestoneId, 0)`
 * is just as safe to reuse here as it was for sprints.
 */
export function sprintNotificationId(sprintId: string): number {
  return notificationId(sprintId, 0);
}

/**
 * Deterministic notification id for a milestone's single morning-of alarm —
 * same reuse rationale as sprintNotificationId directly above (read that
 * comment for the full "why not a disjoint range" argument). Kept as its
 * own named function, rather than callers writing `notificationId(id, 0)`
 * inline, purely so a milestone id and a sprint id are never visually
 * interchangeable at a call site even though they resolve to the same
 * formula.
 */
export function milestoneNotificationId(milestoneId: string): number {
  return notificationId(milestoneId, 0);
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
      // F2: only slot 0 ("Start getting ready.") gets a snooze button. The
      // other three stages are deliberately excluded — "Wrap up" already
      // means the buffer has started, and "Leave in 5"/"Leave now" snoozing
      // themselves would be self-deception with a UI: the appointment
      // doesn't move just because the alarm did, so a snoozed "leave now"
      // only produces a later, still-just-as-real lateness. "Start getting
      // ready" is the one stage where 10 more minutes is still a plan
      // change Replan-from-now (F1) can absorb, not a promise the rest of
      // the schedule can't keep.
      actionTypeId: alarm.slot === 0 ? START_ACTION_TYPE_ID : undefined,
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
 * Cancels a milestone's pending morning-of alarm, if one exists. Same
 * "safe to call unconditionally" reasoning as cancelSprintEndAlarm/
 * cancelDepartureAlarms above. Called from two places: MilestoneEdit's
 * delete action (a deleted milestone has nothing left to remind about), and
 * from inside scheduleMilestoneAlarm itself, below, ahead of every
 * (re)schedule — the same "cancel whatever was there, then schedule fresh"
 * shape scheduleDepartureAlarms uses, so an edited milestone's alarm always
 * reflects its latest saved name/date rather than layering a new
 * notification on top of a stale one at the same id.
 */
export async function cancelMilestoneAlarm(milestoneId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: [{ id: milestoneNotificationId(milestoneId) }] });
}

/**
 * Schedules a milestone's single morning-of alarm (RUNWAY_PRUFUNG_PLAN.md
 * §5): whichever is EARLIER of 07:30 LOCAL time on the milestone's own
 * calendar date, or the milestone's own time (F9) — "Today: {name}, {HH:mm}."
 * is meant to land while Deepak is still getting his day started, not at
 * the moment the milestone happens (that's what the milestone itself is
 * for). Built with plain Date mutators (`setHours`), which operate in the
 * device's local timezone — the same "local", not UTC, time the rest of
 * this app's date math assumes.
 *
 * The min(07:30, milestone.at) clamp (F9) matters for an early milestone —
 * a 06:00 mock oral, say. Unconditionally reminding "this morning" at 07:30
 * would fire the reminder AFTER the thing it's reminding about has already
 * started, which defeats the point of a morning-of nudge entirely. Clamping
 * to the milestone's own time instead means the reminder is never later
 * than useful, even though it stops being a true "before the day starts"
 * nudge for milestones that early.
 *
 * On the gentler STAGED channel, not the high-importance LEAVE channel a
 * sprint's end alarm uses: a milestone reminder is a heads-up for later
 * today, not an "act now" alert the way a sprint timer or a departure's
 * leave-now stage is.
 *
 * No `extra` payload and no special navigation on tap (increment-4 spec):
 * tapping just opens the app to wherever it was, same as any other cold
 * launch. The exam overview is one tap from Home, so wiring a dedicated
 * "jump straight to this milestone" path isn't worth the complexity for
 * what this alarm is — a nudge to open the app, not a deep link.
 *
 * Skips scheduling (past-filter rule, same as computeAlarmTimes for
 * departures) if the clamped reminder time has already passed — Android
 * fires a past-scheduled exact alarm immediately, and a stale "Today: ..."
 * reminder firing the moment you save an edit would be surprising, not
 * useful.
 */
export async function scheduleMilestoneAlarm(milestone: Milestone): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await ensureChannels();
  await cancelMilestoneAlarm(milestone.id);

  const milestoneAt = new Date(milestone.at);
  const morningOf = new Date(milestoneAt);
  morningOf.setHours(7, 30, 0, 0);
  // F9: min(07:30 that day, milestone.at) — see the doc comment above.
  const remindAt = morningOf.getTime() < milestoneAt.getTime() ? morningOf : milestoneAt;
  if (remindAt.getTime() <= Date.now()) return;

  await LocalNotifications.schedule({
    notifications: [
      {
        id: milestoneNotificationId(milestone.id),
        title: 'Runway',
        body: `Today: ${milestone.name}, ${formatTime(milestoneAt)}.`,
        channelId: STAGED_CHANNEL_ID,
        schedule: { at: remindAt, allowWhileIdle: true },
        // No `extra` — see the doc comment above: tapping opens the app via
        // the plugin's default behaviour, deliberately not wired to any
        // special navigation the way a departure's `extra.departureId` is.
      },
    ],
  });
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
      // F2: tapping "Snooze 10 min" reschedules instead of opening the app
      // (see scheduleSnoozeAlarm's own doc comment). Every other actionId —
      // in practice just 'tap', the plugin's default for tapping the
      // notification body itself (read the .d.ts's ActionPerformed comment)
      // — keeps exactly the pre-F2 behaviour below: open the departure the
      // notification was about.
      if (action.actionId === SNOOZE_ACTION_ID) {
        void scheduleSnoozeAlarm(action.notification);
        return;
      }
      const departureId = action.notification.extra?.departureId;
      if (typeof departureId === 'string') handler(departureId);
    },
  );

  return () => {
    void listenerHandle.remove();
  };
}

/**
 * F2: re-schedules the tapped "Start getting ready." alarm
 * `SNOOZE_MINUTES` from the moment "Snooze 10 min" was tapped, reusing the
 * ORIGINAL notification's id/title/body/channel/actionTypeId/extra exactly
 * — this is a pure reschedule of the same alarm, not a resend of possibly-
 * stale copy computed from whatever the departure looks like now. Reusing
 * `original.id` (== notificationId(departureId, 0)) matters beyond just
 * "why compute a new one": it's what keeps the snoozed alarm cancellable
 * through the exact same path everything else already uses —
 * cancelDepartureAlarms recomputes that same id on leave/abandon/edit, so a
 * snooze taken and then overtaken by one of those still gets cleaned up
 * without this function needing to know about it.
 *
 * Deliberately does NOT navigate anywhere, unlike a tap — snoozing means
 * "not yet"; popping the app open to the Runway screen the instant you ask
 * for ten more minutes would defeat the point of asking.
 *
 * Device-verify item, same class as registerNotificationNavigation's own
 * cold-start caveat above: this handler only runs at all if Capacitor's
 * bridge can wake the JS runtime from an app-fully-closed state on an
 * action tap — inferred general bridge behaviour (the same "buffers events
 * until a listener attaches" mechanism the cold-start tap case already
 * relies on), not something this plugin's .d.ts documents as guaranteed.
 * UNVERIFIED until tested on a real device with the app fully closed.
 */
async function scheduleSnoozeAlarm(original: LocalNotificationSchema): Promise<void> {
  const snoozeAt = new Date(Date.now() + SNOOZE_MINUTES * MS_PER_MINUTE);
  await LocalNotifications.schedule({
    notifications: [
      {
        id: original.id,
        title: original.title,
        body: original.body,
        channelId: original.channelId,
        actionTypeId: original.actionTypeId,
        schedule: { at: snoozeAt, allowWhileIdle: true },
        extra: original.extra,
      },
    ],
  });
}
