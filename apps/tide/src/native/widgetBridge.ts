import { Capacitor, registerPlugin } from '@capacitor/core';

// Widget increment (0.9.0), ported from apps/runway's own
// src/native/widgetBridge.ts. The ONLY file that imports the WidgetBridge
// plugin — same one-choke-point pattern as native/healthConnect.ts/
// native/haptics.ts. Not an npm package: it's a plugin defined directly
// inside this app's own Android project
// (android/app/src/main/java/de/bosonian/tide/WidgetBridgePlugin.java),
// registered by MainActivity rather than auto-discovered from
// node_modules. registerPlugin<T>() still works for a plugin shaped like
// this — the JS bridge only needs the plugin's *name* to route calls to it
// (it must match the Java class's `@CapacitorPlugin(name = "WidgetBridge")`
// exactly), not an npm package to import the native side from.

interface WidgetBridgePlugin {
  /** Writes `snapshot` (an already JSON.stringify'd TideWidgetSnapshot —
   * see src/lib/widgets.ts) to Android SharedPreferences and asks the Tide
   * widget to redraw immediately. */
  updateSnapshot(options: { snapshot: string }): Promise<void>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

/**
 * Pushes the latest widget snapshot to native. No-ops on web/dev — there is
 * no SharedPreferences file and no home-screen widget outside Android, same
 * `Capacitor.isNativePlatform()` gate every other native chokepoint in this
 * app uses (haptics.ts, healthConnect.ts). Never throws: a widget refresh
 * is a display nicety layered on top of a write that has already succeeded
 * on its own (a weigh-in saved, a plate logged, a sync completed) — a
 * native call failure here (a plugin not yet registered on an old running
 * instance, a transient bridge error) must never surface as a failure of
 * whatever screen action triggered the refresh. Callers (src/lib/widgets.ts)
 * already wrap their own Dexie reads in a try/catch for the same reason;
 * this function guards its own one native call independently, so the
 * "never throws" contract holds even if this were ever called from
 * somewhere else.
 */
export async function updateWidgetSnapshot(snapshotJson: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WidgetBridge.updateSnapshot({ snapshot: snapshotJson });
  } catch (err) {
    console.warn('Tide: WidgetBridge.updateSnapshot failed', err);
  }
}
