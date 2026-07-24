package de.bosonian.runway;

import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Car Bluetooth transit increment (0.36.0): a manifest-declared
 * BroadcastReceiver for android.bluetooth.device.action.ACL_CONNECTED and
 * ACL_DISCONNECTED — the two system broadcasts Android fires the instant a
 * paired Bluetooth device's link layer actually connects or disconnects
 * (the car's hands-free unit, in this app's one use case).
 *
 * LOAD-BEARING FACT this whole feature rests on: ACL_CONNECTED and
 * ACL_DISCONNECTED are on Android's implicit-broadcast EXEMPTION list. Most
 * implicit broadcasts stopped reaching manifest-declared receivers in a
 * KILLED app as of Android 8 (Oreo) — an app has to be running (or use a
 * different mechanism entirely, like WorkManager) to see most of them — but
 * a documented handful of actions, this pair included, are still delivered
 * to a manifest receiver even when the app has been fully swiped away with
 * no process alive. That's what makes "Runway is closed, the car connects,
 * a drive gets recorded anyway" possible with zero foreground service and
 * zero persistent listener. See BluetoothBridgePlugin.java's own UNVERIFIED
 * note for the real caveat this doesn't cover: Samsung's OWN battery/app-
 * standby deep sleep, a harsher and separate mechanism from stock Android's
 * broadcast exemptions, which the Settings caption (Settings.tsx) tells the
 * user how to work around.
 *
 * PRIVACY / SCOPE: this receiver fires for EVERY paired Bluetooth device's
 * connect/disconnect — Android gives an app no way to subscribe to only one
 * device's events. The very first real thing onReceive does is compare the
 * connecting device's address against the ONE address chosen in Settings
 * ("watched_address") and returns immediately on any mismatch. Runway
 * deliberately records ONE chosen car's connect/disconnect history, never a
 * general Bluetooth-device log of everything the phone has ever paired with
 * (headphones, a smartwatch, a second car) — that would be a far more
 * sensitive, far less relevant log than this feature has any reason to
 * keep.
 */
public class BluetoothTransitReceiver extends BroadcastReceiver {

    static final String PREFS_NAME = "runway_transit";
    static final String KEY_WATCHED_ADDRESS = "watched_address";
    static final String KEY_RING = "ring";

    /**
     * Ring cap — same "bounded local history, not an unbounded log" shape as
     * eventLog.ts's RETAIN_COUNT (2000), just much smaller: 200 raw
     * connect/disconnect events is roughly 100 drives (one connect, one
     * disconnect per drive), which at any plausible real-world driving
     * cadence is months of history — far more than transit.ts's learning
     * math needs (a handful of recent drives per departure name), and small
     * enough that this never grows into a meaningful storage or privacy
     * footprint.
     */
    static final int RING_CAP = 200;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        boolean isConnect = BluetoothDevice.ACTION_ACL_CONNECTED.equals(action);
        boolean isDisconnect = BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action);
        if (!isConnect && !isDisconnect) return;

        BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        if (device == null) return;

        // getAddress() needs no runtime permission on any API level this app
        // targets — unlike getName() (API 31+ needs BLUETOOTH_CONNECT to
        // read it), the MAC address on an ACL broadcast's own EXTRA_DEVICE
        // has always been readable with no permission check. That's exactly
        // why this receiver never touches device.getName(): it has no use
        // for a display name, only the address to compare against the one
        // the user chose.
        String address = device.getAddress();
        if (address == null) return;

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String watchedAddress = prefs.getString(KEY_WATCHED_ADDRESS, null);
        // No car chosen yet, or this is some OTHER paired device (headphones,
        // a watch, a different car) connecting/disconnecting — see this
        // class's own privacy comment above for why this check has to be
        // the first real thing onReceive does.
        if (watchedAddress == null || !watchedAddress.equals(address)) return;

        appendEvent(prefs, isConnect ? "c" : "d", System.currentTimeMillis());
    }

    private static void appendEvent(SharedPreferences prefs, String action, long atMs) {
        JSONArray ring = readRing(prefs);
        JSONObject event = new JSONObject();
        try {
            event.put("a", action);
            event.put("at", atMs);
        } catch (JSONException e) {
            // Unreachable for two literal string/long puts — JSONObject#put
            // only declares the checked exception for a non-finite Double,
            // which never applies here. Guarded anyway rather than asserted
            // away, since a receiver crashing on a malformed broadcast is
            // strictly worse than silently dropping one event.
            return;
        }
        ring.put(event);

        // Drop oldest until back at the cap. A plain loop, not a single
        // bulk trim: at most one event lands per real connect/disconnect,
        // so this only ever has one entry to drop in practice.
        while (ring.length() > RING_CAP) {
            ring.remove(0);
        }

        prefs.edit().putString(KEY_RING, ring.toString()).apply();
    }

    /** Shared with BluetoothBridgePlugin.readTransitEvents — the one place
     * both files agree on how the ring is encoded (a JSON array string
     * under KEY_RING, oldest first). Returns an empty array for "never
     * written yet" and for a corrupt value, rather than throwing — a
     * malformed ring is exactly as recoverable as an empty one: there is
     * nothing to salvage from it either way. */
    static JSONArray readRing(SharedPreferences prefs) {
        String raw = prefs.getString(KEY_RING, null);
        if (raw == null) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
