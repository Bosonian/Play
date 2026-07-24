import type { Departure, Template } from '../db/types';
import { medianMinutes } from './calibration';

// Car Bluetooth transit increment (0.36.0). The user's own framing, kept
// verbatim because it's the exact insight this file turns into math: "My car
// will automatically connect to the phone's Bluetooth ... once the phone
// connects to the Bluetooth and stays in the Bluetooth connection till the
// connection ends. That is actually the whole transit time." A car's ACL
// connect-to-disconnect span (captured natively — see
// android/.../BluetoothTransitReceiver.java and src/native/bluetooth.ts) IS
// a drive, with no estimating involved — this file turns a raw stream of
// connect/disconnect timestamps into (1) discrete drive windows, (2) which
// departure each window most likely belongs to, and (3) whether enough of
// them agree to be worth suggesting as a template's `travelMinutes`. Same
// "pure math, no Dexie, no Capacitor" shape as calibration.ts/learning.ts —
// src/lib/transitSync.ts is the thin orchestrator that reads native events,
// calls into here, and writes the result back to Dexie.

export interface TransitEvent {
  action: 'connected' | 'disconnected';
  atMs: number;
}

export interface TransitWindow {
  startMs: number;
  endMs: number;
}

/**
 * A drive shorter than this is almost certainly not a drive at all — sitting
 * in the car at home fiddling with the phone (or a car that briefly drops
 * and re-establishes Bluetooth at the curb) connects and disconnects too,
 * and neither should be folded into "how long does it take to get to
 * Klinikum." 3 minutes is short enough that it never trims a real short
 * hop, long enough to filter the parked-in-the-driveway case.
 */
export const MIN_DRIVE_MINUTES = 3;

/**
 * Pairs each 'connected' with the NEXT 'disconnected' after it, in
 * chronological order — exactly the "stays in the Bluetooth connection till
 * the connection ends" span the feature is named for. Two edge cases are
 * deliberately dropped rather than guessed at:
 *
 * - A 'connected' with no following 'disconnected' yet is a drive still IN
 *   PROGRESS (or one where the ring was read mid-drive) — there is no honest
 *   end time to report, so it contributes no window at all, not a window
 *   with a fabricated end.
 * - A 'disconnected' with no preceding 'connected' is what a full ring
 *   (BluetoothTransitReceiver.java's 200-entry cap) looks like once it's
 *   wrapped: the connect that started this disconnect's drive fell off the
 *   front. Treated as noise, not an error — there's no way to recover the
 *   missing start.
 *
 * Input does not need to already be sorted — `events` is sorted by `atMs`
 * here first, since the only ordering guarantee the native ring actually
 * makes is "appended as they happened," and a defensive sort costs nothing
 * for a list this small (at most 200 entries).
 */
export function transitWindows(events: TransitEvent[]): TransitWindow[] {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);

  const windows: TransitWindow[] = [];
  let pendingConnectMs: number | null = null;

  for (const event of sorted) {
    if (event.action === 'connected') {
      // A second 'connected' before any 'disconnected' overwrites the
      // pending one rather than stacking — the ring should never actually
      // produce this (a real car doesn't connect twice without
      // disconnecting), but if it somehow did, the most recent connect is
      // the honest start of "the connection that's currently open."
      pendingConnectMs = event.atMs;
      continue;
    }

    // event.action === 'disconnected'
    if (pendingConnectMs === null) continue; // orphan disconnect — see doc comment above

    const startMs = pendingConnectMs;
    pendingConnectMs = null;
    const durationMinutes = (event.atMs - startMs) / 60_000;
    if (durationMinutes < MIN_DRIVE_MINUTES) continue;

    windows.push({ startMs, endMs: event.atMs });
  }

  return windows;
}

export interface TransitMatch {
  departureName: string;
  minutes: number;
  windowStartMs: number;
}

/**
 * How far past a departure's `appointmentAt` its journey is still assumed to
 * plausibly cover, for a departure with no recorded `arrivedAt` — arrival
 * steps are optional (db/types.ts's `Departure.arrivalSteps`), so plenty of
 * real departures never stamp one. Two hours is generous on purpose: this
 * bound only exists to stop a drive from matching a departure that left
 * hours earlier for something unrelated, not to precisely model when the
 * appointment itself ended.
 */
const NO_ARRIVAL_FALLBACK_HOURS = 2;

/**
 * Attributes each drive window to the departure it most likely belongs to.
 * A departure participates only once it has actually LEFT (`leftAt` set,
 * status 'left' or 'done' — a 'planned' or 'abandoned' departure never
 * drove anywhere real). Its candidate span runs from `leftAt` to whichever
 * arrival fact exists: the real `arrivedAt` if the arrival phase stamped
 * one, else `appointmentAt` plus `NO_ARRIVAL_FALLBACK_HOURS` as a generous
 * stand-in for "the appointment is presumably still going."
 *
 * A window matches the departure whose span contains the window's START
 * and whose `leftAt` is closest to it — "closest" because more than one
 * departure can theoretically have an open span at the same moment (a
 * departure left, then a second one was set up and also left before the
 * first arrived), and the drive that actually just started almost always
 * belongs to whichever departure most recently left. Each window matches
 * AT MOST one departure; a window nobody's span covers is returned by the
 * caller as unmatched (see transitSync.ts), which is real and worth
 * logging, not an error.
 */
export function matchTransitsToDepartures(windows: TransitWindow[], departures: Departure[]): TransitMatch[] {
  const eligible = departures
    .filter((departure) => (departure.status === 'left' || departure.status === 'done') && departure.leftAt !== null)
    .map((departure) => {
      const leftAtMs = new Date(departure.leftAt as string).getTime();
      const endMs = departure.arrivedAt
        ? new Date(departure.arrivedAt).getTime()
        : new Date(departure.appointmentAt).getTime() + NO_ARRIVAL_FALLBACK_HOURS * 3_600_000;
      return { departure, leftAtMs, endMs };
    });

  const matches: TransitMatch[] = [];
  for (const window of windows) {
    let best: { name: string; leftAtMs: number } | null = null;
    for (const candidate of eligible) {
      if (window.startMs < candidate.leftAtMs || window.startMs > candidate.endMs) continue;
      if (!best || Math.abs(window.startMs - candidate.leftAtMs) < Math.abs(window.startMs - best.leftAtMs)) {
        best = { name: candidate.departure.name, leftAtMs: candidate.leftAtMs };
      }
    }
    if (!best) continue;
    matches.push({
      departureName: best.name,
      minutes: Math.round((window.endMs - window.startMs) / 60_000),
      windowStartMs: window.startMs,
    });
  }

  return matches;
}

/** One drive's measured minutes, persisted (transitSync.ts) as a small JSON
 * settings row keyed by departure name — see that file's own comment for
 * why a keyed JSON row is enough here and a new Dexie table isn't earned. */
export interface TransitMeasurement {
  minutes: number;
  atMs: number;
}

export type TransitMeasurementsByName = Record<string, TransitMeasurement[]>;

/** Turns the persisted per-name measurement store back into a flat
 * `TransitMatch[]` — the shape `transitSuggestions` below and
 * `transitMeasurementSummaries` both consume, so there's exactly one place
 * that knows how the settings row's shape maps to the rest of this file's
 * types. */
export function flattenMeasurements(measurementsByName: TransitMeasurementsByName): TransitMatch[] {
  const matches: TransitMatch[] = [];
  for (const [departureName, entries] of Object.entries(measurementsByName)) {
    for (const entry of entries) {
      matches.push({ departureName, minutes: entry.minutes, windowStartMs: entry.atMs });
    }
  }
  return matches;
}

export interface TransitSuggestion {
  templateId: string;
  templateName: string;
  currentTravelMinutes: number;
  medianMinutes: number;
  runCount: number;
}

/** Evidence floor before a transit-measured median is trusted enough to
 * suggest — same "3 real occurrences minimum" discipline learning.ts's
 * `learnedEstimate` and `learnedBufferSuggestion` both apply before ever
 * proposing a change to a plan; a measured drive is exactly as much "real
 * evidence, not a guess" as a checked-off step, so it earns the same floor. */
export const MIN_TRANSIT_RUNS = 3;

/** Same MIN_DELTA_MINUTES spirit as learning.ts's `computeSuggestions` (not
 * exported there, so mirrored here rather than imported) — a suggestion
 * that would move `travelMinutes` by less than this is inside the noise a
 * departure's buffer already exists to absorb, not a genuine correction. */
export const MIN_TRANSIT_DELTA_MINUTES = 3;

/**
 * Per departure NAME with at least `MIN_TRANSIT_RUNS` measured drives, the
 * median measured minutes — offered as a suggestion only when it has drifted
 * `MIN_TRANSIT_DELTA_MINUTES` or more from the STANDING template's current
 * `travelMinutes`. Suggestions target templates, never a one-off departure
 * directly, mirroring how `computeBufferSuggestions` (learning.ts) loops
 * over templates and reads each one's own current value rather than a stale
 * snapshot — a name with measured drives but no matching template (a
 * one-off trip, or a template since renamed) simply has nothing to update
 * and is silently skipped, same as a departure whose step names don't match
 * any template step in `computeSuggestions`.
 */
export function transitSuggestions(matches: TransitMatch[], templates: Template[]): TransitSuggestion[] {
  const minutesByName = new Map<string, number[]>();
  for (const match of matches) {
    const existing = minutesByName.get(match.departureName);
    if (existing) existing.push(match.minutes);
    else minutesByName.set(match.departureName, [match.minutes]);
  }

  const suggestions: TransitSuggestion[] = [];
  for (const template of templates) {
    const minutes = minutesByName.get(template.name);
    if (!minutes || minutes.length < MIN_TRANSIT_RUNS) continue;

    const rawMedian = medianMinutes(minutes);
    if (rawMedian === null) continue;
    const median = Math.round(rawMedian);

    const delta = Math.abs(median - template.travelMinutes);
    if (delta < MIN_TRANSIT_DELTA_MINUTES) continue;

    suggestions.push({
      templateId: template.id,
      templateName: template.name,
      currentTravelMinutes: template.travelMinutes,
      medianMinutes: median,
      runCount: minutes.length,
    });
  }

  return suggestions;
}

export interface TransitMeasurementSummary {
  name: string;
  medianMinutes: number;
  runCount: number;
}

/**
 * The Learning screen's "Transit" section (src/screens/Learning.tsx): one
 * row per name with at least one measured drive, regardless of whether it
 * clears `MIN_TRANSIT_RUNS` — unlike `transitSuggestions` above (which only
 * proposes a CHANGE once there's enough evidence to trust), this is a
 * transparency report of everything the app has measured so far, same
 * "narrower floor for a report than for an actionable suggestion" shape
 * `learningReport` (learning.ts) already uses for step estimates vs. rushed
 * floors. Sorted most-measured first, name ascending as a deterministic
 * tiebreak — same ordering `learningReport` itself uses.
 */
export function transitMeasurementSummaries(measurementsByName: TransitMeasurementsByName): TransitMeasurementSummary[] {
  const summaries: TransitMeasurementSummary[] = [];
  for (const [name, entries] of Object.entries(measurementsByName)) {
    if (entries.length === 0) continue;
    const rawMedian = medianMinutes(entries.map((entry) => entry.minutes));
    if (rawMedian === null) continue;
    summaries.push({ name, medianMinutes: Math.round(rawMedian), runCount: entries.length });
  }
  summaries.sort((a, b) => b.runCount - a.runCount || a.name.localeCompare(b.name));
  return summaries;
}

/**
 * Field bug (0.36.1): Settings' "Choose car" once collapsed FOUR distinct
 * failure causes — permission not actually granted, the Bluetooth radio
 * being off, a read that failed outright, and a genuinely empty bond list —
 * into one message, "No paired Bluetooth devices found. Pair your car in
 * Android Settings first." A user with a paired car and permission granted
 * hit exactly this: the radio was off at that moment, and
 * `BluetoothAdapter.getBondedDevices()` is documented to return an empty set
 * whenever the radio isn't on (see BluetoothBridgePlugin.java's own comment)
 * — indistinguishable, from `devices.length` alone, from "nothing is
 * paired." This function picks the one message that names the actual cause.
 *
 * Pulled out as pure, Dexie/Capacitor-free logic (this file's existing
 * shape) rather than left inline in Settings.tsx, so the branch order itself
 * — permission before radio before read-failure before empty-list — is
 * something a test locks down, not something a future edit to Settings.tsx
 * can silently reorder.
 *
 * Returns `null` when the device list should be shown instead of a message.
 */
export function carChooserMessage(
  granted: boolean,
  permitted: boolean,
  radio: 'on' | 'off' | 'unavailable' | 'error',
  deviceCount: number,
): string | null {
  if (!granted || !permitted) {
    return 'Bluetooth permission was not granted. Allow Nearby devices for Runway in Android settings.';
  }
  if (radio === 'off') {
    return 'Bluetooth is turned off. Turn it on, then choose again.';
  }
  if (radio === 'unavailable' || radio === 'error') {
    return 'The paired-device list could not be read. Try again, and report it if it persists.';
  }
  if (deviceCount === 0) {
    return 'No paired Bluetooth devices found. Pair your car in Android Settings first.';
  }
  return null;
}
