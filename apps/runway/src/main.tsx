import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './db/db'; // import for side effect: registers the populate hook before first open
import './index.css';
import { registerNotificationNavigation } from './native/notifications';
import { navigateToDeparture } from './lib/navigationRef';

// Registered here, before the first render, rather than inside App — this
// is the earliest point in the app's lifecycle a listener can attach, which
// gives it the best chance of catching a notification tap that cold-started
// the app (see the comment on registerNotificationNavigation for the
// caveat: this is still not a guarantee, just the best available option).
// navigateToDeparture queues the navigation if App hasn't mounted yet.
void registerNotificationNavigation(navigateToDeparture);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
