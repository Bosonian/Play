import { db } from '../db/db';
import { readTransitEvents } from '../native/bluetooth';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from './dayGaugeRefresh';
import { logEvent } from './eventLog';
import { resolveCarArrival } from './bluetoothArrival';
import { WATCHED_DEVICE_ADDRESS_SETTING } from './transitSettings';

// Car-disconnect arrival increment (0.44.0): the Dexie/Capacitor-touching
// orchestrator around bluetoothArrival.ts's pure `resolveCarArrival` — same
// "pure decision file stays clean, a `*Sync.ts` file reads native state and
// writes Dexie" split transitSync.ts (the transit-timing sibling reading the
// exact same native ring) already uses. Called fire-and-forget from
// main.tsx's startup sequence AND from App.tsx's visibilitychange resume
// hook — see the doc comment on the exported function for why both matter.

/**
 * Reads the watched car's connect/disconnect ring, picks the one departure a
 * fresh disconnect should mean (if any), and — when `resolveCarArrival` says
 * so — stamps `arrivedAt` on it. Never throws: this runs unattended from app
 * startup and from a background resume, same fire-and-forget contract every
 * other startup materializer in this app follows (see transitSync.ts's own
 * doc comment for the identical reasoning).
 *
 * **No watched car configured** (`WATCHED_DEVICE_ADDRESS_SETTING` absent or
 * empty) is checked FIRST and returns early before even reading the native
 * ring — on every phone that has never set up "Choose car" (Settings), this
 * function should cost nothing beyond one Dexie read, not a native round
 * trip that would just come back empty anyway.
 *
 * **Candidate selection** mirrors `externalArrival.ts`'s `selectArrivalCandidate`
 * in shape but NOT in filter: `status === 'left'` and `arrivalSteps` non-empty
 * are the same two gates (the indexed `status` field is queried first, same
 * "narrow on the index, filter the rest in JS" split every candidate query in
 * this app uses), but this deliberately does NOT also require
 * `arrivedAt == null` the way `selectArrivalCandidate` does — `resolveCarArrival`
 * needs to see an ALREADY-arrived candidate too, to decide whether a
 * car-park-early Wi-Fi stamp should be re-anchored forward. Multiple
 * qualifying candidates (theoretical, same as the Wi-Fi/deep-link path)
 * resolve to the SOONEST-appointment one — identical tiebreak reasoning to
 * `selectArrivalCandidate`: the more time-pressured departure is the more
 * likely reason a disconnect just happened. Only ONE candidate is ever
 * considered per sync, matching that same one-candidate shape — a real
 * two-departures-in-flight-at-once case is rare enough that resolving it
 * fully (attributing a specific disconnect to whichever of two departures it
 * actually belongs to) isn't earned here; the next sync catches the second
 * departure once the first is out of the way.
 *
 * **Fresh start vs. re-anchor** get two different log sentences —
 * `resolveCarArrival` itself doesn't distinguish the two in its return
 * shape (both are just `{ arrivedAtMs }`), so the distinction is made here,
 * from whether `arrivedAt` was already set going in.
 */
export async function syncBluetoothArrival(): Promise<void> {
  try {
    const watchedRow = await db.settings.get(WATCHED_DEVICE_ADDRESS_SETTING);
    if (!watchedRow || watchedRow.value === '') return;

    const events = await readTransitEvents();
    const disconnectEventsMs = events.filter((event) => event.action === 'disconnected').map((event) => event.atMs);
    if (disconnectEventsMs.length === 0) return;

    const leftDepartures = await db.departures.where('status').equals('left').toArray();
    const candidates = leftDepartures.filter((departure) => (departure.arrivalSteps ?? []).length > 0);
    if (candidates.length === 0) return;

    candidates.sort((a, b) => new Date(a.appointmentAt).getTime() - new Date(b.appointmentAt).getTime());
    const candidate = candidates[0];

    const now = new Date();
    const resolution = resolveCarArrival(candidate, disconnectEventsMs, now);
    if (!resolution) return;

    const isFreshStart = candidate.arrivedAt == null;
    // No haptic here, unlike handleArrived/the Wi-Fi poll (Runway.tsx) —
    // both of those fire while Deepak has the screen open and a buzz reads
    // as feedback on something he's looking at. This sync can run from a
    // background resume or a cold app-open with the phone still in a
    // pocket, so a buzz here would be unexplained noise, not feedback.
    await db.departures.update(candidate.id, { arrivedAt: new Date(resolution.arrivedAtMs).toISOString() });
    void logEvent(
      'arrival',
      isFreshStart
        ? `Arrival detected via car Bluetooth: ${candidate.name}.`
        : `Arrival re-anchored to car Bluetooth: ${candidate.name}.`,
    );
    void refreshWidgets();
    void refreshDayGauge();
  } catch (err) {
    console.warn('Runway: syncBluetoothArrival failed', err);
  }
}
