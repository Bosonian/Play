import { Capacitor, registerPlugin } from '@capacitor/core';

// The ONLY file that imports the HealthConnect plugin — same one-choke-point
// pattern as apps/runway's wifi.ts/bluetooth.ts. Not an npm package: defined
// directly inside this app's own Android project
// (android/app/src/main/java/de/bosonian/tide/HealthConnectPlugin.kt — the
// one Kotlin file in an otherwise all-Java native project; see that file's
// own header comment for why Health Connect's coroutine-based API made
// Kotlin the honest choice here), registered by MainActivity rather than
// auto-discovered from node_modules.
//
// UNVERIFIED, prominently: everything in this file talks to a native plugin
// that has never been built or run on-device in this environment (no
// Android SDK/JDK here — see this increment's own report/CHANGELOG entry).
// The shapes below match what HealthConnectPlugin.kt resolves as read from
// its own source; the actual Health Connect data flow (Renpho scale ->
// Samsung Health -> Health Connect -> this plugin) is real-device-only to
// confirm.

/** Mirrors HealthConnectClient.getSdkStatus's three outcomes, collapsed to
 * what Settings' copy needs to say — see HealthConnectPlugin.kt's isAvailable
 * for the exact SDK-status mapping. */
export type HealthConnectAvailability = 'installed' | 'not_installed' | 'unsupported';

export interface HealthPermissionResult {
  /** True only when every one of the four read scopes below was granted —
   * Settings shows the fuller "Connected." copy either way as long as
   * `grantedScopes` is non-empty (see Settings.tsx's own comment on why a
   * partial grant still counts as "connected"), but callers that care about
   * the all-or-nothing case can check this directly. */
  granted: boolean;
  /** Which of `'weight' | 'bodyFat' | 'steps' | 'activeEnergy'` were actually
   * granted — a plain `string[]` (not a narrower union) because a native
   * plugin boundary should never let a native-side typo silently widen the
   * caller's type; Settings.tsx treats an unrecognised entry as "ignore it",
   * never a crash. */
  grantedScopes: string[];
}

export interface WeightRecordJs {
  atMs: number;
  weightKg: number;
}

export interface BodyFatRecordJs {
  atMs: number;
  bodyFatPct: number;
}

export interface StepsDayJs {
  date: string;
  steps: number;
}

export interface ActiveEnergyDayJs {
  date: string;
  activeKcal: number;
}

/** One data origin's TODAY step total, as HealthConnectPlugin.kt's
 * readStepSources resolves it — `packageName` is Health Connect's own
 * origin identifier (e.g. `com.sec.android.app.shealth`), not something this
 * app assigns; Settings.tsx maps a handful of known ones to a friendly label
 * and falls back to the raw string for anything else (see that file's own
 * comment on why the fallback is deliberate, not a gap to fill later). */
export interface StepSourceJs {
  packageName: string;
  steps: number;
}

interface HealthConnectPlugin {
  isAvailable(): Promise<{ available: HealthConnectAvailability }>;
  // Named `requestHealthConnectPermissions`, not `requestPermissions` — a
  // deliberate departure from the generic name, mirroring
  // BluetoothBridgePlugin.java's own `ensurePermission` (not
  // `requestPermissions`) in Runway: Capacitor's `Plugin` base class already
  // defines an inherited `@PluginMethod requestPermissions(PluginCall)` that
  // drives the `@Permission`-alias/`ContextCompat` runtime-permission flow —
  // entirely the WRONG mechanism for Health Connect, whose permissions ride
  // on `PermissionController`'s own `ActivityResultContract`, never on
  // `ActivityCompat.requestPermissions`. Reusing the same method name would
  // risk Capacitor's reflection-based method registration picking up the
  // wrong one; a distinct name removes that risk outright rather than
  // relying on override semantics this environment can't compile-check.
  requestHealthConnectPermissions(): Promise<HealthPermissionResult>;
  readWeight(options: { sinceMs: number }): Promise<{ records: WeightRecordJs[] }>;
  readBodyFat(options: { sinceMs: number }): Promise<{ records: BodyFatRecordJs[] }>;
  // `packageNames` scopes the aggregate to one or more Health Connect data
  // origins — issue #20's fix (see HealthConnectPlugin.kt's readSteps doc
  // comment): an EMPTY array means "all origins", which is both Health
  // Connect's own default and exactly the pre-fix behaviour, so a caller
  // that hasn't picked a source yet (or an old JS bundle talking to a new
  // plugin) sees no change at all.
  readSteps(options: { sinceMs: number; packageNames: string[] }): Promise<{ days: StepsDayJs[] }>;
  readActiveEnergy(options: { sinceMs: number; packageNames: string[] }): Promise<{ days: ActiveEnergyDayJs[] }>;
  readStepSources(): Promise<{ sources: StepSourceJs[] }>;
}

const HealthConnect = registerPlugin<HealthConnectPlugin>('HealthConnect');

/** `'unsupported'` on web (no such plugin there) or any native error — never
 * throws. Called only from Settings' explicit "Connect health data" tap
 * (CLAUDE.md's no-permission-ambush rule — this file makes no background/
 * passive call anywhere). */
export async function isHealthConnectAvailable(): Promise<HealthConnectAvailability> {
  if (!Capacitor.isNativePlatform()) return 'unsupported';
  try {
    const result = await HealthConnect.isAvailable();
    return result.available;
  } catch {
    return 'unsupported';
  }
}

/** Triggers the Health Connect permission screen. `{granted: false,
 * grantedScopes: []}` on web or any native error — never throws. Same
 * explicit-tap-only contract as `isHealthConnectAvailable` above. */
export async function requestHealthPermissions(): Promise<HealthPermissionResult> {
  if (!Capacitor.isNativePlatform()) return { granted: false, grantedScopes: [] };
  try {
    return await HealthConnect.requestHealthConnectPermissions();
  } catch {
    return { granted: false, grantedScopes: [] };
  }
}

/** Weight records with `atMs` strictly greater than or equal to `sinceMs` —
 * empty array (never throws) on web, missing permission, Health Connect
 * absent, or any native error. `healthSync.ts` re-filters to a strict `>`
 * boundary itself before merging (see that file's own comment) rather than
 * trusting this function's `sinceMs` semantics to be exactly exclusive. */
export async function readWeight(sinceMs: number): Promise<WeightRecordJs[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const result = await HealthConnect.readWeight({ sinceMs });
    return result.records;
  } catch {
    return [];
  }
}

/** Same contract as `readWeight`, for BodyFatRecord. */
export async function readBodyFat(sinceMs: number): Promise<BodyFatRecordJs[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const result = await HealthConnect.readBodyFat({ sinceMs });
    return result.records;
  } catch {
    return [];
  }
}

/** Per-calendar-day step totals (device-local day, see HealthConnectPlugin.kt's
 * readSteps for the exact bucketing) since `sinceMs` — empty array, never
 * throws, same contract as `readWeight`. `packageNames` is passed straight
 * through to the native `dataOriginFilter` (issue #20's source-picker fix —
 * see HealthConnectPlugin.kt's readSteps doc comment); an empty array counts
 * every Health Connect data origin, same as before this option existed. */
export async function readSteps(sinceMs: number, packageNames: string[]): Promise<StepsDayJs[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const result = await HealthConnect.readSteps({ sinceMs, packageNames });
    return result.days;
  } catch {
    return [];
  }
}

/** Per-calendar-day active-energy totals (kcal) since `sinceMs` — empty
 * array, never throws, same contract as `readSteps`, including the same
 * `packageNames` source filter. */
export async function readActiveEnergy(sinceMs: number, packageNames: string[]): Promise<ActiveEnergyDayJs[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const result = await HealthConnect.readActiveEnergy({ sinceMs, packageNames });
    return result.days;
  } catch {
    return [];
  }
}

/** Today's step total per Health Connect data origin — `[]` on web, missing
 * permission, or any native error, never throws, same contract as every
 * other read here. This is what feeds Settings' "Step source" picker (issue
 * #20): it exists so the user can be shown REAL per-source numbers and pick
 * among them, rather than this app guessing which origin is "the real one"
 * (see HealthConnectPlugin.kt's readStepSources for why guessing isn't the
 * honest option). */
export async function readStepSources(): Promise<StepSourceJs[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const result = await HealthConnect.readStepSources();
    return result.sources;
  } catch {
    return [];
  }
}
