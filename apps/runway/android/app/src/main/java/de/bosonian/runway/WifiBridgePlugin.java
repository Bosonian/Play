package de.bosonian.runway;

// ARCHITECTURE RULE (same as WidgetBridgePlugin.java/CalendarBridgePlugin.java):
// this plugin moves data across the JS<->native boundary and nothing more.
// Which SSID (if any) a departure is waiting for, the case-insensitive
// match, and the arrivedAt write all live in TypeScript (Runway.tsx) — this
// file has no business logic beyond the Android Wi-Fi query itself.

import android.Manifest;
import android.content.Context;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * The JS<->native bridge for reading the phone's currently-connected Wi-Fi
 * SSID — arrival-detection increment (0.23.0): when Runway.tsx's journey
 * phase sees the phone join the network configured on a departure's
 * `arrivalWifiSsid`, it stamps `arrivedAt` automatically instead of waiting
 * for the manual "I'm at the building" tap. One method, `getCurrentSsid`.
 * See src/native/wifi.ts for the JS side (the only file that calls into
 * this plugin).
 *
 * Permission shape mirrors CalendarBridgePlugin.java exactly: a single
 * `@Permission` with an alias, read via `getPermissionState(alias)`, no
 * override of checkPermissions/requestPermissions — the default `Plugin`
 * implementation already reports/requests the alias and nothing else (see
 * that file's own class doc comment for why that's sufficient here too).
 * The alias is "location", not "wifi": on Android, reading the REAL SSID of
 * the current connection (as opposed to the redacted `<unknown ssid>`
 * placeholder) requires ACCESS_FINE_LOCATION, because which network a phone
 * is joined to can approximate its position. The geolocation plugin
 * (src/native/geolocation.ts, @capacitor/geolocation) already requests this
 * exact OS permission at runtime for live travel, so most users who've used
 * that feature have already granted it by the time this plugin's caller
 * needs it — but this plugin still checks for itself, since arrival Wi-Fi
 * detection can be configured without live travel ever having been turned
 * on, and never prompts on its own (see getCurrentSsid's own doc comment).
 */
@CapacitorPlugin(
    name = "WifiBridge",
    permissions = @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = WifiBridgePlugin.LOCATION_ALIAS)
)
public class WifiBridgePlugin extends Plugin {

    static final String LOCATION_ALIAS = "location";

    /**
     * Resolves to `{ ssid: string }` — never rejects. An empty string means
     * "nothing usable right now": permission not granted, no WifiManager
     * available, no active connection, or Android's own placeholder for
     * "SSID withheld" (`<unknown ssid>`, which Android can still return even
     * after a permission check passes here, e.g. a race with the user
     * revoking permission mid-call — belt and suspenders, same defensive
     * shape CalendarBridgePlugin's null-title/-location handling uses).
     * Modeled as a soft "nothing to report" rather than a rejected promise
     * because the caller (Runway.tsx's arrival-phase effect) polls this
     * opportunistically on mount and on the app regaining visibility — an
     * ordinary, frequent, and expected outcome there, not an exceptional
     * one that deserves try/catch ceremony at every call site.
     *
     * Deliberately does NOT request the permission itself if missing — same
     * lazy-permission reasoning as CalendarBridgePlugin's listUpcomingEvents:
     * this is called from a passive background poll, not an explicit tap,
     * and auto-prompting from there would surprise a permission dialog into
     * existence with no tap behind it (CLAUDE.md's no-permission-ambush
     * rule). There is no explicit request path for this plugin's alias
     * either, unlike Calendar's requestCalendarAccess() — see wifi.ts's own
     * doc comment for why that's an accepted, named tradeoff for this
     * feature's small footprint (one optional text field), not an oversight.
     */
    @PluginMethod
    public void getCurrentSsid(PluginCall call) {
        JSObject result = new JSObject();

        if (getPermissionState(LOCATION_ALIAS) != PermissionState.GRANTED) {
            result.put("ssid", "");
            call.resolve(result);
            return;
        }

        Context context = getContext().getApplicationContext();
        WifiManager wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
        if (wifiManager == null) {
            result.put("ssid", "");
            call.resolve(result);
            return;
        }

        // WifiManager#getConnectionInfo() is deprecated from API 31 onward,
        // in favour of registering a ConnectivityManager.NetworkCallback and
        // reading WifiInfo off the active NetworkCapabilities instead. That
        // replacement is built for a LONG-LIVED listener — register once,
        // react to every future network change, unregister on teardown — not
        // a one-shot "what's the SSID right now" query, which is all this
        // method ever needs to answer. Adopting it here would trade one
        // synchronous call for a callback object this plugin would have to
        // create, hold, and clean up for no benefit to a caller that already
        // does its own polling (Runway.tsx, on mount/visibilitychange).
        // Staying with the deprecated call is the deliberately conservative
        // choice: it's still functional through the current target API (see
        // android/variables.gradle), and keeps this method's shape a single
        // line with no lifecycle to get wrong. Revisit only if a future
        // Android version actually removes the method outright rather than
        // just deprecating it.
        WifiInfo info = wifiManager.getConnectionInfo();
        result.put("ssid", normalizeSsid(info != null ? info.getSSID() : null));
        call.resolve(result);
    }

    /**
     * Strips the surrounding quotes Android wraps a real SSID in (e.g.
     * `"Klinikum-Guest"` -> `Klinikum-Guest`), and collapses every
     * "nothing useful here" case — null, blank, or the `<unknown ssid>`
     * placeholder Android returns when it has an active connection but
     * withholds the name — to a plain empty string, so the caller only ever
     * has one "no SSID" value to check against.
     */
    private static String normalizeSsid(String rawSsid) {
        if (rawSsid == null) return "";
        String trimmed = rawSsid.trim();
        if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
            trimmed = trimmed.substring(1, trimmed.length() - 1);
        }
        if (trimmed.isEmpty() || trimmed.equals("<unknown ssid>")) return "";
        return trimmed;
    }
}
