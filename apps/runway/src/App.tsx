import { useState } from 'react';
import { Home } from './screens/Home';
import { TemplateEdit } from './screens/TemplateEdit';
import { DepartureSetup } from './screens/DepartureSetup';
import { Runway } from './screens/Runway';

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
  | { name: 'runway'; departureId: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

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
  }
}
