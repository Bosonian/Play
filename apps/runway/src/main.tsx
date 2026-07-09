import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './db/db'; // import for side effect: registers the populate hook before first open
import './index.css';
import { registerNotificationNavigation } from './native/notifications';
import { registerDeepLinkNavigation } from './native/deepLinks';
import { refreshWidgets } from './native/widgets';
import { navigateToDeparture, navigateToScreen } from './lib/navigationRef';

// Registered here, before the first render, rather than inside App — this
// is the earliest point in the app's lifecycle a listener can attach, which
// gives it the best chance of catching a notification tap that cold-started
// the app (see the comment on registerNotificationNavigation for the
// caveat: this is still not a guarantee, just the best available option).
// navigateToDeparture queues the navigation if App hasn't mounted yet.
void registerNotificationNavigation(navigateToDeparture);

// Widgets increment: a tap on the Prüfung widget or a static home-screen
// shortcut cold-starts (or resumes) the app via a `runway://...` URL —
// registered here for the same "as early as possible" reason as the
// notification listener above. Unlike that one, this also reliably catches
// the cold-start case itself (see registerDeepLinkNavigation's doc comment
// for why @capacitor/app's getLaunchUrl makes that reliable here).
void registerDeepLinkNavigation(navigateToScreen);

// Fire-and-forget: refreshes the home-screen widget from whatever's
// currently in Dexie, so it isn't left showing data from before the app was
// last closed. Never blocks the first render — see refreshWidgets' own doc
// comment for the full list of call sites and why an explicit list beats a
// generic Dexie hook.
void refreshWidgets();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
