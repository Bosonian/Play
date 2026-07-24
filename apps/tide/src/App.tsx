import { useState } from 'react';
import { Home } from './screens/Home';
import { WeighInEntry } from './screens/WeighInEntry';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { ErrorBoundary } from './ui/ErrorBoundary';

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

  // ErrorBoundary wraps every screen's render, same placement as Runway's
  // (see App.tsx's own comment there for the "blank screen" field-report
  // lesson this exists to fix) — `key={screen.name}` remounts the fade
  // wrapper (and, inside it, gets a fresh ErrorBoundary instance for free)
  // on every navigation, same mechanism.
  return (
    <ErrorBoundary onReset={() => setScreen({ name: 'home' })}>
      <div key={screen.name} className="motion-safe:animate-fade-in">
        {renderScreen()}
      </div>
    </ErrorBoundary>
  );
}
