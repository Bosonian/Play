import { useEffect, useState } from 'react';
import { Home } from './screens/Home';
import { WeighInEntry } from './screens/WeighInEntry';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { logEvent } from './lib/eventLog';
import { syncHealthData } from './lib/healthSync';

// Navigation as plain React state, not a router library — same call Runway
// made in increment 1, for the same reason: no deep-linkable URL
// requirement yet (no shareable weigh-in links, no browser back/forward
// across screens) and only four screens. A router would be ceremony
// without payoff here; revisit if that changes (e.g. a future notification
// tap that should open straight to WeighInEntry).
export type Screen = { name: 'home' } | { name: 'weighInEntry' } | { name: 'history' } | { name: 'settings' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

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
