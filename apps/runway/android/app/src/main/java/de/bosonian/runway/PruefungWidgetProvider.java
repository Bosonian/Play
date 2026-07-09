package de.bosonian.runway;

// ARCHITECTURE RULE (widgets increment, Runway 0.10.0): all business math —
// pace, remaining hours, the ready-date projection — lives in TypeScript
// (src/lib/examProjection.ts, src/lib/widgetSnapshot.ts). This class is
// display plumbing only. The only arithmetic it performs on numbers is:
// (1) adding a day-count (offsetDays, computed in TS) to "today" to get a
// display date, and (2) diffing two already-known dates in whole days
// (displayDate vs. anchor) to pick a colour band. Both are a 1:1 mirror of
// the same time-sliding math the app's own live screens already do — never
// a re-derivation of pace or remaining-hours logic.

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Prüfung home-screen widget: three lines (ready-by date, exam anchor,
 * this week's hours) rendered from the JSON snapshot
 * WidgetBridgePlugin.updateSnapshot last wrote to SharedPreferences. Tapping
 * anywhere on the widget opens the app to the Prüfung overview via the
 * `runway://exam` deep link (src/native/deepLinks.ts).
 */
public class PruefungWidgetProvider extends AppWidgetProvider {

    // Same file+key WidgetBridgePlugin writes — see that class's own
    // comment on why these are declared in one place, not duplicated.
    private static final String PREFS_NAME = WidgetBridgePlugin.PREFS_NAME;
    private static final String SNAPSHOT_KEY = WidgetBridgePlugin.SNAPSHOT_KEY;

    private static final long DAY_MILLIS = 24L * 60 * 60 * 1000;
    private static final String FALLBACK_LINE1 = "Open Runway once to fill this widget.";

    // Same calm/tight/late palette as the app's own STATE_TEXT
    // (src/screens/ExamOverview.tsx) — kept as literal ARGB ints here
    // rather than a values/colors.xml resource, since the widget provider
    // is the only native code that needs them.
    private static final int COLOR_LATE = 0xFFF87171;
    private static final int COLOR_TIGHT = 0xFFFBBF24;
    private static final int COLOR_CALM = 0xFFF1F5F9;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateOne(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateOne(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_pruefung);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String snapshotJson = prefs.getString(SNAPSHOT_KEY, null);

        if (snapshotJson == null) {
            renderFallback(views);
        } else {
            try {
                renderSnapshot(views, snapshotJson);
            } catch (JSONException e) {
                // Malformed snapshot should never happen (it's always
                // written by JSON.stringify on the JS side) but a widget
                // must never crash the home screen over a display bug —
                // same fallback as "no snapshot written yet".
                renderFallback(views);
            }
        }

        Intent tapIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("runway://exam"));
        tapIntent.setPackage(context.getPackageName());
        // FLAG_IMMUTABLE per the increment brief — this PendingIntent is
        // never modified by the receiving side (no fillInIntent from a
        // RemoteViewsService), so there's no reason to allow mutation, and
        // Android 12+ requires one of IMMUTABLE/MUTABLE to be set
        // explicitly.
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, tapIntent, PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private void renderFallback(RemoteViews views) {
        views.setTextViewText(R.id.widget_line1, FALLBACK_LINE1);
        views.setTextColor(R.id.widget_line1, COLOR_CALM);
        views.setTextViewText(R.id.widget_line2, "");
        views.setTextViewText(R.id.widget_line3, "");
    }

    private void renderSnapshot(RemoteViews views, String snapshotJson) throws JSONException {
        JSONObject root = new JSONObject(snapshotJson);
        if (root.isNull("pruefung")) {
            renderFallback(views);
            return;
        }
        JSONObject pruefung = root.getJSONObject("pruefung");

        boolean neverReady = pruefung.getBoolean("neverReady");
        String anchorLabel = pruefung.getString("anchorLabel");
        String weekLine = pruefung.getString("weekLine");
        long weekStartEpochMs = pruefung.getLong("weekStartEpochMs");
        int stateThresholdDays = pruefung.getInt("stateThresholdDays");

        views.setTextViewText(R.id.widget_line2, anchorLabel);

        if (neverReady) {
            // Mirrors examProjection.ts's readyDate === null case exactly
            // (zero measured pace, or an overflowed projection) — see
            // PruefungWidgetData.neverReady's doc comment in
            // widgetSnapshot.ts. offsetDays is meaningless here and is not
            // read.
            views.setTextViewText(R.id.widget_line1, "Ready: never at current pace");
            views.setTextColor(R.id.widget_line1, COLOR_LATE);
        } else {
            int offsetDays = pruefung.getInt("offsetDays");
            long anchorEpochMs = pruefung.getLong("anchorEpochMs");

            // Display plumbing only (see the file-top comment): today +
            // offsetDays, via Calendar so it respects the device's local
            // timezone/DST the same way the rest of this app's date math
            // does.
            Calendar displayDate = Calendar.getInstance();
            displayDate.add(Calendar.DAY_OF_YEAR, offsetDays);

            long slackDays = daysBetween(displayDate.getTimeInMillis(), anchorEpochMs);
            int color;
            if (slackDays < 0) {
                color = COLOR_LATE;
            } else if (slackDays < stateThresholdDays) {
                color = COLOR_TIGHT;
            } else {
                color = COLOR_CALM;
            }

            views.setTextViewText(R.id.widget_line1, "Ready by " + formatDisplayDate(displayDate));
            views.setTextColor(R.id.widget_line1, color);
        }

        // Stale-week guard: once the real device clock has moved past the
        // week this weekLine was computed for, it no longer describes "this
        // week" — hidden rather than shown out of date. A snapshot is only
        // ever refreshed by the app itself (src/native/widgets.ts), so an
        // app that's stayed closed across a Monday rollover is exactly the
        // case this guards against.
        long nowMillis = System.currentTimeMillis();
        boolean weekIsCurrent = nowMillis < weekStartEpochMs + 7 * DAY_MILLIS;
        views.setTextViewText(R.id.widget_line3, weekIsCurrent ? weekLine : "");
    }

    /** Whole days between two instants, floor-divided — mirrors
     * examProjection.ts's daysBetween exactly (same floor-division shape).
     * The one date-diff arithmetic op the file-top ARCHITECTURE RULE allows
     * this class to do, not a re-derivation of any business rule. */
    private long daysBetween(long fromMillis, long toMillis) {
        return (long) Math.floor((toMillis - fromMillis) / (double) DAY_MILLIS);
    }

    /** "14 Dec" (this year) / "8 Jun 2028" (a different year) — mirrors
     * format.ts's formatDateMedium rule exactly, including that file's F4
     * reasoning: compare against the real current year, not a fixed
     * "always/never show the year" rule, so a far-out projection still
     * shows an unambiguous year. */
    private String formatDisplayDate(Calendar date) {
        Calendar now = Calendar.getInstance();
        String pattern = date.get(Calendar.YEAR) == now.get(Calendar.YEAR) ? "d MMM" : "d MMM yyyy";
        SimpleDateFormat formatter = new SimpleDateFormat(pattern, Locale.ENGLISH);
        return formatter.format(date.getTime());
    }
}
