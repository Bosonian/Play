package de.bosonian.runway;

// ARCHITECTURE RULE (widgets increment, Runway 0.10.0 W1 / 0.11.0 W2): all
// business math — the projection equation, leave-by/start-by, which
// departure is "next" — lives in TypeScript (src/lib/projection.ts,
// src/lib/widgetSnapshot.ts). This class is display plumbing only, same
// rule PruefungWidgetProvider follows: the only arithmetic it performs is
// comparing "now" against an already-computed appointmentEpochMs to decide
// whether the snapshot has gone stale (the expiry rule below) — never a
// re-derivation of computeProjection/computeStartBy.

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The departure home-screen widget: three lines (departure name, appointment
 * time, leave-by/start-by plan) rendered from the same JSON snapshot
 * WidgetBridgePlugin.updateSnapshot writes to SharedPreferences, under the
 * "departure" key this time rather than "pruefung". Tapping the widget opens
 * the app to that departure's live Runway screen via the
 * `runway://departure/{id}` deep link (src/native/deepLinks.ts); with no
 * eligible departure, it opens Home via `runway://home` instead.
 */
public class DepartureWidgetProvider extends AppWidgetProvider {

    // Same file+key WidgetBridgePlugin writes — see that class's own
    // comment on why these are declared in one place, not duplicated.
    private static final String PREFS_NAME = WidgetBridgePlugin.PREFS_NAME;
    private static final String SNAPSHOT_KEY = WidgetBridgePlugin.SNAPSHOT_KEY;

    private static final String FALLBACK_LINE = "No departure planned.";

    // Mirrors src/lib/departureThreshold.ts's PAST_DEPARTURE_THRESHOLD_MS
    // exactly (60 min) — see this class's own expiry-rule comment in
    // renderSnapshot below for why the same number is checked again here,
    // on the native side, rather than trusted from the TS-side filtering
    // alone.
    private static final long PAST_DEPARTURE_THRESHOLD_MILLIS = 60L * 60 * 1000;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateOne(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateOne(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_departure);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String snapshotJson = prefs.getString(SNAPSHOT_KEY, null);

        String tapUri = "runway://home";
        if (snapshotJson == null) {
            renderFallback(views);
        } else {
            try {
                tapUri = renderSnapshot(views, snapshotJson);
            } catch (JSONException e) {
                // Malformed snapshot should never happen (it's always
                // written by JSON.stringify on the JS side) but a widget
                // must never crash the home screen over a display bug —
                // same fallback as "no snapshot written yet".
                renderFallback(views);
            }
        }

        Intent tapIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(tapUri));
        tapIntent.setPackage(context.getPackageName());
        // FLAG_IMMUTABLE per the increment brief — same reasoning as
        // PruefungWidgetProvider's own tap PendingIntent.
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, tapIntent, PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_departure_root, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private void renderFallback(RemoteViews views) {
        views.setTextViewText(R.id.widget_name_line, FALLBACK_LINE);
        views.setTextViewText(R.id.widget_appointment_line, "");
        views.setTextViewText(R.id.widget_plan_line, "");
    }

    /**
     * Renders the widget from the JSON snapshot and returns the tap
     * destination (`runway://departure/{id}` or the `runway://home`
     * fallback) — folded into this method rather than computed separately
     * so the two can never disagree about which departure (if any) is on
     * screen.
     *
     * Expiry rule: a departure snapshot goes stale the same way the
     * Prüfung widget's weekLine does (see PruefungWidgetProvider's own
     * stale-week comment) — except here staleness means the *fact itself*
     * (not just a "this week" label) has expired: once the real device
     * clock has moved more than PAST_DEPARTURE_THRESHOLD_MILLIS past the
     * appointment, a leftover "Klinik 14:30" from a departure that's long
     * since happened (or been missed) must not keep rendering as if it
     * were still upcoming — same threshold the TS side already used to
     * decide whether to include this departure in the snapshot at all
     * (src/lib/widgetSnapshot.ts's selectUpcomingDeparture), checked again
     * here because a snapshot can sit unrefreshed in SharedPreferences for
     * hours after the app was last closed.
     */
    private String renderSnapshot(RemoteViews views, String snapshotJson) throws JSONException {
        JSONObject root = new JSONObject(snapshotJson);
        if (root.isNull("departure")) {
            renderFallback(views);
            return "runway://home";
        }
        JSONObject departure = root.getJSONObject("departure");

        long appointmentEpochMs = departure.getLong("appointmentEpochMs");
        long nowMillis = System.currentTimeMillis();
        if (nowMillis > appointmentEpochMs + PAST_DEPARTURE_THRESHOLD_MILLIS) {
            renderFallback(views);
            return "runway://home";
        }

        String id = departure.getString("id");
        views.setTextViewText(R.id.widget_name_line, departure.getString("nameLine"));
        views.setTextViewText(R.id.widget_appointment_line, departure.getString("appointmentLine"));
        views.setTextViewText(R.id.widget_plan_line, departure.getString("planLine"));

        return "runway://departure/" + id;
    }
}
