import { useEffect, useRef, useState } from 'react';
import { Home } from './screens/Home';
import { WeighInEntry } from './screens/WeighInEntry';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { PlateCheckIn } from './screens/PlateCheckIn';
import { PlatesToday } from './screens/PlatesToday';
import { ReportProblem } from './screens/ReportProblem';
import { ActivityLog } from './screens/ActivityLog';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { logEvent } from './lib/eventLog';
import { syncHealthData } from './lib/healthSync';
import { registerBackGesture } from './native/backGesture';

// Navigation as plain React state, not a router library — same call Runway
// made in increment 1, for the same reason: no deep-linkable URL
// requirement yet (no shareable weigh-in links, no browser back/forward
// across screens) and now six screens (plate check-in increment 0.4.0 adds
// two more) — still few enough that a router would be ceremony without
// payoff. Revisit if that changes (e.g. a future notification tap that
// should open straight to WeighInEntry or PlateCheckIn).
export type Screen =
  | { name: 'home' }
  | { name: 'weighInEntry' }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'plateCheckIn' }
  | { name: 'platesToday' }
  // Field-reports increment (increment 5, ported from Runway): the in-app
  // "Report a problem" form, reached from Settings' "Report a problem"
  // entry. `fromScreen` carries which screen it was opened from — both the
  // context this screen writes onto the saved FieldReport (db/types.ts's
  // `screenName`) and where "back" (and the post-save navigate) return to.
  | { name: 'reportProblem'; fromScreen: string }
  // The on-device event viewer, reached from Settings' "View activity log"
  // entry — a pure read-only view, no create/prefill props of its own.
  | { name: 'activityLog' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  // Android back gesture (increment 6, ported from Runway — see
  // native/backGesture.ts's own header comment for the field bug this
  // fixes: without it, a back swipe from any screen EXITS the app). The
  // listener is registered ONCE ([] deps below) for the app's lifetime,
  // outside any per-render closure — but it still needs to see whichever
  // screen is CURRENT at the moment a back gesture actually fires, not
  // whichever screen was active when the effect first ran. A plain closure
  // over `screen` would go stale the instant navigation happened even once.
  // `screenRef` is kept in sync on every render (the line just below, no
  // dependency array of its own — a ref write is not a state update, so it
  // doesn't cause a re-render itself) and the listener reads
  // `screenRef.current`, never `screen` directly. Same trap/fix Runway's own
  // App.tsx documents for the identical listener.
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void registerBackGesture(() => screenRef.current, setScreen).then((unregister) => {
      // StrictMode double-invoke safe: if this effect instance was already
      // cleaned up (React unmounted it before the async `addListener` call
      // resolved) by the time the promise settles, undo the registration
      // immediately instead of leaking a listener this instance no longer
      // owns.
      if (cancelled) {
        unregister();
      } else {
        cleanup = unregister;
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  function renderScreen() {
    switch (screen.name) {
      case 'home':
        return <Home onNavigate={setScreen} />;
      case 'weighInEntry':
        return <WeighInEntry onNavigate={setScreen} />;
      case 'history':
        return <History onNavigate={setScreen} />;
      case 'settings':
        return <Settings onNavigate={setScreen} />;
      case 'plateCheckIn':
        return <PlateCheckIn onNavigate={setScreen} />;
      case 'platesToday':
        return <PlatesToday onNavigate={setScreen} />;
      case 'reportProblem':
        return <ReportProblem fromScreen={screen.fromScreen} onNavigate={setScreen} />;
      case 'activityLog':
        return <ActivityLog onNavigate={setScreen} />;
    }
  }

  // Increment 2: mirrors Runway's own App.tsx visibilitychange hook — the
  // one central "app resumed/backgrounded" signal, as opposed to a
  // screen-local effect, because it's about the whole app's lifecycle, not
  // any one screen's concern. Increment 3 adds the first native refresh
  // Tide re-runs on resume (`syncHealthData`) — the exact scenario
  // TIDE_PLAN.md §3 names as the point of the whole bridge: step off the
  // scale, Samsung Health picks it up, then open Tide and this resume tap
  // pulls the new weight in without a manual sync tap.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void logEvent('lifecycle', 'App resumed.');
        void syncHealthData();
      } else {
        void logEvent('lifecycle', 'App backgrounded.');
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // ErrorBoundary wraps every screen's render, same placement as Runway's
  // (see App.tsx's own comment there for the "blank screen" field-report
  // lesson this exists to fix) — `key={screen.name}` remounts the fade
  // wrapper (and, inside it, gets a fresh ErrorBoundary instance for free)
  // on every navigation, same mechanism. `onError` is wired to the real
  // activity log as of this increment (increment 1 left it as the
  // `console.warn` fallback — see ErrorBoundary.tsx's own header comment,
  // "fulfilled" as that comment put it).
  return (
    <ErrorBoundary onReset={() => setScreen({ name: 'home' })} onError={(message) => void logEvent('lifecycle', message)}>
      <div key={screen.name} className="motion-safe:animate-fade-in">
        {renderScreen()}
      </div>
    </ErrorBoundary>
  );
}
