package de.bosonian.runway;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Widgets increment (Runway 0.10.0): registers WidgetBridgePlugin, the
 * app's first custom (non-npm) Capacitor plugin.
 *
 * The registerPlugin() call has to happen BEFORE super.onCreate() runs, not
 * after: BridgeActivity.onCreate() (see
 * node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java)
 * loads every registered plugin into the Bridge and calls load() at the end
 * of its own onCreate() — by the time super.onCreate() returns, the plugin
 * list is already frozen for this Activity instance. registerPlugin() only
 * appends to `bridgeBuilder`, a field initialised at construction time
 * (`protected final Bridge.Builder bridgeBuilder = new Bridge.Builder(this);`
 * in BridgeActivity), so it's already safe to call before super.onCreate()
 * runs — the object it writes to exists before onCreate() is ever invoked.
 * This is the standard Capacitor pattern for registering a plugin that
 * doesn't ship as an npm package.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
