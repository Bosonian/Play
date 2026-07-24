package de.bosonian.tide;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Health Connect bridge increment (0.3.0) adds this app's first custom
 * (non-npm) Capacitor plugin, HealthConnectPlugin.kt — see that file's own
 * header comment for why it's Kotlin rather than Java, and for its
 * permission-contract shape. Widget increment (0.9.0) adds
 * WidgetBridgePlugin.java the same way — plain Java, no coroutine API to
 * justify Kotlin, matching Runway's own widget plugin.
 *
 * registerPlugin() has to run BEFORE super.onCreate(), not after —
 * BridgeActivity.onCreate() (see
 * node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java)
 * loads every registered plugin into the Bridge and calls load() on each by
 * the end of its own onCreate(); by the time super.onCreate() returns, the
 * plugin list is already frozen for this Activity instance. registerPlugin()
 * only appends to `bridgeBuilder`, a field initialised at construction time
 * (`protected final Bridge.Builder bridgeBuilder = new Bridge.Builder(this);`
 * in BridgeActivity), so it's already safe to call before super.onCreate()
 * runs. Same ordering rule apps/runway's own MainActivity.java documents at
 * length for its five plugins.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HealthConnectPlugin.class);
        // Widget increment (0.9.0): WidgetBridgePlugin.java.
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
