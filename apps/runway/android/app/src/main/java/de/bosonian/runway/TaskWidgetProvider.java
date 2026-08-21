package de.bosonian.runway;

// ARCHITECTURE RULE (anti-rot increment 3, Runway 0.39.0): all business
// logic — which task is the headline (soonest deadline, past-deadline
// included and winning), the due/start-by line, the armed/to-arm counts —
// lives in TypeScript (src/lib/widgetSnapshot.ts's selectWidgetTask /
// formatTaskCountsLine / buildTaskWidgetData). This class is display
// plumbing only, same rule PruefungWidgetProvider/DepartureWidgetProvider
// already follow — but stricter than either: it performs ZERO date
// arithmetic and ZERO counting of its own. Unlike the Prüfung widget (which
// calendar-slides a date forward) or the departure widget (which re-checks
// "now" against an expiry threshold every redraw), every string this class
// renders is already a finished, prebaked value straight off the JSON
// snapshot — see renderSnapshot below.

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
 * The "Runway Tasks" home-screen widget: up to three lines — the soonest
 * armed deadline (task name, bold, plus "due HH:mm[ · start by HH:mm]"), or
 * "No armed deadlines." when no planned/running task carries one, plus an
 * optional "{N} armed · {M} to arm" counts line — rendered from the same
 * JSON snapshot WidgetBridgePlugin.updateSnapshot writes to
 * SharedPreferences, under the "tasks" key. Tapping anywhere opens the app
 * at Home via the `runway://home` deep link (src/native/deepLinks.ts) —
 * deliberately NOT a per-task deep link the way the departure widget's tap
 * target is: this widget's own spec is "open the app at Home", not "jump
 * straight into running this specific task", so there is exactly one tap
 * destination regardless of what's on screen.
 */
public class TaskWidgetProvider extends AppWidgetProvider {

    // Same file+key WidgetBridgePlugin writes — see that class's own
    // comment on why these are declared in one place, not duplicated.
    private static final String PREFS_NAME = WidgetBridgePlugin.PREFS_NAME;
    private static final String SNAPSHOT_KEY = WidgetBridgePlugin.SNAPSHOT_KEY;

    private static final String FALLBACK_LINE1 = "Open Runway once to fill this widget.";
    // Distinct from FALLBACK_LINE1 — a snapshot that DOES exist (the app
    // has run at least once) but whose "tasks.task" is null means there is
    // simply no planned/running task with a deadline right now, which is a
    // perfectly normal, calm state — same "no snapshot ever" vs. "a
    // snapshot with nothing in this particular slot" distinction
    // PruefungWidgetProvider's NO_EXAM_LINE1 already documents for its own
    // widget.
    private static final String NO_ARMED_LINE1 = "No armed deadlines.";

    // Muted secondary tone — the exact slate-400 colour widget_task.xml's
    // own line2/line3 already use statically (android:textColor="#94A3B8")
    // — reused here programmatically for the ONE line1 case that isn't a
    // real task name (NO_ARMED_LINE1/FALLBACK_LINE1). Unlike
    // PruefungWidgetProvider's COLOR_CALM (a "calm relative to red/amber"
    // band on a widget that DOES have late/tight/calm state banding), this
    // widget has no dynamic colour banding on a real headline task at all —
    // it's a binary "a task name is showing, or a muted status line is" —
    // so it can afford a genuinely muted secondary colour here rather than
    // a calm-relative-to-urgent one that would have no urgent counterpart
    // to be relative to.
    private static final int COLOR_SECONDARY = 0xFF94A3B8;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateOne(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateOne(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_task);

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
                // covers the schema-upgrade window: a snapshot written by a
                // pre-0.39.0 APK build has no "tasks" key at all, so
                // root.getJSONObject("tasks") below throws JSONException
                // rather than silently misreading a missing field, landing
                // here too — same accepted, self-healing window
                // PruefungWidgetProvider's own JSONException comment
                // documents (the next app open overwrites SharedPreferences
                // with a current-schema snapshot).
                renderFallback(views);
            }
        }

        // Always runway://home, regardless of what's on screen — see this
        // class's own header comment for why a per-task deep link is
        // deliberately not offered here, unlike DepartureWidgetProvider's
        // per-departure tap target.
        Intent tapIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("runway://home"));
        tapIntent.setPackage(context.getPackageName());
        // FLAG_IMMUTABLE per the same reasoning as the other two widgets'
        // own tap PendingIntent (this is never modified by the receiving
        // side, and Android 12+ requires one of IMMUTABLE/MUTABLE set
        // explicitly).
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, tapIntent, PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_task_root, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private void renderFallback(RemoteViews views) {
        views.setTextViewText(R.id.widget_task_line1, FALLBACK_LINE1);
        views.setTextColor(R.id.widget_task_line1, COLOR_SECONDARY);
        views.setTextViewText(R.id.widget_task_line2, "");
        views.setTextViewText(R.id.widget_task_line3, "");
    }

    /**
     * Renders the widget from the JSON snapshot's "tasks" key. Unlike
     * "pruefung"/"departure" (each null when nothing qualifies at all — see
     * PruefungWidgetProvider/DepartureWidgetProvider's own null checks),
     * "tasks" itself is NEVER null (src/lib/widgetSnapshot.ts's
     * TaskWidgetData is always built) — only its nested "task" field is,
     * when no planned/running task carries a deadline. See that type's own
     * doc comment for why an empty tasks widget is a meaningful,
     * always-renderable state rather than a "nothing written yet" gap.
     */
    private void renderSnapshot(RemoteViews views, String snapshotJson) throws JSONException {
        JSONObject root = new JSONObject(snapshotJson);
        JSONObject tasksData = root.getJSONObject("tasks");

        if (tasksData.isNull("task")) {
            views.setTextViewText(R.id.widget_task_line1, NO_ARMED_LINE1);
            views.setTextColor(R.id.widget_task_line1, COLOR_SECONDARY);
            views.setTextViewText(R.id.widget_task_line2, "");
        } else {
            JSONObject task = tasksData.getJSONObject("task");
            views.setTextViewText(R.id.widget_task_line1, task.getString("nameLine"));
            // No colour override here — widget_task.xml's default line1
            // style (bold, #F1F5F9) is what a real headline task renders
            // in; only the NO_ARMED_LINE1/FALLBACK_LINE1 branches above
            // ever mute it.
            views.setTextViewText(R.id.widget_task_line2, task.getString("dueLine"));
        }

        // countsLine is independent of whether a headline task exists — see
        // widgetSnapshot.ts's formatTaskCountsLine doc comment: armedCount
        // counts EVERY planned/running task (a task with no deadline still
        // counts, even though it can never be the headline), and toArmCount
        // counts captured tasks, neither of which requires a headline task
        // to be showing. isNull covers both "the key is JSON null"
        // (formatTaskCountsLine returned null — nothing to report) and a
        // missing key the same way (a pre-0.39.0 snapshot has no "tasks"
        // key at all, which already throws above before reaching this
        // line — this isNull check is for the ordinary "both counts are
        // zero" case within an up-to-date snapshot).
        views.setTextViewText(
            R.id.widget_task_line3,
            tasksData.isNull("countsLine") ? "" : tasksData.getString("countsLine")
        );
    }
}
