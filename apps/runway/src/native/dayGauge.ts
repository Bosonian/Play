import { Capacitor, registerPlugin } from '@capacitor/core';

// The ONLY file that imports the DayGauge plugin — same one-choke-point
// pattern as widgetBridge.ts. Like WidgetBridge, DayGauge is not an npm
// package: it's defined directly inside this app's own Android project
// (android/app/src/main/java/de/bosonian/runway/DayGaugePlugin.java),
// registered by MainActivity rather than auto-discovered from
// node_modules — registerPlugin<T>() below only needs the plugin's name to
// route calls to it (must match the Java class's `@CapacitorPlugin(name =
// "DayGauge")` exactly), same as WidgetBridge.

interface DayGaugePlugin {
  /** Posts (or replaces) the ongoing day-gauge notification. `title` is the
   * already-formatted "Next: {label} · {HH:mm}" string (see
   * src/lib/dayGauge.ts) — this plugin does no formatting itself.
   * `targetAtMs` is the epoch-millisecond instant the notification's native
   * chronometer counts down to. */
  show(options: { title: string; targetAtMs: number }): Promise<void>;
  /** Cancels the day-gauge notification, if one is currently showing. */
  hide(): Promise<void>;
}

const DayGauge = registerPlugin<DayGaugePlugin>('DayGauge');

/**
 * Shows (or updates) the day gauge — an ongoing, silent notification
 * counting down to `targetAt`, rendered by Android's own chronometer view
 * with no further JS involvement until the target next changes (see
 * DayGaugePlugin.java's header comment for the full mechanism and its one
 * honest limitation: staleness while the app stays closed past the target).
 * Native-gated no-op on web, same reasoning as updateWidgetSnapshot — there
 * is no notification shade outside Android for this call to do anything to.
 */
export async function showDayGauge(title: string, targetAt: Date): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await DayGauge.show({ title, targetAtMs: targetAt.getTime() });
}

/** Cancels the day gauge notification. Native-gated no-op on web. */
export async function hideDayGauge(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await DayGauge.hide();
}
