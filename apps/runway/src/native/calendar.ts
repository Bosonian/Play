import { Capacitor, registerPlugin } from '@capacitor/core';

// The ONLY file that imports the CalendarBridge plugin — same
// one-choke-point pattern as widgetBridge.ts. Like WidgetBridge,
// CalendarBridge is not an npm package: it's a plugin defined directly
// inside this app's own Android project
// (android/app/src/main/java/de/bosonian/runway/CalendarBridgePlugin.java),
// registered by MainActivity rather than auto-discovered from node_modules.

/** One instance of a device calendar event, already in the app's own shape —
 * see CalendarBridgePlugin.java's PROJECTION for where these four fields
 * come from. `beginEpochMs` (not an ISO string) matches what
 * android.database.Cursor.getLong() hands back for CalendarContract.Instances
 * .BEGIN with no lossy string round-trip in between. */
export interface CalendarEvent {
  title: string;
  beginEpochMs: number;
  location: string;
  allDay: boolean;
}

interface CalendarBridgePlugin {
  listUpcomingEvents(options: { hours: number }): Promise<{ events: CalendarEvent[] }>;
  /** Not declared by this plugin explicitly — inherited from Capacitor's own
   * `Plugin` base class via the `@Permission(alias = "calendar")` on
   * `@CapacitorPlugin` (see CalendarBridgePlugin.java's class doc comment).
   * Declared here so TypeScript knows its shape; the alias key in the
   * result ("calendar") has to match CalendarBridgePlugin.CALENDAR_ALIAS
   * exactly. */
  requestPermissions(): Promise<{ calendar: string }>;
}

const CalendarBridge = registerPlugin<CalendarBridgePlugin>('CalendarBridge');

const DEFAULT_HOURS = 48;

/**
 * Reads upcoming events across every visible calendar, or null on web, on a
 * missing/not-yet-granted permission, or on any other native error. Never
 * throws — Home's "From your calendar" section treats null exactly like
 * "nothing to show right now", the same defensive shape geolocation.ts's
 * getCurrentPosition uses.
 *
 * Deliberately does NOT trigger the permission prompt itself — that's
 * requestCalendarAccess()'s job, called only from an explicit tap. This
 * function is also the one Home's passive background refresh (mount +
 * visibilitychange, once calendar reading is already enabled) calls; if it
 * silently re-prompted whenever permission happened to be missing (e.g.
 * revoked later in system settings), that background refresh would surprise
 * a permission dialog into existence with no tap behind it — exactly the
 * nagging CLAUDE.md's lazy-permission rule rules out. CalendarBridgePlugin's
 * listUpcomingEvents mirrors this on the native side: it checks the
 * permission state and rejects rather than requesting.
 */
export async function getUpcomingCalendarEvents(hours: number = DEFAULT_HOURS): Promise<CalendarEvent[] | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const result = await CalendarBridge.listUpcomingEvents({ hours });
    return result.events;
  } catch {
    return null;
  }
}

/**
 * Triggers the READ_CALENDAR permission flow (the Android system dialog),
 * resolving to whether it ended up granted. Call exactly once per lazy
 * enable — Home's "Show calendar appointments here." tap — never at app
 * open. `false` on web (there is no such permission there) and on any
 * native error, same never-throw shape as every other native wrapper in
 * this app.
 */
export async function requestCalendarAccess(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await CalendarBridge.requestPermissions();
    return result.calendar === 'granted';
  } catch {
    return false;
  }
}
