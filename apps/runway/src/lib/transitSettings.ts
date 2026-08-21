// Settings-table keys for the car Bluetooth transit increment (0.36.0), same
// one-key-one-constant shape as calendarSettings.ts/dayGaugeSettings.ts.
// Four rows in the existing key-value `settings` table (db/db.ts v2) — none
// of this earns a dedicated Dexie table: which car is watched, its display
// name, the measured-drive history, and a sync cursor are all small enough
// to live as keyed JSON/string rows, the same "smaller default" call the
// backup increment's own settings filtering already makes elsewhere.

/** The chosen car's MAC address, ALSO written into native SharedPreferences
 * by BluetoothBridgePlugin.setWatchedDevice — this Dexie copy exists only so
 * Settings.tsx can render "Watching: {name}." without a native round-trip on
 * every render. The native copy (not this one) is what
 * BluetoothTransitReceiver.java actually compares an incoming device
 * against; this row is a read-only mirror for the UI. */
export const WATCHED_DEVICE_ADDRESS_SETTING = 'transitWatchedDeviceAddress';

/** The chosen car's display name (from BluetoothAdapter's bonded-device
 * list) — Bluetooth device NAMES are never sent to native SharedPreferences
 * at all (see BluetoothBridgePlugin.java's own comment: the receiver only
 * ever needs the address to decide whether to record an event), so this is
 * the only place the name is kept. */
export const WATCHED_DEVICE_NAME_SETTING = 'transitWatchedDeviceName';

/** JSON-encoded `TransitMeasurementsByName` (src/lib/transit.ts) — every
 * measured drive, name -> array of `{minutes, atMs}`, capped 20 per name by
 * transitSync.ts's merge step. */
export const TRANSIT_MEASUREMENTS_SETTING = 'transitMeasurements';

/** The highest `windowStartMs` `syncTransitEvents` has already processed
 * (matched or not) — see transitSync.ts's own comment for why a monotonic
 * cursor, not a per-window dedupe set, is what keeps a re-run from
 * re-logging or re-persisting the same drive twice. */
export const TRANSIT_SYNC_CURSOR_SETTING = 'transitSyncCursorMs';
