import { Capacitor, registerPlugin } from '@capacitor/core';

// The ONLY file that imports the BluetoothBridge plugin — same
// one-choke-point pattern as wifi.ts/calendar.ts. Not an npm package:
// defined directly inside this app's own Android project
// (android/app/src/main/java/de/bosonian/runway/BluetoothBridgePlugin.java),
// registered by MainActivity rather than auto-discovered from node_modules.
// See that file's own doc comment for the permission shape (BLUETOOTH_CONNECT
// from API 31 on, auto-granted below it).

export interface BondedDevice {
  name: string;
  address: string;
}

export interface NativeTransitEvent {
  action: 'connected' | 'disconnected';
  atMs: number;
}

/**
 * Radio state as read by the native side's `adapter.isEnabled()` check —
 * see BluetoothBridgePlugin.java's getBondedDevices doc comment for why this
 * exists: `getBondedDevices()` is documented to return an empty set whenever
 * the radio isn't 'on', which without this field is indistinguishable from
 * "nothing is actually paired." 'unavailable' covers no adapter at all (rare
 * hardware/emulator case); 'error' covers a SecurityException some OEM
 * builds throw even when permission is granted.
 */
export type BluetoothRadioState = 'on' | 'off' | 'unavailable' | 'error';

export interface BondedDevicesResult {
  devices: BondedDevice[];
  permitted: boolean;
  radio: BluetoothRadioState;
}

interface BluetoothBridgePlugin {
  ensurePermission(): Promise<{ granted: boolean }>;
  getBondedDevices(): Promise<BondedDevicesResult>;
  setWatchedDevice(options: { address: string }): Promise<void>;
  clearWatchedDevice(): Promise<void>;
  readTransitEvents(): Promise<{ events: NativeTransitEvent[] }>;
}

const BluetoothBridge = registerPlugin<BluetoothBridgePlugin>('BluetoothBridge');

/**
 * Triggers the BLUETOOTH_CONNECT permission flow if needed, resolving to
 * whether it ended up granted. `false` on web (no such plugin there) and on
 * any native error — never throws, same shape as calendar.ts's
 * requestCalendarAccess. Call exactly once, from the explicit "Choose car"
 * tap on Settings — this is deliberately NOT called from anywhere passive,
 * same no-permission-ambush rule every other lazy permission in this app
 * follows.
 */
export async function ensureBluetoothPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await BluetoothBridge.ensurePermission();
    return result.granted;
  } catch {
    return false;
  }
}

/**
 * The phone's already-paired ("bonded") Bluetooth devices — the candidate
 * list Settings' "Choose car" flow renders as rows to pick from — PLUS
 * `permitted`/`radio` so the caller can tell an empty list apart from a
 * radio that's off, a permission that isn't actually granted, or a read
 * that failed outright (see BondedDevicesResult's own doc comment). Never
 * throws: web and any native error both resolve the same "nothing to show,
 * radio state unknown" shape, matching this file's every-other-function
 * never-throw contract.
 */
export async function getBondedDevices(): Promise<BondedDevicesResult> {
  if (!Capacitor.isNativePlatform()) return { devices: [], permitted: false, radio: 'unavailable' };
  try {
    return await BluetoothBridge.getBondedDevices();
  } catch {
    return { devices: [], permitted: false, radio: 'unavailable' };
  }
}

/**
 * Points BluetoothTransitReceiver.java at exactly one device address — see
 * that file's own privacy comment for why this app only ever watches ONE
 * chosen car, never every paired device. Also clears any previously
 * recorded ring on the native side (BluetoothBridgePlugin.setWatchedDevice),
 * so switching cars never lets the old car's drives blend into the new
 * one's history. Best-effort — a failure here just means the toggle didn't
 * take, which Settings' own read-back of the address row will reveal on
 * next render.
 */
export async function setWatchedDevice(address: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await BluetoothBridge.setWatchedDevice({ address });
  } catch {
    // best-effort, see doc comment above
  }
}

/** Stops watching any device — native ring is cleared too (mirrors
 * setWatchedDevice's clear-on-change reasoning: a decision to stop watching
 * should leave no lingering event history behind it). */
export async function clearWatchedDevice(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await BluetoothBridge.clearWatchedDevice();
  } catch {
    // best-effort
  }
}

/**
 * Reads the raw connect/disconnect ring BluetoothTransitReceiver.java has
 * recorded for the watched device so far — the input src/lib/transit.ts's
 * `transitWindows` turns into drive windows. Empty array on web, no watched
 * device, or any native error; never throws.
 */
export async function readTransitEvents(): Promise<NativeTransitEvent[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const result = await BluetoothBridge.readTransitEvents();
    return result.events;
  } catch {
    return [];
  }
}
