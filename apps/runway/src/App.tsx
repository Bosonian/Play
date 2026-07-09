import { useEffect, useState } from 'react';
import { Home } from './screens/Home';
import { TemplateEdit } from './screens/TemplateEdit';
import { DepartureSetup } from './screens/DepartureSetup';
import { Runway } from './screens/Runway';
import { History } from './screens/History';
import { setNavigationRef } from './lib/navigationRef';

// Navigation as plain React state, not a router library. There's no
// deep-linkable URL requirement in increment 1 (no shareable departure
// links, no browser back/forward across screens) and only four screens —
// a router would be ceremony without payoff here. If that changes later
// (e.g. "open straight to today's departure" from a notification tap),
// revisit this.
export type Screen =
  | { name: 'home' }
  | { name: 'templateEdit'; id?: string }
  | { name: 'departureSetup'; templateId?: string; departureId?: string }
  | { name: 'runway'; departureId: string }
  | { name: 'history' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  // Makes `setScreen` reachable from outside the component tree. The actual
  // notification-tap listener is registered in main.tsx, before this
  // component ever mounts (see src/lib/navigationRef.ts for why: it needs
  // to attach as early as possible to have a chance at catching a
  // cold-start tap) — this effect is the other half of that handoff, and
  // also replays any navigation that arrived before this ran.
  useEffect(() => {
    setNavigationRef(setScreen);
    return () => setNavigationRef(null);
  }, []);

  switch (screen.name) {
    case 'home':
      return <Home onNavigate={setScreen} />;
    case 'templateEdit':
      return <TemplateEdit id={screen.id} onNavigate={setScreen} />;
    case 'departureSetup':
      return (
        <DepartureSetup
          templateId={screen.templateId}
          departureId={screen.departureId}
          onNavigate={setScreen}
        />
      );
    case 'runway':
      return <Runway departureId={screen.departureId} onNavigate={setScreen} />;
    case 'history':
      return <History onNavigate={setScreen} />;
  }
}
