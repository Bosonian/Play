package de.bosonian.tide;

// Widget increment (0.9.0), ported from apps/runway's
// WidgetBridgePlugin.java — same ARCHITECTURE RULE that file's header
// comment states: all business math (the trend engine, daily-shape
// progress, the exact copy Home.tsx shows) lives in TypeScript
// (src/lib/trend.ts, src/lib/dailyShape.ts, src/lib/widgets.ts). This
// plugin does none of that: it only moves an already-computed JSON string
// from JS into Android SharedPreferences and pokes the one widget provider
// to redraw. No date arithmetic, no formatting, happens here at all.
//
// Tide has exactly ONE widget (unlike Runway's three), so this is a
// simplified port — one PREFS_NAME/SNAPSHOT_KEY pair, one provider to poke,
// no per-provider "which one changed" question to skip.

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
 * file, then ask the Tide widget provider to redraw from it. See
 * src/native/widgetBridge.ts for the JS side (the only file that calls
 * into this plugin) and src/lib/widgets.ts for what the JSON actually
 * contains.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    // Shared with TideWidgetProvider, which reads this same file and key —
    // kept as package-visible constants here (not duplicated as string
    // literals there) so the two can't drift apart. Same "tide_" prefix
    // convention as every other Tide-specific SharedPreferences file would
    // use, distinct from Runway's own "runway_widgets" (separate app,
    // separate process, but naming them distinctly costs nothing and rules
    // out any confusion if the two are ever inspected side by side on the
    // same device via adb).
    static final String PREFS_NAME = "tide_widgets";
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
        // One .apply() call — the whole snapshot (trendValue, trendLine,
        // shapeLine1, shapeLine2, shapeMet, updatedAt, all pre-serialised
        // into one JSON string by src/lib/widgets.ts) lands in
        // SharedPreferences atomically as a single batch, never as five
        // separate keys that a redraw could read mid-write.
        prefs.edit().putString(SNAPSHOT_KEY, snapshot).apply();

        requestWidgetRefresh(context);
        call.resolve();
    }

    /**
     * Asks every placed instance of the Tide widget to redraw from the
     * SharedPreferences value just written.
     *
     * Uses a plain broadcast of ACTION_APPWIDGET_UPDATE — the conservative
     * choice per this increment's brief — rather than
     * AppWidgetManager.notifyAppWidgetViewDataChanged(), which exists for
     * RemoteViewsService-backed collection widgets (list/grid widgets with
     * their own adapter). This widget is a handful of plain TextViews with
     * no adapter, so notifyAppWidgetViewDataChanged() doesn't apply;
     * re-delivering ACTION_APPWIDGET_UPDATE straight to the provider is
     * what actually triggers a fresh onUpdate() call. Same reasoning
     * Runway's own WidgetBridgePlugin documents at length for its three
     * providers.
     */
    private void requestWidgetRefresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, TideWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        if (ids.length == 0) return; // no widget currently placed on any home screen

        Intent intent = new Intent(context, TideWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
