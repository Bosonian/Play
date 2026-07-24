package de.bosonian.tide;

// Widget increment (0.9.0), ported from apps/runway's
// PruefungWidgetProvider.java (chosen there as "the simplest provider" to
// port from — no calendar-slide arithmetic, no progress bar, no
// multi-widget headline swap; Tide has exactly one widget and one signal
// hierarchy to render). Same ARCHITECTURE RULE: every string this widget
// shows is computed and formatted in TypeScript (src/lib/trend.ts,
// src/lib/dailyShape.ts, src/lib/widgets.ts's buildTideWidgetSnapshot) and
// arrives here pre-baked in the JSON snapshot. This class does ZERO
// business math — it reads five strings and a boolean out of a JSONObject
// and decides which View gets which text/colour/visibility. Even the
// met/unmet colour choice is a fixed two-colour lookup on a flag the JS
// side already computed (`shapeMet`), not a decision made here.
//
// Java, not Kotlin (per this increment's brief) — matches both Runway's
// widget providers (all Java) and Tide's own MainActivity.java; Kotlin in
// this app is reserved for HealthConnectPlugin.kt, where the Health
// Connect client library's coroutine-based API forced it (see that file's
// own header comment). Plain display plumbing like this has no such
// requirement, so it stays Java for consistency with the rest of the
// native Android surface.

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Tide home-screen widget: the smoothed weight trend (the north star —
 * TIDE_PLAN.md §2/§5) as the large, dominant number, the trend's own
 * sentence underneath it (smaller, dimmer), and — smallest and quietest of
 * all, per TIDE_PLAN.md §5's ranking of daily shape strictly below the
 * trend — up to two daily-shape component lines. Rendered from the JSON
 * snapshot WidgetBridgePlugin.updateSnapshot last wrote to
 * SharedPreferences; src/lib/widgets.ts's buildTideWidgetSnapshot is the
 * one place that decides what those strings say. Tapping anywhere opens
 * the app.
 *
 * Tide has no runway://-style deep-link scheme (unlike Runway — see that
 * app's AndroidManifest.xml) so the tap target here is a plain explicit
 * Intent to MainActivity, not a URI-based ACTION_VIEW. This is a
 * deliberate, smaller port than Runway's own tap handling, not a missing
 * piece — there is only one screen (Home) for the widget to usefully open
 * to, so there is nothing a deep link would buy here that a direct launch
 * doesn't already do.
 */
public class TideWidgetProvider extends AppWidgetProvider {

    // Same file+key WidgetBridgePlugin writes — see that class's own
    // comment on why these are declared in one place, not duplicated.
    private static final String PREFS_NAME = WidgetBridgePlugin.PREFS_NAME;
    private static final String SNAPSHOT_KEY = WidgetBridgePlugin.SNAPSHOT_KEY;

    // No snapshot has EVER been written — the app has never been opened on
    // this device/install. Distinct from the "app has run, but there are no
    // weigh-ins yet" state, which is a REAL snapshot whose trendLine already
    // carries the honest "Add your first weigh-in to start the trend."
    // sentence (src/lib/widgets.ts) — that case is rendered via the ordinary
    // renderSnapshot path below, not this fallback. Same
    // FALLBACK_LINE1/"no exam yet" distinction Runway's own
    // PruefungWidgetProvider draws for the identical reason.
    private static final String FALLBACK_LINE = "Open Tide once to fill this widget.";

    // Same Tailwind hex values apps/tide's own design tokens use
    // (tailwind.config.ts's `surface`/default slate scale), not a
    // widget-specific palette — see widget_bg.xml's own comment for the
    // background colour these text colours sit on.
    private static final int COLOR_TREND_VALUE = 0xFFF1F5F9; // slate-100 — Home's own headline colour
    private static final int COLOR_TREND_LINE = 0xFF94A3B8; // slate-400 — Home's own formatTrendLine colour
    // Shape-line colour, deliberately NOT slate-300 (the colour
    // Home.tsx's own daily-shape card uses for its unmet lines inside that
    // card's own visual context). This increment's brief is explicit that
    // the widget's hierarchy must read the shape lines as the SMALLEST AND
    // QUIETEST element, strictly below the trend line above them — slate-300
    // is lighter than slate-400 and would make the shape lines read as MORE
    // prominent than the trend line, inverting the ranking TIDE_PLAN.md §5
    // requires. slate-500 (dimmer than slate-400) is what Home itself uses
    // for its other quiet secondary lines (bfTrend/movementLine), and is the
    // correct rung of the same ladder for "quietest thing on the widget".
    private static final int COLOR_SHAPE_UNMET = 0xFF64748B; // slate-500
    // Emerald accent, ONLY when shapeMet is true — same hex Home.tsx's own
    // dailyShape "met" text uses (text-emerald-300) and the same colour
    // Runway's widget uses for its own daily-shape "met" state
    // (COLOR_TODAY_MET) — a quiet acknowledgment, never a celebration; never
    // red/amber for the unmet case (TIDE_PLAN.md §2's no-shame rule, this
    // increment's brief repeats it explicitly for the widget).
    private static final int COLOR_SHAPE_MET = 0xFF6EE7B7; // emerald-300

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateOne(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateOne(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tide);

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
                // same fallback as "no snapshot written yet". This also
                // covers a schema-upgrade window: a snapshot written by an
                // older APK build with a different field set would land
                // here too, rather than silently misreading a wrong field.
                // The very next app open (src/lib/widgets.ts's
                // refreshWidgets, called from several sites — see that
                // file's own header comment) overwrites SharedPreferences
                // with a fresh, current-schema snapshot and heals it.
                renderFallback(views);
            }
        }

        // Explicit Intent to MainActivity, not a deep-link URI — see this
        // class's own header comment for why Tide's widget doesn't need one.
        // FLAG_ACTIVITY_NEW_TASK is required here specifically because this
        // PendingIntent is being built from a BroadcastReceiver context
        // (AppWidgetProvider), which has no existing Activity task stack of
        // its own to launch into. FLAG_IMMUTABLE per the increment brief —
        // this PendingIntent is never modified by the receiving side, so
        // there's no reason to allow mutation, and Android 12+ requires one
        // of IMMUTABLE/MUTABLE to be set explicitly (same requirement
        // Runway's own widget PendingIntents document).
        Intent tapIntent = new Intent(context, MainActivity.class);
        tapIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, tapIntent, PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private void renderFallback(RemoteViews views) {
        views.setViewVisibility(R.id.widget_trend_value, View.GONE);
        views.setTextViewText(R.id.widget_trend_value, "");
        views.setTextViewText(R.id.widget_trend_line, FALLBACK_LINE);
        views.setTextColor(R.id.widget_trend_line, COLOR_TREND_LINE);
        views.setViewVisibility(R.id.widget_shape_line1, View.GONE);
        views.setTextViewText(R.id.widget_shape_line1, "");
        views.setViewVisibility(R.id.widget_shape_line2, View.GONE);
        views.setTextViewText(R.id.widget_shape_line2, "");
    }

    private void renderSnapshot(RemoteViews views, String snapshotJson) throws JSONException {
        JSONObject root = new JSONObject(snapshotJson);

        // getString (not optString): every field src/lib/widgets.ts writes
        // is always present, always a string — an empty string means "this
        // line has nothing to say right now" (no trend yet, no shape
        // target set), never a missing key. A genuinely missing key here
        // means the JSON doesn't match this class's expectations at all,
        // which is exactly the JSONException renderSnapshot's caller
        // already catches and falls back from.
        String trendValue = root.getString("trendValue");
        String trendLine = root.getString("trendLine");
        String shapeLine1 = root.getString("shapeLine1");
        String shapeLine2 = root.getString("shapeLine2");
        boolean shapeMet = "true".equals(root.getString("shapeMet"));

        // Trend value: hidden entirely (not just blank) when there's no
        // smoothed weight yet — a widget must never show an empty large
        // slot where a number belongs; see widget_tide.xml's own comment on
        // why GONE, not just empty text, is what keeps the layout from
        // reserving dead space for it.
        if (trendValue.isEmpty()) {
            views.setViewVisibility(R.id.widget_trend_value, View.GONE);
        } else {
            views.setViewVisibility(R.id.widget_trend_value, View.VISIBLE);
            views.setTextViewText(R.id.widget_trend_value, trendValue);
            views.setTextColor(R.id.widget_trend_value, COLOR_TREND_VALUE);
        }

        // trendLine is never empty in practice — src/lib/widgets.ts always
        // has SOMETHING to say here (a real trend, an evidence-floor count,
        // or the empty-state prompt) — but hidden-when-empty defensively
        // anyway, matching every other line on this widget, rather than
        // trusting that invariant to hold forever.
        if (trendLine.isEmpty()) {
            views.setViewVisibility(R.id.widget_trend_line, View.GONE);
        } else {
            views.setViewVisibility(R.id.widget_trend_line, View.VISIBLE);
            views.setTextViewText(R.id.widget_trend_line, trendLine);
            views.setTextColor(R.id.widget_trend_line, COLOR_TREND_LINE);
        }

        applyShapeLine(views, R.id.widget_shape_line1, shapeLine1, shapeMet);
        applyShapeLine(views, R.id.widget_shape_line2, shapeLine2, shapeMet);
    }

    /**
     * One daily-shape component line: hidden entirely when there's nothing
     * to say (no target set at all, or this component opted out at 0 —
     * src/lib/dailyShape.ts's formatCheckInsLine/formatStepsLine already
     * return null for both cases, and src/lib/widgets.ts turns that into an
     * empty string for the JSON snapshot), tinted emerald only when the
     * WHOLE day's shape is met — a single component can't be "met" on its
     * own colour-wise, matching Home.tsx's own all-or-nothing tint (both
     * component lines share the same met/unmet colour there too, not one
     * line lighting up before the other).
     */
    private void applyShapeLine(RemoteViews views, int viewId, String text, boolean shapeMet) {
        if (text.isEmpty()) {
            views.setViewVisibility(viewId, View.GONE);
            views.setTextViewText(viewId, "");
            return;
        }
        views.setViewVisibility(viewId, View.VISIBLE);
        views.setTextViewText(viewId, text);
        views.setTextColor(viewId, shapeMet ? COLOR_SHAPE_MET : COLOR_SHAPE_UNMET);
    }
}
