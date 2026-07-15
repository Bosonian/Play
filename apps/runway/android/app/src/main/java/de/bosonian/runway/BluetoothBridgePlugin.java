package de.bosonian.runway;

// ARCHITECTURE RULE (same as WifiBridgePlugin.java/CalendarBridgePlugin.java/
// DayGaugePlugin.java): this plugin moves data across the JS<->native
// boundary and nothing more. Pairing a drive window to a departure, deciding
// what counts as a measurable drive, and the suggestion math all live in
// TypeScript (src/lib/transit.ts, src/lib/transitSync.ts) — this file only
// knows how to ask Android's Bluetooth APIs a question and configure/read
// the SharedPreferences ring BluetoothTransitReceiver.java writes to.

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The JS<->native bridge for "watch one car's Bluetooth connect/disconnect
 * as its own drive-time measurement" (car Bluetooth transit increment,
 * 0.36.0). See src/native/bluetooth.ts for the JS side (the only file that
 * calls into this plugin) and BluetoothTransitReceiver.java for the actual
 * event capture — that receiver is what fires even with this app fully
 * killed; this plugin only runs while Runway is open, to configure which
 * device is watched, list candidates to choose from, and read back what the
 * receiver has recorded.
 *
 * PERMISSION SHAPE (worth stating precisely — this is the one plugin in this
 * app whose permission requirement changes with the OS version, not just
 * with what it's asking for). Bluetooth device access on Android 11 and
 * below rides on the plain `BLUETOOTH` permission — a NORMAL, install-time
 * permission with no runtime dialog at all. From Android 12 (API 31) onward,
 * `BLUETOOTH_CONNECT` is a DANGEROUS runtime permission instead, requested
 * the same way CalendarBridgePlugin requests READ_CALENDAR: a single
 * `@Permission` alias, checked via `getPermissionState`, requested via
 * Capacitor's `requestPermissionForAlias` + `@PermissionCallback` pair (the
 * manual request path a plugin method uses when IT needs to trigger the
 * dialog mid-call, rather than the generic inherited `requestPermissions()`
 * PluginMethod every other plugin in this app exposes for a caller-driven
 * request — chosen here because `ensurePermission` below also needs the
 * "below API 31, resolve granted with no request at all" branch, which the
 * generic method has no way to express). Both permissions are declared in
 * AndroidManifest.xml — `BLUETOOTH_CONNECT` plain, legacy `BLUETOOTH` with
 * `maxSdkVersion="30"` so it never shadows the runtime one on newer OSes.
 */
@CapacitorPlugin(
    name = "BluetoothBridge",
    permissions = @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = BluetoothBridgePlugin.BLUETOOTH_ALIAS)
)
public class BluetoothBridgePlugin extends Plugin {

    static final String BLUETOOTH_ALIAS = "bluetooth";

    /**
     * Resolves to `{ granted: boolean }`, never rejects. Below API 31 this
     * always resolves `true` with no permission machinery touched at all —
     * BLUETOOTH_CONNECT doesn't exist as a runtime permission there, and the
     * legacy `BLUETOOTH` permission (manifest-declared, maxSdkVersion="30")
     * is already auto-granted at install. From API 31 on, this triggers the
     * real runtime dialog unless already granted. Called only from an
     * explicit tap ("Choose car" on Settings) — never from a passive
     * background poll — so there is no no-permission-ambush concern here the
     * way WifiBridgePlugin's getCurrentSsid has to guard against.
     */
    @PluginMethod
    public void ensurePermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState(BLUETOOTH_ALIAS) == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias(BLUETOOTH_ALIAS, call, "handleEnsurePermissionResult");
    }

    @PermissionCallback
    private void handleEnsurePermissionResult(PluginCall call) {
        resolveGranted(call, getPermissionState(BLUETOOTH_ALIAS) == PermissionState.GRANTED);
    }

    private static void resolveGranted(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    /**
     * Resolves to `{ devices: [{name, address}] }` — the phone's already-
     * paired ("bonded") devices, for Settings' "Choose car" list. Empty
     * array, never a rejection, when permission is missing, the adapter is
     * unavailable, or any Bluetooth API call throws (a small number of OEM
     * builds are known to throw SecurityException from getBondedDevices()/
     * getName() even when getPermissionState reports GRANTED — a documented
     * Android inconsistency, not something this method can fully rule out,
     * so the try/catch is real defense, not ceremony).
     */
    @PluginMethod
    public void getBondedDevices(PluginCall call) {
        JSArray devices = new JSArray();

        boolean permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState(BLUETOOTH_ALIAS) == PermissionState.GRANTED;
        if (permitted) {
            try {
                BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
                BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
                if (adapter != null) {
                    Set<BluetoothDevice> bonded = adapter.getBondedDevices();
                    for (BluetoothDevice device : bonded) {
                        String name = device.getName();
                        JSObject entry = new JSObject();
                        entry.put("name", name == null ? "" : name);
                        entry.put("address", device.getAddress());
                        devices.put(entry);
                    }
                }
            } catch (SecurityException e) {
                // Empty list is the correct fallback — see this method's own
                // doc comment above.
            }
        }

        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    /**
     * Expects `{ address: string }`. Writes the watched address into the
     * SAME SharedPreferences file BluetoothTransitReceiver.java reads from
     * (`runway_transit`, key `watched_address`) and clears any previously
     * recorded ring in the same edit — switching to a different car must
     * never let the old car's connect/disconnect history blend into the new
     * one's, since transit.ts's matching and median math has no way to tell
     * the two apart once they're in the same ring. Device NAME is
     * deliberately not written here at all: this plugin only ever needs the
     * address to decide whether to record an event, and the display name
     * Settings.tsx shows ("Watching: {name}.") is kept entirely on the JS
     * side (src/lib/transitSettings.ts's WATCHED_DEVICE_NAME_SETTING) — see
     * this class's own header comment on the architecture rule this follows.
     */
    @PluginMethod
    public void setWatchedDevice(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("address is required");
            return;
        }

        SharedPreferences prefs = getContext().getSharedPreferences(BluetoothTransitReceiver.PREFS_NAME, Context.MODE_PRIVATE);
        prefs
            .edit()
            .putString(BluetoothTransitReceiver.KEY_WATCHED_ADDRESS, address)
            .remove(BluetoothTransitReceiver.KEY_RING)
            .apply();
        call.resolve();
    }

    /** Clears the watched address and the recorded ring — "Stop watching" on
     * Settings. Safe to call unconditionally, same "no crash on an
     * already-cleared state" shape every other clear-style call in this
     * app's plugins follows. */
    @PluginMethod
    public void clearWatchedDevice(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(BluetoothTransitReceiver.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(BluetoothTransitReceiver.KEY_WATCHED_ADDRESS).remove(BluetoothTransitReceiver.KEY_RING).apply();
        call.resolve();
    }

    /**
     * Resolves to `{ events: [{action, atMs}] }` — the raw ring
     * BluetoothTransitReceiver.java has recorded, decoded from its compact
     * `{a: 'c'|'d', at: epochMs}` JSON shape into the fuller
     * `'connected'|'disconnected'` strings src/lib/transit.ts's
     * `transitWindows` expects. A malformed entry (should be unreachable —
     * the receiver is the only writer — but defended anyway, same
     * "never trust a stored blob completely" caution CalendarBridgePlugin's
     * defensive RRULE read already sets as this app's own precedent) is
     * skipped rather than aborting the whole read.
     */
    @PluginMethod
    public void readTransitEvents(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(BluetoothTransitReceiver.PREFS_NAME, Context.MODE_PRIVATE);
        JSONArray ring = BluetoothTransitReceiver.readRing(prefs);

        JSArray events = new JSArray();
        for (int i = 0; i < ring.length(); i++) {
            JSONObject event = ring.optJSONObject(i);
            if (event == null) continue;
            String action = event.optString("a", "");
            long atMs = event.optLong("at", -1);
            if (atMs < 0 || !("c".equals(action) || "d".equals(action))) continue;

            JSObject entry = new JSObject();
            entry.put("action", "c".equals(action) ? "connected" : "disconnected");
            entry.put("atMs", atMs);
            events.put(entry);
        }

        JSObject result = new JSObject();
        result.put("events", events);
        call.resolve(result);
    }
}
