package de.bosonian.runway;

// ARCHITECTURE RULE (widgets increment, Runway 0.10.0): all business math —
// pace, remaining hours, the ready-date projection — lives in TypeScript
// (src/lib/examProjection.ts, src/lib/widgetSnapshot.ts). This plugin does
// none of that: it only moves an already-computed JSON string from JS into
// Android SharedPreferences and pokes the widget provider to redraw. No
// date arithmetic happens here at all.

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The JS↔native bridge for the home-screen widget. One method,
 * `updateSnapshot`: write the latest snapshot JSON to a SharedPreferences
 * file, then ask the widget provider to redraw from it. See
 * src/native/widgetBridge.ts for the JS side (the only file that calls
 * into this plugin).
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    // Shared with PruefungWidgetProvider, which reads this same file and
    // key — kept as package-visible constants here (not duplicated as
    // string literals in the provider) so the two can't drift apart.
    static final String PREFS_NAME = "runway_widgets";
    static final String SNAPSHOT_KEY = "snapshot";

    @PluginMethod
    public void updateSnapshot(PluginCall call) {
        String snapshot = call.getString("snapshot");
        if (snapshot == null) {
            call.reject("snapshot is required");
            return;
        }

        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(SNAPSHOT_KEY, snapshot).apply();

        requestWidgetRefresh(context);
        call.resolve();
    }

    /**
     * Asks every placed instance of the Prüfung widget to redraw from the
     * SharedPreferences value just written.
     *
     * Uses a plain broadcast of ACTION_APPWIDGET_UPDATE — the conservative
     * choice per this increment's brief — rather than
     * AppWidgetManager.notifyAppWidgetViewDataChanged(), which exists for
     * RemoteViewsService-backed collection widgets (list/grid widgets with
     * their own adapter). This widget is a handful of plain TextViews with
     * no adapter, so notifyAppWidgetViewDataChanged() doesn't apply here;
     * re-delivering ACTION_APPWIDGET_UPDATE straight to the provider is
     * what actually triggers a fresh onUpdate() call.
     */
    private void requestWidgetRefresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, PruefungWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        if (ids.length == 0) return; // no widget currently placed on any home screen

        Intent intent = new Intent(context, PruefungWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
