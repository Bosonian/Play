package de.bosonian.runway;

// ARCHITECTURE RULE (same as WidgetBridgePlugin.java/CalendarBridgePlugin.java/
// WifiBridgePlugin.java): this plugin moves data across the JS<->native
// boundary and nothing more. WHICH commitment is next, and the "Next: {label}
// · {HH:mm}" title string, are both computed in TypeScript
// (src/lib/dayGauge.ts, src/lib/dayGaugeRefresh.ts) — this file only knows
// how to render a title and a target instant as an Android notification.
//
// Day-gauge increment (0.31.0): the generalized form of the original "Google
// Maps while getting ready" hack — an ambient, always-visible countdown to
// whatever's next, living in the notification shade and lockscreen rather
// than a screen that has to be opened. The mechanism that makes this
// possible with ZERO ongoing app involvement is NotificationCompat's
// chronometer fields, set once below:
//
//   setUsesChronometer(true) + setChronometerCountDown(true) + setWhen(atMs)
//
// Android's own Chronometer view inside the notification renders a live,
// ticking mm:ss (or h:mm:ss) countdown to `setWhen`'s instant, entirely on
// the OS side — no foreground service, no periodic JS timer, no repeated
// notify() calls while the target stays the same. This app only calls
// show() again when the TARGET itself changes (a new next-commitment, or the
// same one moving) — see refreshDayGauge()'s own doc comment for exactly
// when that is.
//
// The one honest limitation this buys: the chronometer only counts DOWN to
// zero and then starts counting UP (or, per some OEM renderers, shows a
// negative duration) — it does not know the target has been "reached" in
// any semantic sense, because nothing here is watching the clock. If the
// target passes while the app stays fully closed, the notification goes
// stale — still pinned, still ongoing, just counting the wrong direction —
// until the app is next opened and refreshDayGauge() re-points it at
// whatever's next. This is the same "no background scheduler" tradeoff the
// widget snapshot mechanism already accepts (see widgetSnapshot.ts's own
// header comment on staleness), applied to a countdown instead of a date.
//
// UNVERIFIED: whether the chronometer view renders correctly — font, mm:ss
// vs h:mm:ss switchover, count-up-past-zero behaviour — inside a heavily
// themed One UI (Samsung) notification shade specifically. The chronometer
// mechanism itself is stock Android (NotificationCompat/RemoteViews), but
// OEM notification skins are known to re-style or occasionally clip custom
// notification layouts; this has not been tried on a real Samsung device as
// of this increment.

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The JS<->native bridge for the day gauge — the ambient, silent, ongoing
 * "next commitment" countdown notification. Two methods: `show` (post or
 * replace it) and `hide` (cancel it). See src/native/dayGauge.ts for the JS
 * side (the only file that calls into this plugin).
 */
@CapacitorPlugin(name = "DayGauge")
public class DayGaugePlugin extends Plugin {

    // Own channel, deliberately separate from notifications.ts's
    // 'runway-staged-2'/'runway-leave-2' channels: those are alerts (sound,
    // possibly a heads-up banner) for a specific staged moment; this is a
    // silent, ongoing, always-there gauge, and Android channels are
    // per-purpose, user-tunable buckets — conflating the two would mean
    // muting/customizing one necessarily affects the other in Android
    // Settings.
    static final String CHANNEL_ID = "runway-gauge";

    // Fixed, arbitrary notification id — this gauge is a SINGLETON (there is
    // only ever one "next commitment"), unlike a departure's four staged
    // alarms or a study block's per-occurrence id (notifications.ts's
    // notificationId), which each need a deterministic-but-distinct id per
    // row. No hashing needed here for the same reason WidgetBridgePlugin
    // needs none: there's exactly one thing this plugin ever shows.
    static final int NOTIFICATION_ID = 771900;

    /**
     * Posts (or replaces, same fixed id) the ongoing day-gauge notification.
     * Expects `{ title: string, targetAtMs: number }` — `title` is the
     * fully-formed "Next: {label} · {HH:mm}" string (built in
     * src/lib/dayGauge.ts; this plugin does no string formatting itself),
     * `targetAtMs` is the epoch-millisecond instant the chronometer counts
     * down to.
     *
     * Read via `getData().optLong`/`optString` rather than PluginCall's own
     * `getLong`/`getDouble` typed getters: those getters only accept ONE
     * exact boxed type each (`getLong` rejects a value that arrived as
     * `Integer` or `Double`; `getDouble` rejects `Long`) and which boxed
     * type org.json's JSON parser picks for a given epoch-ms number depends
     * on its magnitude, which is exactly the kind of incidental detail this
     * plugin shouldn't be coupled to. `optLong`/`optString` (plain
     * `org.json.JSONObject` methods JSObject inherits) coerce any `Number`
     * uniformly instead.
     *
     * Does NOT itself request POST_NOTIFICATIONS — see this class's own
     * note in show()'s body below.
     */
    @PluginMethod
    public void show(PluginCall call) {
        JSObject data = call.getData();
        String title = data.optString("title", null);
        long targetAtMs = data.optLong("targetAtMs", Long.MIN_VALUE);
        if (title == null || targetAtMs == Long.MIN_VALUE) {
            call.reject("title and targetAtMs are required");
            return;
        }

        Context context = getContext();
        ensureChannel(context);

        // Tapping the gauge opens Runway to wherever it was (MainActivity's
        // launchMode is singleTask — see its own class comment), same "no
        // special deep-link navigation" choice notifications.ts's milestone
        // reminder makes for the same reason: this is a heads-up nudge to
        // open the app, not a link to one specific screen.
        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // FLAG_IMMUTABLE (required on Android 12+, and the safer default
        // below it too — see notifications.ts's own PendingIntent usage
        // inside the local-notifications plugin for the same requirement):
        // this PendingIntent's Intent never needs to be filled in by
        // whatever ends up delivering it, so there's nothing to gain from
        // mutability and Android now requires callers to say so explicitly.
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Small icon: this app has never configured a custom notification
        // icon (no `plugins.LocalNotifications.smallIcon` in
        // capacitor.config.ts, no drawable added for one) — every existing
        // Runway notification (departure alarms, sprint/milestone/study-block
        // alerts) falls back to @capacitor/local-notifications' own default,
        // which resolves to the plain system "i" glyph
        // (`android.R.drawable.ic_dialog_info` — see
        // LocalNotificationManager.getDefaultSmallIcon in that plugin's
        // source). Reusing the exact same drawable here, rather than the
        // app's launcher icon, is what "the app's existing notification
        // icon" means in practice for this app today — every Runway
        // notification looks the same in the shade. Revisit together if a
        // custom monochrome status-bar icon is ever added for the others.
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setOngoing(true)
            // A re-post with an unchanged title/target must not re-alert
            // (buzz/flash) — this is a silent gauge, not a notification
            // event. setOnlyAlertOnce, combined with the channel's own
            // IMPORTANCE_LOW/no-sound/no-vibration below, is belt-and-
            // suspenders: the channel already can't alert, but a future
            // re-tuning of the channel's importance (by Deepak, in Android
            // Settings) shouldn't silently turn every refresh into a buzz.
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(targetAtMs)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setContentIntent(contentIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW);

        // NotificationManagerCompat#notify does NOT throw or reject when
        // POST_NOTIFICATIONS (Android 13+) hasn't been granted — unlike most
        // runtime permissions, a denied notification permission makes the
        // system silently drop the post instead of raising a
        // SecurityException. That's exactly the behaviour this plugin wants:
        // per the increment spec, permission is already requested through
        // the app's one existing flow (notifications.ts's ensurePermissions,
        // called lazily elsewhere), and the Settings toggle's own caption
        // says the gauge needs notifications — this plugin doesn't need a
        // second permission path, and simply renders nothing when denied.
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        call.resolve();
    }

    /** Cancels the day-gauge notification, if one is currently showing. Safe
     * to call unconditionally — cancelling an id that isn't currently
     * posted is a silent no-op, same "safe to call unconditionally" shape
     * every cancel() call in notifications.ts already relies on. */
    @PluginMethod
    public void hide(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_ID);
        call.resolve();
    }

    /**
     * Creates the 'runway-gauge' channel if it doesn't already exist —
     * idempotent by construction (checked via getNotificationChannel first,
     * same "don't recreate what's already there" shape ensureChannels() in
     * notifications.ts follows for its own two channels, just checked
     * directly against the OS rather than a module-level boolean, since this
     * plugin has no persistent JS-session state to cache the check in).
     * IMPORTANCE_LOW: visible in the shade and on the lockscreen, no sound,
     * no vibration, no heads-up banner — this is a fuel gauge to glance at,
     * not an alert to react to.
     *
     * Guarded by the SDK_INT check because NotificationChannel is an API 26+
     * (Oreo) type — this app's minSdkVersion is 23 (android/variables.gradle),
     * so a device below Oreo would crash on the bare constructor call
     * without this guard. Below API 26, a channel is meaningless anyway
     * (Android's per-channel importance system doesn't exist pre-Oreo) —
     * `show()`'s own IMPORTANCE_LOW intent is instead carried by
     * `setPriority(PRIORITY_LOW)` on the builder, which NotificationCompat
     * still honours on those older versions.
     */
    private void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Day gauge", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("A silent, live countdown to your next commitment.");
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }
}
