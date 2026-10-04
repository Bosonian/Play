import { db } from '../db/db';
import type { Departure } from '../db/types';
import type { Screen } from '../App';
import { hapticImpact } from '../native/haptics';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from './dayGaugeRefresh';
import { logEvent } from './eventLog';

// Arrival-detection increment (deep-link path, 0.23.0): `runway://arrived`
// is what Deepak's own Samsung Modes & Routines automation opens on
// reaching the hospital (see README.md's "Automatic arrival" section for
// the exact setup steps) — a device-level "you're here" signal, arriving
// with no departure id attached, unlike every other runway:// route
// (deepLinks.ts's screenForUrl). This file is what turns that bare signal
// into "which departure, if any, does this mean," and does the write.

/**
 * How far from `now` an eligible departure's `appointmentAt` may sit for
 * the arrival-link tap to be trusted as meaning THIS departure. Guards
 * against stamping some ancient zombie departure: the routine that fires
 * `runway://arrived` triggers on every real arrival at the hospital,
 * including ordinary shifts with no Runway departure planned at all, or a
 * `left` departure from days ago that was never otherwise resolved (e.g.
 * the app was closed before its arrival steps were checked off). Without
 * this window, a coincidental "left" row from last week would silently
 * absorb today's arrival tap. 12 hours is generous enough to cover a departure
 * whose appointment slipped or was re-anchored earlier the same day, while
 * still excluding anything that's clearly a different day's business.
 *
 * Exported (car-disconnect arrival increment, 0.44.0) and reused as-is by
 * `bluetoothArrival.ts`'s `resolveCarArrival` for its own freshness gate — a
 * car-Bluetooth disconnect too far from `now` deserves exactly the same
 * "don't let a stale signal fire today's arrival" treatment as a stale
 * `runway://arrived` tap, so this stays the one place that window is
 * defined rather than drifting into two constants that could silently
 * diverge.
 */
export const ARRIVAL_MATCH_WINDOW_MS = 12 * 60 * 60_000;

/**
 * Pure selection logic for `recordExternalArrival` below — given every
 * candidate departure and the current time, picks the single departure a
 * bare `runway://arrived` signal should resolve to, or `null` if none
 * qualifies. Split out from the Dexie-effectful function so the ±12 h
 * window and the "soonest appointment wins" tiebreak can be unit-tested
 * without a database.
 *
 * A departure qualifies when all four hold:
 *   - `status === 'left'` — the journey is under way; anything else (still
 *     'running', already 'done'/'abandoned') has nothing an arrival signal
 *     could mean.
 *   - `arrivedAt == null` — arrival hasn't already been recorded (by the
 *     manual button, the Wi-Fi path, or an earlier delivery of this same
 *     link — `deepLinks.ts`'s cold-start dedupe already guards the literal
 *     double-delivery case, but this is a second, independent guard against
 *     re-stamping).
 *   - `arrivalSteps` is non-empty — a departure with no arrival phase has
 *     nothing for this signal to begin; see db/types.ts's own comment on
 *     why 'left' + arrival steps together define the journey phase.
 *   - its appointment falls within `ARRIVAL_MATCH_WINDOW_MS` of `now`.
 *
 * Multiple qualifying departures (theoretical — two 'left' journeys with
 * arrival steps in flight at once) resolve to the one with the SOONEST
 * appointment: the more time-pressured of the two is the more likely
 * reason the phone is at the hospital right now.
 */
export function selectArrivalCandidate(departures: Departure[], now: Date): Departure | null {
  const nowMs = now.getTime();
  const eligible = departures.filter((d) => {
    if (d.status !== 'left') return false;
    if (d.arrivedAt != null) return false;
    if ((d.arrivalSteps ?? []).length === 0) return false;
    const gapMs = Math.abs(new Date(d.appointmentAt).getTime() - nowMs);
    return gapMs <= ARRIVAL_MATCH_WINDOW_MS;
  });
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => new Date(a.appointmentAt).getTime() - new Date(b.appointmentAt).getTime());
  return eligible[0];
}

/**
 * Handles a `runway://arrived` tap end to end: finds the one departure it
 * should mean (via `selectArrivalCandidate` above), stamps `arrivedAt` on
 * it with the EXACT SAME write `handleArrived` (Runway.tsx) and the Wi-Fi
 * path (`src/native/wifi.ts`'s caller) use, and returns the `Screen` the
 * caller (`deepLinks.ts`) should navigate to.
 *
 * Zero matches resolves to `{ name: 'home' }`, silently — no toast, no
 * error. The Samsung routine behind this link fires on every arrival at the
 * hospital, including ordinary shifts with no Runway departure in flight at
 * all; surfacing an error on every one of those would be pure noise for the
 * overwhelmingly common case where there's simply nothing to do. Multiple
 * matches (theoretical) resolve to the soonest-appointment departure — see
 * `selectArrivalCandidate`'s own doc comment.
 *
 * On a real match, navigates to that departure's Runway screen — the
 * routine opens the app anyway (that's how `runway://arrived` reaches this
 * code at all), so landing on the checklist it just unlocked is more useful
 * than leaving the user on whatever screen the app happened to cold-start
 * to otherwise.
 *
 * Never throws: `db.departures.where(...)` or the update could in principle
 * fail (a Dexie/IndexedDB error), and this runs from a device automation
 * with no user watching for an error message — the honest fallback here is
 * "nothing happened, land on Home," the same shape every other native
 * wrapper in this app uses for a background/passive call path.
 */
export async function recordExternalArrival(): Promise<Screen> {
  try {
    const now = new Date();
    // Indexed field (db.ts) — cheap to narrow to 'left' before handing the
    // rest of the match logic (arrivedAt, arrivalSteps, the time window) to
    // the pure function above, same "query on the indexed field, filter the
    // rest in JS" split materialize.ts's own sweeps use.
    const leftDepartures = await db.departures.where('status').equals('left').toArray();
    const candidate = selectArrivalCandidate(leftDepartures, now);
    if (!candidate) return { name: 'home' };

    void hapticImpact('light');
    await db.departures.update(candidate.id, { arrivedAt: now.toISOString() });
    void logEvent('arrival', `Arrival recorded via shortcut: ${candidate.name}.`);
    void refreshWidgets();
    void refreshDayGauge();
    return { name: 'runway', departureId: candidate.id };
  } catch (err) {
    console.warn('Runway: recordExternalArrival failed', err);
    return { name: 'home' };
  }
}
