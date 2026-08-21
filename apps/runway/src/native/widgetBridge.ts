import { Capacitor, registerPlugin } from '@capacitor/core';

// The ONLY file that imports the WidgetBridge plugin — same one-choke-point
// pattern as notifications.ts/geolocation.ts/keepAwake.ts. Unlike those
// three, WidgetBridge is not an npm package: it's a plugin defined directly
// inside this app's own Android project
// (android/app/src/main/java/de/bosonian/runway/WidgetBridgePlugin.java),
// registered by MainActivity rather than auto-discovered from
// node_modules. registerPlugin<T>() below still works for a plugin shaped
// like this — the JS bridge only needs the plugin's *name* to route calls
// to it (it must match the Java class's `@CapacitorPlugin(name =
// "WidgetBridge")` exactly), not an npm package to import the native side
// from.

interface WidgetBridgePlugin {
  /** Writes `snapshot` (an already JSON.stringify'd WidgetSnapshot — see
   * src/lib/widgetSnapshot.ts) to Android SharedPreferences and asks every
   * placed instance of the Prüfung widget to redraw immediately. */
  updateSnapshot(options: { snapshot: string }): Promise<void>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

/**
 * Pushes the latest widget snapshot to native. Native-gated no-op on web —
 * there is no SharedPreferences file and no home-screen widget outside
 * Android, so a plain web/dev session has nothing for this call to do.
 */
export async function updateWidgetSnapshot(snapshotJson: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await WidgetBridge.updateSnapshot({ snapshot: snapshotJson });
}
