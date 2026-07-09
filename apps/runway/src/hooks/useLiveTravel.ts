import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import type { Departure } from '../db/types';
import { fetchDriveMinutes } from '../lib/routesApi';
import { shouldUpdateTravelMinutes } from '../lib/liveTravelUpdate';
import { getCurrentPosition } from '../native/geolocation';
import { scheduleDepartureAlarms } from '../native/notifications';
import { refreshWidgets } from '../native/widgets';

const REFRESH_INTERVAL_MS = 3 * 60_000; // 3 min
const MIN_INTERVAL_MS = 150_000; // 150 s — see refresh() below for why this is checked separately from the interval itself.

export interface LiveTravelState {
  /** Minutes from the most recent SUCCESSFUL fetch — independent of
   * whether that value was ever written to departure.travelMinutes. Small
   * drift (see shouldUpdateTravelMinutes) is shown here but never written,
   * per the increment spec's "display only, no write" rule. Null until the
   * first fetch of this mount succeeds. */
  liveMinutes: number | null;
  /** When that successful fetch resolved — drives the "updated HH:mm" copy. */
  updatedAt: Date | null;
  /** Whether the MOST RECENT attempt (successful or not) failed. Sticky
   * across ticks until the next success, so a stale liveMinutes value stays
   * on screen (flagged unavailable) rather than disappearing. */
  failed: boolean;
}

const IDLE_STATE: LiveTravelState = { liveMinutes: null, updatedAt: null, failed: false };

/**
 * Keeps a running departure's live travel time fresh while its Runway
 * screen is open (RUNWAY_PLAN.md §5.1+§5.6's live-travel increment).
 * Mirrors useNow.ts's pause-on-hidden / refresh-on-visible shape, but as
 * its own interval rather than sharing useNow's — the two tick at
 * completely different rates (1 s vs. 3 min) for completely different
 * reasons (UI liveness vs. a metered network call), so merging them would
 * complicate both for no benefit.
 *
 * `config.enabled` gates the whole hook, not just individual fetches —
 * Runway.tsx only passes `true` once status is 'running', live travel is
 * turned on in Settings, and the destination is non-empty, so a departure
 * that doesn't qualify never starts a network timer at all, let alone
 * fires one. This is also what keeps geolocation lazy (src/native/
 * geolocation.ts's own comment): the first call only happens once a
 * departure this qualified is actually on screen.
 */
export function useLiveTravel(
  departure: Pick<Departure, 'id' | 'destination'> | undefined,
  config: { enabled: boolean; apiKey: string },
): LiveTravelState {
  const [state, setState] = useState<LiveTravelState>(IDLE_STATE);

  // Refs, not state: a fetch in flight or a recently-completed one
  // shouldn't itself cause a re-render, and the min-interval gate needs to
  // survive the visibility-change restart below without resetting.
  const lastFetchAtRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const departureId = departure?.id;
  const destination = departure?.destination;
  const active = config.enabled && departureId !== undefined && !!destination;

  useEffect(() => {
    // Reset display state whenever this departure stops qualifying (feature
    // turned off, departure changed, or unmounted) — an old "live, updated
    // 14:02" line from a previous departure/run must not linger under a
    // different one.
    if (!active) {
      setState(IDLE_STATE);
      return;
    }
    // Narrowed by `active` above, but TypeScript can't see that through the
    // boolean — re-assert for the closures below.
    const id = departureId as string;
    const dest = destination as string;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function refresh() {
      if (inFlightRef.current) return;
      // Min 150 s between calls regardless of what triggered this refresh
      // (mount, the 3-min interval, or a visibility-change wakeup) — this
      // check is what enforces that uniformly across all three triggers.
      const now = Date.now();
      if (lastFetchAtRef.current !== null && now - lastFetchAtRef.current < MIN_INTERVAL_MS) return;

      inFlightRef.current = true;
      lastFetchAtRef.current = now;
      try {
        const origin = await getCurrentPosition();
        if (origin === null) {
          // No tight retry on failure (increment spec) — this attempt is
          // simply done; the next opportunity is the next interval tick or
          // the next visibility-change wakeup, both already rate-limited by
          // the check above.
          if (!cancelled) setState((prev) => ({ ...prev, failed: true }));
          return;
        }

        const result = await fetchDriveMinutes({ origin, destinationAddress: dest, apiKey: config.apiKey });
        if (cancelled) return;

        if (!result.ok) {
          setState((prev) => ({ ...prev, failed: true }));
          return;
        }

        setState({ liveMinutes: result.minutes, updatedAt: new Date(), failed: false });

        // Re-read the departure fresh from Dexie rather than trusting a
        // travelMinutes captured in this closure — the effect intentionally
        // doesn't restart on every travelMinutes change (that would mean
        // cancelling and rescheduling this hook's own interval every time
        // IT writes a new value), so a value closed over at effect-creation
        // time could be several ticks stale by now.
        const currentDeparture = await db.departures.get(id);
        if (!currentDeparture || cancelled) return; // departure removed/abandoned mid-fetch

        // Status re-checked from the fresh read, not from the props that
        // gated this hook: "I'm out the door" can land while this fetch was
        // in flight, and `cancelled` only flips when React commits the
        // teardown — a beat later. Without this check, a ≥3 min drift in
        // that beat would write to a 'left' departure and re-schedule the
        // very alarms handleLeave just cancelled ("Leave now." while
        // already driving).
        if (currentDeparture.status !== 'running') return;

        if (shouldUpdateTravelMinutes(currentDeparture.travelMinutes, result.minutes)) {
          await db.departures.where('id').equals(id).modify((d) => {
            d.travelMinutes = result.minutes;
          });
          // scheduleDepartureAlarms cancels whatever was scheduled before
          // rescheduling (src/native/notifications.ts) — same "cancel then
          // schedule fresh" semantics DepartureSetup's save path already
          // relies on, and it already filters alarm times that have since
          // passed, so there's nothing extra to reimplement here.
          const updatedDeparture = await db.departures.get(id);
          // Same status re-check as above — leave can also land in the gap
          // between the modify and this schedule call.
          if (updatedDeparture?.status === 'running' && !cancelled) {
            await scheduleDepartureAlarms(updatedDeparture);
            // Widgets increment: travelMinutes just moved, which moves
            // leaveBy — the departure widget's planLine reads that value,
            // so it needs the same refresh scheduleDepartureAlarms just
            // triggered for the alarm side. Same status guard as the call
            // just above: a leave landing in this exact gap must not
            // refresh a widget snapshot for a departure that's no longer
            // 'running'.
            void refreshWidgets();
          }
        }
        // <3 min drift: intentionally no write, no reschedule — the state
        // update above already shows the live figure. Alarm churn for
        // noise-level drift is worse than the noise itself.
      } catch {
        // Defensive only: fetchDriveMinutes and getCurrentPosition are both
        // documented to never throw, but a misbehaving network/Dexie
        // primitive shouldn't be able to crash the Runway screen either way.
        if (!cancelled) setState((prev) => ({ ...prev, failed: true }));
      } finally {
        inFlightRef.current = false;
      }
    }

    function start() {
      if (intervalId !== undefined) return;
      intervalId = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    }
    function stop() {
      if (intervalId === undefined) return;
      clearInterval(intervalId);
      intervalId = undefined;
    }
    function handleVisibilityChange() {
      if (document.hidden) {
        stop();
      } else {
        void refresh();
        start();
      }
    }

    void refresh();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // active/departureId/destination/config.apiKey are the only things this
    // effect should restart on — config.enabled is folded into `active`
    // already, and travelMinutes is deliberately excluded (read fresh from
    // Dexie inside refresh() instead, see the comment above).
  }, [active, departureId, destination, config.apiKey]);

  return state;
}
