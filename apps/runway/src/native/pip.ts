import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

// The ONLY file that imports the PipBridge plugin — same one-choke-point
// pattern as widgetBridge.ts/dayGauge.ts. Like those two, PipBridge is not
// an npm package: it's defined directly inside this app's own Android
// project (android/app/src/main/java/de/bosonian/runway/PipBridgePlugin.java),
// registered by MainActivity rather than auto-discovered from node_modules —
// registerPlugin<T>() below only needs the plugin's *name* to route calls to
// it (must match the Java class's `@CapacitorPlugin(name = "PipBridge")`
// exactly), not an npm package to import the native side from.

interface PipModeChangedEvent {
  isInPip: boolean;
}

interface PipBridgePlugin {
  /** Whether Picture-in-Picture is available on this device — see
   * PipBridgePlugin.isSupported's own doc comment for the exact two
   * conditions this checks natively (API level AND the hardware feature). */
  isSupported(): Promise<{ supported: boolean }>;
  /** Arms (or disarms) auto-enter for the NEXT time this app leaves the
   * foreground. See PipBridgePlugin.setAutoEnter's own doc comment for the
   * API 26-30 vs. 31+ split — both paths are handled entirely on the native
   * side; this call is the same shape either way from JS. */
  setAutoEnter(options: { enabled: boolean }): Promise<void>;
  addListener(
    eventName: 'pipModeChanged',
    listenerFunc: (event: PipModeChangedEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const PipBridge = registerPlugin<PipBridgePlugin>('PipBridge');

/**
 * Whether this device can show the PiP pill at all. Native-gated to `false`
 * on web/dev, same reasoning as every other function in this file — there
 * is no PiP surface outside Android for this to report on, and StepFocus.tsx
 * only bothers arming auto-enter when this resolves `true`.
 */
export async function isPipSupported(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const result = await PipBridge.isSupported();
  return result.supported;
}

/**
 * Arms or disarms auto-enter-PiP for the current step's countdown — see
 * StepFocus.tsx's own arm/disarm effect for when this is called and why.
 * Native-gated no-op on web/dev.
 */
export async function setPipAutoEnter(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await PipBridge.setAutoEnter({ enabled });
}

/**
 * Registers a listener for PiP mode transitions (entering or leaving the
 * pill), returning an unsubscribe function — same shape as every other
 * listener registration in src/native/ (backGesture.ts, deepLinks.ts,
 * notifications.ts's registerNotificationNavigation). Native-gated no-op on
 * web/dev: the returned unsubscribe function is a no-op there too, so a
 * caller never has to branch on platform itself. See src/hooks/usePipMode.ts
 * for the one caller (a hook wraps this into a plain boolean) — no other
 * file should call this directly, same one-choke-point discipline this
 * file's own header comment already states for PipBridge itself.
 */
export async function addPipModeChangedListener(handler: (isInPip: boolean) => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const listenerHandle = await PipBridge.addListener('pipModeChanged', (event) => handler(event.isInPip));
  return () => {
    void listenerHandle.remove();
  };
}
