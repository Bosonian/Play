package de.bosonian.runway;

import android.content.Intent;
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
        // m6: a task relaunched from the Recents list after its process was
        // killed redelivers the ORIGINAL launch intent — including whatever
        // runway:// deep-link data URI it carried, e.g. a widget tap that
        // cold-started the app hours or days ago. BridgeActivity.load()
        // (called from super.onCreate() below) reads getIntent() and
        // synthesizes a retained appUrlOpen event from it (see
        // deepLinks.ts's own corrected comment on why that path exists), so
        // without stripping the stale data here first, resuming from
        // Recents would re-navigate to that old target instead of landing
        // on Home — which is what resuming a recents entry should do. This
        // has to run BEFORE super.onCreate(), same ordering reason as
        // registerPlugin() below: super.onCreate() is what reads
        // getIntent() and acts on it, so the strip must land first.
        if ((getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            setIntent(new Intent(getIntent()).setData(null).setAction(Intent.ACTION_MAIN));
        }

        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
