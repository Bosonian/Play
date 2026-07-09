package de.bosonian.runway;

// ARCHITECTURE RULE (widgets increment, Runway 0.10.0 W1 / 0.11.0 W2): all
// business math — pace, remaining hours, the ready-date projection, the
// departure projection/plan lines — lives in TypeScript
// (src/lib/examProjection.ts, src/lib/projection.ts,
// src/lib/widgetSnapshot.ts). This plugin does none of that: it only moves
// an already-computed JSON string from JS into Android SharedPreferences and
// pokes both widget providers to redraw. No date arithmetic happens here at
// all.

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The JS↔native bridge for the home-screen widgets. One method,
 * `updateSnapshot`: write the latest snapshot JSON to a SharedPreferences
 * file, then ask both widget providers to redraw from it. See
 * src/native/widgetBridge.ts for the JS side (the only file that calls
 * into this plugin).
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    // Shared with PruefungWidgetProvider and DepartureWidgetProvider, which
    // both read this same file and key — kept as package-visible constants
    // here (not duplicated as string literals in either provider) so the
    // three can't drift apart.
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

        // One snapshot write can change what either widget shows (a sprint
        // ending moves pruefung; a departure save/leave/abandon moves
        // departure) — poking both unconditionally is simpler and cheaper
        // than parsing the JSON here just to decide which one actually
        // changed, and requestWidgetRefresh already no-ops per-provider
        // when that provider has no placed instances.
        requestWidgetRefresh(context, PruefungWidgetProvider.class);
        requestWidgetRefresh(context, DepartureWidgetProvider.class);
        call.resolve();
    }

    /**
     * Asks every placed instance of the given widget provider to redraw
     * from the SharedPreferences value just written.
     *
     * Uses a plain broadcast of ACTION_APPWIDGET_UPDATE — the conservative
     * choice per this increment's brief — rather than
     * AppWidgetManager.notifyAppWidgetViewDataChanged(), which exists for
     * RemoteViewsService-backed collection widgets (list/grid widgets with
     * their own adapter). Both widgets here are a handful of plain
     * TextViews with no adapter, so notifyAppWidgetViewDataChanged() doesn't
     * apply to either; re-delivering ACTION_APPWIDGET_UPDATE straight to the
     * provider is what actually triggers a fresh onUpdate() call.
     */
    private void requestWidgetRefresh(Context context, Class<? extends AppWidgetProvider> providerClass) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, providerClass);
        int[] ids = manager.getAppWidgetIds(provider);
        if (ids.length == 0) return; // no widget of this kind currently placed on any home screen

        Intent intent = new Intent(context, providerClass);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
