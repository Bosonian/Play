import type { Departure } from '../db/types';
import { ARRIVAL_MATCH_WINDOW_MS } from './externalArrival';

export { ARRIVAL_MATCH_WINDOW_MS };

// Car-disconnect arrival increment (0.44.0). The user's own framing,
// verbatim, is what this file turns into a decision: "the Wi-Fi getting
// detected in the parking lot itself ... I don't see the option at all to
// say which bluetooth belongs to the car so that it at least knows that I am
// still in the car and not away from the car. We can maybe start ... once
// car bluetooth disconnects."
//
// The car's Bluetooth connect/disconnect ring already exists
// (BluetoothTransitReceiver.java -> src/native/bluetooth.ts's
// readTransitEvents) and was, until now, used for exactly one thing: transit
// timing (src/lib/transit.ts's transitWindows). This file is the SECOND use
// of that same signal — the DISCONNECT half specifically, not the connect
// half. Wi-Fi arrival detection (externalArrival.ts, and the Runway.tsx
// polling effect) stamps `arrivedAt` the moment the phone associates with
// the hospital network, which — per the field report this increment is
// built from — happens in the car park, before Deepak has actually parked,
// gotten out, and started walking. The car Bluetooth disconnect (ignition
// off, doors opened, the head unit drops the ACL link) is a closer proxy for
// "the walk-in has actually begun." Pure decision logic only, no Dexie, no
// Capacitor — src/lib/bluetoothArrivalSync.ts is the thin orchestrator that
// reads the native ring, loads the candidate departure, calls this, and
// writes the result back, same split every other learning/transit pipeline
// in this app already uses (calibration.ts/learning.ts/transit.ts stay
// pure; a `*Sync.ts` file does the reading and writing).

export interface CarArrivalResolution {
  arrivedAtMs: number;
}

/**
 * Given one candidate departure, the watched car's raw DISCONNECT
 * timestamps (ms since epoch — `atMs` for every `action: 'disconnected'`
 * event `readTransitEvents` returns), and the current time, decides whether
 * a disconnect should (re)anchor that departure's arrival, or `null` for "do
 * nothing." Every branch below is a deliberate guard against overwriting
 * something the app — or Deepak — already has right:
 *
 * 1. **Not an in-progress journey.** `status !== 'left'`, no `arrivalSteps`
 *    at all, or `leftAt` unset (shouldn't happen once `status` is 'left',
 *    but read defensively, same `leftAt` doc comment discipline db/types.ts
 *    uses everywhere else) — none of these has an arrival phase for a
 *    disconnect to mean anything about. `arrivalSteps ?? []`, same
 *    undefined-as-null rule as every other reader of that field.
 *
 * 2. **Which disconnect, if any, counts.** Only a disconnect STRICTLY AFTER
 *    `leftAt` can be "he got out of the car on THIS trip" — anything at or
 *    before `leftAt` is a leftover from a previous, unrelated drive (or the
 *    ring's own bookkeeping noise). Of those, only one within
 *    `ARRIVAL_MATCH_WINDOW_MS` of `now` is trusted — the exact same 12h
 *    freshness gate `selectArrivalCandidate` (externalArrival.ts) applies to
 *    an appointment's distance from `now`, reused here (not re-declared) for
 *    the same reason: a car that disconnected near the hospital yesterday,
 *    or on some unrelated errand hours ago, must not silently fire today's
 *    arrival. Where more than one qualifying disconnect exists (a lunch
 *    supply run, then the real return), the EARLIEST one wins — the first
 *    time Deepak got out of the car after leaving is the first time "the
 *    walk-in" could have begun; a later re-entry/re-exit pair (topping up
 *    petrol, moving the car) should not push the anchor later than the
 *    truth.
 *
 * 3. **No arrival recorded yet (`arrivedAt == null`).** The disconnect
 *    STARTS the arrival phase — this is the ordinary, common case: no Wi-Fi
 *    SSID configured, or Wi-Fi hasn't fired yet, and the car disconnect is
 *    the first honest "arrived" signal to reach this departure at all.
 *
 * 4. **Arrival already recorded (Wi-Fi/manual/deep-link fired first) AND
 *    every arrival step is still unchecked.** This is the RE-ANCHOR case the
 *    whole increment exists for: Wi-Fi associated in the car park, stamping
 *    `arrivedAt` too early, and nothing has been checked off against that
 *    early timestamp yet — so moving the anchor forward to the (later, more
 *    accurate) disconnect time costs nothing and removes exactly the dead
 *    "parking lot to building" minutes the field report describes. Only
 *    forward — see rule 6.
 *
 * 5. **Any arrival step already checked.** The anchor is FROZEN the instant
 *    a step's timer has started being measured against it — moving
 *    `arrivedAt` after that point would retroactively recompute an actual
 *    that already happened against a different starting line than the one
 *    Deepak lived it against (`calibration.ts`'s `deriveStepActuals` reads
 *    `arrivedAt` as the arrival chain's anchor). A late-arriving disconnect
 *    event for a walk already under way is exactly the kind of "correct the
 *    past" move re-anchor (Runway.tsx's `applyReanchor`, a DIFFERENT
 *    feature, appointment-target only) deliberately never does either — see
 *    that function's own doc comment for the same "reality already
 *    happened, don't launder it" principle applied to a different field.
 *
 * 6. **`arrivedAt` already at or after the disconnect.** Whatever's
 *    recorded is already at least as accurate as this disconnect would be
 *    (e.g. a manual "I'm at the building" tap made after getting out, or an
 *    earlier disconnect already re-anchored this same departure) — nothing
 *    to gain by moving it, and moving it BACKWARD would reintroduce the
 *    exact inflation problem this feature exists to remove.
 *
 * No disconnect clears every gate above resolves to `null` — "no action," on
 * a candidate that plainly qualifies for one, is exactly as real an outcome
 * here as it is on `selectArrivalCandidate`.
 */
export function resolveCarArrival(
  departure: Pick<Departure, 'status' | 'leftAt' | 'arrivalSteps' | 'arrivedAt'>,
  disconnectEventsMs: number[],
  now: Date,
): CarArrivalResolution | null {
  if (departure.status !== 'left') return null;
  const arrivalSteps = departure.arrivalSteps ?? [];
  if (arrivalSteps.length === 0) return null;
  if (departure.leftAt === null) return null;

  const leftAtMs = new Date(departure.leftAt).getTime();
  const nowMs = now.getTime();

  const qualifying = disconnectEventsMs
    .filter((atMs) => atMs > leftAtMs && Math.abs(nowMs - atMs) <= ARRIVAL_MATCH_WINDOW_MS)
    .sort((a, b) => a - b);
  if (qualifying.length === 0) return null;
  const disconnectMs = qualifying[0];

  if (departure.arrivedAt == null) {
    return { arrivedAtMs: disconnectMs };
  }

  // arrivedAt already stamped by some other path (Wi-Fi, manual tap, or an
  // earlier car-Bluetooth sync) — only a forward re-anchor into a
  // still-untouched arrival phase is ever allowed. See rules 4-6 above.
  const anyStepChecked = arrivalSteps.some((step) => step.checkedAt !== null);
  if (anyStepChecked) return null;

  const arrivedAtMs = new Date(departure.arrivedAt).getTime();
  if (disconnectMs <= arrivedAtMs) return null;

  return { arrivedAtMs: disconnectMs };
}
