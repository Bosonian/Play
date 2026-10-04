package de.bosonian.runway;

// ARCHITECTURE RULE (same as WidgetBridgePlugin.java): this plugin moves data
// across the JS<->native boundary and nothing more. Which events count as
// "upcoming", how they're deduped against existing departures, and how a tap
// prefills DepartureSetup all live in TypeScript (src/native/calendar.ts,
// src/lib/calendarEvents.ts, src/screens/Home.tsx) — this file has no
// business logic beyond the Android calendar-provider query itself.

import android.Manifest;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import org.json.JSONObject;

/**
 * The JS<->native bridge for reading the device's calendar. One method,
 * `listUpcomingEvents`. See src/native/calendar.ts for the JS side (the
 * only file that calls into this plugin).
 *
 * Permission shape mirrors node_modules/@capacitor/geolocation/android's
 * GeolocationPlugin.kt exactly: a single `@Permission` with an `alias`
 * (here "calendar", READ_CALENDAR only — this app never writes to the
 * calendar, so WRITE_CALENDAR is never requested), read via
 * `getPermissionState(alias)`. Geolocation additionally OVERRIDES
 * checkPermissions/requestPermissions to gate on "are location services
 * enabled" before delegating to `super`; there is no calendar equivalent of
 * that extra gate, so this plugin does NOT override either method — the
 * default implementations `Plugin` itself provides (see
 * node_modules/@capacitor/android/capacitor/.../Plugin.java's own
 * `@PluginMethod checkPermissions`/`requestPermissions`) already do exactly
 * what's needed: report/request the "calendar" alias and nothing else.
 * `@PermissionCallback` (the third piece of the shape this file mirrors) is
 * likewise not needed here for the same reason it's not needed on
 * `getCurrentPosition` when permission is already granted — see
 * `listUpcomingEvents` below for why this plugin deliberately does NOT
 * auto-prompt the way geolocation's getCurrentPosition does.
 */
@CapacitorPlugin(
    name = "CalendarBridge",
    permissions = @Permission(strings = { Manifest.permission.READ_CALENDAR }, alias = CalendarBridgePlugin.CALENDAR_ALIAS)
)
public class CalendarBridgePlugin extends Plugin {

    static final String CALENDAR_ALIAS = "calendar";
    private static final int DEFAULT_HOURS = 48;

    // Not a secret — just a distinguishable string so a rejected call is
    // recognisable in adb logcat as "no permission" rather than some other
    // failure. src/native/calendar.ts's getUpcomingCalendarEvents() maps
    // EVERY rejection (this one included) to `null`; it never inspects this
    // string, by design (see that file's own comment).
    private static final String PERMISSION_DENIED_MESSAGE = "READ_CALENDAR permission not granted";

    private static final String[] PROJECTION = {
        CalendarContract.Instances.BEGIN,
        CalendarContract.Instances.TITLE,
        CalendarContract.Instances.EVENT_LOCATION,
        CalendarContract.Instances.ALL_DAY,
        // Field report #10: CalendarContract.Instances is a view joined
        // against Events under the hood, and exposes Events.RRULE under the
        // same column name — but no Android API actually GUARANTEES that
        // for every calendar provider (stock AOSP does it; a third-party
        // provider app theoretically might not). Requested here defensively;
        // see the read site below for the matching defensive read.
        CalendarContract.Events.RRULE,
    };

    /**
     * Returns upcoming events across every visible calendar (no per-calendar
     * filtering in v1) in the window [now, now + hours). Deliberately does
     * NOT request permission itself when it's missing — unlike geolocation's
     * getCurrentPosition, which auto-prompts on first call, this method just
     * rejects. The reason: this is called both from an explicit user tap
     * (Home's "Show calendar appointments here.") AND from a passive
     * background refresh (mount + visibilitychange, once already enabled) —
     * auto-prompting from the latter would silently re-ask for a permission
     * the user may have deliberately revoked in system settings, which is
     * exactly the nagging CLAUDE.md's lazy-permission rule rules out. The
     * explicit prompt path is requestPermissions() (inherited, unmodified,
     * from Plugin — see the class doc comment above), which
     * src/native/calendar.ts's requestCalendarAccess() calls instead.
     */
    @PluginMethod
    public void listUpcomingEvents(PluginCall call) {
        if (getPermissionState(CALENDAR_ALIAS) != PermissionState.GRANTED) {
            call.reject(PERMISSION_DENIED_MESSAGE);
            return;
        }

        int hours = call.getInt("hours", DEFAULT_HOURS);
        long now = System.currentTimeMillis();
        long end = now + hours * 3_600_000L;

        // CalendarContract.Instances, not .Events: querying .Events returns
        // one row per event SERIES — a daily-recurring appointment shows up
        // once, at its original creation-time bounds, not at its next actual
        // occurrence. .Instances is the pre-expanded view (the same one the
        // stock Android Calendar app's agenda list reads from): one row per
        // actual occurrence that falls inside [now, end), recurring or not,
        // which is what "next 48 h of appointments" actually means.
        Uri.Builder builder = CalendarContract.Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(builder, now);
        ContentUris.appendId(builder, end);

        JSArray events = new JSArray();
        try (
            Cursor cursor = getContext()
                .getContentResolver()
                .query(builder.build(), PROJECTION, null, null, CalendarContract.Instances.BEGIN + " ASC")
        ) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String title = cursor.getString(1);
                    String location = cursor.getString(2);
                    JSObject event = new JSObject();
                    // Defensive null -> "" (brief): a title-less or
                    // location-less row is a real, if unusual, calendar
                    // entry — not a reason to crash the whole query.
                    event.put("title", title == null ? "" : title);
                    event.put("beginEpochMs", cursor.getLong(0));
                    event.put("location", location == null ? "" : location);
                    event.put("allDay", cursor.getInt(3) != 0);
                    // Defensive RRULE read (field report #10): a genuinely
                    // one-off event has no RRULE at all (null is the correct,
                    // expected value there, not a failure) — but a provider
                    // that omits or renames the joined column outright would
                    // otherwise throw a CursorIndexOutOfBoundsException and
                    // take the whole calendar read down with it, over one
                    // optional field. getColumnIndex returning -1 covers
                    // "column not present"; the try/catch is the second
                    // backstop for a provider that includes the column but
                    // throws reading it. JSONObject.NULL (not Java `null`,
                    // which org.json's JSONObject#put silently treats as
                    // "remove this key") is what makes the field arrive on
                    // the JS side as an explicit `null`, matching
                    // CalendarEvent's `rrule: string | null` — see
                    // src/native/calendar.ts.
                    String rrule = null;
                    try {
                        int rruleIndex = cursor.getColumnIndex(CalendarContract.Events.RRULE);
                        if (rruleIndex >= 0) {
                            rrule = cursor.getString(rruleIndex);
                        }
                    } catch (Exception e) {
                        rrule = null;
                    }
                    event.put("rrule", rrule == null ? JSONObject.NULL : rrule);
                    events.put(event);
                }
            }
        }

        JSObject result = new JSObject();
        result.put("events", events);
        call.resolve(result);
    }
}
